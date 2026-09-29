/**
 * MEAM — capa P0–P3: de las series registradas (modelo Sesion de la app) a exposiciones por variante.
 *
 * Reglas (MEAM_v2_3_especificacion.md, P0–P3 y §6 tests 41–58):
 *  - Sesión = (sesionId, fecha). Una exposición por variante y sesión; el núcleo deduplica por día.
 *  - Series de trabajo: carga ≥ 90 % de la máxima del ejercicio en la sesión (el resto = calentamiento inferido).
 *  - Top set: mayor e1RM_raw = W·(1 + reps/30) entre las 3 primeras series de trabajo; reps válidas 1..12 (aislamiento 1..20).
 *  - Errata: |ln(e1RM) − mediana de las 6 exposiciones previas| > 0,22 ⇒ POSIBLE_ERRATA, excluida hasta confirmar.
 *  - Tipo de sesión: 'deload' declarado (Sesion.tipoSesion) o `deload_inferido` (series de trabajo ≤ 60 % y carga top ≤ 90 %
 *    de la mediana de las 4 sesiones previas del ejercicio).
 *  - RIR del top set: fallo/rir0 → 0, rir1 → 1, sin etiqueta → desconocido (nunca "≥ 2").
 *  - Asistidos: W = BW_ref − asistencia (BW_ref = último peso ≤ fecha en 7 d, si no 21 d); sin peso corporal ⇒ sin exposición.
 *  - Canónico de tendencia: e1RM_raw siempre (el canal RIR es secundario y solo se guarda).
 *  - Tiempo: t en semanas desde el lunes de la primera sesión (fecha local 'YYYY-MM-DD' de la app).
 */
import type { Sesion, RegistroPeso, Serie } from '../types/models'
import { serieConDatos } from '../types/models'
import { nombreCanonico } from '../utils/normalizar'
import { MEAM_CONFIG as CFG } from './config'
import { median } from './mathx'
import { makeExposure, segments, type Exposure, type SessionType } from './core'
import type { VariantMeta, MeamMuscle } from './variants'

/** La app aún no persiste tipo de sesión; esta extensión opcional la introduce el módulo (columna entrenos.tipo_sesion). */
export type SesionConTipo = Sesion & { tipoSesion?: 'normal' | 'deload' | 'rehab' | 'test' }

export interface ExposureExtra {
  fecha: string
  sesionId: string
  t: number
  e1rm: number
  topReps: number
  topLoad: number
  rir: number | null
  seriesTrabajo: number
  seriesDuras: number
  seriesTotales: number
  deloadInferido: boolean
  tipo: SessionType
  errata: boolean
  bwRef: number | null
  /** e1RM esperado (mediana de las 5 exposiciones normales previas) cuando se aparta como errata; null si no aplica */
  e1rmEsperado: number | null
}

export interface DerivedVariant {
  meta: VariantMeta
  exps: Exposure[]
  extras: ExposureExtra[]
  /** exposiciones descartadas como errata (para revisión) */
  erratas: ExposureExtra[]
  /** exposiciones por sesión de reps a carga fija (canal P3) cuando no hay e1RM válido: [t, reps] */
  repsSinE1rm: Array<[number, number]>
  /** SIN_MEJORA_EN_6: en las últimas 6 exposiciones normales del BLOQUE ACTUAL no hay récord de e1RM ni de reps a la carga habitual */
  sinMejoraEn6: boolean
  /** mejor marca de las (hasta) 12 exposiciones normales anteriores a esas 6, dentro del bloque: la referencia que hay que batir; null si no se calcula.
   *  pesoRegistrado = lo que el usuario apuntó (kg de ayuda en asistidos, lastre en peso corporal, carga en el resto); topLoad = carga efectiva. */
  mejorMarca: { e1rm: number; topLoad: number; topReps: number; fecha: string; pesoRegistrado: number; tipoCarga: 'peso' | 'ayuda' | 'lastre'; nPrevias: number } | null
  /** fecha de la primera exposición del bloque actual (tras el último parón > gap_segment_reset_days o ruptura de protocolo) */
  bloqueDesde: string | null
  /** rupturas de protocolo propuestas (t): ≥3 "erratas" consecutivas del mismo signo = nuevo nivel (otra máquina, kg por lado…) */
  rupturasPropuestas: number[]
  /** sesiones registradas con el ejercicio (con alguna serie con datos), tengan o no exposición: para explicar «N registradas, M cuentan» */
  nRegistros: number
  /** sesiones sin e1RM porque las 3 primeras series de trabajo pasan del máximo de reps (12; 20 en aislamiento) */
  nSinE1rmPorReps: number
  /** sesiones sin e1RM por no tener carga utilizable (sin kilos o sin reps apuntados, o asistido/lastre sin peso corporal registrado) */
  nSinE1rmPorCarga: number
  /** nombres de los ejercicios cuyo historial hereda esta variante (revisión «sucesor de»); el cambio abre bloque nuevo */
  heredaDe: string[]
  /** primera y última fecha con registro (con o sin exposición) */
  primeraFecha: string
  ultimaFecha: string
}

