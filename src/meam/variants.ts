/**
 * MEAM — mapa ejercicio → variante (músculo, cluster, rol, clase de equipo).
 *
 * La identidad de la variante es el nombre canónico (utils/normalizar), así sobrevive a alias y a los ids sintéticos del
 * historial. El mapa por defecto se deriva de palabras clave (misma filosofía que utils/gruposMusculares); la tabla
 * `meam_variants` de Supabase permite corregirlo por usuario sin tocar el código. Los nombres que no casan con ninguna
 * clave quedan en músculo 'otros' y se listan como "sin asignar" para que el usuario los revise en Ajustes.
 */
import { nombreCanonico, normalizarNombre } from '../utils/normalizar'
import type { EquipmentClass, VariantRole } from './engine'

export type MeamMuscle = 'pecho' | 'hombro' | 'biceps' | 'triceps' | 'espalda' | 'cuadriceps' | 'femoral_gluteo' | 'gemelo' | 'abdomen' | 'otros'

export const MUSCULOS_MEAM: Record<MeamMuscle, string> = {
  pecho: 'Pecho', hombro: 'Hombro', biceps: 'Bíceps', triceps: 'Tríceps', espalda: 'Espalda', cuadriceps: 'Cuádriceps',
  femoral_gluteo: 'Femoral / glúteo', gemelo: 'Gemelo', abdomen: 'Abdomen', otros: 'Otros',
}

export interface VariantMeta {
  /** nombre canónico (clave de la variante) */
  key: string
  /** nombre tal como aparece en el historial (el más reciente) */
  nombre: string
  musculo: MeamMuscle
  cluster: string
  role: VariantRole
  equipment: EquipmentClass
  /** el "peso" registrado es asistencia (dominadas asistidas): el sentido se invierte */
  esAsistencia: boolean
  /** aislamiento: e1RM válido hasta 20 reps (compuestos: 12) */
  aislamiento: boolean
  /** true si se asignó por palabras clave; false si viene de la tabla meam_variants (revisado por el usuario) */
  inferido: boolean
}

interface Regla { claves: string[]; musculo: MeamMuscle; cluster: string; equipment: EquipmentClass; aislamiento: boolean; role?: VariantRole }

/** Orden de evaluación: gana la primera regla que casa (resuelve ambigüedades como "jalón al pecho" o "curl femoral"). */
const REGLAS: Regla[] = [
  { claves: ['abdominal', 'abdomen', 'oblicuo', 'plancha', 'crunch', 'core', 'rueda', 'elevacion de piernas'], musculo: 'abdomen', cluster: 'ABDOMEN', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['femoral', 'isquio', 'nordico', 'nórdico'], musculo: 'femoral_gluteo', cluster: 'FEMORAL', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['hip thrust', 'hiptrust', 'gluteo', 'puente'], musculo: 'femoral_gluteo', cluster: 'EXTENSION_CADERA', equipment: 'compound_free', aislamiento: false },
  { claves: ['gemelo', 'pantorrilla', 'soleo', 'talon', 'talones'], musculo: 'gemelo', cluster: 'GEMELO', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['menton', 'remo alto'], musculo: 'hombro', cluster: 'ELEVACION', equipment: 'compound_free', aislamiento: false },
  { claves: ['abductor', 'aductor'], musculo: 'femoral_gluteo', cluster: 'ABD_ADD', equipment: 'isolation_machine', aislamiento: true, role: 'SECONDARY' },
  { claves: ['prensa', 'sentadilla', 'hack', 'jaca', 'zancada', 'bulgara', 'step', 'cajon', 'sillon', 'extension de cuadriceps', 'cuadriceps', 'pierna'], musculo: 'cuadriceps', cluster: 'SENTADILLA_PRENSA', equipment: 'compound_free', aislamiento: false },
  { claves: ['dominada', 'pull up', 'pullup', 'chin up'], musculo: 'espalda', cluster: 'TRACCION_VERTICAL', equipment: 'weighted_bodyweight', aislamiento: false },
  { claves: ['jalon'], musculo: 'espalda', cluster: 'TRACCION_VERTICAL', equipment: 'compound_free', aislamiento: false },
  { claves: ['remo', 'pull down', 'dorsal'], musculo: 'espalda', cluster: 'REMO', equipment: 'compound_free', aislamiento: false },
  { claves: ['peso muerto', 'hiperextension', 'lumbar', 'buenos dias'], musculo: 'espalda', cluster: 'BISAGRA', equipment: 'compound_free', aislamiento: false },
  { claves: ['encogimiento', 'trapecio'], musculo: 'espalda', cluster: 'TRAPECIO', equipment: 'isolation_machine', aislamiento: true, role: 'SECONDARY' },
  { claves: ['face pull', 'posterior', 'pajaro', 'deltoide posterior'], musculo: 'hombro', cluster: 'POSTERIOR', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['militar', 'press de hombro', 'press hombro', 'arnold', 'press militar', 'hombro'], musculo: 'hombro', cluster: 'PRESS_VERTICAL', equipment: 'compound_free', aislamiento: false },
  { claves: ['vuelo', 'lateral', 'frontal', 'elevacion'], musculo: 'hombro', cluster: 'ELEVACION', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['triceps', 'frances', 'soga', 'patada', 'press cerrado', 'extension de codo'], musculo: 'triceps', cluster: 'TRICEPS', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['biceps', 'curl', 'martillo', 'antebrazo', 'muneca'], musculo: 'biceps', cluster: 'BICEPS', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['inclinado', 'inclinada'], musculo: 'pecho', cluster: 'PRESS_INCLINADO', equipment: 'compound_free', aislamiento: false },
  { claves: ['cruces', 'mariposa', 'apertura', 'pull over', 'pullover', 'pec deck', 'contractor'], musculo: 'pecho', cluster: 'APERTURA', equipment: 'isolation_machine', aislamiento: true },
  { claves: ['fondos', 'dips'], musculo: 'pecho', cluster: 'PRESS_HORIZONTAL', equipment: 'weighted_bodyweight', aislamiento: false },
  { claves: ['pecho', 'banca', 'pectoral', 'press'], musculo: 'pecho', cluster: 'PRESS_HORIZONTAL', equipment: 'compound_free', aislamiento: false },
]

