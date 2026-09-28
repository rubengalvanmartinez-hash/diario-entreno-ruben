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
import { makeExposure, type Exposure, type SessionType } from './core'
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
}

export interface DerivedVariant {
  meta: VariantMeta
  exps: Exposure[]
  extras: ExposureExtra[]
  /** exposiciones descartadas como errata (para revisión) */
  erratas: ExposureExtra[]
  /** exposiciones por sesión de reps a carga fija (canal P3) cuando no hay e1RM válido: [t, reps] */
  repsSinE1rm: Array<[number, number]>
  sinMejoraEn6: boolean
  /** rupturas de protocolo propuestas (t): ≥3 "erratas" consecutivas del mismo signo = nuevo nivel (otra máquina, kg por lado…) */
  rupturasPropuestas: number[]
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
  // historial por variante para inferir deload y erratas (causal: solo sesiones anteriores)
  const hist = new Map<string, { sets: number[]; loads: number[]; lnE1rm: number[]; fechas: string[]; racha: ExposureExtra[]; rachaSigno: number }>()
  for (const f of filas) {
    let meta = mapa.get(f.key)
    if (!meta) { sinMapa.add(f.nombre); meta = { key: f.key, nombre: f.nombre, musculo: 'otros', cluster: 'OTROS', role: 'DIRECT', equipment: 'compound_free', esAsistencia: false, aislamiento: false, inferido: true } }
    if (!variantes.has(f.key)) variantes.set(f.key, { meta, exps: [], extras: [], erratas: [], repsSinE1rm: [], sinMejoraEn6: false, rupturasPropuestas: [] })
    const dv = variantes.get(f.key)!
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
      sv.series += f.series.length; sv.duras += f.series.filter((s) => s.etiqueta !== undefined).length
      continue
    }
    const maxCarga = Math.max(...conCarga.map((x) => x.carga as number))
    if (!(maxCarga > 0)) {
      // peso corporal puro sin BW_ref (carga 0): canal de reps (P3), sin e1RM
      const reps = Math.max(...conCarga.map((x) => x.reps))
      dv.repsSinE1rm.push([t, reps])
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
      continue
    }
    let top = candidatas[0]
    for (const c of candidatas) if (epley(c.carga as number, c.reps) > epley(top.carga as number, top.reps)) top = c
    const e1rm = epley(top.carga as number, top.reps)
    const y = Math.log(e1rm)
    // --- deload inferido (causal): base = sesiones normales de los 28 días previos (mín. 3) ---
    const h = hist.get(f.key) ?? { sets: [], loads: [], lnE1rm: [], fechas: [], racha: [], rachaSigno: 0 }
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
    let errata = false
    if (tipo === 'normal' && h.lnE1rm.length >= 3) {
      const ref = median(h.lnE1rm.slice(-5))
      errata = Math.abs(y - ref) > CFG.errata_log_dev
    }
    const extra: ExposureExtra = {
      fecha: f.fecha, sesionId: f.sesionId, t, e1rm, topReps: top.reps, topLoad: top.carga as number, rir: rirDeEtiqueta(top.s),
      seriesTrabajo: trabajo.length, seriesDuras: trabajo.filter((x) => x.s.etiqueta !== undefined).length, seriesTotales: f.series.length,
      deloadInferido: deloadInf, tipo, errata, bwRef: bw,
    }
    if (errata) {
      const signo = y > median(h.lnE1rm.slice(-5)) ? 1 : -1
      if (h.racha.length && h.rachaSigno === signo) h.racha.push(extra); else { h.racha = [extra]; h.rachaSigno = signo }
      if (h.racha.length >= 3) {
        // nuevo nivel: readmitir la racha como exposiciones, ruptura en la primera, referencia = nuevo nivel
        dv.rupturasPropuestas.push(h.racha[0].t)
        for (const r of h.racha) {
          r.errata = false
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
  // indicador operativo SIN_MEJORA_EN_6_EXPOSICIONES (descriptivo, escala de entrenador)
  for (const dv of variantes.values()) {
    const normales = dv.extras.filter((x) => x.tipo === 'normal')
    if (normales.length < 7) continue
    const ultimas = normales.slice(-CFG.no_improvement_exposures), previas = normales.slice(0, -CFG.no_improvement_exposures)
    const mejorPrevio = Math.max(...previas.map((x) => x.e1rm))
    const cargaHabitual = median(ultimas.map((x) => x.topLoad))
    const repsPreviasACarga = Math.max(0, ...previas.filter((x) => Math.abs(x.topLoad - cargaHabitual) < 1e-6).map((x) => x.topReps))
    const mejoraE1rm = ultimas.some((x) => x.e1rm > mejorPrevio + 1e-9)
    const recordReps = ultimas.some((x) => Math.abs(x.topLoad - cargaHabitual) < 1e-6 && x.topReps > repsPreviasACarga)
    dv.sinMejoraEn6 = !mejoraE1rm && !recordReps
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
