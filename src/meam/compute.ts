/**
 * MEAM — punto de entrada puro del cálculo (compartido por la página y el Web Worker). No registra ningún manejador global:
 * el worker (meam.worker.ts) es quien hace `self.onmessage`, y la página importa este módulo, nunca el del worker (auditoría 6).
 */
import { ejecutarMeam, type InformeMeam } from './run'
import { construirMapaVariantes, type VariantOverride } from './variants'
import type { SesionConTipo } from './exposure'
import type { RegistroPeso } from '../types/models'

export interface MeamWorkerRequest {
  id: number
  sesiones: SesionConTipo[]
  pesos: RegistroPeso[]
  nombres: string[]
  overrides: VariantOverride[]
  asistencia: string[]
  hoy?: string
}

export interface MeamWorkerResponse { id: number; informe: InformeMeam | null; error?: string; ms: number }

export function calcularInforme(req: MeamWorkerRequest): MeamWorkerResponse {
  const t0 = Date.now()
  try {
    const mapa = construirMapaVariantes(req.nombres, req.overrides, new Set(req.asistencia))
    const informe = ejecutarMeam(req.sesiones, mapa, req.pesos, { hoy: req.hoy })
    return { id: req.id, informe, ms: Date.now() - t0 }
  } catch (e) {
    return { id: req.id, informe: null, error: String(e), ms: Date.now() - t0 }
  }
}