/** Asignación por palabras clave (sin base de datos). */
export function inferirVariante(nombre: string, esAsistencia = false): VariantMeta {
  const n = normalizarNombre(nombre)
  const key = nombreCanonico(nombre)
  for (const r of REGLAS) {
    if (r.claves.some((c) => n.includes(c))) {
      return { key, nombre, musculo: r.musculo, cluster: r.cluster, role: r.role ?? 'DIRECT', equipment: esAsistencia ? 'assisted' : r.equipment,
        esAsistencia, aislamiento: r.aislamiento, inferido: true }   // 'weighted_bodyweight' (dominadas/fondos sin asistencia): W = BW_ref + lastre
    }
  }
  return { key, nombre, musculo: 'otros', cluster: 'OTROS', role: 'DIRECT', equipment: esAsistencia ? 'assisted' : 'compound_free', esAsistencia, aislamiento: false, inferido: true }
}

/** Fila de la tabla meam_variants (correcciones del usuario). */
export interface VariantOverride {
  ejercicio: string          // nombre canónico
  musculo: MeamMuscle
  cluster: string
  role: VariantRole
  equipment: EquipmentClass
  es_asistencia: boolean
  aislamiento: boolean
}

/**
 * Construye el mapa de variantes para un conjunto de nombres de ejercicio (historial + configuración), aplicando las
 * correcciones del usuario cuando existen. `asistencia` = nombres canónicos marcados como asistidos en la configuración.
 */
export function construirMapaVariantes(nombres: Iterable<string>, overrides: readonly VariantOverride[] = [], asistencia: ReadonlySet<string> = new Set()): Map<string, VariantMeta> {
  const ov = new Map(overrides.map((o) => [o.ejercicio, o]))
  const out = new Map<string, VariantMeta>()
  for (const nombre of nombres) {
    const key = nombreCanonico(nombre)
    if (out.has(key)) continue
    const o = ov.get(key)
    if (o) {
      out.set(key, { key, nombre, musculo: o.musculo, cluster: o.cluster, role: o.role, equipment: o.equipment, esAsistencia: o.es_asistencia, aislamiento: o.aislamiento, inferido: false })
    } else {
      out.set(key, inferirVariante(nombre, asistencia.has(key)))
    }
  }
  return out
}

export const MUSCULOS_ORDEN: MeamMuscle[] = ['pecho', 'hombro', 'triceps', 'espalda', 'biceps', 'cuadriceps', 'femoral_gluteo', 'gemelo', 'abdomen', 'otros']
