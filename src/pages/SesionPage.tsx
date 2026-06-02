import { useEffect, useState, useRef, useMemo, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, List, Plus, Minus, Check, Clock, ArrowUp, ArrowDown, Lock, X, AlertCircle } from 'lucide-react'
import type { EtiquetaSerie, Sesion } from '../types/models'
import { obtenerImagen } from '../services/imageDB'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore, selectProgresoTotal, selectProgresoCompletados } from '../store/useFitLogStore'
import type { DiaId, SesionEjercicio, Serie } from '../types/models'
import { getUsuarioActivo, sincronizarEntrenoSupabase, getRubenUUID, getPerfilVisto, getIdActivo } from '../services/supabase'
import { pullHistorialInvitado } from '../hooks/useSupabaseSync'
import { sincronizarSesion } from '../services/googleSheets'
import { enqueueEjercicio, subscribeSyncStatus, type SyncStatus } from '../services/syncQueue'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Lanza 15-20 emojis 💪 desde el centro-inferior de la pantalla en todas direcciones */
function lanzarEmojis() {
  const count  = Math.floor(Math.random() * 6) + 15
  const startX = window.innerWidth  / 2
  const startY = window.innerHeight - 80

  for (let k = 0; k < count; k++) {
    const el    = document.createElement('div')
    el.textContent = '💪'
    const size  = Math.floor(Math.random() * 25) + 24  // 24-48 px
    const speed = Math.random() * 280 + 150             // 150-430 px
    const angle = Math.random() * 2 * Math.PI
    const vx    = Math.cos(angle) * speed
    const vy    = Math.sin(angle) * speed

    el.style.cssText = [
      'position:fixed',
      `left:${startX}px`,
      `top:${startY}px`,
      `font-size:${size}px`,
      'pointer-events:none',
      'z-index:9999',
      'user-select:none',
      'line-height:1',
    ].join(';')

    document.body.appendChild(el)

    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(0.5)',                              opacity: 1 },
        { transform: `translate(${vx * 0.6}px,${vy * 0.6}px) scale(1.5)`,    opacity: 1 },
        { transform: `translate(${vx}px,${vy}px) scale(0.8)`,                 opacity: 0 },
      ],
      { duration: 1200, easing: 'ease-out' },
    )
    anim.onfinish = () => el.remove()
  }
}

/** Lanza emojis 🎯💪 cuando se supera un objetivo de peso */
function lanzarObjetivoCelebration() {
  const emojis = ['🎯', '💪', '🎯', '💪', '🎯']
  const count  = 22
  const startX = window.innerWidth  / 2
  const startY = window.innerHeight - 80

  for (let k = 0; k < count; k++) {
    const el   = document.createElement('div')
    el.textContent = emojis[k % emojis.length]
    const size  = Math.floor(Math.random() * 28) + 22
    const speed = Math.random() * 300 + 160
    const angle = Math.random() * 2 * Math.PI
    const vx    = Math.cos(angle) * speed
    const vy    = Math.sin(angle) * speed

    el.style.cssText = [
      'position:fixed',
      `left:${startX}px`,
      `top:${startY}px`,
      `font-size:${size}px`,
      'pointer-events:none',
      'z-index:9999',
      'user-select:none',
      'line-height:1',
    ].join(';')

    document.body.appendChild(el)

    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(0.5)',                              opacity: 1 },
        { transform: `translate(${vx * 0.6}px,${vy * 0.6}px) scale(1.5)`,    opacity: 1 },
        { transform: `translate(${vx}px,${vy}px) scale(0.8)`,                 opacity: 0 },
      ],
      { duration: 1400, easing: 'ease-out' },
    )
    anim.onfinish = () => el.remove()
  }
}

/** Helper para colorear campo de peso según máximo histórico (S1) o serie anterior (S2+) */
type PesoColor = 'superado' | 'bajo' | 'neutro'
function getPesoColor(
  i: number,
  pesosRaw: string[],
  ultimoEntreno: { series: { pesoKg: number | string }[] } | null,
): PesoColor {
  const rawStr = pesosRaw[i] ?? ''
  if (rawStr.trim() === '') return 'neutro'
  const num = parseFloat(rawStr.replace(',', '.'))
  if (isNaN(num) || num <= 0) return 'neutro'

  if (i === 0) {
    // Serie 1: comparar vs máximo peso del último entreno histórico
    if (!ultimoEntreno) return 'neutro'
    const vals = ultimoEntreno.series
      .map((s) => parseFloat(String(s.pesoKg).replace(',', '.')))
      .filter((v) => v > 0 && isFinite(v))
    if (vals.length === 0) return 'neutro'
    const maxPrevio = Math.max(...vals)
    if (num > maxPrevio) return 'superado'
    if (num < maxPrevio) return 'bajo'
    return 'neutro'
  }

  // Series 2+: comparar vs serie anterior. Si la anterior está vacía → neutro (cascada)
  const prevRaw = pesosRaw[i - 1] ?? ''
  if (prevRaw.trim() === '') return 'neutro'
  const prevNum = parseFloat(prevRaw.replace(',', '.'))
  if (isNaN(prevNum) || prevNum <= 0) return 'neutro'
  if (num > prevNum) return 'superado'
  if (num < prevNum) return 'bajo'
  return 'neutro'
}

function formatFechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

type SessionDia = DiaId | 'parcial' | 'extra'

function parseDiaParam(raw: string | undefined): SessionDia | null {
  if (raw === 'parcial') return 'parcial'
  if (raw === 'extra')   return 'extra'
  const n = Number(raw)
  return n === 1 || n === 2 || n === 3 ? (n as DiaId) : null
}

const DIA_NOMBRE: Record<string, string> = {
  '1': 'Día 1', '2': 'Día 2', '3': 'Día 3',
  'parcial': 'Parcial', 'extra': 'Ejercicio extra',
}

// ── SyncDot — indicador de estado de sincronización ──────────────────────────

