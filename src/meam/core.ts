/**
 * MEAM — Motor de Evidencia de Adaptación Muscular. Núcleo estadístico (port de meam_core.py, 2.3.0-rc).
 *
 * Todo en log: y = ln(rendimiento). Pendientes en ln/semana (×100 ≈ %/semana). Escalas en ln (×100 ≈ %).
 * Funciones puras y deterministas; ninguna constante fuera de MEAM_CONFIG. La equivalencia con la referencia Python se
 * comprueba snapshot a snapshot con tests/meam_golden.json (test-meam.mts).
 */
import { MEAM_CONFIG as CFG } from './config'
import { NaN_, isFin, mean, std, median, percentile, diff, uniqueSorted, valueCounts, corrcoef, clip, sign, argsort, roundTo, normPpf, tPpf } from './mathx'

// ---------------------------------------------------------------------------------------------
// 1. Theil-Sen con IC de Sen (rangos simétricos, empates, autocorrelación finita) + suelo paramétrico
// ---------------------------------------------------------------------------------------------
export interface TrendFit {
  slope: number; intercept: number; lower: number; upper: number; n: number; span_weeks: number
  hw_sen: number; hw_param: number
  /** nivel por estrato (vacío ⇒ un solo estrato) */
  intercepts: Record<string, number>
  hasStrata: boolean
}

export function trendPredict(f: TrendFit, t: number, stratum?: string): number {
  const a = stratum !== undefined && f.hasStrata && stratum in f.intercepts ? f.intercepts[stratum] : f.intercept
  return a + f.slope * t
}
export const trendHw = (f: TrendFit): number => Math.max(f.hw_sen, f.hw_param)
export const trendDetectUp = (f: TrendFit): boolean => f.lower > 0
export const trendDetectDown = (f: TrendFit): boolean => f.upper < 0

/** Score continuo T: 1 en la frontera de detectabilidad (usa el lado del IC hacia 0). */
export function trendT(f: TrendFit): number {
  let d: number
  if (f.slope > 0) d = f.slope - f.lower
  else if (f.slope < 0) d = f.upper - f.slope
  else return 0
  d = Math.max(d, trendHw(f))
  if (d <= 0) return sign(f.slope) * CFG.T_cap
  return clip(f.slope / d, -CFG.T_cap, CFG.T_cap)
}

/** Var*(S)/Var(S) de Hamed & Rao (1998) con ρ_s(i) = ρ^i (AR(1) por exposición). Tiende a (1+ρ)/(1−ρ). */
export function hamedRaoFactor(n: number, rho: number): number {
  if (n < 3 || rho <= 0) return 1
  let s = 0
  for (let i = 1; i <= n - 2; i++) s += (n - i) * (n - i - 1) * (n - i - 2) * Math.pow(rho, i)
  return 1 + 2 * s / (n * (n - 1) * (n - 2))
}

/** Inflación finita de Var(β̂) bajo AR(1) por exposición dentro de cada estrato. */
export function slopeVarFactor(xGroups: number[][], sxx: number, rho: number): number {
  if (rho <= 0 || sxx <= 0) return 1
  let s = 0
  for (const x of xGroups) {
    for (let k = 1; k < x.length; k++) {
      let acc = 0
      for (let i = 0; i + k < x.length; i++) acc += x[i] * x[i + k]
      s += Math.pow(rho, k) * acc
    }
  }
  return Math.max(1 + 2 * s / sxx, 1)
}

export function theilSen(
  tIn: readonly number[], yIn: readonly number[], alpha = 0.05, sigmaNoise = 0.0, acFactorIn = 1.0,
  strata?: readonly string[] | null, rho?: number | null,
): TrendFit | null {
  const t = [...tIn], y = [...yIn]
  const finite = rho !== undefined && rho !== null && CFG.ac_finite_sample
  let acFactor = acFactorIn
  if (rho !== undefined && rho !== null && !finite) acFactor = (1 + rho) / (1 - rho)
  const n = t.length
  if (n < 3 || uniqueSorted(t).length < 3) return null
  // grupos (estratos) en orden lexicográfico como numpy.unique
  let groups: Array<[string, number[]]>
  if (!strata) {
    groups = [['_', t.map((_, i) => i)]]
  } else {
    const names = [...new Set(strata)].sort()
    groups = names.map((s) => [s, strata.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0)] as [string, number[]])
      .filter(([, g]) => g.length >= 2)
    if (groups.length === 0 || groups.reduce((a, [, g]) => a + g.length, 0) < 3) return null
  }
  const slopes: number[] = []
  let varS = 0, sxx = 0
  const xGroups: number[][] = []
  for (const [, g] of groups) {
    const tg = g.map((i) => t[i]), yg = g.map((i) => y[i]); const m = g.length
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const dt = tg[j] - tg[i]
      if (dt > 0) slopes.push((yg[j] - yg[i]) / dt)
    }
    const counts = valueCounts(yg)
    let tieTerm = 0
    for (const c of counts) tieTerm += c * (c - 1) * (2 * c + 5)
    const vS = Math.max((m * (m - 1) * (2 * m + 5) - tieTerm) / 18, 0)
    varS += vS * (finite ? hamedRaoFactor(m, rho as number) : 1)
    const order = argsort(tg); const tm = mean(tg)
    const xg = order.map((k) => tg[k] - tm)
    for (const v of xg) sxx += v * v
    xGroups.push(xg)
  }
  if (slopes.length === 0) return null
  if (finite) acFactor = slopeVarFactor(xGroups, sxx, rho as number)
  slopes.sort((a, b) => a - b)
  const ns = slopes.length
  const beta = median(slopes)
  const intercepts: Record<string, number> = {}
  for (const [s, g] of groups) intercepts[s] = median(g.map((i) => y[i] - beta * t[i]))
  let inter: number
  if (strata) {
    const last = String(strata[strata.length - 1])
    inter = last in intercepts ? intercepts[last] : intercepts[groups[groups.length - 1][0]]
  } else inter = intercepts['_']
  varS = Math.max(varS, 1) * (finite ? 1 : acFactor)
  const z = normPpf(1 - alpha / 2)
  const c = z * Math.sqrt(varS)
  const m1 = Math.floor((ns - c) / 2)
  const loIdx = Math.min(Math.max(m1, 0), ns - 1); const hiIdx = Math.max(ns - 1 - loIdx, 0)
  let lower = slopes[loIdx], upper = slopes[hiIdx]
  const span = t[n - 1] - t[0]
  const hwSen = (upper - lower) / 2
  const hwParam = sxx > 0 ? z * sigmaNoise * Math.sqrt(acFactor) / Math.sqrt(sxx) : 0
  lower = Math.min(lower, beta - hwParam); upper = Math.max(upper, beta + hwParam)
  return { slope: beta, intercept: inter, lower, upper, n, span_weeks: span, hw_sen: hwSen, hw_param: hwParam, intercepts: strata ? intercepts : {}, hasStrata: !!strata }
}

// ---------------------------------------------------------------------------------------------
// 2. Exposiciones, estratos, segmentos, errores rolling-origin, escala causal
// ---------------------------------------------------------------------------------------------
export type SessionType = 'normal' | 'deload' | 'rehab' | 'test'

