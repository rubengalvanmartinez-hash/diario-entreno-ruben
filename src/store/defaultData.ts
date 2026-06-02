import type { Ejercicio, DiaId } from '../types/models'

// ---------------------------------------------------------------------------
// Datos por defecto — los 3 días de entrenamiento
// ---------------------------------------------------------------------------

type EjercicioSeed = {
  nombre: string
  dia: DiaId
  orden: number
}

const seeds: EjercicioSeed[] = [
  // Día 1
  { dia: 1, orden: 0, nombre: 'Jalón al pecho' },
  { dia: 1, orden: 1, nombre: 'Peso muerto' },
  { dia: 1, orden: 2, nombre: 'Remo' },
  { dia: 1, orden: 3, nombre: 'Bíceps' },
  { dia: 1, orden: 4, nombre: 'Oblicuos' },
  { dia: 1, orden: 5, nombre: 'Polea Bíceps' },

  // Día 2
  { dia: 2, orden: 0, nombre: 'Press de pecho' },
  { dia: 2, orden: 1, nombre: 'Press militar' },
  { dia: 2, orden: 2, nombre: 'Tríceps francés' },
  { dia: 2, orden: 3, nombre: 'Cruces en polea' },
  { dia: 2, orden: 4, nombre: 'Oblicuos en polea' },
  { dia: 2, orden: 5, nombre: 'Mariposa' },
  { dia: 2, orden: 6, nombre: 'Hip Thrust' },

  // Día 3
  { dia: 3, orden: 0, nombre: 'Dominadas' },
  { dia: 3, orden: 1, nombre: 'Pecho inclinado' },
  { dia: 3, orden: 2, nombre: 'Bíceps martillo' },
  { dia: 3, orden: 3, nombre: 'Tríceps con soga' },
  { dia: 3, orden: 4, nombre: 'Vuelos laterales' },
]

/** IDs deterministas para los ejercicios por defecto (sin uuid externo) */
function seedId(dia: DiaId, orden: number): string {
  return `default-d${dia}-${orden}`
}

export const DEFAULT_EJERCICIOS: Ejercicio[] = seeds.map((s) => ({
  id: seedId(s.dia, s.orden),
  nombre: s.nombre,
  dia: s.dia,
  seriesPorDefecto: 3,
  notasFijas: '',
  orden: s.orden,
}))
