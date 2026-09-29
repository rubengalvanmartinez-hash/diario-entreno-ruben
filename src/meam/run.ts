/**
 * MEAM — ejecución sobre el historial de la app: deriva exposiciones, corre el motor por músculo a cada corte semanal
 * (lunes) y produce el informe por músculo (estado, confianza, acción, evidencia) según P10/P14.
 * Todo se calcula desde el historial en kg de referencia (useHistorialRef) — nunca desde el store local sin sincronizar.
 */
import type { RegistroPeso } from '../types/models'
import { MEAM_CONFIG as CFG } from './config'
import { theilSen, segments } from './core'
import { runSnapshots, variantDef, mdsKgPerMonth, type VariantDef, type SnapshotRow, type VariantEvidence, type ContextCache } from './engine'
import { derivarExposiciones, percentilVolumen, reduccionesDeVolumen, lunesDeIso, diasEntre, isoAddDays, type SesionConTipo, type DerivedVariant, type SemanaVolumen, type ExposureExtra } from './exposure'
import { MUSCULOS_MEAM, MUSCULOS_ORDEN, type MeamMuscle, type VariantMeta } from './variants'

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA' | 'INSUFICIENTE'

/** Errata apartada del cálculo, con lo necesario para localizarla en el historial y entender por qué se apartó */
export interface ErrataDetalle {
  fecha: string; sesionId: string; topReps: number; e1rm: number; esperado: number | null
  /** lo que el usuario apuntó (kg de ayuda en asistidos, lastre en peso corporal, carga en el resto), como en mejorMarca */
  pesoRegistrado: number; tipoCarga: 'peso' | 'ayuda' | 'lastre'
}

/** Ejercicio del músculo que el motor NO evalúa en este corte (menos de 3 exposiciones en su bloque actual), con las cuentas para explicarlo */
export interface EjercicioFuera {
  nombre: string; nRegistros: number; nExposicionesTotal: number; nBloque: number; bloqueDesde: string; bloqueMotivo: InformeEjercicio['bloqueMotivo']; bloqueParonDias: number
  nSinE1rmPorReps: number; nSinE1rmPorCarga: number; ultimaFecha: string; nEstaSemana: number
}

