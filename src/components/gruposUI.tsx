/**
 * Identidad visual de los grupos musculares: pictograma + color.
 * Colores del tema oscuro validados (contraste ≥3:1 sobre #18181b y
 * separación CVD adyacente ≥8 ΔE); la identidad nunca va solo en el color:
 * siempre acompañada de icono y nombre.
 */
import type { GrupoId } from '../utils/gruposMusculares'

export const ICONO_GRUPO: Record<GrupoId, React.ReactNode> = {
  pecho: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8 L36 8 L40 20 L36 40 L12 40 L8 20 Z" />
      <path d="M10 20 C14 17 20 18 23 23 C23 28 17 31 11 28" />
      <path d="M38 20 C34 17 28 18 25 23 C25 28 31 31 37 28" />
      <line x1="24" y1="23" x2="24" y2="40" strokeOpacity="0.5" />
    </svg>
  ),
  hombro: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22 C8 12 16 8 24 8 C32 8 40 12 42 22" />
      <path d="M6 22 C6 30 10 36 14 40" />
      <path d="M24 8 L24 40" strokeOpacity="0.5" />
      <path d="M6 22 C10 26 18 26 21 20 C18 14 10 14 6 22 Z" fill="currentColor" fillOpacity="0.25" />
      <path d="M42 22 C42 30 38 36 34 40" />
    </svg>
  ),
  brazos: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 30 L14 14 C16 10 22 10 24 14 L28 22" />
      <path d="M28 22 C34 18 42 20 42 28 C42 36 34 40 26 38 L14 34 L6 30" />
      <path d="M16 18 C18 14 26 14 27 20 C27 26 18 28 15 24" fill="currentColor" fillOpacity="0.25" />
    </svg>
  ),
  espalda: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 8 L38 8 L42 18 L30 40 L18 40 L6 18 Z" />
      <line x1="24" y1="8" x2="24" y2="40" strokeOpacity="0.5" />
      <path d="M12 14 C16 20 20 22 24 22 C28 22 32 20 36 14" />
      <path d="M14 26 C18 30 30 30 34 26" strokeOpacity="0.6" />
    </svg>
  ),
  piernas: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6 L22 6 L22 22 L18 42 L12 42 L10 22 Z" />
      <path d="M26 6 L36 6 L38 22 L36 42 L30 42 L26 22 Z" />
      <path d="M13 16 C15 14 19 14 21 16" strokeOpacity="0.6" />
      <path d="M27 16 C29 14 33 14 35 16" strokeOpacity="0.6" />
    </svg>
  ),
  abdomen: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 6 L34 6 L36 24 L32 42 L16 42 L12 24 Z" />
      <line x1="24" y1="10" x2="24" y2="40" strokeOpacity="0.6" />
      <path d="M15 16 L33 16 M14 25 L34 25 M16 34 L32 34" strokeOpacity="0.6" />
    </svg>
  ),
  otros: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="16" />
      <path d="M24 16 L24 26 M24 32 L24 32.5" />
    </svg>
  ),
}

/** Color de cada grupo (orden fijo de asignación = orden de GRUPOS_VISTA). */
export const COLOR_GRUPO: Record<GrupoId, string> = {
  pecho:   '#3987e5',
  hombro:  '#d95926',
  brazos:  '#199e70',
  espalda: '#c98500',
  piernas: '#d55181',
  abdomen: '#008300',
  otros:   '#71717a',
}