export interface Exposure {
  t: number; y: number
  session_type: SessionType
  excluded_from_noise: boolean
  reps_typical: number
  load_kg: number
  /** vacío ⇒ se deriva de reps_typical (banda de repeticiones) */
  stratum: string
}

export function makeExposure(p: Partial<Exposure> & { t: number; y: number }): Exposure {
  return { session_type: 'normal', excluded_from_noise: false, reps_typical: 8, load_kg: 100, stratum: '', ...p }
}

export function repBand(reps: number): string {
  for (const [lo, hi] of CFG.rep_bands) if (lo <= reps && reps <= hi) return `r${lo}-${hi}`
  return reps > 20 ? 'r13-20' : 'r1-5'
}

function interleaved(repsRecent: number[]): boolean {
  if (repsRecent.length < CFG.interleave_window) return false
  const bands = repsRecent.map((r) => repBand(r))
  const groups = new Map<string, number[]>()
  bands.forEach((b, i) => { if (!groups.has(b)) groups.set(b, []); groups.get(b)!.push(repsRecent[i]) })
  const bigBands = [...groups.keys()].filter((k) => groups.get(k)!.length >= CFG.interleave_min)
  const big = bigBands.map((k) => median(groups.get(k)!))
  const seq = bands.filter((b) => bigBands.includes(b))
  let switches = 0
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) switches++
  return big.length >= 2 && (Math.max(...big) - Math.min(...big)) >= CFG.stratum_shift_reps && switches >= CFG.interleave_min_switches
}

/** Estrato de protocolo por exposición (secuencial con histéresis y separación mínima de reps; intercalado por exposición). */
export function strataFor(exps: readonly Exposure[]): string[] {
  const out: string[] = []; let cur: string | null = null
  const hist: string[] = []; const repsHist: number[] = []
  const w = CFG.stratum_window
  for (const e of exps) {
    const b = e.stratum || repBand(e.reps_typical)
    hist.push(b); repsHist.push(e.reps_typical)
    if (e.stratum) { out.push(b); cur = b; continue }
    if (interleaved(repsHist.slice(-CFG.interleave_window))) { out.push(b); cur = b; continue }
    if (cur === null) cur = b
    else if (b !== cur && hist.length >= w && hist.slice(-w).every((h) => h === b)) {
      const outPrev = w > 1 ? out.slice(0, out.length - (w - 1)) : out
      const repsPrev = repsHist.slice(0, repsHist.length - w)
      const curReps: number[] = []
      for (let j = 0; j < Math.min(repsPrev.length, outPrev.length); j++) if (outPrev[j] === cur) curReps.push(repsPrev[j])
      const curRecent = curReps.slice(-CFG.interleave_window)
      const newReps = repsHist.slice(-w)
      const far = curRecent.length === 0 || Math.abs(median(newReps) - median(curRecent)) >= CFG.stratum_shift_reps
      if (far) {
        cur = b
        for (let j = out.length - (w - 1); j < out.length; j++) if (j >= 0 && hist[j] === b) out[j] = b
      }
    }
    out.push(cur)
  }
  return out
}

/** Transición secuencial en curso (alguna de las últimas exposiciones se aleja ≥3 reps del estrato actual sin unanimidad). */
export function stratumPending(exps: readonly Exposure[], S: readonly string[]): boolean {
  if (exps.length === 0) return false
  if (interleaved(exps.slice(-CFG.interleave_window).map((e) => e.reps_typical))) return false
  const last = S[S.length - 1]
  const same = exps.filter((_, i) => S[i] === last).map((e) => e.reps_typical).slice(-CFG.interleave_window)
  const ref = same.length ? median(same) : exps[exps.length - 1].reps_typical
  const tail = exps.slice(-(CFG.stratum_window - 1))
  return tail.some((e) => Math.abs(e.reps_typical - ref) >= CFG.stratum_shift_reps && (e.stratum || repBand(e.reps_typical)) !== last)
}

/** Una exposición por día natural y variante (la mejor; prevalece 'normal'). */
export function dedupeSameDay(exps: readonly Exposure[]): Exposure[] {
  if (!CFG.dedupe_same_day || exps.length < 2) return [...exps]
  const best = new Map<number, Exposure>(); const order: number[] = []
  for (const e of exps) {
    const day = Math.floor(e.t * 7 + 1e-9)
    const b = best.get(day)
    if (!b) { best.set(day, e); order.push(day); continue }
    const eNorm = e.session_type === 'normal', bNorm = b.session_type === 'normal'
    if ((eNorm && !bNorm) || (eNorm === bNorm && e.y > b.y)) best.set(day, e)
  }
  return order.map((d) => best.get(d)!)
}

export function medianGapDays(t: readonly number[]): number {
  const tt = t.slice(-CFG.gap_normal_window)
  if (tt.length - 1 < CFG.gap_normal_min_intervals) return CFG.gap_normal_default_days
  return median(diff(tt)) * 7
}

export function interruptionFlags(exps: readonly Exposure[]): boolean[] {
  const t = exps.map((e) => e.t); const out = exps.map(() => false)
  for (let k = 1; k < exps.length; k++) {
    const gap = (t[k] - t[k - 1]) * 7
    out[k] = gap > Math.max(CFG.gap_interruption_days_min, CFG.gap_interruption_factor * medianGapDays(t.slice(0, k)))
  }
  return out
}

export function segments(exps: readonly Exposure[], protocolBreaks: readonly number[] = []): number[][] {
  const segs: number[][] = []; let cur: number[] = []
  exps.forEach((e, k) => {
    let isNew = false
    if (cur.length) {
      const prev = exps[cur[cur.length - 1]]
      if ((e.t - prev.t) * 7 > CFG.gap_segment_reset_days) isNew = true
      if (protocolBreaks.some((pb) => prev.t < pb && pb <= e.t)) isNew = true
    }
    if (isNew) { segs.push(cur); cur = [] }
    cur.push(k)
  })
  if (cur.length) segs.push(cur)
  return segs
}

export interface ForecastError { k: number; e: number; valid: boolean; horizon_weeks: number }

/**
 * Errores 1-paso causales: el error k solo depende de exposiciones ≤ k (y de sus estratos, que son definitivos una vez
 * llegan las 3 exposiciones siguientes). `prev` permite el cálculo incremental: si `prev.exps` es prefijo de `exps`
 * (mismo segmento), se reutilizan los errores con k < prev.n − 4 y se recalculan los demás. Idéntico al cálculo completo.
 */
export function rollingOriginErrors(exps: readonly Exposure[], prev?: { n: number; errors: ForecastError[]; first_t: number } | null): ForecastError[] {
  const t = exps.map((e) => e.t), y = exps.map((e) => e.y)
  const interr = interruptionFlags(exps); const S = strataFor(exps)
  const out: ForecastError[] = []
  let k0: number = CFG.M_min
  if (prev && prev.n <= exps.length && exps.length > 0 && prev.first_t === exps[0].t) {
    const kFinal = prev.n - (CFG.stratum_window + 1)              // errores con k < kFinal: estratos y ventana ya definitivos
    for (const fe of prev.errors) if (fe.k < kFinal) out.push({ ...fe, valid: (!exps[fe.k].excluded_from_noise) && (!interr[fe.k]) && exps[fe.k].session_type === 'normal' })
    k0 = Math.max(CFG.M_min, kFinal)
  }
  for (let k = k0; k < exps.length; k++) {
    const lo = Math.max(0, k - CFG.M_max)
    const idx: number[] = []
    for (let i = lo; i < k; i++) if (exps[i].session_type === 'normal') idx.push(i)
    if (idx.length < CFG.M_min - 2) continue
    const sk = S[k]
    if (idx.filter((i) => S[i] === sk).length < 2) continue
    const fit = theilSen(idx.map((i) => t[i]), idx.map((i) => y[i]), 0.05, 0, 1, idx.map((i) => S[i]))
    if (!fit || !(sk in fit.intercepts)) continue
    const err = y[k] - trendPredict(fit, t[k], sk)
    const valid = !exps[k].excluded_from_noise && !interr[k] && exps[k].session_type === 'normal'
    out.push({ k, e: err, valid, horizon_weeks: t[k] - t[k - 1] })
  }
  return out
}

