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

function bwRefEn(fecha: string, pesos: readonly RegistroPeso[]): number | null {
  let mejor: RegistroPeso | null = null
  for (const p of pesos) {
    if (p.fecha <= fecha && (!mejor || p.fecha > mejor.fecha)) mejor = p
  }
  if (!mejor) return null
  const dias = diasEntre(mejor.fecha, fecha)
  if (dias <= CFG.bw_ref_window_days) return mejor.pesoKg
  if (dias <= CFG.bw_ref_fallback_days) return mejor.pesoKg
  return null
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
  const hist = new Map<string, { sets: number[]; loads: number[]; lnE1rm: number[] }>()
  for (const f of filas) {
    let meta = mapa.get(f.key)
    if (!meta) { sinMapa.add(f.nombre); meta = { key: f.key, nombre: f.nombre, musculo: 'otros', cluster: 'OTROS', role: 'DIRECT', equipment: 'compound_free', esAsistencia: false, aislamiento: false, inferido: true } }
    if (!variantes.has(f.key)) variantes.set(f.key, { meta, exps: [], extras: [], erratas: [], repsSinE1rm: [], sinMejoraEn6: false })
    const dv = variantes.get(f.key)!
    const t = tDe(f.fecha)
    // --- volumen semanal por músculo (series con datos y series duras) ---
    const lunes = lunesDeIso(f.fecha)
    if (!volumen.has(meta.musculo)) volumen.set(meta.musculo, new Map())
    const vm = volumen.get(meta.musculo)!
    if (!vm.has(lunes)) vm.set(lunes, { lunes, semana: Math.round(diasEntre(epoch, lunes) / 7), series: 0, duras: 0 })
    const sv = vm.get(lunes)!
    sv.series += f.series.length
    sv.duras += f.series.filter((s) => s.etiqueta !== undefined).length
    // --- carga efectiva por serie (asistidos: BW_ref − asistencia) ---
    const bw = meta.esAsistencia ? bwRefEn(f.fecha, pesos) : null
    const cargaDe = (s: Serie): number | null => {
      const peso = s.pesoKg === '' ? 0 : Number(s.pesoKg)
      if (meta!.esAsistencia) return bw === null ? null : bw - peso
      return peso
    }
    const conCarga = f.series.map((s) => ({ s, carga: cargaDe(s), reps: s.reps === '' ? 0 : Number(s.reps) })).filter((x) => x.carga !== null && x.reps >= CFG.e1rm_reps_min)
    if (conCarga.length === 0) continue
    const maxCarga = Math.max(...conCarga.map((x) => x.carga as number))
    if (!(maxCarga > 0)) {
      // peso corporal puro (sin carga): canal de reps (P3), sin e1RM
      const reps = Math.max(...conCarga.map((x) => x.reps))
      dv.repsSinE1rm.push([t, reps])
      continue
    }
    const trabajo = conCarga.filter((x) => (x.carga as number) >= CFG.working_set_load_ratio * maxCarga)
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
    // --- deload inferido (causal) ---
    const h = hist.get(f.key) ?? { sets: [], loads: [], lnE1rm: [] }
    let deloadInf = false
    if (h.sets.length >= 4) {
      const medSets = median(h.sets.slice(-4)), medLoad = median(h.loads.slice(-4))
      deloadInf = trabajo.length <= CFG.deload_infer_volume_ratio * medSets && (top.carga as number) <= CFG.deload_infer_load_ratio * medLoad
    }
    const tipo: SessionType = f.tipoDeclarado !== 'normal' ? f.tipoDeclarado : deloadInf ? 'deload' : 'normal'
    // --- errata (causal, sobre exposiciones normales previas). Una descarga (declarada o inferida) baja la carga a propósito:
    //     no se evalúa como errata (P0: el filtro busca errores de registro, p. ej. 800 por 80) ---
    let errata = false
    if (tipo === 'normal' && h.lnE1rm.length >= 3) {
      const ref = median(h.lnE1rm.slice(-6))
      errata = Math.abs(y - ref) > CFG.errata_log_dev
    }
    const extra: ExposureExtra = {
      fecha: f.fecha, sesionId: f.sesionId, t, e1rm, topReps: top.reps, topLoad: top.carga as number, rir: rirDeEtiqueta(top.s),
      seriesTrabajo: trabajo.length, seriesDuras: f.series.filter((s) => s.etiqueta !== undefined).length, seriesTotales: f.series.length,
      deloadInferido: deloadInf, tipo, errata, bwRef: bw,
    }
    if (errata) { dv.erratas.push(extra); continue }
    dv.exps.push(makeExposure({ t, y, session_type: tipo, reps_typical: top.reps, load_kg: top.carga as number }))
    dv.extras.push(extra)
    if (tipo === 'normal') { h.sets.push(trabajo.length); h.loads.push(top.carga as number); h.lnE1rm.push(y) }
    hist.set(f.key, h)
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
  return 100 * v.filter((x) => x <= valor).length / v.length
}

/**
 * Semanas (índice desde epoch) en las que el volumen del músculo cae a ≤ 70 % de la mediana de las 4 semanas previas:
 * candidatas a "reducción del estímulo" (P11). Devuelve los t (lunes de la semana) en la escala del motor.
 */
export function reduccionesDeVolumen(semanas: readonly SemanaVolumen[]): number[] {
  const out: number[] = []
  for (let i = 4; i < semanas.length; i++) {
    const prev = semanas.slice(i - 4, i).map((s) => s.series)
    const med = median(prev)
    if (med > 0 && semanas[i].series <= CFG.reduction_volume_ratio * med) out.push(semanas[i].semana)
  }
  return out
}
