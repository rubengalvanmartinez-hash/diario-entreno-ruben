/**
 * MEAM — orquestación a fecha de corte (port de meam_engine.run_weekly, 2.3.0-rc).
 * Sin look-ahead ni caché entre cortes; las exclusiones de ruido por episodio confirmado son estado DERIVADO y versionado;
 * el eje de recuperación se evalúa en la variante y estrato donde se congeló la referencia.
 */
import { MEAM_CONFIG as CFG } from './config'
import { NaN_, isFin, mean, median } from './mathx'
import {
  type Exposure, type VariantStats, type ForecastError, type ClusterStat, type MuscleStat, type AdaptationState, type RecoveryState, type RecoveryInputs, type UserContext,
  rollingOriginErrors, segments, variantStats, stateWindowResiduals, strataFor, combineCluster, muscleStat, initialAdaptation, recoveryState,
  stepAdaptation, stepRecovery, reductionEvents, robustScale, pooledRho1, dedupeSameDay, pairwiseClusterCorr, trendHw,
} from './core'

export type VariantRole = 'DIRECT' | 'SECONDARY' | 'STABILIZER'
export type EquipmentClass = 'compound_free' | 'isolation_machine' | 'assisted' | 'weighted_bodyweight'

export interface VariantDef {
  exps: Exposure[]
  cluster: string
  equipment_class: EquipmentClass
  role: VariantRole
  protocol_breaks: number[]
}

export const variantDef = (exps: Exposure[], cluster: string, equipment_class: EquipmentClass = 'compound_free', role: VariantRole = 'DIRECT', protocol_breaks: number[] = []): VariantDef =>
  ({ exps, cluster, equipment_class, role, protocol_breaks })

/** Derivado y versionado: intervalo [t0, t1] de una variante excluido del estimador de ruido, originado en el corte from_cutoff. */
export interface NoiseExclusion { vid: string; t0: number; t1: number; from_cutoff: number }

export function prefix(vd: VariantDef, vid: string, cutoff: number, exclusions: readonly NoiseExclusion[]): Exposure[] {
  const ex = exclusions.filter((ne) => ne.vid === vid && ne.from_cutoff < cutoff)
  const out: Exposure[] = []
  for (const e of vd.exps) {
    if (e.t >= cutoff) break
    if (ex.length && ex.some((ne) => ne.t0 <= e.t && e.t <= ne.t1) && !e.excluded_from_noise) out.push({ ...e, excluded_from_noise: true })
    else out.push(e)
  }
  return dedupeSameDay(out)
}

export function segmentOf(sub: readonly Exposure[], vd: VariantDef): Exposure[] {
  if (sub.length === 0) return []
  const segs = segments(sub, vd.protocol_breaks)
  return segs[segs.length - 1].map((i) => sub[i])
}

/** Cantidades por variante y corte que el contexto de usuario reutiliza (caché opcional; auditoría 6, C1). */
interface PoolVariantStats { fc: number | null; res: number | null; resid: number[] | null; ro: ForecastError[] | null; n: number; first_t: number }
export type ContextCache = Map<string, PoolVariantStats>

function poolVariantAt(vid: string, vd: VariantDef, cutoff: number, exclusions: readonly NoiseExclusion[], cache?: ContextCache): PoolVariantStats {
  // clave: las exclusiones de una variante solo se crean en la ejecución de su músculo y solo se añaden ⇒ (vid, corte, nº aplicable) identifica el prefijo
  const nEx = exclusions.filter((ne) => ne.vid === vid && ne.from_cutoff < cutoff).length
  const key = `${vid}|${cutoff}|${nEx}`
  const hit = cache?.get(key)
  if (hit) return hit
  const seg = segmentOf(prefix(vd, vid, cutoff, exclusions), vd)
  const out: PoolVariantStats = { fc: null, res: null, resid: null, ro: null, n: seg.length, first_t: seg.length ? seg[0].t : NaN_ }
  // incremental: el último cálculo de esta variante con el mismo nº de exclusiones (corte anterior) si es prefijo del segmento actual
  const last = cache?.get(`${vid}|last|${nEx}`)
  if (seg.length >= 3) {
    const ro = rollingOriginErrors(seg, last && last.ro ? { n: last.n, errors: last.ro, first_t: last.first_t } : null)
    out.ro = ro
    if (seg.length > CFG.M_min) {
      const e = ro.filter((fe) => fe.valid && fe.k >= CFG.fc_min_train).map((fe) => fe.e)
      if (e.length >= CFG.prior_min_n_err) { const sc = robustScale(e); if (sc > 0) out.fc = sc }
      const res = stateWindowResiduals(seg)
      if (res.length >= CFG.prior_min_n_err) {
        const sc = robustScale(res)
        if (sc > 0) out.res = sc
        out.resid = res
      }
    }
  }
  cache?.set(key, out)
  cache?.set(`${vid}|last|${nEx}`, out)
  return out
}

