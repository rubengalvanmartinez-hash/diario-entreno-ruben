/**
 * MEAM — Web Worker: ejecuta el motor fuera del hilo principal (auditoría 6, C1).
 * Solo este módulo registra `onmessage`, y solo dentro de un WorkerGlobalScope: la página importa `compute.ts`, no este fichero.
 */
import { calcularInforme, type MeamWorkerRequest, type MeamWorkerResponse } from './compute'

declare const WorkerGlobalScope: (new () => unknown) | undefined

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (ev: MessageEvent<MeamWorkerRequest>) => {
    const res: MeamWorkerResponse = calcularInforme(ev.data)
    ;(self as unknown as { postMessage: (m: MeamWorkerResponse) => void }).postMessage(res)
  }
}