export interface SemanaVolumen { lunes: string; semana: number; series: number; duras: number }

export interface DerivacionResultado {
  epoch: string                                   // lunes de referencia (t = 0)
  variantes: Map<string, DerivedVariant>
  volumenPorMusculo: Map<MeamMuscle, SemanaVolumen[]>
  nombresSinMapa: string[]
}

export function isoAddDays(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

export function lunesDeIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const offset = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return isoAddDays(iso, -offset)
}

export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number); const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000)
}

export const epley = (pesoKg: number, reps: number): number => pesoKg * (1 + reps / CFG.epley_k)

function rirDeEtiqueta(s: Serie): number | null {
  if (s.etiqueta === 'fallo' || s.etiqueta === 'rir0') return 0
  if (s.etiqueta === 'rir1') return 1
  return null
}

/** BW_ref causal (P2): mediana de los pesos de los 7 días anteriores o iguales a la fecha; si no hay, el último dentro de 21 días. */
function bwRefEn(fecha: string, pesos: readonly RegistroPeso[]): number | null {
  const ventana = pesos.filter((p) => p.fecha <= fecha && diasEntre(p.fecha, fecha) <= CFG.bw_ref_window_days).map((p) => p.pesoKg)
  if (ventana.length) return median(ventana)
  let mejor: RegistroPeso | null = null
  for (const p of pesos) if (p.fecha <= fecha && (!mejor || p.fecha > mejor.fecha)) mejor = p
  if (!mejor) return null
  return diasEntre(mejor.fecha, fecha) <= CFG.bw_ref_fallback_days ? mejor.pesoKg : null
}

interface SesionEjercicioDerivada {
  fecha: string; sesionId: string; nombre: string; key: string; series: Serie[]; tipoDeclarado: SessionType
}

/** Aplana el historial en (sesión, ejercicio) con la fecha, ordenado cronológicamente (fecha, id). */
function aplanar(sesiones: readonly SesionConTipo[]): SesionEjercicioDerivada[] {
  const out: SesionEjercicioDerivada[] = []
  for (const s of sesiones) {
    const tipo: SessionType = s.tipoSesion === 'deload' ? 'deload' : s.tipoSesion === 'rehab' ? 'rehab' : s.tipoSesion === 'test' ? 'test' : 'normal'
    for (const ej of s.ejercicios) {
      if (ej.saltado) continue
      const series = ej.series.filter(serieConDatos)
      if (series.length === 0) continue
      const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
      out.push({ fecha: s.fecha, sesionId: s.id, nombre, key: nombreCanonico(nombre), series, tipoDeclarado: tipo })
    }
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sesionId.localeCompare(b.sesionId))
  return out
}

/**
 * Deriva las exposiciones de todas las variantes. `mapa` debe contener todos los nombres canónicos del historial
 * (construirMapaVariantes); los que falten se asignan a 'otros' y se devuelven en nombresSinMapa.
 */
