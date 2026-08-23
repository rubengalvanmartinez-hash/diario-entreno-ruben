/**
 * Sincronización EN VIVO de la sesión activa entre dispositivos
 * (p. ej. el móvil de Rubén y el de su entrenador) vía Supabase Realtime
 * Broadcast (websocket, ~50 ms, sin pasar por la base de datos).
 *
 * Modelo:
 *  - Canal por "dueño" de la sesión: `sesion-activa:<idActivo>` (el UUID de
 *    Supabase con el que se sincronizan los entrenos). Todos los dispositivos
 *    que trabajan sobre ese usuario se unen al mismo canal.
 *  - Ediciones finas (reps, peso, etiqueta, nota, Fede, nº de series, guardar,
 *    saltar) se envían como operaciones individuales al instante y se aplican
 *    campo a campo: cada móvil puede rellenar un campo distinto sin pisarse.
 *  - Cambios de estructura (inicio de sesión, añadir/quitar ejercicio, fecha)
 *    se envían como snapshot de la sesión. Un snapshot no solicitado solo
 *    actualiza la estructura; nunca machaca series que se estén escribiendo.
 *  - Al conectar (o reconectar) se pide el estado (`solicitar`); quien tenga
 *    sesión responde con un snapshot completo y el solicitante lo adopta si es
 *    más reciente que el suyo ("la última actividad gana").
 *  - Al finalizar/cancelar en un móvil, el otro cierra también su sesión
 *    activa (el historial llega por el pull normal de Supabase).
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { supabase, getIdActivo, getUsuarioActivo } from './supabase'
import { useFitLogStore } from '../store/useFitLogStore'
import { pullHistorialInvitado } from '../hooks/useSupabaseSync'
import type { Sesion, SesionEjercicio, Serie, EtiquetaSerie } from '../types/models'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type OpSesion =
  | { t: 'serie';    i: number; s: number; campo: 'reps' | 'pesoKg'; valor: number | '' }
  | { t: 'etiqueta'; i: number; s: number; valor: EtiquetaSerie | null }
  | { t: 'nota';     i: number; valor: string }
  | { t: 'fede';     i: number; valor: boolean }
  | { t: 'series';   i: number; series: Serie[] }
  | { t: 'guardar';  i: number; datos: SesionEjercicio }
  | { t: 'saltar';   i: number }
  | { t: 'snapshot'; sesion: Sesion; completo: boolean }
  | { t: 'fin';      sesionId: string }
  | { t: 'cancelar'; sesionId: string }
  | { t: 'solicitar' }

/**
 * Evento que reciben los componentes suscritos (ops remotas ya aplicadas al store).
 *  - reset:  se adoptó otra sesión → reinicializar inputs desde el store
 *  - fusion: se fusionó un snapshot → rellenar solo los campos locales vacíos desde el store
 */
export type EventoRemoto = OpSesion | { t: 'reset' } | { t: 'fusion' }

interface Sobre {
  op: OpSesion
  origen: string
  sesionId: string | null
  /** Marca de "última modificación" del emisor — para decidir quién es más reciente */
  mod: number
  ts: number
}

export type EstadoRealtime = 'desconectado' | 'conectando' | 'conectado'
export interface DispositivoRemoto { id: string; nombre: string }

// ── Identidad del dispositivo ────────────────────────────────────────────────

function getDeviceId(): string {
  try {
    let id = sessionStorage.getItem('fitlog-device-id')
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      sessionStorage.setItem('fitlog-device-id', id)
    }
    return id
  } catch {
    return 'dev-' + Math.random().toString(36).slice(2, 10)
  }
}
const DEVICE_ID = getDeviceId()

// ── Estado del módulo ─────────────────────────────────────────────────────────

let canal: RealtimeChannel | null = null
let claveCanal: string | null = null
let aplicandoRemoto = false
let esperandoEstadoHasta = 0
let storeUnsub: (() => void) | null = null

let conexiones = 0   // nº de veces que el canal ha llegado a SUBSCRIBED (>1 = reconexión)
let estado: EstadoRealtime = 'desconectado'
let otros: DispositivoRemoto[] = []
const estadoListeners = new Set<() => void>()
const opListeners     = new Set<(e: EventoRemoto) => void>()

function notificarEstado() { estadoListeners.forEach((fn) => fn()) }
function notificarOp(e: EventoRemoto) { opListeners.forEach((fn) => fn(e)) }

