import { useState, useEffect, useRef } from 'react'
import { cargarDatosUsuario, getUsuarioActivo, RUBEN_UUID } from '../services/supabase'
import { useFitLogStore } from '../store/useFitLogStore'

// ---------------------------------------------------------------------------
// Refresco manual (botón en AjustesPage)
// ---------------------------------------------------------------------------

let _inFlight = false
let _isSyncing = false
const _syncListeners = new Set<(v: boolean) => void>()

function setIsSyncing(v: boolean) {
  _isSyncing = v
  _syncListeners.forEach(fn => fn(v))
}

export function useSyncingStatus(): boolean {
  const [syncing, setSyncing] = useState(_isSyncing)
  useEffect(() => {
    _syncListeners.add(setSyncing)
    return () => { _syncListeners.delete(setSyncing) }
  }, [])
  return syncing
}

export async function refreshFromSupabase(): Promise<void> {
  if (_inFlight) return
  const usuario = getUsuarioActivo()
  if (!usuario) return
  _inFlight = true
  setIsSyncing(true)
  try {
    const idSupabase = usuario.esRuben ? RUBEN_UUID : usuario.id
    const { sesiones, registrosPeso } = await cargarDatosUsuario(idSupabase)
    useFitLogStore.getState().importarHistorial(sesiones, registrosPeso)
  } catch {
    // Sin conexión — caché local intacto
  } finally {
    _inFlight = false
    setIsSyncing(false)
  }
}

// ---------------------------------------------------------------------------
// Flag: pausa el pull mientras el usuario está editando en PanelHistoricoSeries
// ---------------------------------------------------------------------------

let _edicionEnCurso = false

/**
 * Llama con true al entrar en modo edición de una serie, false al salir.
 * Mientras sea true, pullHistorialInvitado NO sobreescribirá el historial.
 */
export function setEdicionEnCurso(v: boolean): void {
  _edicionEnCurso = v
  if (v) console.log('[Sync] Pull pausado — edición en curso')
  else   console.log('[Sync] Pull reanudado — edición finalizada')
}

// ---------------------------------------------------------------------------
// Pull automático para invitados
// ---------------------------------------------------------------------------

const PULL_INTERVAL_MS = 5_000
let _pullInFlight = false

// Estado del último pull — para mostrarlo en la UI
type PullStatus = 'ok' | 'err' | 'idle'
let _pullStatus: PullStatus = 'idle'
const _statusListeners = new Set<(s: PullStatus) => void>()
function setPullStatus(s: PullStatus) {
  _pullStatus = s
  _statusListeners.forEach(fn => fn(s))
}

/** Devuelve el estado del último pull: 'ok', 'err' o 'idle'. */
export function usePullStatus(): PullStatus {
  const [status, setStatus] = useState<PullStatus>(_pullStatus)
  useEffect(() => {
    _statusListeners.add(setStatus)
    return () => { _statusListeners.delete(setStatus) }
  }, [])
  return status
}

export async function pullHistorialInvitado(): Promise<void> {
  if (_pullInFlight) return
  if (_edicionEnCurso) return   // no sobreescribir mientras el usuario edita
  const usuario = getUsuarioActivo()
  if (!usuario) return

  _pullInFlight = true
  try {
    const idSupabase = usuario.esRuben ? RUBEN_UUID : usuario.id
    const { sesiones, registrosPeso } = await cargarDatosUsuario(idSupabase)
    console.log(`[Sync] Pull OK: remoto=${sesiones.length} pesos=${registrosPeso.length}`)
    if (sesiones.length > 0) {
      useFitLogStore.getState().actualizarHistorialRemoto(sesiones)
    }
    if (registrosPeso.length > 0) {
      useFitLogStore.getState().actualizarPesosRemoto(registrosPeso)
    }
    useFitLogStore.getState().setUltimaSync(Date.now())
    setPullStatus('ok')
  } catch (e) {
    console.log('[Sync] Pull error:', e)
    setPullStatus('err')
  } finally {
    _pullInFlight = false
  }
}

// ---------------------------------------------------------------------------
// Countdown reactivo (para mostrar en UI)
// ---------------------------------------------------------------------------

let _countdown = 5
const _countdownListeners = new Set<(v: number) => void>()

function setCountdown(v: number) {
  if (v === _countdown) return // sin cambio → no notificar → sin re-render extra
  _countdown = v
  _countdownListeners.forEach(fn => fn(v))
}

/**
 * Devuelve los segundos que faltan para el próximo pull (5→4→3→2→1→0).
 * Solo cambia una vez por segundo, no a 60fps.
 */
export function useSyncCountdown(): number {
  const [countdown, setCount] = useState(_countdown)
  useEffect(() => {
    _countdownListeners.add(setCount)
    return () => { _countdownListeners.delete(setCount) }
  }, [])
  return countdown
}

// ---------------------------------------------------------------------------
// Hook global — montado en Layout
// ---------------------------------------------------------------------------

/**
 * v1.4.9 — usa requestAnimationFrame en lugar de setInterval para iOS.
 * iOS Safari mata los setInterval cuando la PWA no tiene foco completo,
 * pero requestAnimationFrame sigue corriendo mientras la pantalla está visible.
 *
 * Solo activo para invitados (no Rubén).
 * Triggers de pull:
 *   - rAF loop: cada 5 segundos con Date.now()
 *   - visibilitychange: al volver al primer plano
 *   - online: al recuperar conexión tras estar offline
 */
export function useSupabaseSync(): void {
  const rafRef  = useRef<number>(0)
  const lastRef = useRef<number>(0)

  useEffect(() => {
    const usuario = getUsuarioActivo()
    if (!usuario) return

    // Pull inmediato al montar
    pullHistorialInvitado()
    lastRef.current = Date.now()

    const loop = () => {
      const now     = Date.now()
      const elapsed = now - lastRef.current
      const secsLeft = Math.max(0, Math.ceil((PULL_INTERVAL_MS - elapsed) / 1000))
      setCountdown(secsLeft)

      if (elapsed >= PULL_INTERVAL_MS) {
        lastRef.current = now
        pullHistorialInvitado()
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    // Pull inmediato al recuperar foco (cambiar de app, desbloquear iPhone…)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        lastRef.current = Date.now()
        pullHistorialInvitado()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    // Pull inmediato al recuperar conexión
    const onOnline = () => {
      lastRef.current = Date.now()
      pullHistorialInvitado()
    }
    window.addEventListener('online', onOnline)

    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