export function robustScale(e: readonly number[]): number {
  if (e.length < 2) return NaN_
  const med = median(e)
  const mad = median(e.map((v) => Math.abs(v - med)))
  if (mad > 0) return 1.4826 * mad
  const q75 = percentile(e, 75), q25 = percentile(e, 25)
  return q75 > q25 ? (q75 - q25) / 1.349 : 0
}

/** Suelo de escala por resolución de medida (ln). */
export function resolutionFloor(repsTypical: number, loadKg: number, yRecent?: readonly number[] | null): number {
  const k = CFG.epley_k; const r = Math.max(Math.trunc(repsTypical), 1)
  const dRep = Math.log((1 + (r + 1) / k) / (1 + r / k))
  const dLoad = loadKg > 0 ? Math.log((loadKg + CFG.resolution_load_increment_kg) / loadKg) : 0
  const cap = Math.max(dRep, dLoad) * CFG.resolution_floor_factor
  if (!yRecent) return cap
  const vals = uniqueSorted(yRecent.slice(-CFG.resolution_window).map((v) => roundTo(v, 6)))
  if (vals.length < CFG.resolution_min_distinct) return cap
  return Math.min(median(diff(vals)), cap)
}

/** Cantidades agrupadas por usuario, calculadas A FECHA DE CORTE. */
export interface UserContext { sigma_prior: number; rho1: number; sigma_prior_fc: number; rho_calibrated?: boolean }
export const ctxPriorFc = (c: UserContext): number => (isFin(c.sigma_prior_fc) ? c.sigma_prior_fc : CFG.fc_over_res_default * c.sigma_prior)
export const ctxAcFactor = (c: UserContext): number => (1 + c.rho1) / (1 - c.rho1)

export function stateWindowResiduals(exps: readonly Exposure[]): number[] {
  const t = exps.map((e) => e.t), y = exps.map((e) => e.y)
  const tl = t[t.length - 1]
  const idx: number[] = []
  for (let i = 0; i < exps.length; i++) if (exps[i].session_type === 'normal' && (tl - t[i]) <= CFG.state_span_max_weeks) idx.push(i)
  const idx2 = idx.slice(-CFG.N_state)
  if (idx2.length < CFG.rho_min_n_err) return []
  const S = strataFor(exps)
  const f = theilSen(idx2.map((i) => t[i]), idx2.map((i) => y[i]), 0.05, 0, 1, idx2.map((i) => S[i]))
  if (!f) return []
  return idx2.filter((i) => S[i] in f.intercepts).map((i) => y[i] - trendPredict(f, t[i], S[i]))
}

export function pooledRho1(errorSeries: readonly (readonly number[])[]): number {
  const vals: number[] = []
  for (const e of errorSeries) {
    if (e.length >= CFG.rho_min_n_err && std(e) > 0) {
      const m = mean(e); const x = e.map((v) => v - m)
      let num = 0, den = 0
      for (let i = 1; i < x.length; i++) num += x[i] * x[i - 1]
      for (const v of x) den += v * v
      vals.push(num / den)
    }
  }
  if (vals.length < CFG.rho_min_variants) return CFG.rho_default_uncalibrated
  return clip(median(vals), CFG.rho_clip[0], CFG.rho_clip[1])
}

export interface Uncertainty { sigma_eff: number; n_err: number; k: number; tier: string; sigma_own: number; sigma_prior: number; sigma_floor: number; quantized: boolean }

export function causalUncertainty(devsBefore: readonly number[], ctx: UserContext, sigmaFloor: number, prior?: number, window?: number): Uncertainty {
  const pr = prior ?? ctx.sigma_prior
  const e = devsBefore.slice(-(window ?? CFG.W_err)); const nErr = e.length
  const sigmaOwn = nErr >= 2 ? robustScale(e) : NaN_
  const n0 = CFG.prior_pseudo_n * Math.max(0, 1 - nErr / CFG.prior_pseudo_n_zero_at)
  let sigmaEff: number
  if (nErr >= 2 && isFin(sigmaOwn)) sigmaEff = (nErr + n0) > 0 ? Math.sqrt((nErr * sigmaOwn * sigmaOwn + n0 * pr * pr) / (nErr + n0)) : sigmaOwn
  else sigmaEff = pr
  const quantized = nErr >= CFG.tier_established && sigmaOwn < sigmaFloor
  sigmaEff = Math.max(sigmaEff, sigmaFloor)
  const nu = Math.max(CFG.nu_min, Math.floor(CFG.nu_fraction * nErr))
  const k = tPpf(1 - CFG.alpha_D / (CFG.alpha_D_one_sided ? 1 : 2), nu) * CFG.kappa
  const tier = nErr === 0 ? 'NONE' : nErr < CFG.tier_established ? 'PROVISIONAL' : nErr < CFG.tier_mature ? 'ESTABLISHED' : 'MATURE'
  return { sigma_eff: sigmaEff, n_err: nErr, k, tier, sigma_own: sigmaOwn, sigma_prior: pr, sigma_floor: sigmaFloor, quantized }
}

// ---------------------------------------------------------------------------------------------
// 3. Estadísticos por variante en la fecha de corte
// ---------------------------------------------------------------------------------------------
export interface VariantStats {
  n_exposures: number; n_normal: number
  unc: Uncertainty
  trend: TrendFit | null; T: number; effect_sigma: number; mds_pct_wk: number
  recent_half: TrendFit | null
  D: number; DCT: number; delta: number; level_recent: number; base_median: number
  z_last: number[]; n_z_below: number; n_recent_below: number
  interruption_recent: boolean; post_interruption_exposures: number; interruption_in_state_window: boolean
  last_t: number; flags: string[]; stratum: string
  resid_t: number[]; resid: number[]
  n_state_window: number; time_span_weeks: number; median_gap_days: number; gap_cv: number
  rho_used: number; temporal_quality: string
  trend_long: TrendFit | null; T_long: number; long_rh_slope: number
}

export function temporalQuality(tWindow: readonly number[]): [string, number, number, number] {
  const n = tWindow.length
  const span = n >= 2 ? tWindow[n - 1] - tWindow[0] : 0
  const gaps = n >= 2 ? diff(tWindow).map((g) => g * 7) : []
  const medGap = gaps.length ? median(gaps) : NaN_
  const cv = gaps.length >= 2 && mean(gaps) > 0 ? std(gaps) / mean(gaps) : NaN_
  let q: string
  if (n < CFG.tq_min_n || span < CFG.tq_min_span_weeks) q = 'ESCASA'
  else if ((isFin(medGap) && medGap > CFG.tq_max_median_gap_days) || (isFin(cv) && cv > CFG.tq_max_gap_cv)) q = 'IRREGULAR'
  else q = 'REGULAR'
  return [q, span, medGap, cv]
}

