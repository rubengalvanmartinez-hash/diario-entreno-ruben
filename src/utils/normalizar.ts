import { ALIAS_EJERCICIOS } from './aliasEjercicios'

/**
 * Normaliza un nombre de ejercicio para comparaciones robustas.
 * - Minúsculas
 * - Sin tildes ni diacríticos (NFD + eliminar combining chars)
 * - Sin espacios extra al inicio/final
 * - Espacios múltiples colapsados a uno
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // eliminar diacríticos (tildes, etc.)
    .replace(/\s+/g, ' ')            // colapsar espacios múltiples
}

/**
 * Forma canónica de un nombre de ejercicio: si el nombre normalizado es un
 * alias conocido (nombre antiguo del historial), devuelve el nombre actual
 * normalizado; si no, devuelve el nombre normalizado tal cual.
 */
export function nombreCanonico(nombre: string): string {
  const norm = normalizarNombre(nombre)
  const actual = ALIAS_EJERCICIOS[norm]
  return actual ? normalizarNombre(actual) : norm
}

/**
 * Casa un ejercicio de sesión con un ejercicio de referencia (config o sesión activa).
 * Primero intenta por ID exacto (sesiones nativas), luego por nombre normalizado
 * (sesiones de Supabase con ID sintético tipo "sesionId-nombre") y, si tampoco
 * coincide, por alias de nombres antiguos (ALIAS_EJERCICIOS).
 */
export function matchesEjercicio(
  e: { ejercicioId: string; nombreSnapshot: string },
  ejercicioId: string,
  nombre: string,
): boolean {
  if (e.ejercicioId === ejercicioId) return true
  if (!e.nombreSnapshot || !nombre) return false
  if (normalizarNombre(e.nombreSnapshot) === normalizarNombre(nombre)) return true
  return nombreCanonico(e.nombreSnapshot) === nombreCanonico(nombre)
}
