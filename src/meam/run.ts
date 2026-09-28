/**
 * MEAM — ejecución sobre el historial de la app: deriva exposiciones, corre el motor por músculo a cada corte semanal
 * (lunes) y produce el informe por músculo (estado, confianza, acción, evidencia) según P10/P14.
 * Todo se calcula desde el historial en kg de referencia (useHistorialRef) — nunca desde el store local sin sincronizar.
 */
import type { RegistroPeso } from '../types/models'
import { MEAM_CONFIG as CFG } from './config'
import { theilSen } from './core'
import { runSnapshots, variantDef, mdsKgPerMonth, type VariantDef, type SnapshotRow, type VariantEvidence, type ContextCache } from './engine'
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
  /** por qué la confianza es BAJA en el corte actual, en lenguaje llano (vacío si no lo es o si lo es solo por histéresis) */
  motivosConfianza: string[]
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

/**
 * Motivos reales que rebajan la confianza a BAJA (P14), en lenguaje llano. Vacío si no hay ninguno.
 * La falta de calibración de ρ NO es motivo: el motor ya usa ρ por defecto (rho_default_uncalibrated) que ensancha el error
 * estándar de la tendencia, así que penalizarla otra vez en la confianza contaba dos veces lo mismo y, con 1 sesión/semana
 * por ejercicio, dejaba BAJA de forma permanente (hacen falta ≥ 20 exposiciones en 16 semanas). Sin calibrar solo se veta ALTA.
 */
export function motivosBajaConfianza(row: SnapshotRow): string[] {
  const ev = row.evidence
  if (!ev.muscle) return []
  const vars = ev.variants
  const tiers = vars.map((v) => v.tier)
  const out: string[] = []
  if (tiers.length > 0 && tiers.every((t) => t === 'PROVISIONAL' || t === 'NONE')) out.push('todos los ejercicios tienen todavía pocas sesiones')
  if (ev.muscle.contradiction) out.push('los ejercicios de este músculo se contradicen entre sí')
  // banderas exactas: POST_INTERRUPCION_SIN_CAMBIO_DE_NIVEL persiste todo el segmento y no es una interrupción reciente (auditoría 6)
  const flags = new Set(row.flags ? row.flags.split(',') : [])
  if (flags.has('POST_INTERRUPCION') || vars.some((v) => v.interruption_recent)) out.push('vienes de un parón reciente')
  if (flags.has('CAMBIO_DE_ESTRATO_PENDIENTE')) out.push('has cambiado hace poco el rango de repeticiones')
  return out
}

function confianzaDe(row: SnapshotRow, rhoCalibrado: boolean): Confianza {
  const ev = row.evidence
  if (row.adaptation === 'INCONCLUYENTE' || !ev.muscle) return 'INSUFICIENTE'
  if (motivosBajaConfianza(row).length > 0) return 'BAJA'
  const tiers = ev.variants.map((v) => v.tier)
  const dir = row.adaptation === 'PROGRESANDO' ? 1 : (row.adaptation === 'DECLINANDO' || row.adaptation === 'REGRESION_PROBABLE') ? -1 : 0
  const clustersDetectando = Object.values(ev.clusters).filter((c) => c && (dir > 0 ? c.lower_pct_wk > 0 : dir < 0 ? c.upper_pct_wk < 0 : false)).length
  const todosEstablecidos = tiers.every((t) => t === 'ESTABLISHED' || t === 'MATURE')
  // ALTA exige además ρ calibrado: sin autocorrelación medida no se afirma la máxima confianza
  if (dir !== 0 && clustersDetectando >= 2 && todosEstablecidos && rhoCalibrado) return 'ALTA'
  return 'MEDIA'
}

/** Ventana real de la tendencia («las últimas N semanas»): el span de los ejercicios que la sostienen, entre 6 y 16 semanas. */
function ventanaDe(row: SnapshotRow): string {
  const n = Math.round(row.evidence.span_weeks)
  return Number.isFinite(n) && n > 0 ? `las últimas ${n} semanas` : 'la ventana analizada'
}