export function derivarExposiciones(sesiones: readonly SesionConTipo[], mapa: ReadonlyMap<string, VariantMeta>, pesos: readonly RegistroPeso[] = []): DerivacionResultado {
  const filas = aplanar(sesiones)
  const variantes = new Map<string, DerivedVariant>()
  const sinMapa = new Set<string>()
  const volumen = new Map<MeamMuscle, Map<string, SemanaVolumen>>()
  if (filas.length === 0) return { epoch: lunesDeIso(new Date().toISOString().slice(0, 10)), variantes, volumenPorMusculo: new Map(), nombresSinMapa: [] }
  const epoch = lunesDeIso(filas[0].fecha)
  const tDe = (fecha: string): number => diasEntre(epoch, fecha) / 7
  // revisión del usuario: un ejercicio retirado sale del cálculo; uno con sucesor vuelca su historial en el sucesor (cadena, con tope)
  // (un ciclo A→B→A o una cadena demasiado larga anula la revisión: se deja cada ejercicio como está — auditoría 9)
  const destinoDe = (key: string): string | null => {
    let k = key; const vistos = new Set([key])
    for (let i = 0; i < 5; i++) {
      const m = mapa.get(k)
      if (!m) return k
      if (m.sucesor && mapa.has(m.sucesor)) { if (vistos.has(m.sucesor)) return key; vistos.add(m.sucesor); k = m.sucesor; continue }
      return m.retirado ? null : k
    }
    return key
  }
  const heredoAntes = new Set<string>(), propiaVista = new Set<string>()
  // historial por variante para inferir deload y erratas (causal: solo sesiones anteriores)
  type Hist = { sets: number[]; loads: number[]; lnE1rm: number[]; fechas: string[]; racha: ExposureExtra[]; rachaSigno: number; ultimaFecha: string }
  const nuevoHist = (): Hist => ({ sets: [], loads: [], lnE1rm: [], fechas: [], racha: [], rachaSigno: 0, ultimaFecha: '' })
  const hist = new Map<string, Hist>()
  for (const f0 of filas) {
    const destino = destinoDe(f0.key)
    if (destino === null) continue                       // retirado sin heredero: fuera del cálculo
    const heredada = destino !== f0.key
    const f = heredada ? { ...f0, key: destino } : f0
    let meta = mapa.get(f.key)
    if (!meta) { sinMapa.add(f.nombre); meta = { key: f.key, nombre: f.nombre, musculo: 'otros', cluster: 'OTROS', role: 'DIRECT', equipment: 'compound_free', esAsistencia: false, aislamiento: false, inferido: true } }
    if (!variantes.has(f.key)) variantes.set(f.key, { meta, exps: [], extras: [], erratas: [], repsSinE1rm: [], sinMejoraEn6: false, mejorMarca: null, bloqueDesde: null, rupturasPropuestas: [], nRegistros: 0, nSinE1rmPorReps: 0, nSinE1rmPorCarga: 0, heredaDe: [], primeraFecha: f.fecha, ultimaFecha: f.fecha })
    const dv = variantes.get(f.key)!
    dv.nRegistros++
    dv.ultimaFecha = f.fecha
    if (heredada) { heredoAntes.add(f.key); if (!dv.heredaDe.includes(f0.nombre)) dv.heredaDe.push(f0.nombre) }
    // primera sesión propia del heredero tras las heredadas: máquina nueva ⇒ ruptura de protocolo (bloque nuevo) y referencia de erratas limpia
    // se borra el historial de erratas/deload aquí (y no más abajo) para que valga aunque esta sesión no llegue a tener e1RM (auditoría 9)
    if (!heredada && heredoAntes.has(f.key) && !propiaVista.has(f.key)) { dv.rupturasPropuestas.push(tDe(f.fecha)); hist.delete(f.key) }
    if (!heredada) propiaVista.add(f.key)
    const t = tDe(f.fecha)
    // --- volumen semanal por músculo (series con datos y series duras) ---
    const lunes = lunesDeIso(f.fecha)
    if (!volumen.has(meta.musculo)) volumen.set(meta.musculo, new Map())
    const vm = volumen.get(meta.musculo)!
    if (!vm.has(lunes)) vm.set(lunes, { lunes, semana: Math.round(diasEntre(epoch, lunes) / 7), series: 0, duras: 0 })
    const sv = vm.get(lunes)!
    // --- carga efectiva por serie: asistidos W = BW_ref − asistencia; lastre W = BW_ref + lastre; resto = peso registrado ---
    const usaBw = meta.esAsistencia || meta.equipment === 'weighted_bodyweight'
    const bw = usaBw ? bwRefEn(f.fecha, pesos) : null
    const cargaDe = (s: Serie): number | null => {
      const peso = s.pesoKg === '' ? 0 : Number(s.pesoKg)
      if (meta!.esAsistencia) return bw === null ? null : bw - peso
      if (meta!.equipment === 'weighted_bodyweight') return bw === null ? null : bw + peso
      return peso
    }
    const conCarga = f.series.map((s) => ({ s, carga: cargaDe(s), reps: s.reps === '' ? 0 : Number(s.reps) })).filter((x) => x.carga !== null && x.reps >= CFG.e1rm_reps_min)
    if (conCarga.length === 0) {
      // sin peso corporal disponible (asistido/lastre) ⇒ canal de reps (P3)
      const reps = Math.max(0, ...f.series.map((s) => (s.reps === '' ? 0 : Number(s.reps))))
      if (reps > 0) dv.repsSinE1rm.push([t, reps])
      dv.nSinE1rmPorCarga++
      sv.series += f.series.length; sv.duras += f.series.filter((s) => s.etiqueta !== undefined).length
      continue
    }
    const maxCarga = Math.max(...conCarga.map((x) => x.carga as number))
    if (!(maxCarga > 0)) {
      // peso corporal puro sin BW_ref (carga 0): canal de reps (P3), sin e1RM
      const reps = Math.max(...conCarga.map((x) => x.reps))
      dv.repsSinE1rm.push([t, reps])
      dv.nSinE1rmPorCarga++
      sv.series += f.series.length; sv.duras += f.series.filter((s) => s.etiqueta !== undefined).length
      continue
    }
    const trabajo = conCarga.filter((x) => (x.carga as number) >= CFG.working_set_load_ratio * maxCarga)
    sv.series += trabajo.length
    sv.duras += trabajo.filter((x) => x.s.etiqueta !== undefined).length
    const repsMax = meta.aislamiento ? CFG.e1rm_reps_max_isolation : CFG.e1rm_reps_max
    const candidatas = trabajo.slice(0, CFG.n_sets_top).filter((x) => x.reps <= repsMax)
    if (candidatas.length === 0) {
      dv.repsSinE1rm.push([t, Math.max(...trabajo.map((x) => x.reps))])
      dv.nSinE1rmPorReps++
      continue
    }
    let top = candidatas[0]
    for (const c of candidatas) if (epley(c.carga as number, c.reps) > epley(top.carga as number, top.reps)) top = c
    const e1rm = epley(top.carga as number, top.reps)
    const y = Math.log(e1rm)
    // --- deload inferido (causal): base = sesiones normales de los 28 días previos (mín. 3) ---
    let h = hist.get(f.key) ?? nuevoHist()
    // parón > gap_segment_reset_days: el motor abre un segmento nuevo, así que la referencia de erratas y de deload también se reinicia.
    // Sin esto, al volver de un parón rindiendo menos (lo normal) las primeras sesiones se descartaban como erratas (auditoría 7).
    if (h.ultimaFecha && diasEntre(h.ultimaFecha, f.fecha) > CFG.gap_segment_reset_days) h = nuevoHist()
    h.ultimaFecha = f.fecha
    let deloadInf = false
    const base = h.fechas.map((_, i) => i).filter((i) => diasEntre(h.fechas[i], f.fecha) <= 28)
    if (base.length >= 3) {
      const medSets = median(base.map((i) => h.sets[i])), medLoad = median(base.map((i) => h.loads[i]))
      deloadInf = trabajo.length <= CFG.deload_infer_volume_ratio * medSets && (top.carga as number) <= CFG.deload_infer_load_ratio * medLoad
    }
    const tipo: SessionType = f.tipoDeclarado !== 'normal' ? f.tipoDeclarado : deloadInf ? 'deload' : 'normal'
    // --- errata (causal, mediana de las 5 exposiciones normales previas). Una descarga baja la carga a propósito: no se evalúa.
    //     Tres "erratas" consecutivas del mismo signo = cambio real de nivel (otra máquina, kg por lado → total): se aceptan las tres,
    //     se propone una ruptura de protocolo en la primera y la referencia pasa al nuevo nivel (auditoría 6) ---
    let errata = false; let e1rmEsperado: number | null = null
    if (tipo === 'normal' && h.lnE1rm.length >= 3) {
      const ref = median(h.lnE1rm.slice(-5))
      errata = Math.abs(y - ref) > CFG.errata_log_dev
      if (errata) e1rmEsperado = Math.exp(ref)
    }
    const extra: ExposureExtra = {
      fecha: f.fecha, sesionId: f.sesionId, t, e1rm, topReps: top.reps, topLoad: top.carga as number, rir: rirDeEtiqueta(top.s),
      seriesTrabajo: trabajo.length, seriesDuras: trabajo.filter((x) => x.s.etiqueta !== undefined).length, seriesTotales: f.series.length,
      deloadInferido: deloadInf, tipo, errata, bwRef: bw, e1rmEsperado,
    }
    if (errata) {
      const signo = y > median(h.lnE1rm.slice(-5)) ? 1 : -1
      if (h.racha.length && h.rachaSigno === signo) h.racha.push(extra); else { h.racha = [extra]; h.rachaSigno = signo }
      if (h.racha.length >= 3) {
        // nuevo nivel: readmitir la racha como exposiciones, ruptura en la primera, referencia = nuevo nivel
        dv.rupturasPropuestas.push(h.racha[0].t)
        for (const r of h.racha) {
          r.errata = false; r.e1rmEsperado = null
          dv.exps.push(makeExposure({ t: r.t, y: Math.log(r.e1rm), session_type: r.tipo, reps_typical: r.topReps, load_kg: r.topLoad }))
          dv.extras.push(r)
          h.sets.push(r.seriesTrabajo); h.loads.push(r.topLoad); h.fechas.push(r.fecha)
        }
        h.lnE1rm = h.racha.map((r) => Math.log(r.e1rm))
        h.racha = []; h.rachaSigno = 0
      } else {
        dv.erratas.push(extra)
      }
      hist.set(f.key, h)
      continue
    }
    h.racha = []; h.rachaSigno = 0
    dv.exps.push(makeExposure({ t, y, session_type: tipo, reps_typical: top.reps, load_kg: top.carga as number }))
    dv.extras.push(extra)
    if (tipo === 'normal') { h.sets.push(trabajo.length); h.loads.push(top.carga as number); h.lnE1rm.push(y); h.fechas.push(f.fecha) }
    hist.set(f.key, h)
  }
  // las rachas readmitidas como nuevo nivel dejan de ser erratas; ordenar exposiciones por t (las readmitidas llegan tarde)
  for (const dv of variantes.values()) {
    dv.erratas = dv.erratas.filter((x) => x.errata)
    const orden = dv.extras.map((_, i) => i).sort((a, b) => dv.extras[a].t - dv.extras[b].t)
    dv.extras = orden.map((i) => dv.extras[i]); dv.exps = orden.map((i) => dv.exps[i])
  }
  // indicador operativo SIN_MEJORA_EN_6_EXPOSICIONES (descriptivo, escala de entrenador).
  // Se evalúa dentro del BLOQUE ACTUAL (mismo criterio de segmento que el motor: parón > gap_segment_reset_days o ruptura de
  // protocolo propuesta). Antes comparaba con el máximo de TODO el histórico: tras un parón o un cambio de máquina/forma de
  // contar los kg, el récord antiguo era inalcanzable y el aviso salía en todos los ejercicios (auditoría 7 / prueba real).
  for (const dv of variantes.values()) {
    const segs = segments(dv.exps, dv.rupturasPropuestas)
    const bloque = segs.length ? segs[segs.length - 1] : []
    dv.bloqueDesde = bloque.length ? dv.extras[bloque[0]].fecha : null
    const normales = bloque.map((i) => dv.extras[i]).filter((x) => x.tipo === 'normal')
    if (normales.length < CFG.no_improvement_exposures + 1) continue
    const ultimas = normales.slice(-CFG.no_improvement_exposures)
    const previas = normales.slice(0, -CFG.no_improvement_exposures).slice(-CFG.no_improvement_reference_exposures)
    let mejor = previas[0]
    for (const x of previas) if (x.e1rm > mejor.e1rm) mejor = x
    const mejoraE1rm = ultimas.some((x) => x.e1rm > mejor.e1rm + 1e-9)
    // récord de reps: cada una de las últimas 6 frente a las previas a SU misma carga (la mediana de 6 cargas puede no coincidir con ninguna)
    const recordReps = ultimas.some((u) => {
      const aEsaCarga = previas.filter((x) => Math.abs(x.topLoad - u.topLoad) < 1e-6)
      return aEsaCarga.length > 0 && u.topReps > Math.max(...aEsaCarga.map((x) => x.topReps))
    })
    dv.sinMejoraEn6 = !mejoraE1rm && !recordReps
    const tipoCarga = dv.meta.esAsistencia ? 'ayuda' : dv.meta.equipment === 'weighted_bodyweight' ? 'lastre' : 'peso'
    const pesoRegistrado = mejor.bwRef === null ? mejor.topLoad : tipoCarga === 'ayuda' ? mejor.bwRef - mejor.topLoad : tipoCarga === 'lastre' ? mejor.topLoad - mejor.bwRef : mejor.topLoad
    dv.mejorMarca = { e1rm: mejor.e1rm, topLoad: mejor.topLoad, topReps: mejor.topReps, fecha: mejor.fecha, pesoRegistrado, tipoCarga, nPrevias: previas.length }
  }
  const volumenPorMusculo = new Map<MeamMuscle, SemanaVolumen[]>()
  for (const [m, vm] of volumen) volumenPorMusculo.set(m, [...vm.values()].sort((a, b) => a.semana - b.semana))
  return { epoch, variantes, volumenPorMusculo, nombresSinMapa: [...sinMapa].sort() }
}

