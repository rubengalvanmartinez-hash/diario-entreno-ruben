// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

export type DiaId = 1 | 2 | 3

// ---------------------------------------------------------------------------
// Ejercicio  (configuración persistente, no cambia entre sesiones)
// ---------------------------------------------------------------------------

export interface Ejercicio {
  id: string
  nombre: string
  dia: DiaId
  seriesPorDefecto: 3 | 4
  /** Instrucciones fijas visibles durante el entrenamiento */
  notasFijas: string
  /** Imagen codificada en base64 (jpeg/png), undefined = sin imagen */
  imagenBase64?: string
  /** Orden de aparición dentro del día */
  orden: number
  /**
   * true si el "peso" registrado es una ASISTENCIA (p.ej. Dominadas asistidas).
   * En estos ejercicios bajar el volumen es progresar (menos ayuda = más fuerza).
   */
  esAsistencia?: boolean
}

// ---------------------------------------------------------------------------
// Serie  (una sola serie dentro de un ejercicio activo)
// ---------------------------------------------------------------------------

export type EtiquetaSerie = 'fallo' | 'rir0' | 'rir1'

export interface Serie {
  /** Número de serie (1-based) */
  numero: number
  reps: number | ''
  pesoKg: number | ''
  /** Etiqueta de esfuerzo opcional */
  etiqueta?: EtiquetaSerie
}

// ---------------------------------------------------------------------------
// SesionEjercicio  (estado de un ejercicio dentro de una sesión activa)
// ---------------------------------------------------------------------------

export interface SesionEjercicio {
  ejercicioId: string
  /** Snapshot del nombre en el momento de la sesión (por si se renombra luego) */
  nombreSnapshot: string
  /** Nombre alternativo si el usuario sustituyó el ejercicio en esta sesión */
  nombreSustituido?: string
  series: Serie[]
  notaSesion: string
  completado: boolean
  /** true si Fede ayudó a acabar el ejercicio */
  ayudaFede?: boolean
  /** true si el usuario saltó este ejercicio sin introducir datos */
  saltado?: boolean
}

// ---------------------------------------------------------------------------
// Sesion  (un entrenamiento completo)
// ---------------------------------------------------------------------------

export type TipoSesion = 'normal' | 'parcial' | 'extra'

export interface Sesion {
  id: string
  /** ISO 8601, ej. "2026-04-01" */
  fecha: string
  /** 1-3 para días normales; 'parcial' para sesión de ejercicios sueltos; 'extra' para ejercicio puntual */
  dia: DiaId | 'parcial' | 'extra'
  tipo?: TipoSesion
  ejercicios: SesionEjercicio[]
  sincronizado: boolean
}

// ---------------------------------------------------------------------------
// RegistroPeso
// ---------------------------------------------------------------------------

export interface RegistroPeso {
  id: string
  /** ISO 8601, ej. "2026-04-01" */
  fecha: string
  pesoKg: number
  sincronizado: boolean
}

// ---------------------------------------------------------------------------
// Helpers de construcción
// ---------------------------------------------------------------------------

/** Genera series vacías a partir del número de series por defecto */
export function crearSeriesVacias(cantidad: number): Serie[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    numero: i + 1,
    reps: '',
    pesoKg: '',
  }))
}

/**
 * true si la serie tiene algún dato real: reps > 0 o peso > 0.
 * El peso 0 con reps es válido (ejercicios a peso corporal, ej. Dominadas).
 */
export function serieConDatos(s: Pick<Serie, 'reps' | 'pesoKg'>): boolean {
  return (s.reps !== '' && Number(s.reps) > 0) || (s.pesoKg !== '' && Number(s.pesoKg) > 0)
}

/** Construye un SesionEjercicio inicial a partir de un Ejercicio */
export function crearSesionEjercicio(ejercicio: Ejercicio): SesionEjercicio {
  return {
    ejercicioId: ejercicio.id,
    nombreSnapshot: ejercicio.nombre,
    series: crearSeriesVacias(ejercicio.seriesPorDefecto),
    notaSesion: '',
    completado: false,
  }
}

/** Fecha de hoy como cadena ISO 8601 (solo fecha, sin hora) */
export function fechaHoy(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// RegistroMedidas  (perímetros corporales en cm)
// ---------------------------------------------------------------------------

export interface RegistroMedidas {
  id: string
  /** ISO 8601, ej. "2026-06-04" */
  fecha: string
  cuello?:          number
  hombro?:          number
  pecho?:           number
  bicepsIzq?:       number
  bicepsDer?:       number
  cinturaAlta?:     number
  cinturaBaja?:     number
  cadera?:          number
  musloIzq?:        number
  musloDer?:        number
  pantorrillaIzq?:  number
  pantorrillaDer?:  number
  abdomen?:         number
}

// ---------------------------------------------------------------------------
// PerfilCorporal  (datos del usuario para cálculos de composición)
// ---------------------------------------------------------------------------

export interface PerfilCorporal {
  alturaCm: number
  edad: number
  sexo: 'hombre' | 'mujer'
  cinturaCm: number
  cuelloCm: number
  /** Solo requerido para mujeres (fórmula Marina EE.UU.) */
  caderaCm?: number
}

// ---------------------------------------------------------------------------
// RegistroComposicion  (snapshot de IMC y composición corporal)
// ---------------------------------------------------------------------------

export type CategoriaImc = 'bajo peso' | 'normal' | 'sobrepeso' | 'obesidad'

export interface RegistroComposicion {
  id: string
  /** ISO 8601, ej. "2026-04-01" */
  fecha: string
  pesoKg: number
  imc: number
  categoriaImc: CategoriaImc
  pctGrasa: number
  pctMusculo: number
}