// "Última modificación" local: persistida para que sobreviva a recargas
const MOD_KEY = 'fitlog-sesion-mod'
let ultimaMod = Number(localStorage.getItem(MOD_KEY) ?? 0) || 0
function setMod(v: number) {
  ultimaMod = Math.max(ultimaMod, v)
  try { localStorage.setItem(MOD_KEY, String(ultimaMod)) } catch { /* ignorar */ }
}

// ── API pública ───────────────────────────────────────────────────────────────

/** Conecta (o reconecta si cambió el usuario activo) al canal de sesión en vivo. Idempotente. */
export function conectarSesionRealtime(): void {
  const idActivo = getIdActivo()
  if (!idActivo) return
  const clave = `sesion-activa:${idActivo}`
  if (canal && claveCanal === clave) return
  desconectarSesionRealtime()

  claveCanal = clave
  estado = 'conectando'
  notificarEstado()
  registrarVisibilidad()

  const nombre = getUsuarioActivo()?.nombre ?? 'Dispositivo'
  canal = supabase.channel(clave, {
    config: { broadcast: { self: false }, presence: { key: DEVICE_ID } },
  })

  canal
    .on('broadcast', { event: 'op' }, ({ payload }) => aplicarRemoto(payload as Sobre))
    .on('presence', { event: 'sync' }, () => {
      const st = canal?.presenceState<{ nombre: string }>() ?? {}
      otros = Object.entries(st)
        .filter(([key]) => key !== DEVICE_ID)
        .map(([key, metas]) => ({ id: key, nombre: metas[0]?.nombre ?? 'Dispositivo' }))
      notificarEstado()
    })
    .subscribe(async (status) => {
      console.debug("[Realtime] canal", clave, status)
      if (status === "SUBSCRIBED") {
        estado = 'conectado'
        notificarEstado()
        await canal?.track({ nombre, deviceId: DEVICE_ID })
        conexiones++
        // Pedir el estado actual a los demás dispositivos (entrada tardía / reconexión)
        esperandoEstadoHasta = Date.now() + 4000
        enviar({ t: 'solicitar' })
        // Tras una RECONEXIÓN, ofrecer también nuestro estado: las ops hechas sin
        // conexión no llegaron al otro dispositivo; él las fusionará campo a campo
        const local = useFitLogStore.getState().sesionActiva
        if (conexiones > 1 && local) enviar({ t: 'snapshot', sesion: local, completo: true }, local.id)
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        estado = status === 'CLOSED' ? 'desconectado' : 'conectando'
        otros = []
        notificarEstado()
      }
    })

  // Cambios de sesión en el store → snapshot / fin / cancelar (solo si son locales)
  storeUnsub?.()
  storeUnsub = useFitLogStore.subscribe((state, prev) => {
    if (aplicandoRemoto) return
    const a = state.sesionActiva
    const b = prev.sesionActiva
    if (a === b) return
    if (!a && b) {
      const enHistorial = state.historialSesiones.some((s) => s.id === b.id)
      enviar(enHistorial ? { t: 'fin', sesionId: b.id } : { t: 'cancelar', sesionId: b.id }, b.id)
      return
    }
    if (a && (!b || a.id !== b.id || cambioEstructural(a, b))) {
      setMod(Date.now())
      enviar({ t: 'snapshot', sesion: a, completo: false }, a.id)
    }
  })
}

export function desconectarSesionRealtime(): void {
  storeUnsub?.()
  storeUnsub = null
  if (canal) {
    const c = canal
    canal = null
    claveCanal = null
    supabase.removeChannel(c).catch(() => { /* ignorar */ })
  }
  estado = 'desconectado'
  otros = []
  notificarEstado()
}

/**
 * Al volver la app a primer plano (el móvil suele cortar el websocket en
 * segundo plano): si el canal sigue vivo, intercambiar estado; si no, reconectar.
 */
let visibilidadRegistrada = false
function registrarVisibilidad(): void {
  if (visibilidadRegistrada) return
  visibilidadRegistrada = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (canal && estado === 'conectado' && canal.state === 'joined') {
      esperandoEstadoHasta = Date.now() + 4000
      enviar({ t: 'solicitar' })
      const local = useFitLogStore.getState().sesionActiva
      if (local) enviar({ t: 'snapshot', sesion: local, completo: true }, local.id)
    } else {
      const clave = claveCanal
      desconectarSesionRealtime()
      if (clave) conectarSesionRealtime()
    }
  })
  window.addEventListener('online', () => {
    if (estado !== 'conectado') { desconectarSesionRealtime(); conectarSesionRealtime() }
  })
}

/** Envía una operación de edición local a los demás dispositivos (al instante). */
export function emitirOp(op: OpSesion): void {
  setMod(Date.now())
  enviar(op)
}

