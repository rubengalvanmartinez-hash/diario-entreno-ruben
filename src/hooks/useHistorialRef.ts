import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { historialAReferencia } from '../utils/equivalencias'
import type { Sesion } from '../types/models'

/**
 * Historial con todos los pesos en kg Entrena-T equivalentes.
 * Úsalo para tendencias, récords, último entreno y comparativas.
 * Para EDITAR series del historial usa el historial crudo del store.
 */
export function useHistorialRef(): Sesion[] {
  const historial     = useFitLogStore(useShallow((s) => s.historialSesiones))
  const equivalencias = useFitLogStore(useShallow((s) => s.equivalencias))
  return useMemo(() => historialAReferencia(historial, equivalencias), [historial, equivalencias])
}