/** Prior y autocorrelación agrupados por USUARIO (todas sus variantes), con datos < cutoff. */
export function userContextAt(pool: ReadonlyMap<string, VariantDef>, cutoff: number, exclusions: readonly NoiseExclusion[], equipmentClass: EquipmentClass, rhoFixed?: number | null, cache?: ContextCache): UserContext {
  const resClass: number[] = [], resAll: number[] = [], fcAll: number[] = [], errSeries: number[][] = []
  for (const [vid, vd] of pool) {
    const pv = poolVariantAt(vid, vd, cutoff, exclusions, cache)
    if (pv.fc !== null) fcAll.push(pv.fc)
    if (pv.resid !== null) {
      if (pv.res !== null) { resAll.push(pv.res); if (vd.equipment_class === equipmentClass) resClass.push(pv.res) }
      errSeries.push(pv.resid)
    }
  }
  const prior = resClass.length ? median(resClass) : resAll.length ? median(resAll) : CFG.prior_default_log[equipmentClass]
  const priorFc = fcAll.length ? median(fcAll) : NaN_
  const nRho = errSeries.filter((e) => e.length >= CFG.rho_min_n_err).length
  return { sigma_prior: prior, rho1: rhoFixed === undefined || rhoFixed === null ? pooledRho1(errSeries) : rhoFixed, sigma_prior_fc: priorFc, rho_calibrated: nRho >= CFG.rho_min_variants }
}

/** Fila de snapshot (mismos campos que la referencia Python + evidencia por variante para «¿por qué?»). */
export interface SnapshotRow {
  week: number; n_exp: number; tier: string; n_err: number; sigma_pct: number; DCT_pct: number; D: number; T: number; eff: number
  adaptation: string; adapt_label: string; recovery: string; rec_label: string; flags: string; rho: number; mds: number
  /** evidencia adicional (no forma parte del contrato de igualdad con Python) */
  evidence: SnapshotEvidence
}

export interface VariantEvidence {
  vid: string; cluster: string; role: VariantRole; n_exposures: number; n_normal: number; tier: string; n_err: number; sigma_pct: number
  T: number; slope_pct_wk: number; lower_pct_wk: number; upper_pct_wk: number; mds_pct_wk: number; D: number; DCT_pct: number
  level_recent: number; base_median: number; n_recent_below: number; stratum: string; temporal_quality: string; time_span_weeks: number
  median_gap_days: number; gap_cv: number; T_long: number; long_slope_pct_wk: number; long_lower_pct_wk: number; long_upper_pct_wk: number
  flags: string[]; last_t: number; interruption_recent: boolean
}

export interface SnapshotEvidence {
  cutoff: number
  variants: VariantEvidence[]
  clusters: Record<string, { slope_pct_wk: number; lower_pct_wk: number; upper_pct_wk: number; T: number; D: number; n_variants: number; corr_mean: number; long_slope_pct_wk: number; long_lower_pct_wk: number; long_upper_pct_wk: number } | null>
  muscle: MuscleStat | null
  adaptation: AdaptationState
  recovery: RecoveryState
  context_high: boolean
  rho_calibrated: boolean
  exclusions: NoiseExclusion[]
  has_new_data: boolean
  span_weeks: number
  sigma_pct: number
}

