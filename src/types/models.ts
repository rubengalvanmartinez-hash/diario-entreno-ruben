// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

export type DiaId = 1 | 2 | 3

/**
 * Gimnasios. Entrena-T es la referencia: toda la evolución se mide en
 * "kg Entrena-T equivalentes". Fitness Park registra el peso real de sus
 * máquinas y se convierte con un factor por ejercicio (ver utils/equivalencias).
 */
export type GimnasioId = 'entrenat' | 'fitnesspark'
export const GIMNASIO_REFERENCIA: GimnasioId = 'entrenat'
export const GIMNASIOS: Record<GimnasioId, { nombre: string; corto: string }> = {
  entrenat:    { nombre: 'Entrena-T',    corto: 'ET' },
  fitnesspark: { nombre: 'Fitness Park', corto: 'FP' },
}

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
  /**
   * true = "en suspenso": fuera de la rutina (no sale en sesiones ni selectores)
   * pero conserva id, día de origen, notas e historial para recuperarlo después.
   */
  suspendido?: boolean
  /**
   * true = cada lado por separado (p. ej. curl martillo, zancadas): las series
   * llevan repeticiones del lado derecho (reps) y del izquierdo (repsIzq).
   */
  unilateral?: boolean
}

// ---------------------------------------------------------------------------
// Serie  (una sola serie dentro de un ejercicio activo)
// ---------------------------------------------------------------------------

export type EtiquetaSerie = 'fallo' | 'rir0' | 'rir1'

export interface Serie {
  /** Número de serie (1-based) */
  numero: number
  /** Repeticiones. En ejercicios unilaterales: las del lado DERECHO (las que usan las estadísticas) */
  reps: number | ''
  /** Solo ejercicios unilaterales: repeticiones del lado IZQUIERDO (undefined = serie normal) */
  repsIzq?: number | ''
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
  /** true si se registra cada lado por separado (copiado de la config al crear la sesión) */
  unilateral?: boolean
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
  /** Gimnasio donde se hizo la sesión; undefined = Entrena-T (referencia) */
  gimnasio?: GimnasioId
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
export function crearSeriesVacias(cantidad: number, unilateral = false): Serie[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    numero: i + 1,
    reps: '' as const,
    ...(unilateral ? { repsIzq: '' as const } : {}),
    pesoKg: '' as const,
  }))
}

/**
 * true si la serie tiene algún dato real: reps > 0 (de cualquier lado) o peso > 0.
 * El peso 0 con reps es válido (ejercicios a peso corporal, ej. Dominadas).
 */
export function serieConDatos(s: Pick<Serie, 'reps' | 'pesoKg' | 'repsIzq'>): boolean {
  return (s.reps !== '' && Number(s.reps) > 0)
    || (s.repsIzq !== undefined && s.repsIzq !== '' && Number(s.repsIzq) > 0)
    || (s.pesoKg !== '' && Number(s.pesoKg) > 0)
}

/** true si la serie registra cada lado por separado */
export function esSerieUnilateral(s: Pick<Serie, 'repsIzq'>): boolean {
  return s.repsIzq !== undefined
}

/** Reps para mostrar: "10" o, en unilaterales, "10/9" (derecho/izquierdo; igual → "10/10") */
export function textoReps(s: Pick<Serie, 'reps' | 'repsIzq'>, vacio = '—'): string {
  const d = s.reps === '' ? vacio : String(s.reps)
  if (!esSerieUnilateral(s)) return d
  const i = s.repsIzq === '' || s.repsIzq === undefined ? vacio : String(s.repsIzq)
  return `${d}/${i}`
}

/** Construye un SesionEjercicio inicial a partir de un Ejercicio */
export function crearSesionEjercicio(ejercicio: Ejercicio): SesionEjercicio {
  return {
    ejercicioId: ejercicio.id,
    nombreSnapshot: ejercicio.nombre,
    series: crearSeriesVacias(ejercicio.seriesPorDefecto, !!ejercicio.unilateral),
    notaSesion: '',
    completado: false,
    ...(ejercicio.unilateral ? { unilateral: true } : {}),
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