function SyncDot({ status }: { status: SyncStatus }) {
  if (status === 'syncing') {
    return (
      <span title="Sincronizando..." className="flex items-center justify-center size-9 shrink-0">
        <span className="size-2 rounded-full bg-green-400 animate-pulse" />
      </span>
    )
  }
  if (status === 'synced') {
    return (
      <span title="Guardado en la nube ✓" className="flex items-center justify-center size-9 shrink-0">
        <span className="size-2 rounded-full bg-green-500" />
      </span>
    )
  }
  // error | offline
  return (
    <span title="Sin conexión, guardado localmente" className="flex items-center justify-center size-9 shrink-0">
      <span className="size-2 rounded-full bg-red-500" />
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SesionPage() {
  const { dia: diaParam }  = useParams()
  const navigate           = useNavigate()
  const dia                = parseDiaParam(diaParam)

  const iniciarSesion      = useFitLogStore((s) => s.iniciarSesion)
  const sesionActiva       = useFitLogStore(useShallow((s) => s.sesionActiva))
  const indice             = useFitLogStore((s) => s.indiceEjercicioActual)
  const irAEjercicio       = useFitLogStore((s) => s.irAEjercicio)
  const guardarEjercicio   = useFitLogStore((s) => s.guardarEjercicio)
  const saltarEjercicio    = useFitLogStore((s) => s.saltarEjercicio)
  const completarSesion    = useFitLogStore((s) => s.completarSesion)
  const cancelarSesion     = useFitLogStore((s) => s.cancelarSesion)
  const progresoTotal      = useFitLogStore(selectProgresoTotal)
  const progresoCompletados = useFitLogStore(selectProgresoCompletados)

  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const [showLista,           setShowLista]           = useState(false)
  const [showCompletado,      setShowCompletado]      = useState(false)
  const [sesionCapturada,     setSesionCapturada]     = useState<Sesion | null>(null)
  const [showCancelar,        setShowCancelar]        = useState(false)
  const [hayObjetivoSuperado, setHayObjetivoSuperado] = useState(false)
  const [syncStatus,          setSyncStatus]          = useState<SyncStatus>('synced')

  useEffect(() => {
    return subscribeSyncStatus(setSyncStatus)
  }, [])

  useEffect(() => {
    if (!dia) return
    if (dia === 'parcial' || dia === 'extra') {
      if (!sesionActiva || sesionActiva.dia !== dia) {
        navigate('/rutina', { replace: true })
      }
      return
    }
    if (!sesionActiva || sesionActiva.dia !== dia) {
      iniciarSesion(dia)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia])

  if (!dia) return <ErrorPage mensaje="Día inválido" />
  if (!sesionActiva) return <LoadingPage />

  const ejercicioActual = sesionActiva.ejercicios[indice] ?? null

  const capturarYMostrarResumen = () => {
    const state = useFitLogStore.getState()
    const sesionActualizada = state.sesionActiva
    if (sesionActualizada) {
      setSesionCapturada(sesionActualizada)
      // Detectar si algún ejercicio superó su objetivo de peso
      const superado = sesionActualizada.ejercicios.some((ej) => {
        if (!ej.completado || ej.saltado) return false
        const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
        const obj = state.objetivosPesoEntreno[nombre]
        if (!obj) return false
        const vals = ej.series.map((s) => Number(s.pesoKg)).filter((v) => v > 0 && isFinite(v))
        return vals.length > 0 && Math.max(...vals) >= obj
      })
      setHayObjetivoSuperado(superado)
    }
    setShowCompletado(true)
  }

  const handleGuardar = (datos: SesionEjercicio) => {
    guardarEjercicio(indice, datos)
    // Debug: verificar que el store se actualiza correctamente
    const storeState = useFitLogStore.getState()
    console.log('[handleGuardar] Store actualizado:', {
      ejercicioGuardado: datos.nombreSnapshot,
      series: datos.series.length,
      sesionId: storeState.sesionActiva?.id,
      ejerciciosCompletados: storeState.sesionActiva?.ejercicios.filter(e => e.completado).length,
    })
    const usuario = getUsuarioActivo()
    if (usuario && sesionActiva) {
      const uid = getIdActivo() ?? ''
      if (uid) enqueueEjercicio(uid, sesionActiva, datos)
    }
    const quedan = sesionActiva.ejercicios.filter((e, i) => i !== indice && !e.completado)
    if (quedan.length === 0) capturarYMostrarResumen()
  }

  const handleSaltar = () => {
    saltarEjercicio(indice)
    const quedan = sesionActiva.ejercicios.filter((e, i) => i !== indice && !e.completado)
    if (quedan.length === 0) capturarYMostrarResumen()
  }

  const handleFinalizar = () => {
    completarSesion()
    navigate('/', { replace: true })

    const usuario = getUsuarioActivo()
    if (!usuario || !sesionCapturada) return
    const sesionId = sesionCapturada.id

    // Optimistic: marcar como sincronizado antes de confirmar con Supabase
    useFitLogStore.getState().marcarSesionSincronizada(sesionId)

    // Sync en background — revertir si falla
    const doSync = async () => {
      const uid = getIdActivo()
      const perfilVisto = getPerfilVisto()
      try {
        if (usuario.esRuben && !perfilVisto) {
          const rubenUUID = getRubenUUID()
          const { googleConfig, isAuthenticated } = useFitLogStore.getState()
          const sheetsPromise =
            isAuthenticated && googleConfig.spreadsheetId
              ? sincronizarSesion(googleConfig.accessToken, googleConfig.spreadsheetId, sesionCapturada)
              : Promise.resolve()
          const results = await Promise.allSettled([
            sincronizarEntrenoSupabase(rubenUUID, sesionCapturada),
            sheetsPromise,
          ])
          if (results[0].status === 'rejected') {
            useFitLogStore.getState().desmarcarSesionSincronizada(sesionId)
          }
        } else {
          // Invitado o admin viendo perfil: sync a Supabase con el ID activo
          const syncId = uid ?? usuario.id
          await sincronizarEntrenoSupabase(syncId, sesionCapturada)
          // Pull solo si es invitado propio (no admin viendo perfil ajeno)
          if (!perfilVisto) await pullHistorialInvitado()
        }
      } catch {
        useFitLogStore.getState().desmarcarSesionSincronizada(sesionId)
      }
    }
    doSync()
  }

  const handleCancelarConfirmado = () => {
    cancelarSesion()
    navigate('/rutina', { replace: true })
  }

  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)]">

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCancelar(true)}
            className="size-9 flex items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="flex-1">
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
              {DIA_NOMBRE[String(dia)]}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: progresoTotal > 0
                      ? `${(progresoCompletados / progresoTotal) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <span className="text-xs font-bold text-zinc-400 tabular-nums shrink-0">
                {progresoCompletados}/{progresoTotal}
              </span>
            </div>
          </div>

          <SyncDot status={syncStatus} />

          <button
            onClick={() => setShowLista(true)}
            className="size-9 flex items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800"
            aria-label="Lista de ejercicios"
          >
            <List size={20} />
          </button>
        </div>
      </header>

      {/* ── Ejercicio actual ── */}
      <div className="flex-1 overflow-y-auto">
        {ejercicioActual ? (
          <EjercicioCard
            key={`${sesionActiva.id}-${indice}`}
            ejercicio={ejercicioActual}
            indice={indice}
            onGuardar={handleGuardar}
            onSaltar={handleSaltar}
          />
        ) : (
          <div className="p-6 text-zinc-500 text-center">No hay ejercicio seleccionado</div>
        )}
      </div>

      {/* ── Drawer: lista de ejercicios ── */}
      {showLista && (
        <ListaEjerciciosDrawer
          ejercicios={sesionActiva.ejercicios}
          indiceActual={indice}
          onSeleccionar={(i) => { irAEjercicio(i); setShowLista(false) }}
          onCerrar={() => setShowLista(false)}
        />
      )}

      {/* ── Resumen de sesión (pantalla completa) ── */}
      {showCompletado && sesionCapturada && (
        <ResumenSesion
          sesion={sesionCapturada}
          historialPrevio={historialSesiones}
          diaNombre={DIA_NOMBRE[String(dia)] ?? 'Sesión'}
          hayObjetivoSuperado={hayObjetivoSuperado}
          onFinalizar={handleFinalizar}
          onSeguir={() => setShowCompletado(false)}
        />
      )}

      {/* ── Modal: cancelar sesión ── */}
      {showCancelar && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full border border-zinc-700 shadow-xl">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-white font-bold text-lg leading-tight">¿Cancelar sesión?</h3>
              <button
                onClick={() => setShowCancelar(false)}
                className="size-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 shrink-0 ml-3"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-zinc-400 text-sm mb-6">
              Los datos de esta sesión no se guardarán.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowCancelar(false)}
                className="w-full rounded-2xl bg-zinc-800 py-3 font-bold text-zinc-300 active:bg-zinc-700"
              >
                Volver
              </button>
              <button
                onClick={handleCancelarConfirmado}
                className="w-full rounded-2xl bg-red-700 py-3 font-bold text-white active:bg-red-800"
              >
                Cancelar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── EjercicioCard ─────────────────────────────────────────────────────────────

function EjercicioCard({
  ejercicio,
  indice,
  onGuardar,
  onSaltar,
}: {
  ejercicio: SesionEjercicio
  indice: number
  onGuardar: (datos: SesionEjercicio) => void
  onSaltar: () => void
}) {
  const nombre = ejercicio.nombreSustituido ?? ejercicio.nombreSnapshot

  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))

  // Nota fija del ejercicio (de la configuración)
  const notasFijas = useFitLogStore(
    (s) => s.ejercicios.find((e) => e.id === ejercicio.ejercicioId)?.notasFijas ?? '',
  )

  // Último y penúltimo registro de este ejercicio (para comparación histórica)
  const { ultimoEntreno, penultimoEntreno } = useMemo(() => {
    const ordenado = [...historialSesiones].sort((a, b) => b.fecha.localeCompare(a.fecha))
    const encontrados: { fecha: string; series: Serie[]; ayudaFede: boolean }[] = []
    for (const sesion of ordenado) {
      const ej = sesion.ejercicios.find(
        (e) =>
          e.ejercicioId === ejercicio.ejercicioId ||
          e.nombreSnapshot === ejercicio.nombreSnapshot,
      )
      if (ej?.completado && !ej.saltado) {
        encontrados.push({ fecha: sesion.fecha, series: ej.series, ayudaFede: ej.ayudaFede ?? false })
        if (encontrados.length === 2) break
      }
    }
    return { ultimoEntreno: encontrados[0] ?? null, penultimoEntreno: encontrados[1] ?? null }
  }, [historialSesiones, ejercicio.ejercicioId, ejercicio.nombreSnapshot])

  const [series,   setSeries]   = useState<Serie[]>(() => ejercicio.series.map((s) => ({ ...s })))
  const [pesosRaw, setPesosRaw] = useState<string[]>(() =>
    ejercicio.series.map((s) => (s.pesoKg === '' ? '' : String(s.pesoKg))),
  )
  const [nota,         setNota]         = useState(ejercicio.notaSesion)
  const [ayudaFede,    setAyudaFede]    = useState(ejercicio.ayudaFede ?? false)
  const [imagen,       setImagen]       = useState<string | null>(null)
  const [showRirModal, setShowRirModal] = useState(false)
  const [showVaciosModal, setShowVaciosModal] = useState(false)
  const [vaciosInfo,   setVaciosInfo]   = useState('')

  const actualizarEjercicioActivo = useFitLogStore((s) => s.actualizarEjercicioActivo)

  // Objetivo próximo entreno: estado local (se resetea al cambiar ejercicio por el key)
  const [objetivoDir, setObjetivoDir] = useState<'subir' | 'bajar' | null>(null)
  const [objetivoPesoLocal, setObjetivoPesoLocal] = useState<number | null>(null)

  const fedeRef = useRef<HTMLButtonElement>(null)

  const prevId = useRef(ejercicio.ejercicioId)
  useEffect(() => {
    if (prevId.current !== ejercicio.ejercicioId) {
      setSeries(ejercicio.series.map((s) => ({ ...s })))
      setPesosRaw(ejercicio.series.map((s) => (s.pesoKg === '' ? '' : String(s.pesoKg))))
      setNota(ejercicio.notaSesion)
      setAyudaFede(ejercicio.ayudaFede ?? false)
      prevId.current = ejercicio.ejercicioId
    }
  }, [ejercicio])

  const handleCheckFede = (checked: boolean) => {
    setAyudaFede(checked)
    if (checked) {
      fedeRef.current?.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.3)' },
          { transform: 'scale(1)' },
        ],
        { duration: 300, easing: 'ease-out' },
      )
      lanzarEmojis()
    }
  }

  useEffect(() => {
    let cancelled = false
    obtenerImagen(ejercicio.ejercicioId).then((b64) => {
      if (!cancelled) setImagen(b64)
    })
    return () => { cancelled = true }
  }, [ejercicio.ejercicioId])

  const updateReps = (i: number, raw: string) => {
    const val = raw === '' ? '' : Number(raw)
    setSeries((prev) => prev.map((s, idx) => idx === i ? { ...s, reps: val } : s))
  }

  const updatePeso = (i: number, raw: string) => {
    const normalized = raw.replace(',', '.')
    setPesosRaw((prev) => prev.map((p, idx) => idx === i ? normalized : p))
    const num = parseFloat(normalized)
    if (normalized === '') {
      setSeries((prev) => prev.map((s, idx) => idx === i ? { ...s, pesoKg: '' } : s))
    } else if (!isNaN(num)) {
      setSeries((prev) => prev.map((s, idx) => idx === i ? { ...s, pesoKg: num } : s))
    }
  }

  const autoRellenarPeso = () => {
    const raw = pesosRaw[0] ?? ''
    if (!raw) return
    const num = parseFloat(raw.replace(',', '.'))
    if (isNaN(num)) return
    setPesosRaw((prev) => prev.map((p, idx) => idx === 0 ? p : (p === '' ? raw : p)))
    setSeries((prev) => prev.map((s, idx) => idx === 0 ? s : (s.pesoKg === '' ? { ...s, pesoKg: num } : s)))
  }

  const toggleEtiqueta = (i: number, etiqueta: EtiquetaSerie) => {
    setSeries((prev) =>
      prev.map((s, idx) =>
        idx === i ? { ...s, etiqueta: s.etiqueta === etiqueta ? undefined : etiqueta } : s,
      ),
    )
  }

  const addSerie = () => {
    setSeries((prev) => [...prev, { numero: prev.length + 1, reps: '', pesoKg: '' }])
    setPesosRaw((prev) => [...prev, ''])
  }

  const removeSerie = () => {
    setSeries((prev) => prev.length > 1 ? prev.slice(0, -1) : prev)
    setPesosRaw((prev) => prev.length > 1 ? prev.slice(0, -1) : prev)
  }

  const buildFinalSeries = (): Serie[] =>
    series.map((s, i) => {
      const raw = pesosRaw[i] ?? ''
      const num = parseFloat(raw.replace(',', '.'))
      return { ...s, pesoKg: raw === '' ? '' : (isNaN(num) ? s.pesoKg : num) }
    })

  useEffect(() => {
    const timer = setTimeout(() => {
      actualizarEjercicioActivo(indice, {
        series: buildFinalSeries(),
        notaSesion: nota,
        ayudaFede,
      })
    }, 500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, pesosRaw, nota, ayudaFede])

  const doGuardar = () => {
    onGuardar({ ...ejercicio, series: buildFinalSeries(), notaSesion: nota, ayudaFede })
  }

  const doGuardarConRir = () => {
    const hayAlgunaConEtiqueta = series.some((s) => s.etiqueta)
    if (!hayAlgunaConEtiqueta) {
      setShowRirModal(true)
      return
    }
    doGuardar()
  }

  const handleGuardar = () => {
    // 1. Comprobar campos vacíos
    const vacias = series.filter((s) => s.reps === '' || s.pesoKg === '')
    if (vacias.length > 0) {
      setVaciosInfo(vacias.map((s) => `Serie ${s.numero}`).join(', '))
      setShowVaciosModal(true)
      return
    }
    // 2. Comprobar etiquetas RIR/Fallo
    doGuardarConRir()
  }

  return (
    <div className="flex flex-col gap-6 pb-6">

      {/* Imagen del ejercicio */}
      {imagen && (
        <img src={imagen} alt={nombre} className="w-full max-h-52 object-cover rounded-b-3xl" />
      )}

      {/* Nombre */}
      <div className="px-5">
        {ejercicio.nombreSustituido && (
          <p className="text-xs text-orange-400 mb-1">Sustituye: {ejercicio.nombreSnapshot}</p>
        )}
        <h2 className="text-2xl font-black text-white uppercase tracking-tight leading-tight">
          {nombre}
        </h2>
        {ejercicio.completado && (
          <span className="inline-flex items-center gap-1 text-xs text-green-400 mt-1">
            <Check size={12} /> Completado
          </span>
        )}
      </div>

      {/* Último entrenamiento */}
      <UltimoEntrenoCard
        ultimoEntreno={ultimoEntreno}
        penultimoEntreno={penultimoEntreno}
        seriesActuales={series}
        objetivo={objetivoDir}
        objetivoPeso={objetivoPesoLocal}
      />

      {/* Objetivo próximo entreno */}
      <ObjetivoProximoEntreno
        objetivo={objetivoDir}
        setObjetivo={setObjetivoDir}
        objetivoPeso={objetivoPesoLocal}
        setObjetivoPeso={setObjetivoPesoLocal}
      />

      {/* Tabla de series */}
      <div className="mx-5 rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        {/* Cabecera */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-px bg-zinc-800">
          <div className="bg-zinc-900 py-2 text-center text-xs font-semibold text-zinc-500">#</div>
          <div className="bg-zinc-900 py-2 text-center text-xs font-semibold text-zinc-500">Reps</div>
          <div className="bg-zinc-900 py-2 text-center text-xs font-semibold text-zinc-500">Kg</div>
        </div>

        {/* Filas */}
        {series.map((serie, i) => {
          const pesoColor = getPesoColor(i, pesosRaw, ultimoEntreno)
          const pesoBgStyle: React.CSSProperties =
            pesoColor === 'superado'
              ? { background: 'linear-gradient(135deg, rgba(6,78,59,0.55) 0%, rgba(39,39,42,0.9) 100%)' }
              : pesoColor === 'bajo'
              ? { background: 'linear-gradient(135deg, rgba(127,29,29,0.38) 0%, rgba(39,39,42,0.9) 100%)' }
              : {}

          return (
          <div key={i} className="border-t border-zinc-800">
            <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-px bg-zinc-800">
              <div className="bg-zinc-900 flex items-center justify-center text-sm font-bold text-zinc-500">
                {serie.numero}
              </div>
              <div className="bg-zinc-900 p-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={serie.reps === '' ? '' : String(serie.reps)}
                  onChange={(e) => updateReps(i, e.target.value)}
                  placeholder="—"
                  className="w-full bg-zinc-800 rounded-xl py-3 text-center text-lg font-bold text-white placeholder-zinc-600
                             focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="bg-zinc-900 p-1 relative">
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={pesosRaw[i] ?? ''}
                  onChange={(e) => updatePeso(i, e.target.value)}
                  onBlur={i === 0 ? autoRellenarPeso : undefined}
                  placeholder="—"
                  style={pesoBgStyle}
                  className={[
                    'w-full rounded-xl py-3 text-center text-lg font-bold text-white placeholder-zinc-600 focus:outline-none focus:ring-2',
                    pesoColor === 'superado'
                      ? 'border border-emerald-600/60 focus:ring-emerald-500'
                      : pesoColor === 'bajo'
                      ? 'border border-red-800/60 focus:ring-red-600'
                      : 'bg-zinc-800 focus:ring-blue-500',
                  ].join(' ')}
                />
                {pesoColor === 'superado' && (
                  <span className="absolute top-2 right-2 text-[10px] font-black text-emerald-400 leading-none pointer-events-none">
                    ✓
                  </span>
                )}
                {pesoColor === 'bajo' && (
                  <span className="absolute top-2 right-2 text-[10px] font-black text-red-400 leading-none pointer-events-none">
                    ✗
                  </span>
                )}
              </div>
            </div>
            {/* Pastillas de esfuerzo */}
            <div className="bg-zinc-900 flex gap-2 px-3 pb-2 pt-1">
              {(['fallo', 'rir0', 'rir1'] as EtiquetaSerie[]).map((etq) => (
                <PillEtiqueta
                  key={etq}
                  etiqueta={etq}
                  activa={serie.etiqueta === etq}
                  onToggle={() => toggleEtiqueta(i, etq)}
                />
              ))}
            </div>
          </div>
          )
        })}

        {/* Controles + / − */}
        <div className="bg-zinc-900 border-t border-zinc-800 flex items-center justify-center gap-6 py-3">
          <button
            onClick={removeSerie}
            disabled={series.length <= 1}
            className="size-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400
                       disabled:opacity-30 active:bg-zinc-700"
          >
            <Minus size={16} />
          </button>
          <span className="text-sm text-zinc-400 font-medium tabular-nums w-20 text-center">
            {series.length} {series.length === 1 ? 'serie' : 'series'}
          </span>
          <button
            onClick={addSerie}
            className="size-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 active:bg-zinc-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Nota fija (solo si existe) */}
      {notasFijas && (
        <div className="px-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={11} className="text-amber-500" />
            <label className="text-xs font-semibold text-amber-500 uppercase tracking-wider">
              Nota fija
            </label>
          </div>
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl px-4 py-3 text-sm text-amber-200/80">
            {notasFijas}
          </div>
        </div>
      )}

      {/* Nota de sesión */}
      <div className="px-5">
        <label className="block text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">
          Nota de sesión
        </label>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cómo fue el ejercicio, sensaciones, marca personal…"
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white
                     placeholder-zinc-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Checkbox Fede */}
      <div className="px-5">
        <button
          ref={fedeRef}
          onClick={() => handleCheckFede(!ayudaFede)}
          className={[
            'w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-200',
            ayudaFede
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-zinc-900 border-zinc-800 active:bg-zinc-800',
          ].join(' ')}
        >
          <div className={[
            'size-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-200',
            ayudaFede ? 'bg-green-500 border-green-500' : 'border-zinc-600',
          ].join(' ')}>
            {ayudaFede && <Check size={13} className="text-white" strokeWidth={3} />}
          </div>
          <span className={[
            'text-sm font-medium transition-colors duration-200 leading-snug',
            ayudaFede ? 'text-green-400' : 'text-zinc-300',
          ].join(' ')}>
            💪 ¿Te ha ayudado Fede en acabar el ejercicio?
          </span>
        </button>
      </div>

      {/* Botón guardar + saltar */}
      <div className="px-5 flex flex-col gap-2">
        <button
          onClick={handleGuardar}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4
                     text-base font-bold text-white active:bg-blue-700 transition-colors"
        >
          <Check size={20} strokeWidth={2.5} />
          Guardar y siguiente
        </button>
        <button
          onClick={onSaltar}
          className="w-full py-3 rounded-2xl text-sm font-semibold text-zinc-500 active:bg-zinc-800 transition-colors"
        >
          Saltar ejercicio
        </button>
      </div>

      {/* Modal: campos vacíos */}
      {showVaciosModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full border border-zinc-700 shadow-xl">
            <h3 className="text-white font-bold text-lg mb-2">Faltan datos</h3>
            <p className="text-zinc-400 text-sm mb-1">
              {vaciosInfo} {vaciosInfo.includes(',') ? 'tienen' : 'tiene'} reps o peso sin rellenar.
            </p>
            <p className="text-zinc-500 text-sm mb-6">¿Continuar de todas formas?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowVaciosModal(false)}
                className="w-full rounded-2xl bg-zinc-800 py-3 font-bold text-zinc-300 active:bg-zinc-700"
              >
                Volver
              </button>
              <button
                onClick={() => { setShowVaciosModal(false); doGuardarConRir() }}
                className="w-full rounded-2xl bg-blue-600 py-3 font-bold text-white active:bg-blue-700"
              >
                Continuar sin completar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: recordatorio RIR/Fallo */}
      {showRirModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full border border-zinc-700 shadow-xl">
            <h3 className="text-white font-bold text-lg mb-2">¿Has olvidado el esfuerzo?</h3>
            <p className="text-zinc-400 text-sm mb-6">
              Alguna serie no tiene etiqueta (Fallo, RIR 0 o RIR 1). ¿Quieres volver a marcarlas?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowRirModal(false)}
                className="w-full rounded-2xl bg-blue-600 py-3 font-bold text-white active:bg-blue-700"
              >
                Volver y añadir
              </button>
              <button
                onClick={() => { setShowRirModal(false); doGuardar() }}
                className="w-full rounded-2xl bg-zinc-800 py-3 font-bold text-zinc-300 active:bg-zinc-700"
              >
                Continuar sin marcar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── UltimoEntrenoCard ─────────────────────────────────────────────────────────

const ETIQUETA_DOT: Record<EtiquetaSerie, string> = {
  fallo: 'bg-red-500',
  rir0:  'bg-orange-500',
  rir1:  'bg-yellow-400',
}

function UltimoEntrenoCard({
  ultimoEntreno,
  penultimoEntreno,
  seriesActuales,
  objetivo,
  objetivoPeso,
}: {
  ultimoEntreno: { fecha: string; series: Serie[]; ayudaFede: boolean } | null
  penultimoEntreno: { series: Serie[] } | null
  seriesActuales: Serie[]
  objetivo: 'subir' | 'bajar' | null
  objetivoPeso: number | null
}) {
  const ultimaSyncTimestamp = useFitLogStore((s) => s.ultimaSyncTimestamp)
  if (!ultimoEntreno) {
    return (
      <div className="mx-5 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="rounded-xl bg-yellow-950 border border-yellow-700/40 py-2 px-3
                        flex items-center gap-2">
          <span className="text-sm leading-none">⭐</span>
          <span className="text-xs font-bold text-yellow-400">Primera vez en este ejercicio</span>
        </div>
      </div>
    )
  }

  const seriesValidas = ultimoEntreno.series.filter(
    (s) => s.pesoKg !== '' && Number(s.pesoKg) > 0 && s.reps !== '' && Number(s.reps) > 0,
  )

  // Comparar peso objetivo con peso máximo actual
  const pesoMaxActual = seriesActuales
    .filter((s) => s.pesoKg !== '' && Number(s.pesoKg) > 0)
    .reduce<number | null>((max, s) => {
      const v = Number(s.pesoKg)
      return max === null || v > max ? v : max
    }, null)

  const objetivoSuperado =
    objetivoPeso !== null && pesoMaxActual !== null
      ? pesoMaxActual >= objetivoPeso
      : null

  return (
    <div className="mx-5 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="rounded-xl bg-zinc-800/90 border border-zinc-700 py-2 px-3">

        {/* Línea 1: icono + label + objetivo dir + fecha */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Clock size={11} className="text-zinc-500" />
            <span className="text-xs text-zinc-400">Último entreno</span>
            {objetivo === 'subir' && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 rounded-full px-1.5 py-0.5 leading-none">
                <ArrowUp size={8} strokeWidth={3} />Subir
              </span>
            )}
            {objetivo === 'bajar' && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-400 bg-red-500/15 rounded-full px-1.5 py-0.5 leading-none">
                <ArrowDown size={8} strokeWidth={3} />Bajar
              </span>
            )}
            {/* Peso objetivo */}
            {objetivoPeso !== null && (
              <span className={[
                'flex items-center gap-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none',
                objetivoSuperado === true
                  ? 'text-emerald-400 bg-emerald-500/15'
                  : objetivoSuperado === false
                  ? 'text-red-400 bg-red-500/15'
                  : 'text-zinc-400 bg-zinc-700/50',
              ].join(' ')}>
                {objetivoSuperado === true && <ArrowUp size={8} strokeWidth={3} />}
                {objetivoSuperado === false && <ArrowDown size={8} strokeWidth={3} />}
                🎯 {objetivoPeso}kg
              </span>
            )}
          </div>
          <span className="text-xs text-zinc-600 shrink-0 ml-1">{formatFechaCorta(ultimoEntreno.fecha)}</span>
          {ultimaSyncTimestamp > 0 && (
            <span className="text-[9px] text-zinc-700 shrink-0 tabular-nums">
              ↻{new Date(ultimaSyncTimestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        {/* Línea 2: chips horizontales con flechas de comparación en tiempo real */}
        {seriesValidas.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">Sin datos registrados</p>
        ) : (
          <div className="flex items-center overflow-x-auto">
            {seriesValidas.map((s, i) => {
              // Flecha histórica: comparar este entreno vs el anterior a él
              const serieAnterior = penultimoEntreno?.series.find((sp) => sp.numero === s.numero)
              const pesoAnterior  = serieAnterior && serieAnterior.pesoKg !== '' ? Number(serieAnterior.pesoKg) : null
              const pesoHist      = Number(s.pesoKg)
              const tendencia     =
                pesoAnterior !== null && !isNaN(pesoAnterior) && !isNaN(pesoHist) && pesoHist !== pesoAnterior
                  ? pesoHist > pesoAnterior ? 'sube' : 'baja'
                  : null
              return (
                <Fragment key={i}>
                  {i > 0 && <div className="w-px h-3.5 bg-zinc-600 mx-1.5 shrink-0" />}
                  <div className="flex items-center gap-[3px] shrink-0">
                    <span className="text-[10px] font-bold text-violet-400">S{s.numero}</span>
                    <span className="text-sm font-bold text-white tabular-nums">{s.pesoKg}</span>
                    <span className="text-[10px] text-zinc-500">kg</span>
                    <span className="text-[10px] text-zinc-500 mx-px">×</span>
                    <span className="text-sm text-emerald-400 tabular-nums">{s.reps}</span>
                    {s.etiqueta && (
                      <div className={`w-1.5 h-1.5 rounded-full ml-0.5 shrink-0 ${ETIQUETA_DOT[s.etiqueta]}`} />
                    )}
                    {tendencia === 'sube' && (
                      <ArrowUp size={9} className="text-emerald-400 animate-pulse shrink-0 ml-0.5" />
                    )}
                    {tendencia === 'baja' && (
                      <ArrowDown size={9} className="text-red-400 animate-pulse shrink-0 ml-0.5" />
                    )}
                  </div>
                </Fragment>
              )
            })}
            {ultimoEntreno.ayudaFede && (
              <>
                <div className="w-px h-3.5 bg-zinc-600 mx-1.5 shrink-0" />
                <span className="text-[10px] font-bold bg-green-500/20 text-green-400 rounded-full px-1.5 py-0.5 shrink-0">
                  💪
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ObjetivoProximoEntreno ────────────────────────────────────────────────────

function ObjetivoProximoEntreno({
  objetivo,
  setObjetivo,
  objetivoPeso,
  setObjetivoPeso,
}: {
  objetivo: 'subir' | 'bajar' | null
  setObjetivo: (dir: 'subir' | 'bajar' | null) => void
  objetivoPeso: number | null
  setObjetivoPeso: (kg: number | null) => void
}) {
  const [editDir,   setEditDir]   = useState<'subir' | 'bajar' | null>(null)
  const [pesoInput, setPesoInput] = useState('')

  const handleClickDir = (dir: 'subir' | 'bajar') => {
    if (objetivo === dir) {
      // Mismo → limpiar
      setObjetivo(null)
      setObjetivoPeso(null)
      setEditDir(null)
    } else {
      // Abrir input para esta dirección
      setPesoInput(objetivoPeso !== null ? String(objetivoPeso) : '')
      setEditDir(dir)
    }
  }

  const handleGuardarPeso = () => {
    if (!editDir) return
    setObjetivo(editDir)
    const num = parseFloat(pesoInput.replace(',', '.'))
    setObjetivoPeso(!isNaN(num) && num > 0 ? num : null)
    setEditDir(null)
  }

  const handleCancelarEdit = () => {
    setEditDir(null)
  }

  return (
    <div className="mx-5">
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Objetivo próximo entreno</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleClickDir('subir')}
              className={[
                'size-8 flex items-center justify-center rounded-full border transition-colors',
                objetivo === 'subir'
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : 'border-zinc-700 text-zinc-500 active:bg-zinc-800',
              ].join(' ')}
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => handleClickDir('bajar')}
              className={[
                'size-8 flex items-center justify-center rounded-full border transition-colors',
                objetivo === 'bajar'
                  ? 'bg-red-500 border-red-500 text-white'
                  : 'border-zinc-700 text-zinc-500 active:bg-zinc-800',
              ].join(' ')}
            >
              <ArrowDown size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Input de peso objetivo */}
        {editDir && (
          <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
            <span className="text-xs text-zinc-500 shrink-0">
              {editDir === 'subir' ? '↑' : '↓'} Peso objetivo:
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={pesoInput}
              onChange={(e) => setPesoInput(e.target.value)}
              placeholder="kg"
              autoFocus
              className="flex-1 min-w-0 bg-zinc-800 rounded-xl px-3 py-1.5 text-sm text-white
                         placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleGuardarPeso}
              className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white active:bg-blue-700"
            >
              OK
            </button>
            <button
              onClick={handleCancelarEdit}
              className="shrink-0 size-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-500 active:bg-zinc-700"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Peso objetivo guardado (si existe y no está editando) */}
        {!editDir && objetivoPeso !== null && (
          <p className="text-xs text-zinc-500">
            🎯 Peso objetivo: <span className="font-bold text-zinc-300">{objetivoPeso} kg</span>
          </p>
        )}
      </div>
    </div>
  )
}

// ── PillEtiqueta ──────────────────────────────────────────────────────────────

const ETIQUETA_CONFIG: Record<EtiquetaSerie, { label: string; base: string; active: string }> = {
  fallo: { label: 'Fallo',  base: 'border-red-800    text-red-500',     active: 'bg-red-500    text-white border-red-500'    },
  rir0:  { label: 'RIR 0', base: 'border-orange-700 text-orange-500',  active: 'bg-orange-500 text-white border-orange-500' },
  rir1:  { label: 'RIR 1', base: 'border-yellow-700 text-yellow-500',  active: 'bg-yellow-500 text-black border-yellow-500' },
}

function PillEtiqueta({
  etiqueta, activa, onToggle,
}: {
  etiqueta: EtiquetaSerie
  activa: boolean
  onToggle: () => void
}) {
  const cfg = ETIQUETA_CONFIG[etiqueta]
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'rounded-full border px-3 py-0.5 text-xs font-bold transition-colors',
        activa ? cfg.active : cfg.base,
      ].join(' ')}
    >
      {cfg.label}
    </button>
  )
}

// ── ListaEjerciciosDrawer ─────────────────────────────────────────────────────

function ListaEjerciciosDrawer({
  ejercicios, indiceActual, onSeleccionar, onCerrar,
}: {
  ejercicios: SesionEjercicio[]
  indiceActual: number
  onSeleccionar: (i: number) => void
  onCerrar: () => void
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onCerrar}
      />
      <div className="fixed bottom-16 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-3xl
                      max-h-[70svh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
        <div className="sticky top-0 bg-zinc-900 flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white text-base">Ejercicios de la sesión</h3>
          <button onClick={onCerrar} className="text-zinc-400 text-sm font-medium active:text-white">
            Cerrar
          </button>
        </div>

        <ul className="py-2">
          {ejercicios.map((ej, i) => {
            const nombre  = ej.nombreSustituido ?? ej.nombreSnapshot
            const esActual = i === indiceActual
            return (
              <li key={i}>
                <button
                  onClick={() => onSeleccionar(i)}
                  className={[
                    'w-full flex items-center gap-4 px-5 py-4 text-left active:bg-zinc-800',
                    esActual ? 'bg-blue-500/10' : '',
                  ].join(' ')}
                >
                  <span className="shrink-0">
                    {ej.completado ? (
                      <CheckCircle2 size={20} className="text-green-400" />
                    ) : esActual ? (
                      <span className="size-5 rounded-full border-2 border-blue-400 block" />
                    ) : (
                      <span className="size-5 rounded-full border-2 border-zinc-700 block" />
                    )}
                  </span>
                  <span className={[
                    'text-sm font-medium flex-1',
                    ej.saltado    ? 'text-zinc-600 line-through italic' :
                    ej.completado ? 'text-zinc-500 line-through' :
                    esActual      ? 'text-blue-400' : 'text-white',
                  ].join(' ')}>
                    {nombre}{ej.saltado ? ' (saltado)' : ''}
                  </span>
                  {esActual && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/15 rounded-full px-2 py-0.5">
                      Actual
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

// ── ResumenSesion — helpers ───────────────────────────────────────────────────

type ModoResumen = 'visual' | 'texto'

function calcularTotales(ejercicios: SesionEjercicio[]) {
  const completados = ejercicios.filter((e) => e.completado && !e.saltado)
  let totalSeries = 0
  let totalKg     = 0
  for (const ej of completados) {
    for (const s of ej.series) {
      if (s.pesoKg !== '' && s.reps !== '') {
        totalSeries++
        totalKg += Number(s.pesoKg) * Number(s.reps)
      }
    }
  }
  return { totalEjercicios: completados.length, totalSeries, totalKg }
}

function fmtKg(kg: number): string {
  return kg % 1 === 0 ? String(kg) : kg.toFixed(1)
}

function calcularVolumen(series: Serie[]): number {
  return series.reduce((sum, s) => {
    if (s.pesoKg === '' || s.reps === '') return sum
    const kg   = Number(s.pesoKg)
    const reps = Number(s.reps)
    if (!isFinite(kg) || !isFinite(reps) || kg <= 0 || reps <= 0) return sum
    return sum + kg * reps
  }, 0)
}

interface ProgresoEjercicio {
  nombre: string
  volActual: number
  diffAnterior: number | null  // solo si subió
  diffMedia4:   number | null  // solo si subió
}

/**
 * Para cada ejercicio completado, calcula el volumen actual y lo compara con
 * (a) la sesión anterior del mismo ejercicio y (b) la media de las últimas 4.
 * Devuelve solo los ejercicios en los que hay al menos una subida.
 */
function calcularProgresosVolumen(
  completados: SesionEjercicio[],
  historialOrdenado: Sesion[],
): ProgresoEjercicio[] {
  const resultado: ProgresoEjercicio[] = []
  for (const ej of completados) {
    const volActual = calcularVolumen(ej.series)
    if (volActual <= 0) continue
    const nombre = ej.nombreSustituido ?? ej.nombreSnapshot

    // Hasta 4 sesiones previas con volumen > 0
    const volPrevios: number[] = []
    for (const ses of historialOrdenado) {
      const ejPrev = ses.ejercicios.find(
        (e) =>
          (e.nombreSnapshot === ej.nombreSnapshot || e.ejercicioId === ej.ejercicioId) &&
          e.completado && !e.saltado,
      )
      if (ejPrev) {
        const v = calcularVolumen(ejPrev.series)
        if (v > 0) volPrevios.push(v)
        if (volPrevios.length >= 4) break
      }
    }
    if (volPrevios.length === 0) continue

    const diffAnterior = volActual - volPrevios[0]
    const media4       = volPrevios.reduce((a, b) => a + b, 0) / volPrevios.length
    const diffMedia4   = volActual - media4

    if (diffAnterior > 0 || diffMedia4 > 0) {
      resultado.push({
        nombre,
        volActual,
        diffAnterior: diffAnterior > 0 ? diffAnterior : null,
        diffMedia4:   diffMedia4   > 0 ? diffMedia4   : null,
      })
    }
  }
  return resultado
}

function pesoMax(series: Serie[]): number | null {
  const vals = series
    .filter((s) => s.pesoKg !== '' && Number(s.pesoKg) > 0)
    .map((s) => Number(s.pesoKg))
  return vals.length > 0 ? Math.max(...vals) : null
}

function generarTextoWhatsApp(
  sesion: Sesion,
  diaNombre: string,
  totales: ReturnType<typeof calcularTotales>,
  historialPrevio: Sesion[],
  progresos: ProgresoEjercicio[],
): string {
  const fecha = formatFechaCorta(sesion.fecha)
  const historialOrdenado = [...historialPrevio].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const lines: string[] = [
    `🏋️ Entreno del ${fecha} — ${diaNombre}`,
    '━━━━━━━━━━━━━━━━',
  ]
  const completados = sesion.ejercicios.filter((e) => e.completado && !e.saltado)
  for (const ej of completados) {
    lines.push(`✅ ${ej.nombreSustituido ?? ej.nombreSnapshot}`)
    const seriesStr = ej.series
      .map((s) => {
        let str = `S${s.numero}: ${s.pesoKg !== '' ? s.pesoKg + 'kg' : '—'} × ${s.reps !== '' ? s.reps : '—'}`
        if (s.etiqueta === 'fallo') str += ' 🔴Fallo'
        else if (s.etiqueta === 'rir0') str += ' 🟠RIR0'
        else if (s.etiqueta === 'rir1') str += ' 🟡RIR1'
        return str
      })
      .join(' | ')
    lines.push(`  ${seriesStr}`)
    if (ej.ayudaFede) lines.push('  💪 Fede ayudó')

    // Récord / primera vez
    const ultimoHist = historialOrdenado.reduce<SesionEjercicio | null>((acc, ses) => {
      if (acc) return acc
      return ses.ejercicios.find(
        (e) =>
          (e.nombreSnapshot === ej.nombreSnapshot || e.ejercicioId === ej.ejercicioId) &&
          e.completado && !e.saltado,
      ) ?? null
    }, null)
    const maxHist   = ultimoHist ? pesoMax(ultimoHist.series) : null
    const maxActual = pesoMax(ej.series)
    if (ultimoHist === null && maxActual !== null) {
      lines.push('  ⭐ ¡Primera vez!')
    } else if (maxHist !== null && maxActual !== null && maxActual > maxHist) {
      lines.push(`  🏆 ¡Nuevo récord! +${fmtKg(maxActual - maxHist)}kg`)
    }
  }
  lines.push('━━━━━━━━━━━━━━━━')
  lines.push(
    `📊 Total: ${totales.totalEjercicios} ejercicio${totales.totalEjercicios !== 1 ? 's' : ''} | ` +
    `${totales.totalSeries} serie${totales.totalSeries !== 1 ? 's' : ''} | ` +
    `${fmtKg(totales.totalKg)}kg levantados`,
  )
  lines.push('💪 ¡Gran sesión!')

  // Sección progreso de volumen (solo si hay subidas)
  if (progresos.length > 0) {
    lines.push('')
    lines.push('📈 Progreso de hoy')
    for (const p of progresos) {
      lines.push(`${p.nombre} (${fmtKg(p.volActual)} kg vol.)`)
      if (p.diffAnterior !== null) lines.push(`  ↑ +${fmtKg(p.diffAnterior)} kg vs anterior`)
      if (p.diffMedia4   !== null) lines.push(`  ↑ +${fmtKg(p.diffMedia4)} kg vs media 4 💪`)
    }
  }

  return lines.join('\n')
}

// ── SeccionProgresoHoy ────────────────────────────────────────────────────────

function SeccionProgresoHoy({ progresos }: { progresos: ProgresoEjercicio[] }) {
  if (progresos.length === 0) return null
  return (
    <div className="bg-zinc-900 border border-emerald-800/50 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-base select-none">📈</span>
        <h3 className="font-bold text-emerald-400 text-sm">Progreso de hoy</h3>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {progresos.map((p, i) => (
          <div key={i} className="px-4 py-3 flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-white leading-snug">{p.nombre}</span>
              <span className="text-xs text-zinc-500 tabular-nums shrink-0">{fmtKg(p.volActual)} kg</span>
            </div>
            {p.diffAnterior !== null && (
              <span className="text-xs font-semibold text-emerald-400">
                ↑ +{fmtKg(p.diffAnterior)} kg vs sesión anterior
              </span>
            )}
            {p.diffMedia4 !== null && (
              <span className="text-xs font-semibold text-emerald-400">
                ↑ +{fmtKg(p.diffMedia4)} kg vs media 4 sesiones
              </span>
            )}
          </div>
        ))}
        <div className="px-4 py-2.5 flex items-center gap-1.5">
          <span className="text-sm select-none">💪</span>
          <span className="text-xs font-bold text-emerald-400">¡Buen trabajo!</span>
        </div>
      </div>
    </div>
  )
}

// ── ResumenSesion — componente ────────────────────────────────────────────────

function ResumenSesion({
  sesion, historialPrevio, diaNombre, hayObjetivoSuperado, onFinalizar, onSeguir, syncing, syncError,
}: {
  sesion: Sesion
  historialPrevio: Sesion[]
  diaNombre: string
  hayObjetivoSuperado: boolean
  onFinalizar: () => void
  onSeguir: () => void
  syncing?: boolean
  syncError?: string | null
}) {
  const [modo,    setModo]    = useState<ModoResumen>('visual')
  const [copiado, setCopiado] = useState(false)

  const completados = sesion.ejercicios.filter((e) => e.completado && !e.saltado)
  const saltados    = sesion.ejercicios.filter((e) => e.saltado)
  const totales     = calcularTotales(sesion.ejercicios)
  const fecha       = formatFechaCorta(sesion.fecha)

  const historialOrdenado = useMemo(
    () => [...historialPrevio].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [historialPrevio],
  )

  const progresos = useMemo(
    () => calcularProgresosVolumen(completados, historialOrdenado),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sesion.id, historialPrevio],
  )

  useEffect(() => {
    lanzarEmojis()
    if (hayObjetivoSuperado) {
      setTimeout(lanzarObjetivoCelebration, 600)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCopiar = async () => {
    const texto = generarTextoWhatsApp(sesion, diaNombre, totales, historialPrevio, progresos)
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch { /* clipboard no disponible */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: 'linear-gradient(to bottom, #09090b 0%, #18181b 100%)' }}
    >
      {/* ── Cabecera fija ── */}
      <div
        className="sticky top-0 z-10 px-5 pt-10 pb-4"
        style={{ background: 'linear-gradient(to bottom, #09090b 70%, transparent)' }}
      >
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <span className="text-3xl select-none">🏋️</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-white leading-tight">Sesión completada</h1>
            <p className="text-sm text-zinc-500 tabular-nums">{fecha}</p>
          </div>
          <div className="flex items-center bg-zinc-800 rounded-xl p-1 gap-1 shrink-0">
            {(['visual', 'texto'] as ModoResumen[]).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={[
                  'text-xs font-bold px-3 py-1.5 rounded-lg transition-colors capitalize',
                  modo === m ? 'bg-zinc-600 text-white' : 'text-zinc-500 active:text-zinc-300',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Contenido scrollable ── */}
      <div className="px-4 pb-44 flex flex-col gap-4 max-w-lg mx-auto">

        {modo === 'visual' ? (
          <>
            {/* Tarjeta resumen general */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
              <div className="flex justify-around">
                {[
                  { valor: totales.totalEjercicios, label: 'ejercicios' },
                  { valor: totales.totalSeries,     label: 'series'     },
                  { valor: fmtKg(totales.totalKg),  label: 'kg totales' },
                ].map(({ valor, label }, i, arr) => (
                  <Fragment key={label}>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-2xl font-black text-white tabular-nums">{valor}</span>
                      <span className="text-xs text-zinc-500">{label}</span>
                    </div>
                    {i < arr.length - 1 && <div className="w-px bg-zinc-800 self-stretch" />}
                  </Fragment>
                ))}
              </div>
              {saltados.length > 0 && (
                <p className="text-xs text-zinc-600 text-center mt-3">
                  Saltado{saltados.length !== 1 ? 's' : ''}: {saltados.map((e) => e.nombreSustituido ?? e.nombreSnapshot).join(', ')}
                </p>
              )}
            </div>

            {/* Tarjetas por ejercicio */}
            {completados.map((ej, ejIdx) => {
              const nombre = ej.nombreSustituido ?? ej.nombreSnapshot

              const ultimoHist = historialOrdenado.reduce<SesionEjercicio | null>((acc, ses) => {
                if (acc) return acc
                return ses.ejercicios.find(
                  (e) =>
                    (e.nombreSnapshot === ej.nombreSnapshot || e.ejercicioId === ej.ejercicioId) &&
                    e.completado && !e.saltado,
                ) ?? null
              }, null)

              const maxHist    = ultimoHist ? pesoMax(ultimoHist.series) : null
              const maxActual  = pesoMax(ej.series)
              const diferencia = maxHist !== null && maxActual !== null ? maxActual - maxHist : null

              return (
                <div
                  key={ejIdx}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${ejIdx * 60}ms`, animationFillMode: 'both' }}
                >
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
                    <h3 className="font-bold text-white text-sm leading-snug flex-1 min-w-0 truncate">
                      {nombre}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ej.ayudaFede && (
                        <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                          💪 Fede
                        </span>
                      )}
                      {diferencia !== null && diferencia !== 0 && (
                        <span className={[
                          'text-xs font-black px-2 py-0.5 rounded-full',
                          diferencia > 0
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-red-400 bg-red-500/10',
                        ].join(' ')}>
                          {diferencia > 0 ? '+' : ''}{fmtKg(diferencia)}kg
                        </span>
                      )}
                      {diferencia === null && ultimoHist === null && (
                        <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                          ⭐ Primera vez
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-zinc-800/60">
                    {ej.series.map((s, sIdx) => {
                      const histSerie   = ultimoHist?.series.find((hs) => hs.numero === s.numero)
                      const pesoHistNum = histSerie && histSerie.pesoKg !== '' ? Number(histSerie.pesoKg) : null
                      const pesoActNum  = s.pesoKg !== '' ? Number(s.pesoKg) : null
                      const supera      = pesoActNum !== null && pesoHistNum !== null && pesoActNum > pesoHistNum

                      return (
                        <div key={sIdx} className="px-4 py-2.5 flex items-center gap-3">
                          <span className="text-xs font-bold text-zinc-500 w-5 shrink-0">
                            S{s.numero}
                          </span>
                          <span className={[
                            'text-sm font-bold tabular-nums',
                            supera ? 'text-emerald-400' : 'text-white',
                          ].join(' ')}>
                            {s.pesoKg !== '' ? `${s.pesoKg}kg` : '—'}
                          </span>
                          <span className="text-zinc-600 text-xs">×</span>
                          <span className="text-sm text-zinc-300 tabular-nums">
                            {s.reps !== '' ? String(s.reps) : '—'}
                          </span>
                          {s.etiqueta && (
                            <span className={[
                              'text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto',
                              s.etiqueta === 'fallo' ? 'bg-red-500/20 text-red-400'    :
                              s.etiqueta === 'rir0'  ? 'bg-orange-500/20 text-orange-400' :
                                                       'bg-yellow-500/20 text-yellow-400',
                            ].join(' ')}>
                              {s.etiqueta === 'fallo' ? 'Fallo' : s.etiqueta === 'rir0' ? 'RIR 0' : 'RIR 1'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Línea de récord / primera vez */}
                  {diferencia !== null && diferencia > 0 && (
                    <div className="px-4 py-2 border-t border-zinc-800/60 flex items-center gap-1.5">
                      <span className="text-sm">🏆</span>
                      <span className="text-xs font-bold text-emerald-400">
                        ¡Nuevo récord! +{fmtKg(diferencia)}kg respecto al último entreno
                      </span>
                    </div>
                  )}
                  {ultimoHist === null && maxActual !== null && (
                    <div className="px-4 py-2 border-t border-zinc-800/60 flex items-center gap-1.5">
                      <span className="text-sm">⭐</span>
                      <span className="text-xs font-bold text-yellow-400">¡Primera vez!</span>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Sección progreso de volumen — al final, solo si hay subidas */}
            <SeccionProgresoHoy progresos={progresos} />
          </>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-3">
              Vista previa
            </p>
            <pre className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words font-mono">
              {generarTextoWhatsApp(sesion, diaNombre, totales, historialPrevio, progresos)}
            </pre>
          </div>
        )}
      </div>

      {/* ── Footer fijo ── */}
      <div
        className="fixed bottom-0 inset-x-0 px-4 pb-8 pt-6"
        style={{ background: 'linear-gradient(to top, #09090b 75%, transparent)' }}
      >
        <div className="flex flex-col gap-2 max-w-lg mx-auto">
          <button
            onClick={handleCopiar}
            className={[
              'w-full rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 transition-colors',
              copiado
                ? 'bg-green-600 text-white'
                : 'bg-zinc-800 text-white active:bg-zinc-700',
            ].join(' ')}
          >
            {copiado ? '✅ Copiado' : '📋 Copiar para WhatsApp'}
          </button>
          {syncError && (
            <div className="flex items-start gap-2 bg-red-950 border border-red-700/60 rounded-2xl px-4 py-3">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-red-300">Error de sincronización</p>
                <p className="text-[11px] text-red-400/80 mt-0.5 break-all">{syncError}</p>
              </div>
            </div>
          )}
          <button
            onClick={onFinalizar}
            disabled={syncing}
            className="w-full rounded-2xl bg-blue-600 py-4 font-bold text-white text-base active:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {syncing ? 'Sincronizando…' : 'Cerrar'}
          </button>
          <button
            onClick={onSeguir}
            disabled={syncing}
            className="w-full py-2.5 rounded-2xl text-sm font-semibold text-zinc-500 active:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Seguir editando
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100svh-4rem)]">
      <p className="text-zinc-500 text-sm">Cargando sesión…</p>
    </div>
  )
}

function ErrorPage({ mensaje }: { mensaje: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100svh-4rem)] gap-4">
      <p className="text-zinc-400">{mensaje}</p>
      <button onClick={() => navigate('/rutina')} className="text-blue-400 text-sm">
        ← Volver
      </button>
    </div>
  )
}
