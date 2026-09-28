/**
 * MEAM — Web Worker: ejecuta el motor fuera del hilo principal (auditoría 6, C1). Recibe el historial en kg de referencia,
 * los pesos, los nombres de ejercicio, las correcciones del mapa y la fecha de hoy; devuelve el informe por músculo.
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

self.onmessage = (ev: MessageEvent<MeamWorkerRequest>) => {
  const res = calcularInforme(ev.data)
  ;(self as unknown as { postMessage: (m: MeamWorkerResponse) => void }).postMessage(res)
}
