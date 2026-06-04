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
