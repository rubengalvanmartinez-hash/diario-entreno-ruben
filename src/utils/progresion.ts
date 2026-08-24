/**
 * Detección de estancamiento y aviso de deload.
 *
 * Por cada ejercicio del historial (agrupado por nombre canónico, en kg de
 * referencia Entrena-T) se toma una métrica por sesión:
 *  - 1RM estimado (Epley) si el ejercicio se hace con peso,
 *  - repeticiones máximas si es a peso corporal (peso 0 siempre).
 * y sobre las últimas sesiones se clasifica:
 *  - progresando: la última sesión marcó (o igualó) su mejor registro
 *  - estable:     sin mejorar pero cerca del mejor
 *  - estancado:   ≥ UMBRAL_ESTANCADO sesiones sin superar el mejor
 *  - regresion:   la media de las últimas 3 cae > 7 % por debajo del mejor
 * Deload: ≥ UMBRAL_DELOAD ejercicios estancados/en regresión entrenados en los
 * últimos 21 días → sugerir semana de descarga.
 */
import type { Sesion } from '../types/models'
import { nombreCanonico } from './normalizar'
import { grupoDeEjercicio, type GrupoId } from './gruposMusculares'

export type EstadoProgresion = 'progresando' | 'estable' | 'estancado' | 'regresion'

export interface PuntoProgresion {
  fecha: string
  valor: number
}

export interface AnalisisEjercicio {
  clave: string
  nombre: string
  grupo: GrupoId
  metrica: 'e1rm' | 'reps'
  /** Últimas sesiones con datos (cronológico, máx. VENTANA) */
  puntos: PuntoProgresion[]
  estado: EstadoProgresion
  sesionesSinMejora: number
  mejor: number
  ultimo: number
  ultimaFecha: string
}

export const VENTANA = 10
export const MIN_SESIONES = 4
export const UMBRAL_ESTANCADO = 4
export const UMBRAL_REGRESION = 0.93
export const UMBRAL_DELOAD = 3
export const DIAS_ACTIVO = 21
/** Solo se listan ejercicios entrenados en los últimos N días (los abandonados no están "estancados") */
export const DIAS_LISTA = 45

function epley(peso: number, reps: number): number {
  return reps <= 1 ? peso : peso * (1 + reps / 30)
}

