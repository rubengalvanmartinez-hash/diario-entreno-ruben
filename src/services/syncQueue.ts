import type { Sesion, SesionEjercicio } from '../types/models'
import { sincronizarEjercicioSupabase } from './supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncStatus = 'syncing' | 'synced' | 'error' | 'offline'

type SesionInfo = Pick<Sesion, 'id' | 'fecha' | 'dia' | 'gimnasio'>

interface EjercicioOp {
  id: string
  type: 'ejercicio'
  usuarioId: string
  sesion: SesionInfo
  ejercicio: SesionEjercicio
  retries: number
}

type QueueOp = EjercicioOp

// ---------------------------------------------------------------------------
// Persistencia en localStorage
// ---------------------------------------------------------------------------

const QUEUE_KEY     = 'fitlog-sync-queue'
const MAX_RETRIES   = 3
const RETRY_INTERVAL_MS = 30_000

function loadQueue(): QueueOp[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueueOp[] }
  catch { return [] }
}

function saveQueue(q: QueueOp[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

// ---------------------------------------------------------------------------
// Estado y suscriptores
// ---------------------------------------------------------------------------

type StatusListener = (s: SyncStatus) => void
const listeners = new Set<StatusListener>()
let _status: SyncStatus = loadQueue().length > 0 ? 'error' : 'synced'

function setStatus(s: SyncStatus): void {
  if (_status === s) return
  _status = s
  listeners.forEach(l => l(s))
}

/** Suscríbete a cambios de estado. Devuelve la función de baja. */
export function subscribeSyncStatus(fn: StatusListener): () => void {
  listeners.add(fn)
  fn(_status)           // notifica el estado actual inmediatamente
  return () => { listeners.delete(fn) }
}

// ---------------------------------------------------------------------------
// Procesado de la cola
// ---------------------------------------------------------------------------

let flushing = false

async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true

  if (!navigator.onLine) {
    setStatus('offline')
    flushing = false
    return
  }

  const queue = loadQueue()
  if (queue.length === 0) {
    setStatus('synced')
    flushing = false
    return
  }

  setStatus('syncing')
  const remaining: QueueOp[] = []

  for (const op of queue) {
    try {
      if (op.type === 'ejercicio') {
        await sincronizarEjercicioSupabase(op.usuarioId, op.sesion, op.ejercicio)
      }
    } catch {
      if (op.retries + 1 < MAX_RETRIES) {
        remaining.push({ ...op, retries: op.retries + 1 })
      }
      // Si agota reintentos, se descarta (el dato ya está en local)
    }
  }

  saveQueue(remaining)
  setStatus(remaining.length === 0 ? 'synced' : 'error')
  flushing = false
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Encola la sincronización de un ejercicio.
 * Si ya existía una op para este ejercicio en esta sesión, la sustituye (idempotente).
 */
export function enqueueEjercicio(
  usuarioId: string,
  sesion: SesionInfo,
  ejercicio: SesionEjercicio,
): void {
  const opId = `${sesion.id}-${ejercicio.ejercicioId}`
  const queue = loadQueue().filter(o => o.id !== opId)
  queue.push({ id: opId, type: 'ejercicio', usuarioId, sesion, ejercicio, retries: 0 })
  saveQueue(queue)
  setStatus('syncing')
  flushQueue()
}

// ---------------------------------------------------------------------------
// Bootstrap: reintento periódico + eventos de red
// ---------------------------------------------------------------------------

setInterval(flushQueue, RETRY_INTERVAL_MS)

window.addEventListener('online',  () => flushQueue())
window.addEventListener('offline', () => setStatus('offline'))

// Intentar vaciar la cola de sesiones anteriores al cargar
if (loadQueue().length > 0) flushQueue()