export interface RunOptions {
  /** cortes (semanas, en la misma escala que Exposure.t); cada corte incluye solo exposiciones con t < corte */
  cutoffs: number[]
  contextHighCutoffs?: ReadonlySet<number>
  volumeReductionTs?: number[]
  rhoFixed?: number | null
  /** todas las variantes del usuario (prior y ρ); por defecto las del músculo */
  pool?: ReadonlyMap<string, VariantDef>
  /** caché compartida entre músculos de las cantidades por variante y corte (rendimiento) */
  ctxCache?: ContextCache
}

function coverWeeks(exclusions: readonly NoiseExclusion[], vid: string, cutoff: number, extra?: [number, number]): number {
  const ivs = exclusions.filter((ne) => ne.vid === vid && ne.t1 >= cutoff - 52).map((ne) => [Math.max(ne.t0, cutoff - 52), ne.t1] as [number, number])
  if (extra) ivs.push([Math.max(extra[0], cutoff - 52), extra[1]])
  ivs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (ivs.length === 0) return 0
  let covered = 0; let [a0, b0] = ivs[0]
  for (const [a, b] of ivs.slice(1)) {
    if (a <= b0) b0 = Math.max(b0, b)
    else { covered += b0 - a0; a0 = a; b0 = b }
  }
  return covered + (b0 - a0)
}

