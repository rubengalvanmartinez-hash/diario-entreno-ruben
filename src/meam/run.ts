/**
 * MEAM — ejecución sobre el historial de la app: deriva exposiciones, corre el motor por músculo a cada corte semanal
 * (lunes) y produce el informe por músculo (estado, confianza, acción, evidencia) según P10/P14.
 * Todo se calcula desde el historial en kg de referencia (useHistorialRef) — nunca desde el store local sin sincronizar.
 */
import type { RegistroPeso } from '../types/models'
import { MEAM_CONFIG as CFG } from './config'
import { theilSen } from './core'
import { runSnapshots, variantDef, mdsKgPerMonth, type VariantDef, type SnapshotRow, type VariantEvidence } from './engine'
import { derivarExposiciones, percentilVolumen, reduccionesDeVolumen, lunesDeIso, diasEntre, isoAddDays, type SesionConTipo, type DerivedVariant, type SemanaVolumen } from './exposure'
import { MUSCULOS_MEAM, MUSCULOS_ORDEN, type MeamMuscle, type VariantMeta } from './variants'

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA' | 'INSUFICIENTE'

export interface InformeEjercicio {
  key: string; nombre: string; cluster: string; role: string
  T: number; pendientePctSem: number; mdsKgMes: number; e1rmActual: number; tier: string; nExposiciones: number
  calidadTemporal: string; estrato: string; sinMejoraEn6: boolean; TLong: number; flags: string[]; ultimaFecha: string
  erratas: number; rirDisponible: number
}

export interface InformeMusculo {
  musculo: MeamMuscle
  nombre: string
  semana: string                       // lunes del corte
  estado: string
  etiqueta: string
  recuperacion: string
  etiquetaRecuperacion: string
  confianza: Confianza
  accion: string
  textoUsuario: string
  cambioKg: [number, number] | null    // IC del cambio total en la ventana, en kg de e1RM (media de clusters)
  T: number; D: number; sigmaPct: number; rho: number; rhoCalibrado: boolean
  volumenSeriesSemana: number; volumenPercentil: number; frecuenciaSemanal: number
  contextoAlto: boolean
  ejercicios: InformeEjercicio[]
  flags: string[]
  fila: SnapshotRow
  historial: SnapshotRow[]
  nExposicionesTotal: number
  inputHash: string
}

export interface InformeMeam {
  epoch: string
  hoy: string
  corte: string
  musculos: InformeMusculo[]
  nombresSinMapa: string[]
  pesoPendientePctSem: number         // pendiente del peso corporal (%/sem), NaN sin datos
  faseNutricional: 'deficit' | 'mantenimiento' | 'superavit' | 'desconocida'
  modelVersion: string
  configVersion: string
}