function errsFor(ro: readonly ForecastError[], beforeK: number, minK = 0): number[] {
  return ro.filter((fe) => fe.valid && fe.k < beforeK && fe.k >= minK).map((fe) => fe.e)
}

export function causalResiduals(exps: readonly Exposure[], beforeK: number, afterK: number): number[] {
  const t = exps.map((e) => e.t), y = exps.map((e) => e.y)
  const tEnd = beforeK > 0 ? t[beforeK - 1] : t[t.length - 1]
  const idx: number[] = []
  for (let i = 0; i < exps.length; i++) {
    if (afterK < i && i < beforeK && exps[i].session_type === 'normal' && !exps[i].excluded_from_noise && (tEnd - t[i]) <= CFG.state_span_max_weeks) idx.push(i)
  }
  const idx2 = idx.slice(-CFG.N_state)
  if (idx2.length < CFG.res_min_n) return []
  const S = strataFor(exps)
  const f = theilSen(idx2.map((i) => t[i]), idx2.map((i) => y[i]), 0.05, 0, 1, idx2.map((i) => S[i]))
  if (!f) return []
  return idx2.filter((i) => S[i] in f.intercepts).map((i) => y[i] - trendPredict(f, t[i], S[i]))
}

/** exps: exposiciones del SEGMENTO actual, ordenadas, todas < fecha de corte. */
export function variantStats(exps: readonly Exposure[], ctx: UserContext, roCache?: readonly ForecastError[] | null): VariantStats {
  const n = exps.length; const flags: string[] = []
  const t = exps.map((e) => e.t), y = exps.map((e) => e.y)
  const normalIdx: number[] = []
  for (let i = 0; i < n; i++) if (exps[i].session_type === 'normal') normalIdx.push(i)
  const ro = (roCache ?? rollingOriginErrors(exps)).filter((fe) => fe.k < n)
  const interr = interruptionFlags(exps)
  let lastInterr = -1
  for (let k = 0; k < n; k++) if (interr[k]) lastInterr = k
  const postInt = lastInterr >= 0 ? n - lastInterr - 1 : n
  const eRef = normalIdx.length ? exps[normalIdx[normalIdx.length - 1]] : exps[n - 1]
  const resFloor = resolutionFloor(eRef.reps_typical, eRef.load_kg, normalIdx.map((i) => y[i]))
  // ventana reciente (solo normales, ≤ 21 d)
  const tl = t[n - 1]
  let recIdx = normalIdx.filter((i) => (tl - t[i]) * 7 <= CFG.recent_max_days).slice(-CFG.n_recent)
  if (recIdx.length < CFG.n_recent_min) { recIdx = normalIdx.slice(-CFG.n_recent_min); flags.push('RECIENTE_ESCASA') }
  const S = strataFor(exps)
  const curStrat = normalIdx.length ? S[normalIdx[normalIdx.length - 1]] : ''
  recIdx = recIdx.filter((i) => S[i] === curStrat)
  if (recIdx.length < CFG.n_recent_min) flags.push('CAMBIO_DE_ESTRATO_RECIENTE')
  const kRecentStart = recIdx.length ? recIdx[0] : n
  const unc = causalUncertainty(causalResiduals(exps, kRecentStart, lastInterr), ctx, resFloor)
  // errores de pronóstico (z)
  const zLast: number[] = []
  const roByK = new Map<number, ForecastError>(); for (const fe of ro) roByK.set(fe.k, fe)
  for (const i of recIdx) {
    const fe = roByK.get(i)
    if (fe) {
      const uI = causalUncertainty(errsFor(ro, i, CFG.fc_min_train), ctx, resFloor, ctxPriorFc(ctx))
      zLast.push(fe.e / uI.sigma_eff)
    }
  }
  const nZBelow = zLast.filter((z) => z <= CFG.z_below_thr).length
  // D: base disjunta
  let D = NaN_, DCT = NaN_, delta = NaN_, baseMed = NaN_
  const levelRecent = recIdx.length ? median(recIdx.map((i) => y[i])) : NaN_
  const basePool = normalIdx.filter((i) => i < kRecentStart && i > lastInterr && S[i] === curStrat && (t[kRecentStart - 1] - t[i]) * 7 <= CFG.base_max_days)
  const baseIdx = basePool.slice(-CFG.n_base)
  const interruptionRecent = lastInterr >= 0 && postInt < CFG.post_interruption_exposures_for_D
  const stratPending = stratumPending(normalIdx.map((i) => exps[i]), normalIdx.map((i) => S[i]))
  const DPending = baseIdx.length >= CFG.n_base_min && recIdx.length >= CFG.n_recent_min && !interruptionRecent && !stratPending
  if (stratPending) flags.push('CAMBIO_DE_ESTRATO_PENDIENTE')
  if (!DPending) flags.push(!interruptionRecent ? 'D_NO_DISPONIBLE' : 'POST_INTERRUPCION')
  // T: ventana de estado
  let trend: TrendFit | null = null; let T = NaN_, eff = NaN_, mds = NaN_; let rh: TrendFit | null = null
  let residT: number[] = [], resid: number[] = []
  let tq: [string, number, number, number] = ['ESCASA', NaN_, NaN_, NaN_]
  const tBurn = lastInterr >= 0 ? t[lastInterr] + CFG.post_interruption_burn_in_weeks : -Infinity
  let levelShift = false
  if (lastInterr >= 0) {
    const postI = normalIdx.filter((i) => i >= lastInterr && t[i] >= tBurn)
    const preI = normalIdx.filter((i) => i < lastInterr).slice(-CFG.n_base)
    if (postI.length >= CFG.post_interruption_exposures_for_D && preI.length >= CFG.n_base_min) {
      const npost = Math.min(postI.length, CFG.n_base)
      const dlev = median(postI.slice(0, npost).map((i) => y[i])) - median(preI.map((i) => y[i]))
      const seL = unc.sigma_eff * CFG.median_ineff * Math.sqrt(1 / preI.length + 1 / npost) * Math.sqrt(ctxAcFactor(ctx))
      levelShift = Math.abs(dlev) > unc.k * seL
      flags.push(levelShift ? 'POST_INTERRUPCION_CON_CAMBIO_DE_NIVEL' : 'POST_INTERRUPCION_SIN_CAMBIO_DE_NIVEL')
    } else levelShift = true
  }
  const inBurn = (i: number): boolean => lastInterr >= 0 && i >= lastInterr && t[i] < tBurn
  const stIdx = (lastInterr >= 0 && levelShift
    ? normalIdx.filter((i) => (tl - t[i]) <= CFG.state_span_max_weeks && i > lastInterr && !inBurn(i))
    : normalIdx.filter((i) => (tl - t[i]) <= CFG.state_span_max_weeks && !inBurn(i))).slice(-CFG.N_state)
  let interruptionInWindow = false
  for (let i = Math.max(0, n - CFG.N_state); i < n; i++) if ((tl - t[i]) <= CFG.state_span_max_weeks && interr[i]) interruptionInWindow = true
  const nSw = stIdx.length
  if (nSw >= 2) tq = temporalQuality(stIdx.map((i) => t[i]))
  if (stIdx.length >= CFG.N_state_min && (t[stIdx[stIdx.length - 1]] - t[stIdx[0]]) >= CFG.state_span_min_weeks) {
    trend = theilSen(stIdx.map((i) => t[i]), stIdx.map((i) => y[i]), CFG.alpha_T, unc.sigma_eff, ctxAcFactor(ctx), stIdx.map((i) => S[i]), ctx.rho1)
    if (trend) {
      T = trendT(trend); eff = Math.abs(trend.slope) * trend.span_weeks / unc.sigma_eff
      mds = trendHw(trend) * 100
      const rIdx = stIdx.filter((i) => S[i] in trend!.intercepts)
      residT = rIdx.map((i) => t[i]); resid = rIdx.map((i) => y[i] - trendPredict(trend!, t[i], S[i]))
      const halfSpan = trend.span_weeks * CFG.recent_half_fraction
      const rhIdx = stIdx.filter((i) => (tl - t[i]) <= halfSpan)
      if (rhIdx.length >= CFG.recent_half_min_n) rh = theilSen(rhIdx.map((i) => t[i]), rhIdx.map((i) => y[i]), CFG.alpha_T, unc.sigma_eff, ctxAcFactor(ctx), rhIdx.map((i) => S[i]), ctx.rho1)
    }
  } else flags.push(interruptionInWindow ? 'POST_INTERRUPCION' : 'N_STATE_INSUFICIENTE')
  // canal largo (piloto)
  let trendLong: TrendFit | null = null; let TLong = NaN_, longRhSlope = NaN_
  if (CFG.long_channel) {
    const lgIdx = (lastInterr >= 0 && levelShift
      ? normalIdx.filter((i) => (tl - t[i]) <= CFG.state_span_max_weeks_long && i > lastInterr && !inBurn(i))
      : normalIdx.filter((i) => (tl - t[i]) <= CFG.state_span_max_weeks_long && !inBurn(i))).slice(-CFG.N_state_long)
    if (lgIdx.length >= CFG.N_state_min_long && (t[lgIdx[lgIdx.length - 1]] - t[lgIdx[0]]) >= CFG.state_span_min_weeks_long) {
      trendLong = theilSen(lgIdx.map((i) => t[i]), lgIdx.map((i) => y[i]), CFG.alpha_T_long, unc.sigma_eff, ctxAcFactor(ctx), lgIdx.map((i) => S[i]), ctx.rho1)
      if (trendLong) {
        TLong = trendT(trendLong)
        const lrh = lgIdx.filter((i) => (tl - t[i]) <= trendLong!.span_weeks * CFG.recent_half_fraction)
        if (lrh.length >= CFG.recent_half_min_n) {
          const fLrh = theilSen(lrh.map((i) => t[i]), lrh.map((i) => y[i]), CFG.alpha_T_long, unc.sigma_eff, ctxAcFactor(ctx), lrh.map((i) => S[i]), ctx.rho1)
          longRhSlope = fLrh ? fLrh.slope : NaN_
        }
      }
    }
  }
  let nRecentBelow = 0
  if (DPending) {
    baseMed = median(baseIdx.map((i) => y[i]))
    const adjIdx = trend ? stIdx.filter((i) => i < kRecentStart) : []
    let betaAdj = 0
    if (adjIdx.length >= CFG.N_state_min) {
      const fAdj = theilSen(adjIdx.map((i) => t[i]), adjIdx.map((i) => y[i]), CFG.alpha_T, unc.sigma_eff, ctxAcFactor(ctx), adjIdx.map((i) => S[i]), ctx.rho1)
      betaAdj = fAdj ? fAdj.slope : 0
    }
    const tBaseMean = mean(baseIdx.map((i) => t[i]))
    delta = levelRecent - baseMed - betaAdj * (mean(recIdx.map((i) => t[i])) - tBaseMean)
    const se = unc.sigma_eff * CFG.median_ineff * Math.sqrt(1 / baseIdx.length + 1 / recIdx.length) * Math.sqrt(ctxAcFactor(ctx))
    DCT = unc.k * se; D = delta / DCT
    const expectedI = (i: number): number => baseMed + betaAdj * (t[i] - tBaseMean)
    const persIdx = normalIdx.filter((i) => i > lastInterr && S[i] === curStrat).slice(-CFG.persistence_window)
    nRecentBelow = persIdx.filter((i) => y[i] < expectedI(i) - CFG.recent_below_margin_sigma * unc.sigma_eff).length
  }
  if (unc.quantized) flags.push('SERIE_CUANTIZADA')
  if (trend && Object.keys(trend.intercepts).length >= 2) {
    const per: TrendFit[] = []
    for (const stName of Object.keys(trend.intercepts)) {
      const ii = stIdx.filter((i) => S[i] === stName)
      if (ii.length >= CFG.N_state_min) {
        const fS = theilSen(ii.map((i) => t[i]), ii.map((i) => y[i]), CFG.alpha_T, unc.sigma_eff, ctxAcFactor(ctx), null, ctx.rho1)
        if (fS) per.push(fS)
      }
    }
    if (per.some((a) => per.some((b) => a.lower > 0 && b.upper < 0))) flags.push('PENDIENTE_HETEROGENEA_ENTRE_ESTRATOS')
  }
  return {
    n_exposures: n, n_normal: normalIdx.length, unc, trend, T, effect_sigma: eff, mds_pct_wk: mds, recent_half: rh,
    D, DCT, delta, level_recent: levelRecent, base_median: baseMed, z_last: zLast, n_z_below: nZBelow, n_recent_below: nRecentBelow,
    interruption_recent: interruptionRecent, post_interruption_exposures: postInt, interruption_in_state_window: interruptionInWindow,
    last_t: t[n - 1], flags, stratum: curStrat, resid_t: residT, resid, n_state_window: nSw,
    time_span_weeks: tq[1], median_gap_days: tq[2], gap_cv: tq[3], rho_used: ctx.rho1, temporal_quality: tq[0],
    trend_long: trendLong, T_long: TLong, long_rh_slope: longRhSlope,
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Agregación: dentro de cluster (precisión con tope y correlación) → entre clusters (peso igual)
// ---------------------------------------------------------------------------------------------
export interface ClusterStat {
  slope: number; hw: number; T: number; lower: number; upper: number; recent_half_slope: number; D: number; n_variants: number
  recent_half_detect_up: boolean; recent_half_detect_down: boolean
  corr_mean: number; corr_estimated: boolean
  long_lower: number; long_upper: number; long_slope: number; long_rh_slope: number
}

/** Matriz ρ_ij entre variantes del cluster a partir de residuos emparejados por proximidad temporal (simétrica, contraída a 0,5). */
export function pairwiseClusterCorr(stats: readonly VariantStats[]): [number[][], boolean] {
  const k = stats.length
  const R: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)))
  const rho0 = CFG.cluster_corr_default, n0 = CFG.cluster_corr_pseudo_n, win = CFG.cluster_pair_window_weeks
  let anyEst = false
  const pairsOf = (t1: number[], r1: number[], t2: number[], r2: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = []; const used = new Set<number>()
    for (let i = 0; i < t1.length; i++) {
      if (t2.length === 0) break
      let j = 0, dmin = Infinity
      for (let q = 0; q < t2.length; q++) { const d = Math.abs(t2[q] - t1[i]); if (d < dmin) { dmin = d; j = q } }
      if (dmin <= win && !used.has(j)) { used.add(j); out.push([r1[i], r2[j]]) }
    }
    return out
  }
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
    const ta = stats[a].resid_t, ra = stats[a].resid, tb = stats[b].resid_t, rb = stats[b].resid
    const rs: number[] = [], ms: number[] = []
    const p1 = pairsOf(ta, ra, tb, rb); const p2 = pairsOf(tb, rb, ta, ra).map(([p, q]) => [q, p] as [number, number])
    for (const pairs of [p1, p2]) {
      const m = pairs.length
      if (m >= CFG.cluster_corr_min_pairs) {
        const xa = pairs.map((p) => p[0]), xb = pairs.map((p) => p[1])
        if (std(xa) > 1e-12 && std(xb) > 1e-12) { rs.push(corrcoef(xa, xb)); ms.push(m) }   // residuos numéricamente constantes ⇒ sin información
      }
    }
    let rho: number
    if (rs.length) { const m = mean(ms), r = mean(rs); rho = (m * r + n0 * rho0) / (m + n0); anyEst = true } else rho = rho0
    R[a][b] = R[b][a] = clip(rho, 0, 1)
  }
  return [R, anyEst]
}

