/** Generador de IDs únicos de 12 caracteres compatible con todos los navegadores. */
export function nanoid(): string {
  const t = Date.now().toString(36)          // ~8 chars base36 del timestamp
  const r = Math.random().toString(36).slice(2, 6) // 4 chars aleatorios
  return (t + r).slice(-12).padStart(12, '0')
}