/** Hash FNV-1a de 64 bits (como cadena hex) para input_hash: determinista y sin dependencias. */
export function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x0100019b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/** Pendiente del peso corporal (%/sem) sobre medianas semanales de las últimas 8 semanas (≥ 6 semanas con dato). */
export function pendientePesoCorporal(pesos: readonly RegistroPeso[], hoy: string): number {
  const desde = isoAddDays(hoy, -56)
  const porSemana = new Map<string, number[]>()
  for (const p of pesos) if (p.fecha >= desde && p.fecha <= hoy) { const l = lunesDeIso(p.fecha); if (!porSemana.has(l)) porSemana.set(l, []); porSemana.get(l)!.push(p.pesoKg) }
  const sem = [...porSemana.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (sem.length < 6) return Number.NaN
  const t = sem.map(([l]) => diasEntre(desde, l) / 7)
  const y = sem.map(([, v]) => Math.log(v.sort((a, b) => a - b)[Math.floor(v.length / 2)]))
  const f = theilSen(t, y, 0.05, 0, 1)
  return f ? f.slope * 100 : Number.NaN
}

function confianzaDe(row: SnapshotRow, rhoCalibrado: boolean): Confianza {
  const ev = row.evidence
  if (row.adaptation === 'INCONCLUYENTE' || !ev.muscle) return 'INSUFICIENTE'
  const vars = ev.variants
  const tiers = vars.map((v) => v.tier)
  const soloProvisional = tiers.length > 0 && tiers.every((t) => t === 'PROVISIONAL' || t === 'NONE')
  const interrupcion = row.flags.includes('POST_INTERRUPCION') || vars.some((v) => v.flags.includes('CAMBIO_DE_ESTRATO_PENDIENTE'))
  if (soloProvisional || ev.muscle.contradiction || interrupcion || !rhoCalibrado) return 'BAJA'
  const dir = row.adaptation === 'PROGRESANDO' ? 1 : (row.adaptation === 'DECLINANDO' || row.adaptation === 'REGRESION_PROBABLE') ? -1 : 0
  const clustersDetectando = Object.values(ev.clusters).filter((c) => c && (dir > 0 ? c.lower_pct_wk > 0 : dir < 0 ? c.upper_pct_wk < 0 : false)).length
  const todosEstablecidos = tiers.every((t) => t === 'ESTABLISHED' || t === 'MATURE')
  if (dir !== 0 && clustersDetectando >= 2 && todosEstablecidos) return 'ALTA'
  return 'MEDIA'
}

function accionDe(row: SnapshotRow, conf: Confianza, sinMejora: boolean, volPct: number, fase: InformeMeam['faseNutricional'], pesoSlope: number, contextoAlto: boolean): [string, string] {
  const est = row.adaptation, rec = row.recovery
  const deficit = fase === 'deficit'
  if (rec === 'FATIGA_SOSPECHADA') {
    return ['Descenso persistente de rendimiento compatible con fatiga.', 'Propuesta: semana de descarga (−40–50 % de series, RIR 3–4). Márcala como descarga y la app comprobará el rebote.']
  }
  if (rec === 'FATIGA_APOYADA') return ['La caída se explica por fatiga: hubo reducción y rebote.', 'Vuelve al plan normal; la referencia se mantiene hasta recuperar el nivel.']
  if (rec === 'NO_ATRIBUIDA') return ['Caída persistente que no se ha podido atribuir a fatiga.', 'Revisa técnica, variante o protocolo; si hay déficit o sueño/estrés altos, corrígelos antes de cambiar el estímulo.']
  if (conf === 'INSUFICIENTE') return ['Todavía no hay evidencia suficiente en este músculo.', 'Sigue registrando: mismo ejercicio, mismo rango de repeticiones y RIR del top set.']
  if (conf === 'BAJA') return ['Evidencia de baja confianza (ruido sin calibrar, interrupción o contradicción entre ejercicios).', 'Sin acción: se confirma con más datos.']
  if (est === 'PROGRESANDO') return ['Rendimiento en ascenso.', 'Mantener el plan.']
  if (est === 'DECLINANDO' || est === 'REGRESION_PROBABLE') {
    if (deficit) return [`Descenso de rendimiento durante déficit (peso ${pesoSlope.toFixed(2)} %/sem).`, `${pesoSlope <= -1.0 ? 'Aviso: pérdida > 1 %/sem. ' : ''}Revisa el ritmo de pérdida y mantén el volumen; no reduzcas el estímulo.`]
    if (contextoAlto) return ['Descenso de rendimiento con carga contextual alta.', 'Propuesta de descarga diagnóstica; márcala como descarga para comprobar el rebote.']
    return ['Descenso de rendimiento sin fatiga ni déficit detectados.', 'Revisa técnica, variante y protocolo; considera una descarga diagnóstica.']
  }
  if (est === 'ESTABLE') {
    if (sinMejora && Number.isFinite(volPct) && volPct < CFG.volume_low_percentile) return ['Estable, sin mejora en las últimas 6 exposiciones y volumen reciente en tu 40 % inferior.', 'Si buscas progresar aquí, revisa volumen y frecuencia.']
    if (sinMejora) return ['Estable, sin mejora en las últimas 6 exposiciones.', 'Sin cambio de estímulo por ahora; vigila las próximas semanas.']
    return ['Sin cambio detectable en la ventana de 16 semanas.', 'Mantener.']
  }
  return ['', '']
}

function textoDe(row: SnapshotRow, m: InformeMusculo): string {
  const kg = m.cambioKg
  const rango = kg ? ` (entre ${kg[0] >= 0 ? '+' : ''}${kg[0].toFixed(1)} y ${kg[1] >= 0 ? '+' : ''}${kg[1].toFixed(1)} kg de e1RM en la ventana)` : ''
  switch (row.adaptation) {
    case 'PROGRESANDO': return `Progresando${rango}.`
    case 'DECLINANDO': return `Descenso de rendimiento${rango}.`
    case 'REGRESION_PROBABLE': return `Regresión probable${rango}.`
    case 'INCONCLUYENTE': return 'Sin evidencia suficiente todavía.'
    default: {
      const l = row.adapt_label
      if (l === 'PROGRESO_LENTO_26S') return `Sin cambio concluyente en 16 semanas; en 26 semanas la tendencia es positiva${rango}.`
      if (l === 'DECLIVE_LENTO_26S') return `Sin cambio concluyente en 16 semanas; en 26 semanas la tendencia es negativa${rango}.`
      if (l === 'TENDENCIA_POSITIVA_NO_CONCLUYENTE') return `Tendencia positiva no concluyente${rango}.`
      if (l === 'TENDENCIA_NEGATIVA_NO_CONCLUYENTE') return `Tendencia negativa no concluyente${rango}.`
      if (l === 'PROGRESO_RECIENTE_NO_CONFIRMADO') return 'Progreso reciente pendiente de confirmar.'
      if (l === 'EVIDENCIA_MIXTA') return 'Evidencia mixta entre ejercicios.'
      return `Sin cambio detectable${rango}.`
    }
  }
}

export interface OpcionesMeam {
  hoy?: string
  /** ρ agrupado fijo (solo tests) */
  rhoFixed?: number | null
  /** cortes a evaluar: todos desde el inicio (por defecto) o solo los últimos N */
  ultimosCortes?: number
}

/** Ejecuta MEAM sobre el historial completo del usuario y devuelve el informe por músculo. */
export function ejecutarMeam(sesiones: readonly SesionConTipo[], mapa: ReadonlyMap<string, VariantMeta>, pesos: readonly RegistroPeso[], opts: OpcionesMeam = {}): InformeMeam {
  const hoy = opts.hoy ?? new Date().toISOString().slice(0, 10)
  const der = derivarExposiciones(sesiones, mapa, pesos)
  const pesoSlope = pendientePesoCorporal(pesos, hoy)
  const fase: InformeMeam['faseNutricional'] = !Number.isFinite(pesoSlope) ? 'desconocida' : pesoSlope <= -0.25 ? 'deficit' : pesoSlope >= 0.25 ? 'superavit' : 'mantenimiento'
  // pool de todas las variantes del usuario (prior y ρ agrupados)
  const pool = new Map<string, VariantDef>()
  for (const [key, dv] of der.variantes) if (dv.exps.length >= 3) pool.set(key, variantDef(dv.exps, dv.meta.cluster, dv.meta.equipment, dv.meta.role))
  // cortes: cada lunes desde la semana 6 hasta el próximo lunes posterior a hoy (el corte incluye t < corte)
  const proximoLunes = isoAddDays(lunesDeIso(hoy), 7)
  const ultimoCorte = Math.round(diasEntre(der.epoch, proximoLunes) / 7)
  let cortes = Array.from({ length: Math.max(0, ultimoCorte - 6 + 1) }, (_, i) => 6 + i)
  const corteIso = (c: number): string => isoAddDays(der.epoch, c * 7)
  const musculos: InformeMusculo[] = []
  const porMusculo = new Map<MeamMuscle, DerivedVariant[]>()
  for (const dv of der.variantes.values()) { if (!porMusculo.has(dv.meta.musculo)) porMusculo.set(dv.meta.musculo, []); porMusculo.get(dv.meta.musculo)!.push(dv) }
  for (const musculo of MUSCULOS_ORDEN) {
    const dvs = (porMusculo.get(musculo) ?? []).filter((dv) => dv.exps.length >= 3)
    if (dvs.length === 0 || musculo === 'otros') continue
    const variants = new Map<string, VariantDef>()
    for (const dv of dvs) variants.set(dv.meta.key, variantDef(dv.exps, dv.meta.cluster, dv.meta.equipment, dv.meta.role))
    const semanasVol: SemanaVolumen[] = der.volumenPorMusculo.get(musculo) ?? []
    // contexto alto por volumen: la semana previa al corte ≥ P70 del histórico personal (RPE/sueño/estrés no están en la app)
    const ctxAlto = new Set<number>()
    for (const c of cortes) {
      const previas = semanasVol.filter((s) => s.semana < c)
      const ult = previas.slice(-3)
      if (ult.length === 3 && previas.length >= 8) {
        const media = ult.reduce((a, s) => a + s.series, 0) / 3
        if (percentilVolumen(previas, media) >= CFG.volume_high_percentile) ctxAlto.add(c)
      }
    }
    const reducciones = reduccionesDeVolumen(semanasVol)
    if (opts.ultimosCortes) cortes = cortes.slice(-opts.ultimosCortes)
    const rows = runSnapshots(variants, { cutoffs: cortes, contextHighCutoffs: ctxAlto, volumeReductionTs: reducciones, rhoFixed: opts.rhoFixed, pool })
    if (rows.length === 0) continue
    const fila = rows[rows.length - 1]
    const corte = fila.week
    const previas = semanasVol.filter((s) => s.semana < corte)
    const ult3 = previas.slice(-3)
    const volSem = ult3.length ? ult3.reduce((a, s) => a + s.series, 0) / ult3.length : 0
    const volPct = percentilVolumen(previas, volSem)
    const sesionesUlt3 = new Set(dvs.flatMap((dv) => dv.extras.filter((x) => x.t >= corte - 3 && x.t < corte).map((x) => x.sesionId))).size
    const rhoCal = fila.evidence.rho_calibrated
    const conf = confianzaDe(fila, rhoCal)
    const sinMejora = dvs.some((dv) => dv.sinMejoraEn6)
    const [accionTitulo, accionTexto] = accionDe(fila, conf, sinMejora, volPct, fase, pesoSlope, ctxAlto.has(corte))
    const ev = fila.evidence
    const e1rmActual = (v: VariantEvidence): number => {
      const dv = dvs.find((d) => d.meta.key === v.vid); const last = dv?.extras[dv.extras.length - 1]
      return last ? last.e1rm : Number.NaN
    }
    const ejercicios: InformeEjercicio[] = ev.variants.map((v) => {
      const dv = dvs.find((d) => d.meta.key === v.vid)!
      return {
        key: v.vid, nombre: dv.meta.nombre, cluster: v.cluster, role: v.role, T: v.T, pendientePctSem: v.slope_pct_wk,
        mdsKgMes: mdsKgPerMonth(v.mds_pct_wk, e1rmActual(v)), e1rmActual: e1rmActual(v), tier: v.tier, nExposiciones: v.n_exposures,
        calidadTemporal: v.temporal_quality, estrato: v.stratum, sinMejoraEn6: dv.sinMejoraEn6, TLong: v.T_long, flags: v.flags,
        ultimaFecha: dv.extras.length ? dv.extras[dv.extras.length - 1].fecha : '', erratas: dv.erratas.length,
        rirDisponible: dv.extras.filter((x) => x.rir !== null).length,
      }
    })
    const e1rmMedio = ejercicios.map((e) => e.e1rmActual).filter(Number.isFinite)
    const refKg = e1rmMedio.length ? e1rmMedio.reduce((a, b) => a + b, 0) / e1rmMedio.length : Number.NaN
    const cambioKg: [number, number] | null = ev.muscle && Number.isFinite(refKg) && Number.isFinite(ev.muscle.change_lower)
      ? [refKg * (Math.exp(ev.muscle.change_lower) - 1), refKg * (Math.exp(ev.muscle.change_upper) - 1)] : null
    const inputHash = fnv1a64(JSON.stringify({ cfg: CFG.config_version, v: dvs.map((dv) => [dv.meta.key, dv.exps.map((e) => [e.t, e.y, e.session_type, e.reps_typical, e.load_kg])]), ctx: [...ctxAlto], red: reducciones }))
    const m: InformeMusculo = {
      musculo, nombre: MUSCULOS_MEAM[musculo], semana: corteIso(corte), estado: fila.adaptation, etiqueta: fila.adapt_label, recuperacion: fila.recovery,
      etiquetaRecuperacion: fila.rec_label, confianza: conf, accion: `${accionTitulo} ${accionTexto}`.trim(), textoUsuario: '', cambioKg,
      T: fila.T, D: fila.D, sigmaPct: fila.sigma_pct, rho: fila.rho, rhoCalibrado: rhoCal, volumenSeriesSemana: volSem, volumenPercentil: volPct,
      frecuenciaSemanal: sesionesUlt3 / 3, contextoAlto: ctxAlto.has(corte), ejercicios, flags: fila.flags ? fila.flags.split(',') : [], fila, historial: rows,
      nExposicionesTotal: fila.n_exp, inputHash,
    }
    m.textoUsuario = textoDe(fila, m)
    musculos.push(m)
  }
  return { epoch: der.epoch, hoy, corte: isoAddDays(der.epoch, ultimoCorte * 7), musculos, nombresSinMapa: der.nombresSinMapa, pesoPendientePctSem: pesoSlope, faseNutricional: fase,
    modelVersion: CFG.model_version, configVersion: CFG.config_version }
}