export function cappedWeights(hws: readonly number[]): number[] {
  let w = hws.map((h) => 1 / (h * h)); const tot = w.reduce((a, b) => a + b, 0); w = w.map((v) => v / tot)
  const cap = CFG.cluster_max_share
  if (w.length > 1) {
    for (let it = 0; it < w.length; it++) {
      const over = w.map((v) => v > cap)
      if (!over.some(Boolean)) break
      let excess = 0
      for (let i = 0; i < w.length; i++) if (over[i]) { excess += w[i] - cap; w[i] = cap }
      const under = w.map((_, i) => !over[i])
      if (under.some(Boolean)) {
        const sumUnder = w.reduce((a, v, i) => a + (under[i] ? v : 0), 0)
        for (let i = 0; i < w.length; i++) if (under[i]) w[i] += excess * w[i] / sumUnder
      }
    }
  }
  return w
}

function quadForm(w: readonly number[], h: readonly number[], R: readonly number[][]): number {
  let s = 0
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += (w[i] * h[i]) * (w[j] * h[j]) * R[i][j]
  return Math.sqrt(Math.max(s, 0))
}

export function combineCluster(stats: readonly VariantStats[]): ClusterStat | null {
  const vs = stats.filter((s) => s.trend !== null && isFin(s.T))
  if (vs.length === 0) return null
  const hws = vs.map((s) => Math.max(trendHw(s.trend!), 1e-9)); const w = cappedWeights(hws)
  let slope = 0; for (let i = 0; i < vs.length; i++) slope += w[i] * vs[i].trend!.slope
  const hwLow = vs.map((s) => Math.max(s.trend!.slope - s.trend!.lower, 1e-9)); const hwUp = vs.map((s) => Math.max(s.trend!.upper - s.trend!.slope, 1e-9))
  const [R, est] = pairwiseClusterCorr(vs)
  const lower = slope - quadForm(w, hwLow, R); const upper = slope + quadForm(w, hwUp, R)
  const hw = (upper - lower) / 2
  const k = vs.length
  let rsum = 0; for (const row of R) for (const v of row) rsum += v
  const corrMean = k > 1 ? (rsum - k) / (k * (k - 1)) : NaN_
  const T = hw > 0 ? clip(slope / hw, -CFG.T_cap, CFG.T_cap) : 0
  const withRh = vs.filter((s) => s.recent_half !== null)
  const rhs = withRh.map((s) => s.recent_half!.slope)
  const rhSlope = rhs.length ? mean(rhs) : NaN_
  const rhUp = rhs.length > 0 && withRh.every((s) => s.recent_half!.lower > 0)
  const rhDown = rhs.length > 0 && withRh.every((s) => s.recent_half!.upper < 0)
  const Ds = vs.filter((s) => isFin(s.D)).map((s) => [s.D, s.DCT] as [number, number])
  let D = NaN_
  if (Ds.length) { const wd = cappedWeights(Ds.map((d) => d[1])); D = 0; for (let i = 0; i < Ds.length; i++) D += wd[i] * Ds[i][0] }
  let ll = NaN_, lu = NaN_, ls = NaN_, lrh = NaN_
  const idx = vs.map((s, i) => (s.trend_long ? i : -1)).filter((i) => i >= 0)
  if (idx.length) {
    const vl = idx.map((i) => vs[i]); const wsum = idx.reduce((a, i) => a + w[i], 0); const wl = idx.map((i) => w[i] / wsum)
    const Rl = idx.map((i) => idx.map((j) => R[i][j]))
    ls = 0; for (let i = 0; i < vl.length; i++) ls += wl[i] * vl[i].trend_long!.slope
    const hl = vl.map((s) => Math.max(s.trend_long!.slope - s.trend_long!.lower, 1e-9)); const hu = vl.map((s) => Math.max(s.trend_long!.upper - s.trend_long!.slope, 1e-9))
    ll = ls - quadForm(wl, hl, Rl); lu = ls + quadForm(wl, hu, Rl)
    let num = 0, den = 0
    for (let i = 0; i < vl.length; i++) if (isFin(vl[i].long_rh_slope)) { num += wl[i] * vl[i].long_rh_slope; den += wl[i] }
    lrh = den > 0 ? num / den : NaN_
  }
  return { slope, hw, T, lower, upper, recent_half_slope: rhSlope, D, n_variants: vs.length, recent_half_detect_up: rhUp, recent_half_detect_down: rhDown,
    corr_mean: corrMean, corr_estimated: est, long_lower: ll, long_upper: lu, long_slope: ls, long_rh_slope: lrh }
}

