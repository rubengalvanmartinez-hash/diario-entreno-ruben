/**
 * Equivalencias de peso entre gimnasios.
 *
 * Entrena-T es la REFERENCIA. Para cada ejercicio puede existir un factor
 * `f = kg Entrena-T / kg Fitness Park` (p. ej. 100 kg ET = 80 kg FP → f = 1,25).
 *  - Lo que se registra en Fitness Park es el peso REAL de su máquina.
 *  - Para medir la evolución, ese peso se convierte a "kg ET equivalentes": kg × f.
 *  - Para saber qué cargar en Fitness Park a partir de una referencia ET: kg ÷ f.
 * Sin factor (o en Entrena-T) no se convierte nada (f = 1): peso libre, mancuernas…
 *
 * Las equivalencias se guardan por nombre canónico de ejercicio (utils/normalizar),
 * así sobreviven a renombrados/alias y a los ids sintéticos del historial.
 */
import type { GimnasioId, Sesion, SesionEjercicio } from '../types/models'
import { GIMNASIO_REFERENCIA } from '../types/models'
import { nombreCanonico } from './normalizar'

/** nombreCanonico(ejercicio) → factor (kg ET por cada kg en Fitness Park) */
export type Equivalencias = Record<string, number>

/** Factor aplicable a un ejercicio en un gimnasio (1 si es la referencia o no hay equivalencia). */
export function factorEquivalencia(
  equivalencias: Equivalencias,
  nombreEjercicio: string,
  gimnasio: GimnasioId | undefined,
): number {
  if (!gimnasio || gimnasio === GIMNASIO_REFERENCIA) return 1
  const f = equivalencias[nombreCanonico(nombreEjercicio)]
  return typeof f === 'number' && isFinite(f) && f > 0 ? f : 1
}

/** true si existe una equivalencia explícita para ese ejercicio en ese gimnasio. */
export function tieneEquivalencia(
  equivalencias: Equivalencias,
  nombreEjercicio: string,
  gimnasio: GimnasioId | undefined,
): boolean {
  if (!gimnasio || gimnasio === GIMNASIO_REFERENCIA) return false
  return typeof equivalencias[nombreCanonico(nombreEjercicio)] === 'number'
}

/** kg reales de un gimnasio → kg Entrena-T equivalentes */
export function aReferencia(pesoKg: number, factor: number): number {
  return pesoKg * factor
}

/** kg Entrena-T → kg a cargar en el otro gimnasio */
export function aGimnasio(pesoRefKg: number, factor: number): number {
  return factor > 0 ? pesoRefKg / factor : pesoRefKg
}

/** Redondeo para mostrar pesos convertidos (a 0,5 kg, quitando ruido decimal). */
export function redondearPeso(kg: number): number {
  return Math.round(kg * 2) / 2
}

/** Factor a partir de una pareja "X kg en Entrena-T equivalen a Y kg en Fitness Park". */
export function factorDesdePareja(kgReferencia: number, kgGimnasio: number): number | null {
  if (!(kgReferencia > 0) || !(kgGimnasio > 0)) return null
  return kgReferencia / kgGimnasio
}

/** Convierte las series de un ejercicio de sesión a kg Entrena-T equivalentes. */
export function ejercicioAReferencia(
  ej: SesionEjercicio,
  gimnasio: GimnasioId | undefined,
  equivalencias: Equivalencias,
): SesionEjercicio {
  const f = factorEquivalencia(equivalencias, ej.nombreSustituido ?? ej.nombreSnapshot, gimnasio)
  if (f === 1) return ej
  return {
    ...ej,
    series: ej.series.map((s) =>
      s.pesoKg === '' ? s : { ...s, pesoKg: Math.round(aReferencia(Number(s.pesoKg), f) * 100) / 100 },
    ),
  }
}

/**
 * Devuelve la sesión con todos sus pesos en kg Entrena-T equivalentes.
 * Devuelve la MISMA instancia si no hay nada que convertir (memo-friendly).
 */
export function sesionAReferencia(sesion: Sesion, equivalencias: Equivalencias): Sesion {
  if (!sesion.gimnasio || sesion.gimnasio === GIMNASIO_REFERENCIA) return sesion
  let cambio = false
  const ejercicios = sesion.ejercicios.map((ej) => {
    const conv = ejercicioAReferencia(ej, sesion.gimnasio, equivalencias)
    if (conv !== ej) cambio = true
    return conv
  })
  return cambio ? { ...sesion, ejercicios } : sesion
}

/** Historial completo en kg Entrena-T equivalentes (para tendencias, récords, último entreno…). */
export function historialAReferencia(historial: Sesion[], equivalencias: Equivalencias): Sesion[] {
  let cambio = false
  const out = historial.map((s) => {
    const conv = sesionAReferencia(s, equivalencias)
    if (conv !== s) cambio = true
    return conv
  })
  return cambio ? out : historial
}