/** Un músculo con una o varias variantes/clusters, evaluado en cada corte en orden. */
export function runSnapshots(variants: ReadonlyMap<string, VariantDef>, opts: RunOptions): SnapshotRow[] {
  const pool = opts.pool ?? variants
  const exclusions: NoiseExclusion[] = []
  let ad: AdaptationState = initialAdaptation(); let rec: RecoveryState = recoveryState()
  const rows: SnapshotRow[] = []; let lastMaxT = -Infinity; let exclFlags = new Set<string>()
  const ctxHigh = opts.contextHighCutoffs ?? new Set<number>()
  const volRed = opts.volumeReductionTs ?? []
  const vids = [...variants.keys()]
  for (const cutoff of opts.cutoffs) {
    const perVar = new Map<string, VariantStats>(); const segs = new Map<string, Exposure[]>()
    for (const vid of vids) {
      const vd = variants.get(vid)!
      const seg = segmentOf(prefix(vd, vid, cutoff, exclusions), vd)
      if (seg.length < 3) continue
      const ctx = userContextAt(pool, cutoff, exclusions, vd.equipment_class, opts.rhoFixed, opts.ctxCache)
      const nEx = exclusions.filter((ne) => ne.vid === vid && ne.from_cutoff < cutoff).length
      const cached = opts.ctxCache?.get(`${vid}|${cutoff}|${nEx}`)
      const ro = cached && cached.ro && cached.n === seg.length && cached.first_t === seg[0].t ? cached.ro : null
      perVar.set(vid, variantStats(seg, ctx, ro)); segs.set(vid, seg)
    }
    let maxT = -Infinity; for (const s of perVar.values()) maxT = Math.max(maxT, s.last_t)
    const hasNew = maxT > lastMaxT; lastMaxT = Math.max(lastMaxT, maxT)
    const clusters = new Map<string, ClusterStat | null>()
    for (const cid of [...new Set(vids.map((v) => variants.get(v)!.cluster))].sort()) {
      const members = vids.filter((v) => variants.get(v)!.cluster === cid && variants.get(v)!.role === 'DIRECT' && perVar.has(v)).map((v) => perVar.get(v)!)
      clusters.set(cid, members.length ? combineCluster(members) : null)
    }
    const drivers = [...perVar.values()].filter((s) => s.trend !== null)
    const sig = drivers.length ? median(drivers.map((s) => s.unc.sigma_eff)) : NaN_
    const span = drivers.length ? median(drivers.map((s) => s.trend!.span_weeks)) : 0
    const ms = muscleStat(clusters, sig, span)
    const interrupted = [...perVar.values()].some((s) => s.interruption_recent)
    const inconclusive = ms === null || interrupted
    // --- recuperación: variante driver y su estrato ---
    const prevRecState = rec.state
    const Dvals = new Map<string, VariantStats>(); for (const [v, s] of perVar) if (isFin(s.D)) Dvals.set(v, s)
    let drvVid: string | null = null; let drv: VariantStats | null = null
    if (rec.driver_vid && rec.state !== 'NORMAL') {
      drvVid = rec.driver_vid; drv = perVar.get(drvVid) ?? null
      if (!drv || drv.stratum !== rec.driver_stratum) { rec = recoveryState({ label: 'NO_EVALUABLE_CAMBIO_PROTOCOLO' }); drv = null }
    } else {
      let best: string | null = null
      for (const [v, s] of Dvals) if (best === null || s.D < Dvals.get(best)!.D) best = v
      drvVid = best; drv = best ? perVar.get(best) ?? null : null
    }
    if (drv && drvVid && segs.has(drvVid)) {
      let nConc = isFin(drv.D) && drv.D <= CFG.D_enter ? 1 : 0
      for (const [v2, s2] of Dvals) {
        if (v2 !== drvVid && s2.D <= CFG.D_enter) {
          const [R] = pairwiseClusterCorr([drv, s2])
          if (R[0][1] <= CFG.corroboration_corr_max) nConc += 1
        }
      }
      const tierOk = drv.unc.tier === 'ESTABLISHED' || drv.unc.tier === 'MATURE'
      const dseg = segs.get(drvVid)!; const S = strataFor(dseg)
      const same = dseg.filter((e, i) => S[i] === drv!.stratum && e.session_type === 'normal')
      const redT = reductionEvents(dseg, cutoff, volRed)
      const post = isFin(redT) ? same.filter((e) => e.t > redT).map((e) => e.y) : []
      const pre = isFin(redT) ? same.filter((e) => e.t <= redT).map((e) => e.y) : []
      const x: RecoveryInputs = {
        D_m: ms ? ms.D_m : NaN_, n_recent_below: drv.n_recent_below, tier_ok: tierOk, context_high: ctxHigh.has(cutoff), n_variants_concordant: nConc,
        level_recent: drv.level_recent, base_median: drv.base_median, DCT: drv.DCT, reduction_t: redT, post_reduction_levels: post,
        last_level_before_reduction: pre.length ? median(pre.slice(-2)) : NaN_, t_now: cutoff, has_new_data: hasNew, interrupted,
        driver_vid: drvVid, driver_stratum: drv.stratum,
      }
      rec = stepRecovery(rec, x)
    }
    if (rec.state === 'FATIGA_APOYADA' && prevRecState !== 'FATIGA_APOYADA') {
      const t0 = rec.t_enter - CFG.recent_max_days / 7; const t1 = isFin(rec.reduction_t) ? rec.reduction_t : cutoff
      if (coverWeeks(exclusions, rec.driver_vid, cutoff, [t0, t1]) > CFG.exclusion_max_weeks_52w) exclFlags = new Set(['EXCLUSION_EXCESIVA'])
      else exclusions.push({ vid: rec.driver_vid, t0, t1, from_cutoff: cutoff })
    }
    // bandera no pegajosa: persiste mientras no quede sitio para un episodio típico bajo el tope (auditoría 6)
    if (exclFlags.size && rec.driver_vid) {
      if (coverWeeks(exclusions, rec.driver_vid, cutoff) + CFG.exclusion_typical_episode_weeks <= CFG.exclusion_max_weeks_52w) exclFlags = new Set()
    }
    const nExpTotal = [...perVar.values()].reduce((a, s) => a + s.n_exposures, 0)
    ad = stepAdaptation(ad, ms, nExpTotal, hasNew, inconclusive, rec.state === 'FATIGA_APOYADA')
    const d0 = drivers.length ? drivers[0] : perVar.size ? [...perVar.values()][0] : null
    const allFlags = new Set<string>(); for (const s of perVar.values()) for (const f of s.flags) allFlags.add(f); for (const f of exclFlags) allFlags.add(f)
    const clusterSlopes = [...clusters.values()].filter((c): c is ClusterStat => c !== null).map((c) => c.slope)
    const ctxPool = perVar.size ? userContextAt(pool, cutoff, exclusions, 'compound_free', opts.rhoFixed, opts.ctxCache) : null
    const rhoUsed = opts.rhoFixed !== undefined && opts.rhoFixed !== null ? opts.rhoFixed : ctxPool ? ctxPool.rho1 : 0
    const evidence: SnapshotEvidence = {
      cutoff,
      variants: [...perVar.entries()].map(([vid, s]) => {
        const vd = variants.get(vid)!
        return {
          vid, cluster: vd.cluster, role: vd.role, n_exposures: s.n_exposures, n_normal: s.n_normal, tier: s.unc.tier, n_err: s.unc.n_err, sigma_pct: s.unc.sigma_eff * 100,
          T: s.T, slope_pct_wk: s.trend ? s.trend.slope * 100 : NaN_, lower_pct_wk: s.trend ? s.trend.lower * 100 : NaN_, upper_pct_wk: s.trend ? s.trend.upper * 100 : NaN_,
          mds_pct_wk: s.mds_pct_wk, D: s.D, DCT_pct: s.DCT * 100, level_recent: s.level_recent, base_median: s.base_median, n_recent_below: s.n_recent_below,
          stratum: s.stratum, temporal_quality: s.temporal_quality, time_span_weeks: s.time_span_weeks, median_gap_days: s.median_gap_days, gap_cv: s.gap_cv,
          T_long: s.T_long, long_slope_pct_wk: s.trend_long ? s.trend_long.slope * 100 : NaN_, long_lower_pct_wk: s.trend_long ? s.trend_long.lower * 100 : NaN_,
          long_upper_pct_wk: s.trend_long ? s.trend_long.upper * 100 : NaN_, flags: [...s.flags], last_t: s.last_t, interruption_recent: s.interruption_recent,
        }
      }),
      clusters: Object.fromEntries([...clusters.entries()].map(([cid, c]) => [cid, c ? {
        slope_pct_wk: c.slope * 100, lower_pct_wk: c.lower * 100, upper_pct_wk: c.upper * 100, T: c.T, D: c.D, n_variants: c.n_variants, corr_mean: c.corr_mean,
        long_slope_pct_wk: c.long_slope * 100, long_lower_pct_wk: c.long_lower * 100, long_upper_pct_wk: c.long_upper * 100,
      } : null])),
      muscle: ms, adaptation: ad, recovery: rec, context_high: ctxHigh.has(cutoff),
      rho_calibrated: ctxPool ? !!ctxPool.rho_calibrated : false,
      exclusions: [...exclusions], has_new_data: hasNew, span_weeks: span, sigma_pct: sig * 100,
    }
    rows.push({
      week: cutoff, n_exp: nExpTotal, tier: d0 ? d0.unc.tier : 'NONE', n_err: d0 ? d0.unc.n_err : 0,
      sigma_pct: d0 ? d0.unc.sigma_eff * 100 : NaN_, DCT_pct: d0 && isFin(d0.DCT) ? d0.DCT * 100 : NaN_,
      D: ms ? ms.D_m : NaN_, T: ms ? ms.T_m : NaN_,
      eff: ms && sig > 0 ? Math.abs(mean(clusterSlopes)) * span / sig : NaN_,
      adaptation: ad.state, adapt_label: ad.label, recovery: rec.state, rec_label: rec.label,
      flags: [...allFlags].sort().join(','), rho: rhoUsed, mds: d0 ? d0.mds_pct_wk : NaN_,
      evidence,
    })
  }
  return rows
}

/** Utilidad: MDS (semianchura del IC de la pendiente) en kg/mes a partir de un nivel de e1RM en kg. */
export function mdsKgPerMonth(mdsPctWk: number, e1rmKg: number): number {
  if (!isFin(mdsPctWk) || !isFin(e1rmKg)) return NaN_
  return e1rmKg * (Math.exp(mdsPctWk / 100 * (52 / 12)) - 1)
}

export { trendHw }