/** Suscribe a las operaciones remotas ya aplicadas (para refrescar inputs locales). */
export function suscribirOpsRemotas(fn: (e: EventoRemoto) => void): () => void {
  opListeners.add(fn)
  return () => { opListeners.delete(fn) }
}

/** Hook: estado de conexión y dispositivos remotos presentes en el canal. */
export function useEstadoRealtime(): { estado: EstadoRealtime; otros: DispositivoRemoto[] } {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    estadoListeners.add(fn)
    return () => { estadoListeners.delete(fn) }
  }, [])
  return { estado, otros }
}

// ── Internos ──────────────────────────────────────────────────────────────────

function enviar(op: OpSesion, sesionId?: string): void {
  if (!canal || estado !== 'conectado') return
  const sobre: Sobre = {
    op,
    origen: DEVICE_ID,
    sesionId: sesionId ?? useFitLogStore.getState().sesionActiva?.id ?? null,
    mod: ultimaMod,
    ts: Date.now(),
  }
  console.debug('[Realtime] →', op.t, sobre.sesionId?.slice(0, 6))
  canal.send({ type: 'broadcast', event: 'op', payload: sobre }).catch((e) => {
    console.warn('[Realtime] no se pudo enviar op', op.t, e)
  })
}

/** true si cambió algo de estructura (no series/nota/fede, que viajan como ops) */
function cambioEstructural(a: Sesion, b: Sesion): boolean {
  if (a.fecha !== b.fecha || a.dia !== b.dia || a.ejercicios.length !== b.ejercicios.length) return true
  return a.ejercicios.some((ea, i) => {
    const eb = b.ejercicios[i]
    return ea.ejercicioId !== eb.ejercicioId
      || ea.nombreSnapshot !== eb.nombreSnapshot
      || ea.nombreSustituido !== eb.nombreSustituido
      || ea.completado !== eb.completado
      || !!ea.saltado !== !!eb.saltado
  })
}

/**
 * Fusiona un snapshot NO solicitado con la sesión local del mismo id: toma la
 * estructura remota pero conserva series/nota/fede locales de los ejercicios que
 * ya existían (esas ediciones viajan por ops y no deben pisarse).
 */
function fusionarEstructura(local: Sesion, remota: Sesion): Sesion {
  const porId = new Map(local.ejercicios.map((e) => [e.ejercicioId, e]))
  return {
    ...remota,
    ejercicios: remota.ejercicios.map((er) => {
      const el = porId.get(er.ejercicioId)
      if (!el) return er
      // Si el remoto lo ha completado/saltado, sus datos finales mandan
      if (er.completado && !el.completado) return er
      return { ...er, series: el.series, notaSesion: el.notaSesion, ayudaFede: el.ayudaFede }
    }),
  }
}

/**
 * Fusiona un snapshot COMPLETO con la sesión local del mismo id (reconexión):
 * estructura remota; por cada serie, un campo local vacío toma el valor remoto
 * y un campo local con valor se conserva. Un ejercicio completado en cualquiera
 * de los dos lados queda completado con sus datos finales.
 */
function fusionarCampos(local: Sesion, remota: Sesion): Sesion {
  const porId = new Map(local.ejercicios.map((e) => [e.ejercicioId, e]))
  return {
    ...remota,
    ejercicios: remota.ejercicios.map((er) => {
      const el = porId.get(er.ejercicioId)
      if (!el) return er
      if (er.completado && !el.completado) return er
      if (el.completado && !er.completado) return el
      const n = Math.max(el.series.length, er.series.length)
      const series: Serie[] = Array.from({ length: n }, (_, i) => {
        const sl = el.series[i]
        const sr = er.series[i]
        if (!sl) return sr
        if (!sr) return sl
        return {
          numero:   sl.numero,
          reps:     sl.reps   !== '' ? sl.reps   : sr.reps,
          pesoKg:   sl.pesoKg !== '' ? sl.pesoKg : sr.pesoKg,
          ...((sl.etiqueta ?? sr.etiqueta) ? { etiqueta: sl.etiqueta ?? sr.etiqueta } : {}),
        }
      })
      return {
        ...er,
        series,
        notaSesion: el.notaSesion || er.notaSesion,
        ayudaFede:  el.ayudaFede || er.ayudaFede,
      }
    }),
  }
}