export interface MuscleStat {
  T_m: number; D_m: number; n_clusters: number; concordant: boolean; contradiction: boolean
  any_detect_up: boolean; any_detect_down: boolean; all_up: boolean; all_down: boolean
  recent_half_slope: number; effect_ok: boolean
  recent_half_detect_up: boolean; recent_half_detect_down: boolean
  change_lower: number; change_upper: number
  long_detect_up: boolean; long_detect_down: boolean
}

export function muscleStat(clusters: ReadonlyMap<string, ClusterStat | null>, sigmaEff: number, spanWeeks: number): MuscleStat | null {
  const cs = [...clusters.values()].filter((c): c is ClusterStat => c !== null)
  if (cs.length === 0) return null
  const Tm = mean(cs.map((c) => c.T))
  const Ds = cs.filter((c) => isFin(c.D)).map((c) => c.D); const Dm = Ds.length ? mean(Ds) : NaN_
  const nonneutral = cs.filter((c) => Math.abs(c.T) >= CFG.cluster_neutral_abs_T)
  const signM = sign(Tm)
  let conc: boolean
  if (cs.length === 1) conc = true
  else if (nonneutral.length === 0) conc = true
  else if (cs.length === 2) conc = nonneutral.every((c) => sign(c.T) === signM)
  else conc = mean(nonneutral.map((c) => (sign(c.T) === signM ? 1 : 0))) >= CFG.concordance_min_3plus
  const contradiction = signM !== 0 ? cs.some((c) => sign(c.T) === -signM && Math.abs(c.T) >= CFG.contradiction_abs_T) : false
  const rhs = cs.filter((c) => isFin(c.recent_half_slope)).map((c) => c.recent_half_slope)
  const rh = rhs.length ? mean(rhs) : NaN_
  const slopeM = mean(cs.map((c) => c.slope))
  const effectOk = sigmaEff > 0 ? Math.abs(slopeM) * spanWeeks / sigmaEff >= CFG.min_effect_sigma : false
  const finLong = cs.filter((c) => isFin(c.long_rh_slope))
  const longUp = cs.some((c) => c.long_lower > 0) && !cs.some((c) => c.long_upper < 0) && !cs.some((c) => isFin(c.long_slope) && c.long_slope < 0)
    && finLong.every((c) => c.long_rh_slope >= CFG.long_rh_min_fraction * c.long_slope)
  const longDown = cs.some((c) => c.long_upper < 0) && !cs.some((c) => c.long_lower > 0) && !cs.some((c) => isFin(c.long_slope) && c.long_slope > 0)
    && finLong.every((c) => c.long_rh_slope <= CFG.long_rh_min_fraction * c.long_slope)
  return {
    T_m: Tm, D_m: Dm, n_clusters: cs.length, concordant: conc, contradiction,
    any_detect_up: cs.some((c) => c.lower > 0), any_detect_down: cs.some((c) => c.upper < 0),
    all_up: nonneutral.length ? nonneutral.every((c) => c.slope > 0) : false,
    all_down: nonneutral.length ? nonneutral.every((c) => c.slope < 0) : false,
    recent_half_slope: rh, effect_ok: effectOk,
    recent_half_detect_up: cs.some((c) => c.recent_half_detect_up), recent_half_detect_down: cs.some((c) => c.recent_half_detect_down),
    change_lower: mean(cs.map((c) => c.lower)) * spanWeeks, change_upper: mean(cs.map((c) => c.upper)) * spanWeeks,
    long_detect_up: longUp, long_detect_down: longDown,
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Máquinas de estado (puras). Solo avanzan cuando hay exposiciones nuevas.
// ---------------------------------------------------------------------------------------------
export type AdaptationStateName = 'PROGRESANDO' | 'ESTABLE' | 'DECLINANDO' | 'REGRESION_PROBABLE' | 'INCONCLUYENTE'

export interface AdaptationState {
  state: AdaptationStateName
  regression_confirmations: number
  exposures_at_last_confirmation: number
  recent_half_fail_streak: number
  rh_up_streak: number
  rh_down_streak: number
  exited_by_recent_half: boolean
  label: string
}

export const initialAdaptation = (): AdaptationState => ({
  state: 'INCONCLUYENTE', regression_confirmations: 0, exposures_at_last_confirmation: -99, recent_half_fail_streak: 0,
  rh_up_streak: 0, rh_down_streak: 0, exited_by_recent_half: false, label: '',
})

export function stepAdaptation(prev: AdaptationState, ms: MuscleStat | null, nExposures: number, hasNewData: boolean, inconclusive: boolean, fatigueSupported: boolean): AdaptationState {
  if (!hasNewData) return prev
  if (!ms || inconclusive || !isFin(ms.T_m)) return initialAdaptation()
  const s = prev.state; let label = ''
  const rhPos = isFin(ms.recent_half_slope) && ms.recent_half_slope > 0
  const rhNeg = isFin(ms.recent_half_slope) && ms.recent_half_slope < 0
  const upStreak = rhPos ? prev.rh_up_streak + 1 : 0
  const downStreak = rhNeg ? prev.rh_down_streak + 1 : 0
  const need = CFG.recent_half_exit_snapshots
  let enterUp = ms.any_detect_up && ms.all_up && ms.T_m >= CFG.T_enter && ms.effect_ok && ms.concordant && !ms.contradiction && upStreak >= need
  let enterDown = ms.any_detect_down && ms.all_down && ms.T_m <= -CFG.T_enter && ms.effect_ok && ms.concordant && !ms.contradiction && downStreak >= need
  let exitedRh = prev.exited_by_recent_half
  if (exitedRh) {
    enterUp = enterUp && ms.recent_half_detect_up
    enterDown = enterDown && ms.recent_half_detect_down
    if (Math.abs(ms.T_m) < CFG.T_stay) exitedRh = false
  }
  let rhStreak = prev.recent_half_fail_streak
  let next: AdaptationStateName
  if (s === 'PROGRESANDO') {
    rhStreak = !rhPos ? rhStreak + 1 : 0
    const rhFail = rhStreak >= CFG.recent_half_exit_snapshots
    const stay = ms.T_m >= CFG.T_stay && ms.concordant && !ms.contradiction && !rhFail
    next = stay ? 'PROGRESANDO' : 'ESTABLE'
    if (!stay && rhFail) exitedRh = true
  } else if (s === 'DECLINANDO' || s === 'REGRESION_PROBABLE') {
    rhStreak = !rhNeg ? rhStreak + 1 : 0
    const rhFail = rhStreak >= CFG.recent_half_exit_snapshots
    const stay = ms.T_m <= -CFG.T_stay && ms.concordant && !ms.contradiction && !rhFail
    next = stay ? s : 'ESTABLE'
    if (!stay && rhFail) exitedRh = true
  } else { next = 'ESTABLE'; rhStreak = 0 }
  if (next === 'ESTABLE') {
    if (enterUp && s !== 'DECLINANDO' && s !== 'REGRESION_PROBABLE') { next = 'PROGRESANDO'; rhStreak = 0; exitedRh = false }
    else if (enterDown && s !== 'PROGRESANDO') { next = 'DECLINANDO'; rhStreak = 0; exitedRh = false }
    else {
      label = ms.T_m >= CFG.T_stay ? 'TENDENCIA_POSITIVA_NO_CONCLUYENTE' : ms.T_m <= -CFG.T_stay ? 'TENDENCIA_NEGATIVA_NO_CONCLUYENTE' : 'SIN_CAMBIO_DETECTABLE'
      if (CFG.long_channel && (label === 'SIN_CAMBIO_DETECTABLE' || label === 'TENDENCIA_POSITIVA_NO_CONCLUYENTE') && ms.long_detect_up && ms.T_m > 0) label = 'PROGRESO_LENTO_26S'
      else if (CFG.long_channel && (label === 'SIN_CAMBIO_DETECTABLE' || label === 'TENDENCIA_NEGATIVA_NO_CONCLUYENTE') && ms.long_detect_down && ms.T_m < 0) label = 'DECLIVE_LENTO_26S'
      if (ms.any_detect_up && ms.T_m >= CFG.T_enter && !rhPos) label = 'PROGRESO_RECIENTE_NO_CONFIRMADO'
      if (ms.contradiction) label = 'EVIDENCIA_MIXTA'
    }
  }
  let conf = prev.regression_confirmations, lastN = prev.exposures_at_last_confirmation
  if (next === 'DECLINANDO' || next === 'REGRESION_PROBABLE') {
    if (ms.any_detect_down && ms.T_m <= -CFG.T_enter && (nExposures - lastN) >= CFG.regression_min_new_exposures_between) { conf += 1; lastN = nExposures }
    if (conf >= CFG.regression_confirmations && !fatigueSupported) next = 'REGRESION_PROBABLE'
  } else { conf = 0; lastN = -99 }
  return { state: next, regression_confirmations: conf, exposures_at_last_confirmation: lastN, recent_half_fail_streak: rhStreak,
    rh_up_streak: upStreak, rh_down_streak: downStreak, exited_by_recent_half: exitedRh, label }
}

export type RecoveryStateName = 'NORMAL' | 'FATIGA_SOSPECHADA' | 'FATIGA_APOYADA' | 'NO_ATRIBUIDA'

export interface RecoveryState {
  state: RecoveryStateName
  L_ref: number; DCT_ref: number; t_enter: number
  drop_persisted: boolean; reduction_t: number; exit_streak: number; below_streak: number; label: string
  driver_vid: string; driver_stratum: string
}

export const recoveryState = (p: Partial<RecoveryState> = {}): RecoveryState => ({
  state: 'NORMAL', L_ref: NaN_, DCT_ref: NaN_, t_enter: NaN_, drop_persisted: false, reduction_t: NaN_, exit_streak: 0, below_streak: 0, label: '',
  driver_vid: '', driver_stratum: '', ...p,
})

export interface RecoveryInputs {
  D_m: number; n_recent_below: number; tier_ok: boolean; context_high: boolean; n_variants_concordant: number
  level_recent: number; base_median: number; DCT: number
  reduction_t: number
  post_reduction_levels: number[]
  last_level_before_reduction: number
  t_now: number; has_new_data: boolean; interrupted: boolean
  driver_vid: string; driver_stratum: string
}

export function stepRecovery(prev: RecoveryState, x: RecoveryInputs): RecoveryState {
  if (!x.has_new_data || x.interrupted) return prev
  const s = prev.state
  const belowNow = isFin(x.D_m) && x.D_m <= CFG.D_enter && x.n_recent_below >= CFG.persistence_min
  const belowStreak = belowNow ? prev.below_streak + 1 : 0
  const entryOk = belowStreak >= CFG.suspect_confirmations && x.tier_ok && (x.context_high || x.n_variants_concordant >= 2)
  const recovered = (lvl: number): boolean => isFin(prev.L_ref) && isFin(lvl) && lvl >= prev.L_ref - CFG.recover_margin_dct * prev.DCT_ref
  if (s === 'NORMAL') {
    const LRef = isFin(prev.L_ref) && prev.below_streak >= 1 ? prev.L_ref : x.base_median
    const DCTRef = isFin(prev.DCT_ref) && prev.below_streak >= 1 ? prev.DCT_ref : x.DCT
    if (entryOk) return recoveryState({ state: 'FATIGA_SOSPECHADA', L_ref: LRef, DCT_ref: DCTRef, t_enter: x.t_now, driver_vid: x.driver_vid, driver_stratum: x.driver_stratum })
    if (belowNow) {
      const lab = belowStreak < CFG.suspect_confirmations ? 'DESCENSO_DETECTADO_PENDIENTE_CONFIRMACION' : 'DESCENSO_AISLADO_VIGILAR'
      return recoveryState({ state: 'NORMAL', L_ref: LRef, DCT_ref: DCTRef, below_streak: belowStreak, label: lab, driver_vid: x.driver_vid, driver_stratum: x.driver_stratum })
    }
    return recoveryState({ state: 'NORMAL', label: '' })
  }
  if (s === 'FATIGA_SOSPECHADA') {
    const redT = isFin(x.reduction_t) && x.reduction_t >= prev.t_enter ? x.reduction_t : NaN_
    const persisted = isFin(redT) && isFin(x.last_level_before_reduction) && !recovered(x.last_level_before_reduction)
    if (isFin(redT) && persisted && x.post_reduction_levels.length >= CFG.post_reduction_min_exposures) {
      if (recovered(median(x.post_reduction_levels.slice(-CFG.n_recent)))) {
        return recoveryState({ state: 'FATIGA_APOYADA', L_ref: prev.L_ref, DCT_ref: prev.DCT_ref, t_enter: prev.t_enter, drop_persisted: true, reduction_t: redT, driver_vid: prev.driver_vid, driver_stratum: prev.driver_stratum })
      }
    }
    if (recovered(x.level_recent)) return recoveryState({ state: 'NORMAL', label: !isFin(redT) ? 'CAIDA_TRANSITORIA' : 'REDUCCION_SIN_REBOTE_CLARO' })
    if ((x.t_now - prev.t_enter) > CFG.suspect_max_weeks) {
      return recoveryState({ state: 'NO_ATRIBUIDA', L_ref: prev.L_ref, DCT_ref: prev.DCT_ref, t_enter: prev.t_enter, drop_persisted: persisted, reduction_t: redT, label: 'CAIDA_PERSISTENTE_NO_ATRIBUIDA', driver_vid: prev.driver_vid, driver_stratum: prev.driver_stratum })
    }
    return { ...prev, reduction_t: redT, drop_persisted: persisted }
  }
  if (s === 'FATIGA_APOYADA') {
    const streak = recovered(x.level_recent) ? prev.exit_streak + 1 : 0
    if (streak >= CFG.recovery_exit_snapshots) return recoveryState({ state: 'NORMAL', label: 'RECUPERADA' })
    if (entryOk && !recovered(x.level_recent)) return recoveryState({ state: 'FATIGA_SOSPECHADA', L_ref: prev.L_ref, DCT_ref: prev.DCT_ref, t_enter: x.t_now, label: 'RECAIDA', driver_vid: prev.driver_vid, driver_stratum: prev.driver_stratum })
    if (isFin(prev.reduction_t) && (x.t_now - prev.reduction_t) > CFG.apoyada_max_weeks) return recoveryState({ state: 'NORMAL', label: 'CIERRE_APOYADA_POR_TIEMPO' })
    return { ...prev, exit_streak: streak }
  }
  if (s === 'NO_ATRIBUIDA') {
    if (recovered(x.level_recent)) return recoveryState({ state: 'NORMAL', label: 'RECUPERADA_TARDIA' })
    if ((x.t_now - prev.t_enter) > CFG.suspect_max_weeks + CFG.noatr_max_weeks) return recoveryState({ state: 'NORMAL', label: 'CIERRE_POR_NUEVO_NIVEL' })
    return prev
  }
  return prev
}

/** t de la reducción del estímulo más reciente (deload declarado, hueco ≥ max(7 d, 2·hueco normal), o reducción de volumen). */
export function reductionEvents(exps: readonly Exposure[], tNow: number, volumeReductionTs: readonly number[] = []): number {
  const t = exps.map((e) => e.t); const cands = [...volumeReductionTs]
  for (const e of exps) if (e.session_type === 'deload') cands.push(e.t)
  for (let k = 1; k < exps.length; k++) {
    const gap = (t[k] - t[k - 1]) * 7
    if (gap >= Math.max(CFG.reduction_gap_days_min, CFG.reduction_gap_factor * medianGapDays(t.slice(0, k)))) cands.push(t[k - 1] + 1e-6)
  }
  const ok = cands.filter((c) => c <= tNow)
  return ok.length ? Math.max(...ok) : NaN_
}
