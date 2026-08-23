/**
 * Clasificación de ejercicios por grupo muscular (solo para navegación/vista;
 * no modifica datos). Se basa en palabras clave sobre el nombre normalizado.
 *
 * El orden de GRUPOS importa: se evalúan de arriba abajo y gana el primero que
 * casa, para resolver ambigüedades reales del historial:
 *  - "Jalón al pecho" → espalda (espalda se evalúa antes que pecho)
 *  - "Curl femoral acostado" → piernas (antes que brazos)
 *  - "Pull over polea alta" → pecho ('pull over' está en pecho, no en espalda)
 *  - "Curo de bíceps con mancuerna en banca" → brazos (antes que pecho/'banca')
 *  - "Posteriores mariposa" → hombro (antes que pecho/'mariposa')
 *  - "Elevación de piernas" → abdomen (antes que piernas)
 */
import { normalizarNombre } from './normalizar'

export type GrupoId = 'abdomen' | 'piernas' | 'hombro' | 'espalda' | 'brazos' | 'pecho' | 'otros'

export interface GrupoMuscular {
  id: GrupoId
  nombre: string
  /** Palabras clave (ya normalizadas: minúsculas, sin tildes) */
  claves: string[]
}

/** Orden de EVALUACIÓN (resuelve ambigüedades). Para mostrar, usar GRUPOS_VISTA. */
export const GRUPOS: GrupoMuscular[] = [
  {
    id: 'abdomen', nombre: 'Abdomen',
    claves: ['abdominal', 'abdomen', 'oblicuo', 'plancha', 'crunch', 'core', 'rueda', 'elevacion de piernas'],
  },
  {
    id: 'piernas', nombre: 'Piernas',
    claves: ['pierna', 'cuadriceps', 'femoral', 'isquio', 'prensa', 'sentadilla', 'hack', 'jaca',
             'gemelo', 'pantorrilla', 'abductor', 'aductor', 'hip thrust', 'hiptrust', 'gluteo',
             'zancada', 'cajon', 'sillon', 'bulgara', 'step'],
  },
  {
    id: 'hombro', nombre: 'Hombro',
    claves: ['hombro', 'militar', 'vuelo', 'lateral', 'frontal', 'posterior', 'arnold', 'pajaro',
             'face pull', 'deltoide', 'elevacion'],
  },
  {
    id: 'espalda', nombre: 'Espalda',
    claves: ['jalon', 'remo', 'dominada', 'peso muerto', 'espalda', 'dorsal', 'trapecio',
             'encogimiento', 'hiperextension', 'lumbar'],
  },
  {
    id: 'brazos', nombre: 'Brazos',
    claves: ['biceps', 'triceps', 'curl', 'martillo', 'antebrazo', 'muneca', 'frances', 'soga', 'patada'],
  },
  {
    id: 'pecho', nombre: 'Pecho',
    claves: ['pecho', 'cruces', 'mariposa', 'apertura', 'pull over', 'pullover', 'fondos', 'banca', 'pectoral'],
  },
]

export const GRUPO_OTROS: GrupoMuscular = { id: 'otros', nombre: 'Otros', claves: [] }

/** Orden para MOSTRAR los botones (los grandes grupos que pidió el usuario + abdomen). */
export const GRUPOS_VISTA: GrupoMuscular[] = (['pecho', 'hombro', 'brazos', 'espalda', 'piernas', 'abdomen'] as GrupoId[])
  .map((id) => GRUPOS.find((g) => g.id === id)!)

/** Devuelve el grupo muscular de un ejercicio por su nombre ('otros' si no casa ninguna clave). */
export function grupoDeEjercicio(nombre: string): GrupoId {
  const n = normalizarNombre(nombre)
  for (const g of GRUPOS) {
    if (g.claves.some((c) => n.includes(c))) return g.id
  }
  return 'otros'
}