function accionDe(row: SnapshotRow, conf: Confianza, sinMejora: boolean, volPct: number, fase: InformeMeam['faseNutricional'], pesoSlope: number, contextoAlto: boolean): [string, string] {
  const est = row.adaptation, rec = row.recovery
  const deficit = fase === 'deficit'
  // Textos en lenguaje llano (la pantalla la lee gente sin formación en entrenamiento); la lógica de ramas es la de P10/P11/P14.
  if (rec === 'FATIGA_SOSPECHADA') {
    return ['Llevas varias sesiones por debajo de lo normal: parece cansancio acumulado.', 'Propuesta: una semana suave (descarga) con la mitad de series y quedándote lejos del fallo (3–4 repeticiones en reserva). Márcala como descarga en la app y comprobará si rebotas.']
  }
  if (rec === 'FATIGA_APOYADA') return ['El bajón se explica por cansancio: bajaste el ritmo y has vuelto a subir.', 'Vuelve al plan normal; la app sigue comparando con el nivel de antes del bajón hasta que lo recuperes.']
  if (rec === 'NO_ATRIBUIDA') return ['Bajón que se mantiene y que no se explica por cansancio.', 'Revisa la técnica, el ejercicio o cómo lo estás haciendo; si comes poco o duermes mal, corrige eso antes de cambiar el entreno.']
  if (conf === 'INSUFICIENTE') return ['Todavía no hay datos suficientes en este músculo.', 'Sigue apuntando: mismo ejercicio, mismo rango de repeticiones y anota cuántas repeticiones te quedaban (RIR) en la serie fuerte.']
  // Con confianza BAJA la acción se sigue mostrando: lo que no se propone es cambiar el estímulo por un descenso aún no firme (P14).
  const baja = conf === 'BAJA' ? ', aunque la evidencia aún es débil' : ''
  if (est === 'PROGRESANDO') return [`Estás mejorando${baja}.`, 'Sigue con el mismo plan.']
  if (est === 'DECLINANDO' || est === 'REGRESION_PROBABLE') {
    if (conf === 'BAJA') return ['Parece que bajas, pero la evidencia aún es débil.', 'No cambies nada todavía: sigue apuntando y en las próximas semanas se confirmará o se descartará.']
    if (deficit) return [`Bajas rendimiento mientras pierdes peso (${pesoSlope.toFixed(2)} %/sem).`, `${pesoSlope <= -1.0 ? 'Aviso: estás perdiendo más de un 1 % a la semana; frena el ritmo. ' : ''}Es normal al perder peso: mantén las series y no bajes el estímulo.`]
    if (contextoAlto) return ['Bajas rendimiento y llevas semanas con más volumen del habitual.', 'Propuesta: una semana suave (descarga) para ver si rebotas; márcala como descarga en la app.']
    return ['Bajas rendimiento sin cansancio ni pérdida de peso que lo expliquen.', 'Revisa la técnica, el ejercicio y cómo lo haces; una semana suave (descarga) ayudaría a salir de dudas.']
  }
  if (est === 'ESTABLE') {
    if (sinMejora && Number.isFinite(volPct) && volPct < CFG.volume_low_percentile) return [`Estancado: ningún récord en las últimas 6 sesiones y menos series de lo habitual en ti${baja}.`, 'Si quieres progresar aquí, sube series o frecuencia.']
    if (sinMejora) return [`Estancado: ningún récord en las últimas 6 sesiones${baja}.`, 'No cambies nada aún; vigila las próximas semanas.']
    return [`Sin cambios claros en ${ventanaDe(row)}${baja}.`, 'Sigue igual.']
  }
  return ['', '']
}