export interface InformeEjercicio {
  key: string; nombre: string; cluster: string; role: string
  T: number; pendientePctSem: number; mdsKgMes: number; mdsPctMes: number; e1rmActual: number; tier: string; nExposiciones: number
  calidadTemporal: string; estrato: string; sinMejoraEn6: boolean; TLong: number; flags: string[]; ultimaFecha: string
  erratas: number; rirDisponible: number
  /** primera exposición del bloque actual AL CORTE (mismo segmento que nExposiciones: parón > 42 días o ruptura de protocolo); '' si no hay */
  bloqueDesde: string
  /** por qué empezó el bloque actual: parón > gap_segment_reset_days, ruptura de protocolo (≥3 erratas del mismo signo) o null si es el único bloque */
  bloqueMotivo: 'paron' | 'protocolo' | null
  /** días entre la última exposición del bloque anterior y la primera del actual (0 si no hay bloque anterior) */
  bloqueParonDias: number
  nBloques: number
  /** exposiciones con e1RM válido de TODO el histórico al corte (todos los bloques) */
  nExposicionesTotal: number
  /** sesiones registradas con el ejercicio (con series con datos), tengan o no exposición */
  nRegistros: number
  /** sesiones sin fuerza estimada: más reps que el máximo (repsMax) o sin carga/peso corporal utilizable */
  nSinE1rm: number
  nSinE1rmPorReps: number
  nSinE1rmPorCarga: number
  /** máximo de reps con e1RM para este ejercicio (12; 20 si es de aislamiento) */
  repsMax: number
  /** exposiciones normales del bloque (sin descargas): las únicas que cuentan para ruido y tendencia */
  nNormales: number
  /** días con exposición en la semana en curso (t ≥ corte): se evalúan el lunes siguiente */
  nEstaSemana: number
  /** errores de pronóstico con los que se mide el ruido: el tier sale de aquí (8 = establecido, 20 = maduro) */
  nErr: number
  /** normales en la ventana de estado (≤ 16 semanas desde la última exposición) y su span: lo que necesita la tendencia (≥ 8 en ≥ 6 semanas) */
  spanSemanas: number
  interrupcionReciente: boolean
  /** días desde la última exposición anterior al corte hasta el corte (las de la semana en curso van en nEstaSemana) */
  diasDesdeUltima: number
  erratasDetalle: ErrataDetalle[]
  /** mejor marca de las (hasta) 12 exposiciones anteriores a las últimas 6 del bloque: la referencia de «sin récord» */
  mejorMarca: DerivedVariant['mejorMarca']
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
  /** por qué el músculo está INCONCLUYENTE en este corte, en llano y con nombres de ejercicio; '' si no lo está */
  motivoInconcluyente: string
  /** ejercicios del músculo que el motor no evalúa en este corte (< 3 exposiciones en su bloque actual) */
  ejerciciosFuera: EjercicioFuera[]
  /** última exposición de cualquier ejercicio del músculo antes del corte ('' si ninguna) y días hasta el corte: sin sesiones nuevas el estado se congela (engine: hasNew) */
  ultimaSesion: string
  diasSinSesion: number
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
  /** músculos con ejercicios registrados pero sin ninguno con ≥ 3 exposiciones (no tienen tarjeta): se explica por qué */
  musculosSinTarjeta: Array<{ musculo: MeamMuscle; nombre: string; ejercicios: EjercicioFuera[] }>
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
export function motivosBajaConfianza(row: SnapshotRow, nombres?: ReadonlyMap<string, string>): string[] {
  const ev = row.evidence
  if (!ev.muscle) return []
  const vars = ev.variants
  const tiers = vars.map((v) => v.tier)
  const out: string[] = []
  // con nombres se atribuye cada motivo al ejercicio que lo causa (una variante abandonada puede arrastrar la bandera indefinidamente)
  const quien = (vs: VariantEvidence[]): string => nombres && vs.length ? ` (${vs.map((v) => `«${nombres.get(v.vid) ?? v.vid}»`).join(', ')})` : ''
  if (tiers.length > 0 && tiers.every((t) => t === 'PROVISIONAL' || t === 'NONE')) out.push('todos los ejercicios tienen todavía pocas sesiones en su bloque actual')
  if (ev.muscle.contradiction) out.push('los ejercicios de este músculo se contradicen entre sí')
  // banderas exactas: POST_INTERRUPCION_SIN_CAMBIO_DE_NIVEL persiste todo el segmento y no es una interrupción reciente (auditoría 6)
  const flags = new Set(row.flags ? row.flags.split(',') : [])
  const conParon = vars.filter((v) => v.interruption_recent || v.flags.includes('POST_INTERRUPCION'))
  if (flags.has('POST_INTERRUPCION') || vars.some((v) => v.interruption_recent)) out.push(`vienes de un parón reciente${quien(conParon)}`)
  if (flags.has('CAMBIO_DE_ESTRATO_PENDIENTE')) out.push(`has cambiado hace poco el rango de repeticiones${quien(vars.filter((v) => v.flags.includes('CAMBIO_DE_ESTRATO_PENDIENTE')))}`)
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

interface BloqueAlCorte { desde: string; motivo: InformeEjercicio['bloqueMotivo']; paronDias: number; nBloques: number; nExposicionesTotal: number; nBloque: number }

/**
 * Segmento que el motor evalúa en el corte (exposiciones con t < corte; mismos cortes de segmento que variantDef) y por qué empezó ahí.
 * Los recuentos son por día natural, como engine.prefix (dedupeSameDay): dos sesiones del mismo día cuentan una.
 */
function bloqueAlCorte(dv: DerivedVariant, corte: number): BloqueAlCorte {
  const sub = dv.exps.filter((e) => e.t < corte)          // prefijo: exps está ordenado por t y alineado con extras
  const segs = segments(sub, dv.rupturasPropuestas)
  const seg = segs.length ? segs[segs.length - 1] : []
  const dias = (idx: readonly number[]): number => new Set(idx.map((i) => dv.extras[i].fecha)).size
  const nExposicionesTotal = dias(sub.map((_, i) => i))
  if (!seg.length) return { desde: '', motivo: null, paronDias: 0, nBloques: segs.length, nExposicionesTotal, nBloque: 0 }
  let motivo: InformeEjercicio['bloqueMotivo'] = null; let paronDias = 0
  if (segs.length >= 2) {
    const prev = segs[segs.length - 2]
    const tPrev = sub[prev[prev.length - 1]].t, tIni = sub[seg[0]].t
    paronDias = diasEntre(dv.extras[prev[prev.length - 1]].fecha, dv.extras[seg[0]].fecha)
    // misma regla que segments(): ruptura propuesta entre ambas exposiciones ⇒ protocolo; si no, el corte lo abrió el parón
    // (que se compara en la escala t del motor: diasEntre puede dar 42 justos donde (Δt·7) da 42.00000000000001 y sí corta — auditoría 8)
    motivo = dv.rupturasPropuestas.some((pb) => tPrev < pb && pb <= tIni) && !((tIni - tPrev) * 7 > CFG.gap_segment_reset_days) ? 'protocolo' : 'paron'
  }
  return { desde: dv.extras[seg[0]].fecha, motivo, paronDias, nBloques: segs.length, nExposicionesTotal, nBloque: dias(seg) }
}

/**
 * Por qué el músculo está INCONCLUYENTE en el corte (engine.runSnapshots: inconclusive = sin estadístico de músculo o algún ejercicio con
 * interrupción reciente; stepAdaptation reinicia a INCONCLUYENTE). En llano y con nombres, para que «no hay datos» no suene a mentira
 * cuando el historial es largo pero el bloque actual no.
 */
function motivoInconcluyenteDe(row: SnapshotRow, ejercicios: readonly InformeEjercicio[], ejerciciosFuera: readonly EjercicioFuera[]): string {
  if (row.adaptation !== 'INCONCLUYENTE') return ''
  const q = (e: InformeEjercicio): string => `«${e.nombre}»`
  const interrumpidos = ejercicios.filter((e) => e.interrupcionReciente)
  if (interrumpidos.length) {
    const detalle = (e: InformeEjercicio): string => {
      const dejado = e.diasDesdeUltima > CFG.gap_segment_reset_days ? `; sin sesiones desde el ${e.ultimaFecha}, ${e.diasDesdeUltima} días: mientras siga así seguirá bloqueando el músculo` : `; última sesión el ${e.ultimaFecha}`
      return `${q(e)} (volvió de un parón de más de ${CFG.gap_interruption_days_min} días y aún no suma ${CFG.post_interruption_exposures_for_D} sesiones después${dejado})`
    }
    return `El motor no evalúa el músculo mientras un ejercicio esté recién vuelto de un parón, y ahora lo está${interrumpidos.length > 1 ? 'n' : ''} ${interrumpidos.map(detalle).join(' y ')}.`
  }
  // estado arrastrado: sin sesiones nuevas de los ejercicios evaluados desde el corte anterior el motor no avanza (stepAdaptation: !hasNewData ⇒ prev)
  if (!row.evidence.has_new_data) {
    const fuera = ejerciciosFuera.length ? ` Los que sí has entrenado no entran aún: ${ejerciciosFuera.map((e) => `«${e.nombre}» (${e.nBloque} en su bloque actual, hacen falta 3)`).join(', ')}.` : ''
    return `Sin sesiones nuevas de los ejercicios evaluados desde el corte anterior: el motor se queda como estaba y se reevalúa con la próxima sesión.${fuera}`
  }
  if (!ejercicios.length) {
    return ejerciciosFuera.length ? `Ningún ejercicio llega a 3 sesiones con fuerza estimada en su bloque actual: ${ejerciciosFuera.map((e) => `«${e.nombre}» (${e.nBloque}${e.bloqueMotivo === 'paron' ? `, bloque abierto tras un parón de ${e.bloqueParonDias} días` : e.bloqueMotivo === 'protocolo' ? ', bloque abierto por un cambio de nivel' : ''})`).join(', ')}.` : 'Ningún ejercicio de este músculo entra en el motor en este corte.'
  }
  const directos = ejercicios.filter((e) => e.role === 'DIRECT')
  if (!directos.length) return 'Ningún ejercicio de este músculo cuenta como trabajo directo (todos son de apoyo o indirectos), y solo los directos deciden el estado.'
  const conTendencia = directos.filter((e) => Number.isFinite(e.T))
  if (!conTendencia.length) {
    // la tendencia se calcula sobre las sesiones NORMALES del bloque (sin descargas), a ≤ 16 semanas de la última y, tras una interrupción de
    // 21–42 días, solo con las posteriores a ella (core.variantStats: stIdx); nExposiciones cuenta el bloque entero y engañaría aquí
    const tras = directos.filter((e) => e.flags.some((f) => f.startsWith('POST_INTERRUPCION')))
    const mejor = [...directos].sort((a, b) => b.nNormales - a.nNormales)[0]
    const bloque = mejor.bloqueMotivo === 'paron' ? ` (bloque abierto el ${mejor.bloqueDesde} tras un parón de ${mejor.bloqueParonDias} días; lo anterior ya no se compara)` : mejor.bloqueMotivo === 'protocolo' ? ` (bloque abierto el ${mejor.bloqueDesde} por un cambio de nivel; lo anterior ya no se compara)` : ''
    const paron = tras.length ? ` ${tras.map(q).join(' y ')} ${tras.length > 1 ? 'tuvieron' : 'tuvo'} un parón de ${CFG.gap_interruption_days_min}–${CFG.gap_segment_reset_days} días dentro del bloque: la tendencia se reinicia y solo cuentan las sesiones normales posteriores (y las de las 3 primeras semanas de vuelta tampoco).` : ''
    return `Ningún ejercicio directo llega a ${CFG.N_state_min} sesiones normales repartidas en al menos ${CFG.state_span_min_weeks} semanas dentro de su bloque actual y de las últimas ${CFG.state_span_max_weeks} semanas.${paron} El que más se acerca: ${q(mejor)} con ${mejor.nNormales} normales de ${mejor.nExposiciones} en el bloque${Number.isFinite(mejor.spanSemanas) && mejor.spanSemanas > 0 ? ` (ventana de ${mejor.spanSemanas.toFixed(0)} semanas)` : ''}${bloque}.`
  }
  return 'El motor no ha podido combinar los ejercicios de este músculo en este corte.'
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
  if (est === 'INCONCLUYENTE') {
    if (row.evidence.variants.some((v) => v.interruption_recent)) return ['Este músculo está en pausa de evaluación por un parón reciente.', `Sigue con el plan: en cuanto el ejercicio que vuelve del parón sume ${CFG.post_interruption_exposures_for_D} sesiones después de él, se reevalúa.`]
    if (!row.evidence.has_new_data) return ['Sin sesiones nuevas desde el corte anterior.', 'Sigue con el plan: se reevalúa con la próxima sesión de este músculo.']
    return ['Todavía no hay sesiones suficientes en el bloque actual de este músculo.', 'Sigue apuntando: mismo ejercicio, mismo rango de repeticiones y anota cuántas repeticiones te quedaban (RIR) en la serie fuerte.']
  }
  // Con confianza BAJA la acción se sigue mostrando: lo que no se propone es cambiar el estímulo por un descenso aún no firme (P14).
  // INSUFICIENTE con un estado real solo ocurre por la histéresis de la confianza (2 cortes): se trata como BAJA, no como «sin datos».
  if (conf === 'INSUFICIENTE') conf = 'BAJA'
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
    case 'INCONCLUYENTE': return `Todavía no se puede evaluar. ${m.motivoInconcluyente}`
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
  // días naturales con exposición desde el corte (la semana en curso): el motor deduplica por día, así que dos sesiones el mismo día cuentan una
  const diasDesde = (dv: DerivedVariant, corte: number): number => new Set(dv.extras.filter((x) => x.t >= corte).map((x) => x.fecha)).size
  // ejercicio que el motor no evalúa en un corte, con las cuentas para explicarlo (menos de 3 exposiciones en su bloque actual, o en total)
  const fueraDe = (dv: DerivedVariant, corte: number): EjercicioFuera => {
    const b = bloqueAlCorte(dv, corte)
    return {
      nombre: dv.meta.nombre, nRegistros: dv.nRegistros, nExposicionesTotal: b.nExposicionesTotal, nBloque: b.nBloque,
      bloqueDesde: b.desde, bloqueMotivo: b.motivo, bloqueParonDias: b.paronDias, nSinE1rmPorReps: dv.nSinE1rmPorReps, nSinE1rmPorCarga: dv.nSinE1rmPorCarga,
      ultimaFecha: dv.extras.filter((x) => x.t < corte).map((x) => x.fecha).pop() ?? '', nEstaSemana: diasDesde(dv, corte),
    }
  }
  const musculosSinTarjeta: InformeMeam['musculosSinTarjeta'] = []
  for (const musculo of MUSCULOS_ORDEN) {
    if (musculo === 'otros') continue
    const dvs = (porMusculo.get(musculo) ?? []).filter((dv) => dv.exps.length >= 3)
    if (dvs.length === 0) {
      const todos = porMusculo.get(musculo) ?? []
      if (todos.length) musculosSinTarjeta.push({ musculo, nombre: MUSCULOS_MEAM[musculo], ejercicios: todos.map((dv) => fueraDe(dv, ultimoCorte)).sort((a, b) => b.nRegistros - a.nRegistros) })
      continue
    }
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
    // «estancado» a nivel músculo: ningún récord en NINGUNO de los ejercicios con indicador calculable (bloque actual con ≥ 7 exposiciones normales)
    const conIndicador = dvs.filter((dv) => dv.mejorMarca !== null)
    const sinMejora = conIndicador.length > 0 && conIndicador.every((dv) => dv.sinMejoraEn6)
    const [accionTitulo, accionTexto] = accionDe(fila, conf, sinMejora, volPct, fase, pesoSlope, ctxAlto.has(corte))
    const ev = fila.evidence
    const e1rmActual = (v: VariantEvidence): number => {
      const dv = dvs.find((d) => d.meta.key === v.vid); const last = dv?.extras[dv.extras.length - 1]
      return last ? last.e1rm : Number.NaN
    }
    const corteIsoActual = corteIso(corte)
    const ejercicios: InformeEjercicio[] = ev.variants.map((v) => {
      const dv = dvs.find((d) => d.meta.key === v.vid)!
      const bloque = bloqueAlCorte(dv, corte)
      const erratasAlCorte: ExposureExtra[] = dv.erratas.filter((x) => x.t < corte)
      const alCorte = dv.extras.filter((x) => x.t < corte)
      const ultimaFecha = alCorte.length ? alCorte[alCorte.length - 1].fecha : ''
      const tipoCarga: ErrataDetalle['tipoCarga'] = dv.meta.esAsistencia ? 'ayuda' : dv.meta.equipment === 'weighted_bodyweight' ? 'lastre' : 'peso'
      const registrado = (x: ExposureExtra): number => x.bwRef === null ? x.topLoad : tipoCarga === 'ayuda' ? x.bwRef - x.topLoad : tipoCarga === 'lastre' ? x.topLoad - x.bwRef : x.topLoad
      return {
        key: v.vid, nombre: dv.meta.nombre, cluster: v.cluster, role: v.role, T: v.T, pendientePctSem: v.slope_pct_wk,
        mdsKgMes: mdsKgPerMonth(v.mds_pct_wk, e1rmActual(v)), mdsPctMes: v.mds_pct_wk * 52 / 12, e1rmActual: e1rmActual(v), tier: v.tier, nExposiciones: v.n_exposures,
        calidadTemporal: v.temporal_quality, estrato: v.stratum, sinMejoraEn6: dv.sinMejoraEn6, TLong: v.T_long, flags: v.flags,
        ultimaFecha, erratas: erratasAlCorte.length,
        rirDisponible: dv.extras.filter((x) => x.rir !== null).length,
        bloqueDesde: bloque.desde, bloqueMotivo: bloque.motivo, bloqueParonDias: bloque.paronDias, nBloques: bloque.nBloques, nExposicionesTotal: bloque.nExposicionesTotal,
        nRegistros: dv.nRegistros, nSinE1rm: dv.nSinE1rmPorReps + dv.nSinE1rmPorCarga, nSinE1rmPorReps: dv.nSinE1rmPorReps, nSinE1rmPorCarga: dv.nSinE1rmPorCarga,
        repsMax: dv.meta.aislamiento ? CFG.e1rm_reps_max_isolation : CFG.e1rm_reps_max, nNormales: v.n_normal, nEstaSemana: diasDesde(dv, corte),
        nErr: v.n_err, spanSemanas: v.time_span_weeks, interrupcionReciente: v.interruption_recent,
        diasDesdeUltima: ultimaFecha ? diasEntre(ultimaFecha, corteIsoActual) : 0,
        erratasDetalle: erratasAlCorte.map((x) => ({ fecha: x.fecha, sesionId: x.sesionId, topReps: x.topReps, e1rm: x.e1rm, esperado: x.e1rmEsperado, pesoRegistrado: registrado(x), tipoCarga })),
        mejorMarca: dv.mejorMarca,
      }
    })
    // ejercicios del músculo que el motor no evalúa en este corte: < 3 exposiciones en su bloque actual (engine: seg.length < 3), incluidos
    // los que ni llegan a 3 en total. Antes desaparecían de la pantalla sin explicación aunque tuvieran decenas de sesiones registradas.
    const evaluados = new Set(ev.variants.map((v) => v.vid))
    const ejerciciosFuera: EjercicioFuera[] = (porMusculo.get(musculo) ?? []).filter((dv) => !evaluados.has(dv.meta.key)).map((dv) => fueraDe(dv, corte)).sort((a, b) => b.nRegistros - a.nRegistros)
    // última exposición del músculo antes del corte (cualquier ejercicio): sin sesiones nuevas, engine mantiene el estado anterior (hasNew=false)
    let ultimaSesion = ''
    for (const dv of porMusculo.get(musculo) ?? []) for (const x of dv.extras) if (x.t < corte && x.fecha > ultimaSesion) ultimaSesion = x.fecha
    const nombresPorVid = new Map(dvs.map((dv) => [dv.meta.key, dv.meta.nombre]))
    const e1rmMedio = ejercicios.map((e) => e.e1rmActual).filter(Number.isFinite)
    const refKg = e1rmMedio.length ? e1rmMedio.reduce((a, b) => a + b, 0) / e1rmMedio.length : Number.NaN
    const cambioKg: [number, number] | null = ev.muscle && Number.isFinite(refKg) && Number.isFinite(ev.muscle.change_lower)
      ? [refKg * (Math.exp(ev.muscle.change_lower) - 1), refKg * (Math.exp(ev.muscle.change_upper) - 1)] : null
    const inputHash = fnv1a64(JSON.stringify({ cfg: CFG.config_version, v: dvs.map((dv) => [dv.meta.key, dv.exps.map((e) => [e.t, e.y, e.session_type, e.reps_typical, e.load_kg])]), ctx: [...ctxAlto], red: reducciones }))
    const m: InformeMusculo = {
      musculo, nombre: MUSCULOS_MEAM[musculo], semana: corteIso(corte), estado: fila.adaptation, etiqueta: fila.adapt_label, recuperacion: fila.recovery,
      etiquetaRecuperacion: fila.rec_label, confianza: conf, motivosConfianza: conf === 'BAJA' ? motivosBajaConfianza(fila, nombresPorVid) : [], motivoInconcluyente: motivoInconcluyenteDe(fila, ejercicios, ejerciciosFuera), ejerciciosFuera,
      ultimaSesion, diasSinSesion: ultimaSesion ? diasEntre(ultimaSesion, corteIsoActual) : 0,
      accion: `${accionTitulo} ${accionTexto}`.trim(), textoUsuario: '', cambioKg,
      T: fila.T, D: fila.D, sigmaPct: fila.sigma_pct, rho: fila.rho, rhoCalibrado: rhoCal, volumenSeriesSemana: volSem, volumenPercentil: volPct,
      frecuenciaSemanal: sesionesUlt3 / 3, contextoAlto: ctxAlto.has(corte), ejercicios, flags: fila.flags ? fila.flags.split(',') : [], fila, historial: rows,
      nExposicionesTotal: fila.n_exp, inputHash,
    }
    m.textoUsuario = textoDe(fila, m)
    musculos.push(m)
  }
  // construirMapaVariantes crea entrada para todo nombre, así que der.nombresSinMapa queda vacío en la práctica: los ejercicios que el mapa
  // no reconoce van a 'otros' y el bucle los salta. Se listan aquí para que no desaparezcan de la pantalla sin aviso (auditoría 8, A2).
  const sinMapa = new Set(der.nombresSinMapa)
  for (const dv of der.variantes.values()) if (dv.meta.musculo === 'otros') sinMapa.add(dv.meta.nombre)
  return { epoch: der.epoch, hoy, corte: isoAddDays(der.epoch, ultimoCorte * 7), musculos, musculosSinTarjeta, nombresSinMapa: [...sinMapa].sort(), pesoPendientePctSem: pesoSlope, faseNutricional: fase,
    modelVersion: CFG.model_version, configVersion: CFG.config_version }
}