/** Analiza la progresión de todos los ejercicios con ≥ MIN_SESIONES sesiones con datos. */
export function analizarProgresion(
  historial: Sesion[],
  hoy: string = new Date().toISOString().slice(0, 10),
): AnalisisEjercicio[] {
  // Agrupar sesiones por ejercicio (nombre canónico)
  type Acc = { nombre: string; fechas: Map<string, { e1rm: number; reps: number; conPeso: boolean }> }
  const porClave = new Map<string, Acc>()

  const ordenado = [...historial].sort((a, b) => a.fecha.localeCompare(b.fecha))
  for (const ses of ordenado) {
    for (const ej of ses.ejercicios) {
      if (!ej.completado || ej.saltado) continue
      const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
      if (!nombre) continue
      const validas = ej.series.filter(
        (s) => s.reps !== '' && Number(s.reps) > 0 && s.pesoKg !== '' && Number(s.pesoKg) >= 0,
      )
      if (validas.length === 0) continue
      const clave = nombreCanonico(nombre)
      if (!porClave.has(clave)) porClave.set(clave, { nombre, fechas: new Map() })
      const acc = porClave.get(clave)!
      acc.nombre = nombre // el nombre más reciente gana
      const e1rm = Math.max(...validas.map((s) => epley(Number(s.pesoKg), Number(s.reps))))
      const reps = Math.max(...validas.map((s) => Number(s.reps)))
      const conPeso = validas.some((s) => Number(s.pesoKg) > 0)
      const prev = acc.fechas.get(ses.fecha)
      acc.fechas.set(ses.fecha, {
        e1rm: Math.max(prev?.e1rm ?? 0, e1rm),
        reps: Math.max(prev?.reps ?? 0, reps),
        conPeso: (prev?.conPeso ?? false) || conPeso,
      })
    }
  }

  // Solo ejercicios entrenados recientemente: los abandonados no están "estancados"
  const [ay, am, ad] = hoy.split('-').map(Number)
  const lim = new Date(ay, am - 1, ad - DIAS_LISTA)
  const limiteLista = `${lim.getFullYear()}-${String(lim.getMonth() + 1).padStart(2, '0')}-${String(lim.getDate()).padStart(2, '0')}`

  const resultado: AnalisisEjercicio[] = []
  for (const [clave, acc] of porClave) {
    const fechas = [...acc.fechas.keys()].sort()
    if (fechas.length < MIN_SESIONES) continue
    if (fechas[fechas.length - 1] < limiteLista) continue

    // Métrica: reps si el ejercicio se hace AHORA a peso corporal (últimas 2 sesiones
    // sin peso) o nunca ha llevado peso — evita mezclar épocas con/sin lastre (Dominadas)
    const registros = fechas.map((f) => acc.fechas.get(f)!)
    const usaPeso = registros.slice(-2).some((v) => v.conPeso) && registros.some((v) => v.conPeso)
    const todos: PuntoProgresion[] = []
    for (let i = 0; i < fechas.length; i++) {
      const r = registros[i]
      if (usaPeso && !r.conPeso) continue // sesiones a cuerpo libre no comparables con e1RM
      todos.push({ fecha: fechas[i], valor: Math.round((usaPeso ? r.e1rm : r.reps) * 10) / 10 })
    }
    if (todos.length < MIN_SESIONES) continue
    const puntos = todos.slice(-VENTANA)
    const valores = puntos.map((p) => p.valor)

    // Suavizado por mediana de 3: un valor atípico de un solo día (error de
    // introducción, día raro) no debe decidir el estado ni anclar el "mejor"
    const suaves = medianaDe3(valores)

    // Última sesión que marcó un nuevo mejor (suavizado) dentro de la ventana
    // (igualar el mejor NO cuenta como mejora)
    let idxUltimoMejor = 0
    let best = suaves[0]
    for (let i = 1; i < suaves.length; i++) {
      if (suaves[i] > best + 1e-9) { best = suaves[i]; idxUltimoMejor = i }
    }
    const sesionesSinMejoraSuav = suaves.length - 1 - idxUltimoMejor
    const mejor = Math.max(...suaves)
    const ultimo = valores[valores.length - 1]
    const media3 = suaves.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, suaves.length)

    // Un récord BRUTO en la última sesión siempre cuenta como progreso inmediato
    // (el suavizado tardaría una sesión más en reflejarlo)
    const prReciente = valores.length >= 2 && ultimo > Math.max(...valores.slice(0, -1)) + 1e-9

    let estado: EstadoProgresion
    if (prReciente || sesionesSinMejoraSuav === 0) estado = 'progresando'
    else if (media3 < UMBRAL_REGRESION * mejor) estado = 'regresion'
    else if (sesionesSinMejoraSuav >= UMBRAL_ESTANCADO) estado = 'estancado'
    else estado = 'estable'
    const sesionesSinMejora = estado === 'progresando' ? 0 : sesionesSinMejoraSuav

    resultado.push({
      clave,
      nombre: acc.nombre,
      grupo: grupoDeEjercicio(acc.nombre),
      metrica: usaPeso ? 'e1rm' : 'reps',
      puntos,
      estado,
      sesionesSinMejora,
      mejor: Math.round(mejor * 10) / 10,
      ultimo,
      ultimaFecha: fechas[fechas.length - 1],
    })
  }

  // Orden: peor primero (regresión, estancado, estable, progresando), luego más reciente
  const peso: Record<EstadoProgresion, number> = { regresion: 0, estancado: 1, estable: 2, progresando: 3 }
  resultado.sort((a, b) => peso[a.estado] - peso[b.estado] || b.ultimaFecha.localeCompare(a.ultimaFecha))
  return resultado
}

/** Mediana móvil de 3 (bordes con la ventana de 3 más cercana). */
function medianaDe3(v: number[]): number[] {
  if (v.length < 3) return [...v]
  const med = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y)[1]
  return v.map((_, i) => {
    const j = Math.min(Math.max(i, 1), v.length - 2)
    return med(v[j - 1], v[j], v[j + 1])
  })
}

export interface AvisoDeload {
  sugerir: boolean
  /** Ejercicios estancados o en regresión entrenados en los últimos DIAS_ACTIVO días */
  afectados: AnalisisEjercicio[]
}

export function evaluarDeload(
  analisis: AnalisisEjercicio[],
  hoy: string = new Date().toISOString().slice(0, 10),
): AvisoDeload {
  const [y, m, d] = hoy.split('-').map(Number)
  const limite = new Date(y, m - 1, d - DIAS_ACTIVO)
  const limiteISO = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`
  const afectados = analisis.filter(
    (a) => (a.estado === 'estancado' || a.estado === 'regresion') && a.ultimaFecha >= limiteISO,
  )
  return { sugerir: afectados.length >= UMBRAL_DELOAD, afectados }
}