/** Percentil personal del volumen semanal (para contexto alto ≥ P70 y etiquetas < P40 / < P25). */
export function percentilVolumen(semanas: readonly SemanaVolumen[], valor: number): number {
  const v = semanas.map((s) => s.series).filter((x) => x > 0)
  if (v.length < 4) return Number.NaN
  // rango medio: los empates cuentan la mitad. Con «<=» un volumen constante daba P100 y contexto alto en todos los cortes
  // (y con ello la entrada en FATIGA_SOSPECHADA con un solo ejercicio) — auditoría 7
  let menores = 0, iguales = 0
  for (const x of v) { if (x < valor) menores++; else if (x === valor) iguales++ }
  return 100 * (menores + 0.5 * iguales) / v.length
}

/**
 * Semanas (índice desde epoch) en las que el volumen del músculo cae a ≤ 70 % de la mediana de las 4 semanas previas:
 * candidatas a "reducción del estímulo" (P11). Devuelve los t (lunes de la semana) en la escala del motor.
 */
export function reduccionesDeVolumen(semanas: readonly SemanaVolumen[], semanaActual = Number.POSITIVE_INFINITY): number[] {
  const out: number[] = []
  for (let i = 4; i < semanas.length; i++) {
    if (semanas[i].semana >= semanaActual) break        // la semana en curso (parcial) no puede contar como reducción (auditoría 6, C4)
    const prev = semanas.slice(i - 4, i).map((s) => s.series)
    const med = median(prev)
    if (med > 0 && semanas[i].series <= CFG.reduction_volume_ratio * med) out.push(semanas[i].semana)
  }
  return out
}