function aplicarRemoto(sobre: Sobre): void {
  if (!sobre || sobre.origen === DEVICE_ID) return
  console.debug('[Realtime] ←', sobre.op.t, sobre.sesionId?.slice(0, 6), 'de', sobre.origen.slice(0, 6))
  const st = useFitLogStore.getState()
  const local = st.sesionActiva
  const op = sobre.op

  aplicandoRemoto = true
  try {
    switch (op.t) {
      case 'solicitar': {
        if (local) {
          aplicandoRemoto = false
          enviar({ t: 'snapshot', sesion: local, completo: true }, local.id)
        }
        return
      }
      case 'snapshot': {
        const remota = op.sesion
        const solicitado = op.completo && Date.now() < esperandoEstadoHasta
        if (!local) {
          st.reemplazarSesionActiva(remota)
          setMod(sobre.mod)
          notificarOp({ t: 'reset' })
          return
        }
        if (local.id !== remota.id) {
          if (local.dia === remota.dia && local.fecha === remota.fecha) {
            // La misma rutina iniciada por separado en los dos móviles: fusionar
            // campo a campo y converger a un id común (el menor) en ambos lados
            const id = local.id < remota.id ? local.id : remota.id
            const fusion = { ...fusionarCampos(local, remota), id }
            st.reemplazarSesionActiva(fusion)
            setMod(sobre.mod)
            notificarOp(id === local.id ? { t: 'fusion' } : { t: 'reset' })
            if (id !== local.id) {
              // Nuestro id ha cambiado: ofrecer el estado fusionado para que el otro converja también
              aplicandoRemoto = false
              enviar({ t: 'snapshot', sesion: fusion, completo: true }, fusion.id)
            }
            return
          }
          // Rutinas distintas: solo adoptamos si la pedimos nosotros y la remota es más reciente
          if (solicitado && sobre.mod > ultimaMod) {
            st.reemplazarSesionActiva(remota)
            setMod(sobre.mod)
            notificarOp({ t: 'reset' })
          }
          return
        }
        if (op.completo) {
          // Misma sesión, snapshot completo (respuesta a solicitud o reconexión):
          // fusionar campo a campo sin pisar lo que se haya escrito aquí
          st.reemplazarSesionActiva(fusionarCampos(local, remota))
          setMod(sobre.mod)
          notificarOp({ t: 'fusion' })
          return
        }
        st.reemplazarSesionActiva(fusionarEstructura(local, remota))
        return
      }
      case 'fin': {
        if (local?.id === op.sesionId) {
          st.cancelarSesion()
          notificarOp(op)
          pullHistorialInvitado().catch(() => { /* offline */ })
        }
        return
      }
      case 'cancelar': {
        if (local?.id === op.sesionId) {
          st.cancelarSesion()
          notificarOp(op)
        }
        return
      }
    }

    // Operaciones sobre ejercicios: requieren estar en la misma sesión
    if (!local || sobre.sesionId !== local.id) return
    const ej = local.ejercicios[op.i]
    if (!ej) return

    switch (op.t) {
      case 'serie':
      case 'etiqueta': {
        // Asegurar que existe la serie (por si llega antes que el op de estructura)
        if (!ej.series[op.s]) {
          const series = [...ej.series]
          while (series.length <= op.s) series.push({ numero: series.length + 1, reps: '', pesoKg: '' })
          st.actualizarEjercicioActivo(op.i, { series })
        }
        if (op.t === 'serie') st.actualizarSerie(op.i, op.s, { [op.campo]: op.valor })
        else                  st.actualizarSerie(op.i, op.s, { etiqueta: op.valor ?? undefined })
        break
      }
      case 'nota':   st.actualizarEjercicioActivo(op.i, { notaSesion: op.valor }); break
      case 'fede':   st.actualizarEjercicioActivo(op.i, { ayudaFede: op.valor }); break
      case 'series': st.actualizarEjercicioActivo(op.i, { series: op.series }); break
      case 'guardar': {
        if (st.indiceEjercicioActual === op.i) st.guardarEjercicio(op.i, op.datos)
        else st.actualizarEjercicioActivo(op.i, { ...op.datos, completado: true })
        break
      }
      case 'saltar': {
        if (st.indiceEjercicioActual === op.i) st.saltarEjercicio(op.i)
        else st.actualizarEjercicioActivo(op.i, { completado: true, saltado: true })
        break
      }
    }
    setMod(sobre.mod)
    notificarOp(op)
  } finally {
    aplicandoRemoto = false
  }
}

// Solo en desarrollo: permite simular desconexión/reconexión desde la consola
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sesionRealtime = {
    conectar: conectarSesionRealtime,
    desconectar: desconectarSesionRealtime,
  }
}