/** Frase principal de la tarjeta, en lenguaje llano. El «cambio» es el intervalo del cambio de fuerza estimada (e1RM) en la ventana real de la tendencia (span_weeks). */
function textoDe(row: SnapshotRow, m: InformeMusculo): string {
  const kg = m.cambioKg
  const s = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`
  const ventana = ventanaDe(row)
  const rango = kg ? ` (entre ${s(kg[0])} y ${s(kg[1])} kg de fuerza estimada en ${ventana})` : ''
  switch (row.adaptation) {
    case 'PROGRESANDO': return `Tu fuerza en este músculo va subiendo${rango}.`
    case 'DECLINANDO': return `Tu fuerza en este músculo va bajando${rango}.`
    case 'REGRESION_PROBABLE': return `Llevas semanas perdiendo fuerza y se ha confirmado varias veces${rango}.`
    case 'INCONCLUYENTE': {
      const flags = row.flags ? row.flags.split(',') : []
      if (flags.includes('POST_INTERRUPCION')) return 'Vienes de un parón: hacen falta unas semanas más de sesiones para volver a evaluar este músculo.'
      return 'Aún no hay datos suficientes para decir nada.'
    }
    default: {
      const l = row.adapt_label
      if (l === 'PROGRESO_LENTO_26S') return `Sin cambio claro en ${ventana}, pero mirando 26 semanas vas subiendo poco a poco${rango}.`
      if (l === 'DECLIVE_LENTO_26S') return `Sin cambio claro en ${ventana}, pero mirando 26 semanas vas bajando poco a poco${rango}.`
      if (l === 'TENDENCIA_POSITIVA_NO_CONCLUYENTE') return `Apunta a mejora, pero aún no es concluyente${rango}.`
      if (l === 'TENDENCIA_NEGATIVA_NO_CONCLUYENTE') return `Apunta a bajada, pero aún no es concluyente${rango}.`
      if (l === 'PROGRESO_RECIENTE_NO_CONFIRMADO') return `Mejoras en el conjunto de ${ventana}, pero las últimas semanas no lo confirman${rango}.`
      if (l === 'EVIDENCIA_MIXTA') return 'Unos ejercicios de este músculo suben y otros bajan.'
      return `Te mantienes en el mismo nivel${rango}.`
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

/** Confianza con histéresis (P14): la categoría solo cambia cuando la nueva se mantiene 2 snapshots seguidos. */
function confianzaConHisteresis(rows: readonly SnapshotRow[]): Confianza {
  let actual: Confianza = 'INSUFICIENTE'; let candidata: Confianza | null = null
  for (const r of rows) {
    const c = confianzaDe(r, r.evidence.rho_calibrated)
    if (c === actual) { candidata = null; continue }
    if (candidata === c) { actual = c; candidata = null } else candidata = c
  }
  return actual
}

/** Ejecuta MEAM sobre el historial completo del usuario y devuelve el informe por músculo. */
export function ejecutarMeam(sesiones: readonly SesionConTipo[], mapa: ReadonlyMap<string, VariantMeta>, pesos: readonly RegistroPeso[], opts: OpcionesMeam = {}): InformeMeam {
  const hoy = opts.hoy ?? new Date().toISOString().slice(0, 10)
  const der = derivarExposiciones(sesiones, mapa, pesos)
  const pesoSlope = pendientePesoCorporal(pesos, hoy)
  const fase: InformeMeam['faseNutricional'] = !Number.isFinite(pesoSlope) ? 'desconocida' : pesoSlope <= -0.25 ? 'deficit' : pesoSlope >= 0.25 ? 'superavit' : 'mantenimiento'
  // pool de todas las variantes del usuario (prior y ρ agrupados)
  const pool = new Map<string, VariantDef>()
  for (const [key, dv] of der.variantes) if (dv.exps.length >= 3) pool.set(key, variantDef(dv.exps, dv.meta.cluster, dv.meta.equipment, dv.meta.role, dv.rupturasPropuestas))
  // cortes: cada lunes desde la semana 6 hasta el lunes de la semana en curso (solo semanas completas: el corte incluye t < corte;
  // la semana parcial se evalúa el lunes siguiente — auditoría 6, C4)
  const lunesActual = lunesDeIso(hoy)
  const ultimoCorte = Math.round(diasEntre(der.epoch, lunesActual) / 7)
  const cortesTodos = Array.from({ length: Math.max(0, ultimoCorte - 6 + 1) }, (_, i) => 6 + i)
  const cortes = opts.ultimosCortes ? cortesTodos.slice(-opts.ultimosCortes) : cortesTodos
  const corteIso = (c: number): string => isoAddDays(der.epoch, c * 7)
  const ctxCache: ContextCache = new Map()
  const musculos: InformeMusculo[] = []
  const porMusculo = new Map<MeamMuscle, DerivedVariant[]>()
  for (const dv of der.variantes.values()) { if (!porMusculo.has(dv.meta.musculo)) porMusculo.set(dv.meta.musculo, []); porMusculo.get(dv.meta.musculo)!.push(dv) }
  for (const musculo of MUSCULOS_ORDEN) {
    const dvs = (porMusculo.get(musculo) ?? []).filter((dv) => dv.exps.length >= 3)
    if (dvs.length === 0 || musculo === 'otros') continue
    const variants = new Map<string, VariantDef>()
    for (const dv of dvs) variants.set(dv.meta.key, variantDef(dv.exps, dv.meta.cluster, dv.meta.equipment, dv.meta.role, dv.rupturasPropuestas))
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
    const reducciones = reduccionesDeVolumen(semanasVol, ultimoCorte)
    const rows = runSnapshots(variants, { cutoffs: cortes, contextHighCutoffs: ctxAlto, volumeReductionTs: reducciones, rhoFixed: opts.rhoFixed, pool, ctxCache })
    if (rows.length === 0) continue
    const fila = rows[rows.length - 1]
    const corte = fila.week
    const previas = semanasVol.filter((s) => s.semana < corte)
    const ult3 = previas.slice(-3)
    const volSem = ult3.length ? ult3.reduce((a, s) => a + s.series, 0) / ult3.length : 0
    const volPct = percentilVolumen(previas, volSem)
    const sesionesUlt3 = new Set(dvs.flatMap((dv) => dv.extras.filter((x) => x.t >= corte - 3 && x.t < corte).map((x) => x.sesionId))).size
    const rhoCal = fila.evidence.rho_calibrated
    const conf = confianzaConHisteresis(rows)
    // «estancado» a nivel músculo: ningún récord en NINGUNO de los ejercicios con indicador calculable (≥ 7 exposiciones normales)
    const conIndicador = dvs.filter((dv) => dv.extras.filter((x) => x.tipo === 'normal').length >= 7)
    const sinMejora = conIndicador.length > 0 && conIndicador.every((dv) => dv.sinMejoraEn6)
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
      etiquetaRecuperacion: fila.rec_label, confianza: conf, motivosConfianza: conf === 'BAJA' ? motivosBajaConfianza(fila) : [], accion: `${accionTitulo} ${accionTexto}`.trim(), textoUsuario: '', cambioKg,
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
