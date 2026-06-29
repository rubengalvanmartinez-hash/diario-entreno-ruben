import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronUp, ChevronDown, Trash2, Plus, ImagePlus,
  X, LogOut, FileSpreadsheet, RefreshCw, CheckCircle2, AlertCircle, ChevronRight, Users, Database,
} from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { getUsuarioActivo, cerrarSesionLocal, sincronizarEjerciciosUsuario, supabase, forzarSincronizacionPendientes, getRubenUUID, cargarDatosUsuario, asegurarUsuarioRuben } from '../services/supabase'
import {
  iniciarSesionGoogle,
  cerrarSesionGoogle,
  sincronizarPendientes,
  importarHistorialDesdeSheets,
  ErrorTokenExpirado,
} from '../services/googleSheets'
import { guardarImagen, obtenerImagen, eliminarImagen } from '../services/imageDB'
import type { DiaId, Ejercicio, Sesion, RegistroPeso, RegistroComposicion, PerfilCorporal } from '../types/models'
import { normalizarNombre } from '../utils/normalizar'
import { APP_VERSION, CHANGELOG } from '../config/version'

const DIAS: DiaId[] = [1, 2, 3]
const DIA_NOMBRE: Record<DiaId, string> = { 1: 'Día 1', 2: 'Día 2', 3: 'Día 3' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AjustesPage() {
  const navigate = useNavigate()
  const usuarioActivo = getUsuarioActivo()
  const esRuben = usuarioActivo?.esRuben ?? false

  // Sync ejercicios a Supabase cuando cambian (todos los usuarios)
  const ejercicios = useFitLogStore(useShallow((s) => s.ejercicios))
  const syncMounted = useRef(false)
  useEffect(() => {
    if (!syncMounted.current) { syncMounted.current = true; return }
    if (!usuarioActivo) return
    const uid = esRuben ? getRubenUUID() : usuarioActivo.id
    sincronizarEjerciciosUsuario(uid, ejercicios).catch(console.error)
  }, [ejercicios]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCambiarUsuario = () => {
    cerrarSesionLocal()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex flex-col gap-10 px-4 pt-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Ajustes</h1>
          <span className="text-xs text-zinc-600 tabular-nums">v{APP_VERSION}</span>
        </div>
        <button
          onClick={handleCambiarUsuario}
          className="flex items-center gap-1.5 text-xs font-bold text-zinc-400
                     bg-zinc-800 px-3 py-2 rounded-xl active:bg-zinc-700 transition-colors"
        >
          <LogOut size={13} />
          {usuarioActivo ? usuarioActivo.nombre : 'Salir'}
        </button>
      </div>

      <section className="flex flex-col gap-5">
        <SectionLabel>Ejercicios por día</SectionLabel>
        {DIAS.map((dia) => <SeccionDia key={dia} dia={dia} />)}
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Series por defecto</SectionLabel>
        <SeccionSeriesPorDefecto />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Sincronización Supabase</SectionLabel>
        <SeccionSyncPendientes />
      </section>

      {esRuben && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Google Sheets</SectionLabel>
          <SeccionGoogleSheets />
        </section>
      )}

      {esRuben && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Gestión de usuarios</SectionLabel>
          <SeccionGestionUsuarios />
        </section>
      )}

      {esRuben && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Conexión Supabase</SectionLabel>
          <SeccionVerificarSupabase />
        </section>
      )}

      {esRuben && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Subida manual a Supabase</SectionLabel>
          <SeccionSubidaRuben />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Exportar para IA</SectionLabel>
        <SeccionExportarIA />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Diagnóstico de datos</SectionLabel>
        <SeccionDiagnostico />
        <SeccionDiagnosticoNombres />
        <SeccionBackupRestore />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Mantenimiento</SectionLabel>
        <SeccionBorrarCache />
      </section>

      <SeccionVersion />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 px-1">
      {children}
    </h2>
  )
}

// ── SeccionDia ────────────────────────────────────────────────────────────────

function SeccionDia({ dia }: { dia: DiaId }) {
  const [abierto, setAbierto] = useState(false)

  const ejercicios = useFitLogStore(
    useShallow((s) =>
      s.ejercicios.filter((e) => e.dia === dia).sort((a, b) => a.orden - b.orden),
    ),
  )
  const agregarEjercicio     = useFitLogStore((s) => s.agregarEjercicio)
  const eliminarEjercicio    = useFitLogStore((s) => s.eliminarEjercicio)
  const reordenarEjercicios  = useFitLogStore((s) => s.reordenarEjercicios)
  const seriesGlobales       = useFitLogStore((s) => s.seriesGlobalesPorDefecto)

  const handleMover = (id: string, dir: 'arriba' | 'abajo') => {
    const ids = ejercicios.map((e) => e.id)
    const idx = ids.indexOf(id)
    const swap = dir === 'arriba' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    reordenarEjercicios(dia, next)
  }

  const handleAgregar = () => {
    agregarEjercicio({
      nombre: 'Nuevo ejercicio',
      dia,
      seriesPorDefecto: seriesGlobales,
      notasFijas: '',
    })
  }

  return (
    <div className="rounded-2xl border border-zinc-800 overflow-hidden">
      {/* Cabecera plegable */}
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 bg-zinc-900 active:bg-zinc-800/80 transition-colors"
      >
        <span className="size-6 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-blue-400">{dia}</span>
        </span>
        <span className="font-bold text-white flex-1 text-left">{DIA_NOMBRE[dia]}</span>
        <span className="text-xs text-zinc-500">
          {ejercicios.length} ejercicio{ejercicios.length !== 1 ? 's' : ''}
        </span>
        {abierto
          ? <ChevronUp size={16} className="text-zinc-400 shrink-0" />
          : <ChevronDown size={16} className="text-zinc-400 shrink-0" />
        }
      </button>

      {/* Contenido desplegable */}
      {abierto && (
        <div className="flex flex-col gap-2 px-3 pt-3 pb-3 border-t border-zinc-800 bg-zinc-950/40">
          {ejercicios.map((ej, idx) => (
            <EjercicioCard
              key={ej.id}
              ejercicio={ej}
              isFirst={idx === 0}
              isLast={idx === ejercicios.length - 1}
              onMoverArriba={() => handleMover(ej.id, 'arriba')}
              onMoverAbajo={() => handleMover(ej.id, 'abajo')}
              onEliminar={() => eliminarEjercicio(ej.id)}
            />
          ))}

          <button
            onClick={handleAgregar}
            className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-dashed
                       border-zinc-700 py-3.5 text-sm font-semibold text-zinc-500 active:bg-zinc-900/60"
          >
            <Plus size={17} />
            Añadir ejercicio
          </button>
        </div>
      )}
    </div>
  )
}

// ── EjercicioCard ─────────────────────────────────────────────────────────────

// ── ModalElegirEjercicio ──────────────────────────────────────────────────────

function ModalElegirEjercicio({
  onElegir,
  onCerrar,
}: {
  onElegir: (nombre: string) => void
  onCerrar: () => void
}) {
  const todosEjercicios = useFitLogStore(useShallow((s) => s.ejercicios))
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [modoNuevo,   setModoNuevo]   = useState(false)

  const nombresUnicos = useMemo(() => {
    const set = new Set(todosEjercicios.map((e) => e.nombre))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [todosEjercicios])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center">
      <div className="w-full max-w-lg bg-zinc-900 rounded-t-3xl border-t border-zinc-700 shadow-xl
                      max-h-[80svh] flex flex-col animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h3 className="font-bold text-white">Elegir ejercicio</h3>
          <button onClick={onCerrar} className="text-zinc-400 text-sm active:text-white">Cancelar</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Opción: añadir nuevo */}
          {modoNuevo ? (
            <div className="p-4 flex flex-col gap-3">
              <input
                autoFocus
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Nombre del ejercicio…"
                className="w-full bg-zinc-800 rounded-xl px-3 py-3 text-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => { if (nuevoNombre.trim()) onElegir(nuevoNombre.trim()) }}
                disabled={!nuevoNombre.trim()}
                className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-40"
              >
                Añadir
              </button>
              <button onClick={() => setModoNuevo(false)} className="text-zinc-500 text-sm text-center py-1">
                Volver al listado
              </button>
            </div>
          ) : (
            <ul className="py-2">
              <li>
                <button
                  onClick={() => setModoNuevo(true)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left active:bg-zinc-800"
                >
                  <span className="text-sm font-semibold text-blue-400">+ Añadir nombre nuevo</span>
                </button>
              </li>
              {nombresUnicos.map((nombre) => (
                <li key={nombre}>
                  <button
                    onClick={() => onElegir(nombre)}
                    className="w-full flex items-center justify-between px-5 py-3.5 text-left
                               active:bg-zinc-800 border-t border-zinc-800/60"
                  >
                    <span className="text-sm text-white">{nombre}</span>
                    <ChevronRight size={16} className="text-zinc-600 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── EjercicioCard ─────────────────────────────────────────────────────────────

function EjercicioCard({
  ejercicio,
  isFirst,
  isLast,
  onMoverArriba,
  onMoverAbajo,
  onEliminar,
}: {
  ejercicio: Ejercicio
  isFirst: boolean
  isLast: boolean
  onMoverArriba: () => void
  onMoverAbajo: () => void
  onEliminar: () => void
}) {
  const actualizarEjercicio = useFitLogStore((s) => s.actualizarEjercicio)

  const [nombre, setNombre]           = useState(ejercicio.nombre)
  const [notas, setNotas]             = useState(ejercicio.notasFijas)
  const [imagen, setImagen]           = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showModal,    setShowModal]  = useState(false)

  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef      = useRef<HTMLInputElement>(null)

  // Load image from IndexedDB
  useEffect(() => {
    obtenerImagen(ejercicio.id).then(setImagen)
  }, [ejercicio.id])

  // Keep local state in sync when the store entry changes externally
  useEffect(() => { setNombre(ejercicio.nombre) },    [ejercicio.nombre])
  useEffect(() => { setNotas(ejercicio.notasFijas) }, [ejercicio.notasFijas])

  // Clear timeout on unmount
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleElegirNombre = (nombreElegido: string) => {
    setNombre(nombreElegido)
    actualizarEjercicio(ejercicio.id, { nombre: nombreElegido })
    setShowModal(false)
  }

  const handleNotasBlur = () => {
    if (notas !== ejercicio.notasFijas) actualizarEjercicio(ejercicio.id, { notasFijas: notas })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      await guardarImagen(ejercicio.id, base64)
      setImagen(base64)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleEliminarImagen = async () => {
    await eliminarImagen(ejercicio.id)
    setImagen(null)
  }

  const handleEliminar = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    if (imagen) eliminarImagen(ejercicio.id)
    onEliminar()
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">

      {/* Row 1: reorder + nombre + delete */}
      <div className="flex items-center gap-2">

        {/* Up / Down */}
        <div className="flex flex-col shrink-0">
          <button
            onClick={onMoverArriba}
            disabled={isFirst}
            className="size-8 flex items-center justify-center rounded-lg text-zinc-400
                       disabled:opacity-20 active:bg-zinc-800"
          >
            <ChevronUp size={18} />
          </button>
          <button
            onClick={onMoverAbajo}
            disabled={isLast}
            className="size-8 flex items-center justify-center rounded-lg text-zinc-400
                       disabled:opacity-20 active:bg-zinc-800"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        {/* Nombre */}
        <button
          onClick={() => setShowModal(true)}
          className="flex-1 min-w-0 bg-zinc-800 rounded-xl px-3 py-2.5 text-left text-white text-sm
                     font-semibold flex items-center justify-between gap-1 active:bg-zinc-700"
        >
          <span className="truncate">{nombre}</span>
          <ChevronRight size={15} className="text-zinc-500 shrink-0" />
        </button>

        {/* Delete */}
        <button
          onClick={handleEliminar}
          className={[
            'size-9 flex items-center justify-center rounded-xl shrink-0 transition-colors',
            confirmDelete
              ? 'bg-red-500/15 text-red-400'
              : 'text-zinc-600 active:bg-zinc-800',
          ].join(' ')}
          aria-label={confirmDelete ? 'Confirmar eliminación' : 'Eliminar ejercicio'}
        >
          <Trash2 size={17} />
        </button>
      </div>

      {/* Confirm delete hint */}
      {confirmDelete && (
        <p className="text-xs text-red-400/80 px-1 -mt-1">
          Toca de nuevo para confirmar el borrado
        </p>
      )}

      {/* Row 2: imagen */}
      <div className="flex items-center gap-3">
        {imagen && (
          <div className="relative size-16 rounded-xl overflow-hidden border border-zinc-700 shrink-0">
            <img src={imagen} alt="Ejercicio" className="w-full h-full object-cover" />
            <button
              onClick={handleEliminarImagen}
              className="absolute top-0 right-0 size-5 bg-zinc-900/85 flex items-center justify-center rounded-bl-lg"
              aria-label="Quitar imagen"
            >
              <X size={10} className="text-zinc-300" />
            </button>
          </div>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-700
                     px-3 py-2 text-xs font-medium text-zinc-500 active:bg-zinc-800"
        >
          <ImagePlus size={15} />
          {imagen ? 'Cambiar imagen' : 'Añadir imagen'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Row 3: notas fijas */}
      <textarea
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        onBlur={handleNotasBlur}
        placeholder="Notas fijas: técnica, peso objetivo, recordatorios…"
        rows={2}
        className="bg-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600
                   resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {showModal && (
        <ModalElegirEjercicio
          onElegir={handleElegirNombre}
          onCerrar={() => setShowModal(false)}
        />
      )}
    </div>
  )
}

// ── SeccionSeriesPorDefecto ───────────────────────────────────────────────────

function SeccionSeriesPorDefecto() {
  const series    = useFitLogStore((s) => s.seriesGlobalesPorDefecto)
  const setSeries = useFitLogStore((s) => s.setSeriesGlobalesPorDefecto)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-sm text-zinc-400">
        Número de series por defecto al añadir un ejercicio nuevo.
      </p>
      <div className="flex gap-3">
        {([3, 4] as const).map((n) => (
          <button
            key={n}
            onClick={() => setSeries(n)}
            className={[
              'flex-1 py-3.5 rounded-xl text-base font-bold transition-colors',
              series === n
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700',
            ].join(' ')}
          >
            {n} series
          </button>
        ))}
      </div>
    </div>
  )
}

// ── SeccionGoogleSheets ───────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID =
  '512541931653-vfaag7fb6ncegrrvvaeosqq38uoukugf.apps.googleusercontent.com'

type SyncEstado = 'idle' | 'working' | 'ok' | 'error'

function SeccionGoogleSheets() {
  const isAuthenticated          = useFitLogStore((s) => s.isAuthenticated)
  const googleConfig             = useFitLogStore(useShallow((s) => s.googleConfig))
  const setGoogleConfig          = useFitLogStore((s) => s.setGoogleConfig)
  const setAuthenticated         = useFitLogStore((s) => s.setAuthenticated)
  const historialSesiones        = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso            = useFitLogStore(useShallow((s) => s.registrosPeso))
  const marcarSesionSincronizada = useFitLogStore((s) => s.marcarSesionSincronizada)
  const marcarPesoSincronizado   = useFitLogStore((s) => s.marcarPesoSincronizado)
  const importarHistorial        = useFitLogStore((s) => s.importarHistorial)

  const [sheetId, setSheetId]   = useState(googleConfig.spreadsheetId)
  const [idSaved, setIdSaved]   = useState(false)
  const [loginLoading, setLoginLoading]   = useState(false)
  const [syncEstado, setSyncEstado]       = useState<SyncEstado>('idle')
  const [syncMsg, setSyncMsg]             = useState('')
  const [loginError, setLoginError]       = useState('')
  const [importEstado, setImportEstado]   = useState<SyncEstado>('idle')
  const [importMsg, setImportMsg]         = useState('')

  const pendientes =
    historialSesiones.filter((s) => !s.sincronizado).length +
    registrosPeso.filter((r) => !r.sincronizado).length

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError('')
    try {
      const { accessToken, email } = await iniciarSesionGoogle(GOOGLE_CLIENT_ID)
      setGoogleConfig({ accessToken, email })
      setAuthenticated(true)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Error al conectar')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    await cerrarSesionGoogle(googleConfig.accessToken)
    setGoogleConfig({ accessToken: '', email: '' })
    setAuthenticated(false)
  }

  const handleSaveId = () => {
    setGoogleConfig({ spreadsheetId: sheetId.trim() })
    setIdSaved(true)
    setTimeout(() => setIdSaved(false), 2000)
  }

  const handleSync = async () => {
    const spreadsheetId = googleConfig.spreadsheetId.trim()
    if (!spreadsheetId) {
      setSyncMsg('Introduce el Spreadsheet ID primero.')
      setSyncEstado('error')
      return
    }
    setSyncEstado('working')
    setSyncMsg('')
    try {
      const result = await sincronizarPendientes(googleConfig.accessToken, spreadsheetId, {
        sesiones:                 historialSesiones,
        registrosPeso,
        marcarSesionSincronizada,
        marcarPesoSincronizado,
      })
      if (result.errores.length > 0) {
        setSyncMsg(`Parcial: ${result.sesiones} sesiones, ${result.pesos} pesos. ` +
                   `Errores: ${result.errores.join('; ')}`)
        setSyncEstado('error')
      } else {
        setSyncMsg(`Sincronizado: ${result.sesiones} sesiones, ${result.pesos} registros de peso.`)
        setSyncEstado('ok')
      }
    } catch (err) {
      if (err instanceof ErrorTokenExpirado) {
        setAuthenticated(false)
        setGoogleConfig({ accessToken: '' })
        setSyncMsg('Token expirado. Vuelve a conectar tu cuenta.')
      } else {
        setSyncMsg(err instanceof Error ? err.message : 'Error de sincronización')
      }
      setSyncEstado('error')
    }
  }

  const handleImport = async () => {
    const spreadsheetId = googleConfig.spreadsheetId.trim()
    if (!spreadsheetId) {
      setImportMsg('Introduce el Spreadsheet ID primero.')
      setImportEstado('error')
      return
    }
    setImportEstado('working')
    setImportMsg('')
    try {
      const { sesiones, registrosPeso: pesos } = await importarHistorialDesdeSheets(
        googleConfig.accessToken,
        spreadsheetId,
      )
      importarHistorial(sesiones, pesos)
      setImportMsg(
        `Importado: ${sesiones.length} sesión${sesiones.length !== 1 ? 'es' : ''}, ` +
        `${pesos.length} registro${pesos.length !== 1 ? 's' : ''} de peso.`,
      )
      setImportEstado('ok')
    } catch (err) {
      if (err instanceof ErrorTokenExpirado) {
        setAuthenticated(false)
        setGoogleConfig({ accessToken: '' })
        setImportMsg('Token expirado. Vuelve a conectar tu cuenta.')
      } else {
        setImportMsg(err instanceof Error ? err.message : 'Error al importar')
      }
      setImportEstado('error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-5">

      {/* Cuenta */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Cuenta de Google
        </p>
        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {googleConfig.email || 'Cuenta conectada'}
              </p>
              <p className="text-xs text-green-400 mt-0.5">Conectada</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2
                         text-sm font-medium text-zinc-400 active:bg-zinc-700 shrink-0"
            >
              <LogOut size={15} />
              Desconectar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="w-full flex items-center justify-center gap-3 rounded-xl bg-white
                         px-4 py-3.5 text-sm font-semibold text-zinc-900
                         active:bg-zinc-100 disabled:opacity-60"
            >
              {loginLoading
                ? <RefreshCw size={16} className="animate-spin text-zinc-600" />
                : <GoogleLogo />}
              {loginLoading ? 'Conectando…' : 'Conectar con Google'}
            </button>
            {loginError && (
              <p className="text-xs text-red-400 px-1">{loginError}</p>
            )}
          </div>
        )}
      </div>

      {/* Spreadsheet ID */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          <FileSpreadsheet size={12} className="inline mr-1.5 -mt-0.5" />
          Spreadsheet ID
        </label>
        <div className="flex gap-2">
          <input
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            className="flex-1 min-w-0 bg-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white
                       placeholder-zinc-600 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSaveId}
            disabled={sheetId.trim() === googleConfig.spreadsheetId && !idSaved}
            className={[
              'rounded-xl px-4 py-2.5 text-sm font-bold transition-colors shrink-0',
              idSaved
                ? 'bg-green-600 text-white'
                : sheetId.trim() !== googleConfig.spreadsheetId
                ? 'bg-blue-600 text-white active:bg-blue-700'
                : 'bg-zinc-800 text-zinc-600',
            ].join(' ')}
          >
            {idSaved ? '✓' : 'Guardar'}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          El ID aparece en la URL de tu hoja, entre /d/ y /edit.
        </p>
      </div>

      {/* Botón de sincronización */}
      {isAuthenticated && (
        <div className="flex flex-col gap-2 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Sincronizar ahora</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {pendientes > 0
                  ? `${pendientes} registro${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}`
                  : 'Todo sincronizado'}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncEstado === 'working' || !googleConfig.spreadsheetId.trim()}
              className={[
                'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors shrink-0',
                syncEstado === 'working'
                  ? 'bg-zinc-700 text-zinc-400'
                  : googleConfig.spreadsheetId.trim()
                  ? 'bg-blue-600 text-white active:bg-blue-700'
                  : 'bg-zinc-800 text-zinc-600',
              ].join(' ')}
            >
              <RefreshCw size={15} className={syncEstado === 'working' ? 'animate-spin' : ''} />
              {syncEstado === 'working' ? 'Sincronizando…' : 'Sincronizar'}
            </button>
          </div>

          {/* Estado de la sincronización */}
          {syncEstado === 'idle' && (
            <p className="text-xs text-zinc-500 px-1">
              {googleConfig.spreadsheetId.trim()
                ? 'Listo para sincronizar'
                : 'Guarda el Spreadsheet ID para sincronizar'}
            </p>
          )}
          {syncEstado === 'working' && (
            <p className="text-xs text-zinc-400 px-1">Sincronizando…</p>
          )}
          {(syncEstado === 'ok' || syncEstado === 'error') && syncMsg && (
            <div className={[
              'flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs',
              syncEstado === 'ok'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400',
            ].join(' ')}>
              {syncEstado === 'ok'
                ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                : <AlertCircle  size={14} className="shrink-0 mt-0.5" />}
              <span>{syncMsg}</span>
            </div>
          )}

          {/* Importar historial */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
            <div>
              <p className="text-sm font-semibold text-white">Importar historial</p>
              <p className="text-xs text-zinc-500 mt-0.5">Reemplaza el historial local con los datos del sheet</p>
            </div>
            <button
              onClick={handleImport}
              disabled={importEstado === 'working' || !googleConfig.spreadsheetId.trim()}
              className={[
                'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors shrink-0',
                importEstado === 'working'
                  ? 'bg-zinc-700 text-zinc-400'
                  : googleConfig.spreadsheetId.trim()
                  ? 'bg-violet-600 text-white active:bg-violet-700'
                  : 'bg-zinc-800 text-zinc-600',
              ].join(' ')}
            >
              <RefreshCw size={15} className={importEstado === 'working' ? 'animate-spin' : ''} />
              {importEstado === 'working' ? 'Importando…' : 'Importar historial desde Sheets'}
            </button>
          </div>
          {(importEstado === 'ok' || importEstado === 'error') && importMsg && (
            <div className={[
              'flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs',
              importEstado === 'ok'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400',
            ].join(' ')}>
              {importEstado === 'ok'
                ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                : <AlertCircle  size={14} className="shrink-0 mt-0.5" />}
              <span>{importMsg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SeccionGestionUsuarios ────────────────────────────────────────────────────

function SeccionGestionUsuarios() {
  const navigate = useNavigate()

  const handleCerrarSesion = () => {
    cerrarSesionLocal()
    navigate('/login', { replace: true })
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
      {/* Fila: administrar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0">
            <Users size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Administrar usuarios</p>
            <p className="text-xs text-zinc-500 mt-0.5">Crear, editar y eliminar usuarios</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/admin/usuarios')}
          className="flex items-center gap-2 bg-red-800 text-white text-sm font-bold
                     px-4 py-2.5 rounded-xl active:bg-red-900 transition-colors shrink-0"
        >
          <ChevronRight size={16} />
          Gestionar
        </button>
      </div>

      {/* Fila: cerrar sesión */}
      <div className="border-t border-zinc-800 pt-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-white">Cerrar sesión</p>
          <p className="text-xs text-zinc-500 mt-0.5">Volver a la pantalla de acceso</p>
        </div>
        <button
          onClick={handleCerrarSesion}
          className="flex items-center gap-2 bg-zinc-800 text-zinc-300 text-sm font-bold
                     px-4 py-2.5 rounded-xl active:bg-zinc-700 transition-colors shrink-0"
        >
          <LogOut size={15} />
          Salir
        </button>
      </div>
    </div>
  )
}

// ── SeccionDiagnostico ────────────────────────────────────────────────────────

interface LocalStorageInfo {
  tieneClaveNueva:  boolean
  tieneClaveVieja:  boolean
  sesiones:         number
  pesos:            number
  ultimaFecha:      string | null
  bytesNuevo:       number
  bytesViejo:       number
  preview200Nuevo:  string
  preview200Viejo:  string
  error?:           string
}

function leerLocalStorageDirecto(): LocalStorageInfo {
  try {
    const rawNuevo = localStorage.getItem('fitlog-store-ruben') ?? ''
    const rawViejo = localStorage.getItem('fitlog-store') ?? ''

    let sesiones: { fecha: string }[] = []
    let pesos:    unknown[]           = []
    let ultimaFecha: string | null    = null

    if (rawNuevo) {
      const parsed = JSON.parse(rawNuevo)
      sesiones    = parsed?.state?.historialSesiones ?? []
      pesos       = parsed?.state?.registrosPeso      ?? []
      ultimaFecha = sesiones.length > 0
        ? [...sesiones].sort((a, b) => b.fecha.localeCompare(a.fecha))[0].fecha
        : null
    }

    return {
      tieneClaveNueva:  rawNuevo.length > 0,
      tieneClaveVieja:  rawViejo.length > 0,
      sesiones:         sesiones.length,
      pesos:            pesos.length,
      ultimaFecha,
      bytesNuevo:       rawNuevo.length,
      bytesViejo:       rawViejo.length,
      preview200Nuevo:  rawNuevo.slice(0, 200),
      preview200Viejo:  rawViejo.slice(0, 200),
    }
  } catch (e) {
    return {
      tieneClaveNueva: false, tieneClaveVieja: false,
      sesiones: 0, pesos: 0, ultimaFecha: null,
      bytesNuevo: 0, bytesViejo: 0,
      preview200Nuevo: '', preview200Viejo: '',
      error: String(e),
    }
  }
}

function SeccionDiagnostico() {
  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso     = useFitLogStore(useShallow((s) => s.registrosPeso))
  const [abierto, setAbierto] = useState(false)
  const [lsInfo,  setLsInfo]  = useState<LocalStorageInfo | null>(null)

  const totalSesiones   = historialSesiones.length
  const pendientesSync  = historialSesiones.filter((s) => !s.sincronizado).length
  const pendientesPeso  = registrosPeso.filter((r) => !r.sincronizado).length

  const ultimaSesion = historialSesiones.length > 0
    ? [...historialSesiones].sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    : null

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center justify-between gap-3 w-full"
      >
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-violet-900/30 flex items-center justify-center shrink-0">
            <Database size={16} className="text-violet-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-white">Diagnóstico de datos</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {totalSesiones} sesiones · {pendientesSync + pendientesPeso} pendientes
            </p>
          </div>
        </div>
        <ChevronRight
          size={16}
          className={['text-zinc-600 transition-transform shrink-0', abierto ? 'rotate-90' : ''].join(' ')}
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 pt-1 border-t border-zinc-800">

          {/* Resumen numérico */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Sesiones',   value: totalSesiones,             color: 'text-blue-400' },
              { label: 'Pend. sesión', value: pendientesSync,          color: pendientesSync  > 0 ? 'text-amber-400' : 'text-green-400' },
              { label: 'Pend. peso', value: pendientesPeso,            color: pendientesPeso  > 0 ? 'text-amber-400' : 'text-green-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-zinc-800 rounded-xl p-3 flex flex-col items-center gap-1">
                <span className={['text-xl font-black tabular-nums', color].join(' ')}>{value}</span>
                <span className="text-[10px] text-zinc-500 text-center">{label}</span>
              </div>
            ))}
          </div>

          {/* Última sesión */}
          {ultimaSesion ? (
            <div className="bg-zinc-800 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-zinc-300">Última sesión guardada</p>
                <span className={[
                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                  ultimaSesion.sincronizado
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-amber-500/15 text-amber-400',
                ].join(' ')}>
                  {ultimaSesion.sincronizado ? 'Sincronizada' : 'Pendiente'}
                </span>
              </div>
              <p className="text-xs text-zinc-500 tabular-nums">{ultimaSesion.fecha} · Día {ultimaSesion.dia}</p>
              <ul className="flex flex-col gap-1">
                {ultimaSesion.ejercicios.filter((e) => e.completado && !e.saltado).map((ej) => (
                  <li key={ej.ejercicioId} className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="text-zinc-600 shrink-0">·</span>
                    <span>{ej.nombreSustituido ?? ej.nombreSnapshot}</span>
                    <span className="text-zinc-600 tabular-nums ml-auto">{ej.series.length} series</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-zinc-600 text-center py-2">No hay sesiones guardadas</p>
          )}

          {/* Leer localStorage directamente */}
          <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
            <button
              onClick={() => setLsInfo(leerLocalStorageDirecto())}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-800
                         py-3 text-sm font-bold text-zinc-300 active:bg-zinc-700 transition-colors"
            >
              <Database size={14} />
              Ver datos en localStorage
              <span className={[
                'ml-auto text-xs tabular-nums font-normal',
                (localStorage.getItem('fitlog-store-ruben') ?? '').length > 0
                  ? 'text-green-500'
                  : 'text-red-500',
              ].join(' ')}>
                {(localStorage.getItem('fitlog-store-ruben') ?? '').length > 0
                  ? `${(localStorage.getItem('fitlog-store-ruben') ?? '').length} chars`
                  : '⚠ VACÍO'}
              </span>
            </button>

            {lsInfo && (
              <div className="bg-zinc-800 rounded-xl p-3 flex flex-col gap-2">
                {lsInfo.error ? (
                  <p className="text-xs text-red-400 font-mono break-all">{lsInfo.error}</p>
                ) : (
                  <>
                    <FilaLS
                      label="fitlog-store-ruben"
                      value={lsInfo.tieneClaveNueva ? 'SÍ' : 'NO'}
                      ok={lsInfo.tieneClaveNueva}
                    />
                    <FilaLS
                      label="fitlog-store (antigua)"
                      value={lsInfo.tieneClaveVieja ? 'SÍ' : 'NO'}
                      ok={lsInfo.tieneClaveVieja}
                      dimIfNo
                    />
                    <FilaLS
                      label="Sesiones guardadas"
                      value={String(lsInfo.sesiones)}
                      ok={lsInfo.sesiones > 0}
                    />
                    <FilaLS
                      label="Registros de peso"
                      value={String(lsInfo.pesos)}
                      ok={lsInfo.pesos > 0}
                    />
                    <FilaLS
                      label="Última sesión"
                      value={lsInfo.ultimaFecha ?? '—'}
                      ok={!!lsInfo.ultimaFecha}
                    />
                    <FilaLS
                      label="Tamaño fitlog-store-ruben"
                      value={lsInfo.bytesNuevo > 0 ? `${lsInfo.bytesNuevo} chars` : '(vacío)'}
                      ok={lsInfo.bytesNuevo > 0}
                    />
                    <FilaLS
                      label="Tamaño fitlog-store (antigua)"
                      value={lsInfo.bytesViejo > 0 ? `${lsInfo.bytesViejo} chars` : '(vacío)'}
                      ok={lsInfo.bytesViejo > 0}
                      dimIfNo
                    />
                    {lsInfo.bytesNuevo > 0 && (
                      <div className="flex flex-col gap-1 pt-1 border-t border-zinc-700">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                          fitlog-store-ruben (primeros 200 chars)
                        </p>
                        <p className="text-[10px] text-zinc-400 font-mono break-all leading-relaxed">
                          {lsInfo.preview200Nuevo}
                        </p>
                      </div>
                    )}
                    {lsInfo.bytesViejo > 0 && (
                      <div className="flex flex-col gap-1 pt-1 border-t border-zinc-700">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                          fitlog-store (primeros 200 chars)
                        </p>
                        <p className="text-[10px] text-zinc-400 font-mono break-all leading-relaxed">
                          {lsInfo.preview200Viejo}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

function FilaLS({ label, value, ok, dimIfNo }: { label: string; value: string; ok: boolean; dimIfNo?: boolean }) {
  const color = dimIfNo && !ok ? 'text-zinc-600' : ok ? 'text-green-400' : 'text-red-400'
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={['text-xs font-bold font-mono', color].join(' ')}>{value}</span>
    </div>
  )
}

// ── SeccionDiagnosticoNombres ─────────────────────────────────────────────────

function SeccionDiagnosticoNombres() {
  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const ejercicios        = useFitLogStore(useShallow((s) => s.ejercicios))
  const [abierto, setAbierto] = useState(false)

  const diagnostico = useMemo(() => {
    // Nombres únicos en historial (nombreSustituido ?? nombreSnapshot)
    const setHistorial = new Set<string>()
    for (const ses of historialSesiones) {
      for (const ej of ses.ejercicios) {
        if (!ej.completado || ej.saltado) continue
        const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
        if (nombre) setHistorial.add(nombre)
      }
    }
    const nombresHistorial = Array.from(setHistorial).sort()

    // Nombres en la configuración actual
    const nombresConfig = ejercicios.map((e) => e.nombre).sort()
    const normConfig = new Set(nombresConfig.map(normalizarNombre))

    // Sin match: nombres del historial que ni siquiera tras normalizar coinciden con algún ejercicio de config
    const sinMatch: string[] = []
    for (const nh of nombresHistorial) {
      const normH = normalizarNombre(nh)
      if (!normConfig.has(normH)) {
        sinMatch.push(nh)
      }
    }

    return { nombresHistorial, nombresConfig, sinMatch }
  }, [historialSesiones, ejercicios])

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center justify-between gap-3 w-full"
      >
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-amber-900/30 flex items-center justify-center shrink-0">
            <AlertCircle size={16} className="text-amber-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-white">Matching de nombres</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {diagnostico.nombresHistorial.length} en historial · {diagnostico.nombresConfig.length} en config · {diagnostico.sinMatch.length} sin match
            </p>
          </div>
        </div>
        <ChevronRight
          size={16}
          className={['text-zinc-600 transition-transform shrink-0', abierto ? 'rotate-90' : ''].join(' ')}
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-4 pt-2 border-t border-zinc-800">

          {/* Sin match (problemáticos) */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-400">
              Sin match — problemáticos ({diagnostico.sinMatch.length})
            </p>
            {diagnostico.sinMatch.length === 0 ? (
              <p className="text-xs text-green-400">Todos los nombres del historial tienen match con la configuración.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {diagnostico.sinMatch.map((nombre) => (
                  <li key={nombre} className="flex items-start gap-2 text-xs">
                    <span className="text-red-500 shrink-0 mt-0.5">✗</span>
                    <span className="text-red-300 font-mono break-all">{nombre}</span>
                    <span className="text-zinc-600 ml-auto shrink-0 font-mono">→ {normalizarNombre(nombre)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Nombres en historial */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">
              Nombres en historial ({diagnostico.nombresHistorial.length})
            </p>
            <ul className="flex flex-col gap-0.5 max-h-60 overflow-y-auto">
              {diagnostico.nombresHistorial.map((nombre) => {
                const normH = normalizarNombre(nombre)
                const tieneMatch = ejercicios.some((e) => normalizarNombre(e.nombre) === normH)
                return (
                  <li key={nombre} className="flex items-center gap-2 text-xs">
                    <span className={tieneMatch ? 'text-green-500' : 'text-red-500'}>
                      {tieneMatch ? '✓' : '✗'}
                    </span>
                    <span className={['font-mono break-all', tieneMatch ? 'text-zinc-400' : 'text-red-300'].join(' ')}>
                      {nombre}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Nombres en configuración */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
              Nombres en configuración ({diagnostico.nombresConfig.length})
            </p>
            <ul className="flex flex-col gap-0.5">
              {diagnostico.nombresConfig.map((nombre, i) => (
                <li key={`${nombre}-${i}`} className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="text-emerald-500 shrink-0">·</span>
                  <span className="font-mono break-all">{nombre}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}
    </div>
  )
}

// ── SeccionBackupRestore ──────────────────────────────────────────────────────

interface BackupData {
  version:              string
  exportDate:           string
  historialSesiones:    Sesion[]
  registrosPeso:        RegistroPeso[]
  ejercicios:           Ejercicio[]
  historialComposicion: RegistroComposicion[]
  perfilCorporal:       PerfilCorporal | null
}

function SeccionBackupRestore() {
  const historialSesiones    = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso        = useFitLogStore(useShallow((s) => s.registrosPeso))
  const ejercicios           = useFitLogStore(useShallow((s) => s.ejercicios))
  const historialComposicion = useFitLogStore(useShallow((s) => s.historialComposicion))
  const perfilCorporal       = useFitLogStore((s) => s.perfilCorporal)

  const [restoreData,  setRestoreData]  = useState<BackupData | null>(null)
  const [restoreError, setRestoreError] = useState('')
  const [restoreOk,    setRestoreOk]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Descargar ──────────────────────────────────────────────────────────────

  const handleDescargar = () => {
    const now  = new Date()
    const dd   = String(now.getDate()).padStart(2, '0')
    const mm   = String(now.getMonth() + 1).padStart(2, '0')
    const aaaa = String(now.getFullYear())
    const nombre = `backup_diario_entreno_${dd}${mm}${aaaa}.json`

    const datos: BackupData = {
      version: APP_VERSION,
      exportDate: now.toISOString(),
      historialSesiones,
      registrosPeso,
      ejercicios,
      historialComposicion,
      perfilCorporal,
    }

    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = nombre
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Leer archivo ───────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRestoreData(null)
    setRestoreError('')
    setRestoreOk(false)
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as Partial<BackupData>
        if (!Array.isArray(parsed.historialSesiones) || !Array.isArray(parsed.registrosPeso)) {
          setRestoreError('El archivo no tiene la estructura correcta (faltan historialSesiones o registrosPeso).')
          return
        }
        setRestoreData(parsed as BackupData)
      } catch {
        setRestoreError('No se pudo leer el archivo. ¿Es un JSON válido?')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Restaurar ──────────────────────────────────────────────────────────────

  const handleConfirmar = () => {
    if (!restoreData) return
    useFitLogStore.setState({
      historialSesiones:    restoreData.historialSesiones,
      registrosPeso:        restoreData.registrosPeso,
      ...(Array.isArray(restoreData.ejercicios)
        ? { ejercicios: restoreData.ejercicios } : {}),
      ...(Array.isArray(restoreData.historialComposicion)
        ? { historialComposicion: restoreData.historialComposicion } : {}),
      ...(restoreData.perfilCorporal != null
        ? { perfilCorporal: restoreData.perfilCorporal } : {}),
    })
    setRestoreOk(true)
    setRestoreData(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Copia de seguridad</p>

      {/* Descargar */}
      <button
        onClick={handleDescargar}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-800
                   py-3 text-sm font-bold text-zinc-200 active:bg-zinc-700 transition-colors"
      >
        💾 Descargar copia de seguridad
      </button>

      {/* Restaurar */}
      <button
        onClick={() => { setRestoreData(null); setRestoreError(''); setRestoreOk(false); fileRef.current?.click() }}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-800
                   py-3 text-sm font-bold text-zinc-200 active:bg-zinc-700 transition-colors"
      >
        📥 Restaurar copia de seguridad
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Error de lectura */}
      {restoreError && (
        <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5">
          <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{restoreError}</p>
        </div>
      )}

      {/* Éxito restauración */}
      {restoreOk && (
        <div className="flex items-start gap-2 rounded-xl bg-green-500/10 px-3 py-2.5">
          <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
          <p className="text-xs text-green-400">Datos restaurados correctamente.</p>
        </div>
      )}

      {/* Preview + confirmación */}
      {restoreData && (
        <div className="flex flex-col gap-2 rounded-xl bg-zinc-800 px-3 py-3">
          <p className="text-xs font-bold text-white">Archivo válido — contenido detectado:</p>
          <p className="text-xs text-zinc-300">
            {restoreData.historialSesiones.length} sesiones
            {' · '}
            {restoreData.registrosPeso.length} registros de peso
            {Array.isArray(restoreData.ejercicios) ? ` · ${restoreData.ejercicios.length} ejercicios` : ''}
            {Array.isArray(restoreData.historialComposicion) && restoreData.historialComposicion.length > 0
              ? ` · ${restoreData.historialComposicion.length} composición corporal`
              : ''}
          </p>
          {restoreData.exportDate && (
            <p className="text-xs text-zinc-500">
              Exportado el {new Date(restoreData.exportDate).toLocaleString('es-ES')}
            </p>
          )}
          <p className="text-xs text-amber-400">
            ⚠ Esto sobreescribirá los datos actuales. ¿Continuar?
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleConfirmar}
              className="flex-1 rounded-xl bg-red-700 py-2.5 text-sm font-bold text-white active:bg-red-800"
            >
              Sí, restaurar
            </button>
            <button
              onClick={() => { setRestoreData(null); setRestoreError('') }}
              className="flex-1 rounded-xl bg-zinc-700 py-2.5 text-sm font-bold text-zinc-300 active:bg-zinc-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SeccionExportarIA ─────────────────────────────────────────────────────────

type PeriodoIA = 'todo' | '1a' | '6m' | '3m' | '1m'

const PERIODOS_IA: { id: PeriodoIA; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: '1a',   label: '1 año' },
  { id: '6m',   label: '6 meses' },
  { id: '3m',   label: '3 meses' },
  { id: '1m',   label: '1 mes' },
]

function epley1RM(peso: number, reps: number): number {
  return reps <= 1 ? peso : peso * (1 + reps / 30)
}

function fmtFechaIA(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function SeccionExportarIA() {
  const historialSesiones    = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso        = useFitLogStore(useShallow((s) => s.registrosPeso))
  const historialComposicion = useFitLogStore(useShallow((s) => s.historialComposicion))
  const historialMedidas     = useFitLogStore(useShallow((s) => s.historialMedidas))
  const perfilCorporal       = useFitLogStore((s) => s.perfilCorporal)
  const usuarioActivo        = getUsuarioActivo()

  const [periodo, setPeriodo] = useState<PeriodoIA>('todo')
  const [copiado, setCopiado] = useState(false)

  const fechaCorte = useMemo((): string | null => {
    if (periodo === 'todo') return null
    const hoy   = new Date()
    const meses = periodo === '1a' ? 12 : periodo === '6m' ? 6 : periodo === '3m' ? 3 : 1
    hoy.setMonth(hoy.getMonth() - meses)
    return hoy.toISOString().slice(0, 10)
  }, [periodo])

  const sesionesFiltradas = useMemo(() =>
    historialSesiones
      .filter((s) => !fechaCorte || s.fecha >= fechaCorte)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [historialSesiones, fechaCorte])

  const pesosFiltrados = useMemo(() =>
    registrosPeso
      .filter((r) => !fechaCorte || r.fecha >= fechaCorte)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [registrosPeso, fechaCorte])

  const composicionFiltrada = useMemo(() =>
    historialComposicion
      .filter((c) => !fechaCorte || c.fecha >= fechaCorte)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [historialComposicion, fechaCorte])

  const medidasFiltradas = useMemo(() =>
    historialMedidas
      .filter((m) => !fechaCorte || m.fecha >= fechaCorte)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [historialMedidas, fechaCorte])

  // Récords sobre todo el historial (no solo el periodo filtrado)
  const records = useMemo(() => {
    const map: Record<string, { peso: number; reps: number; rm1: number; fecha: string }> = {}
    for (const ses of historialSesiones) {
      for (const ej of ses.ejercicios) {
        if (!ej.completado || ej.saltado) continue
        const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
        for (const sr of ej.series) {
          const p = Number(sr.pesoKg), r = Number(sr.reps)
          if (!p || !r) continue
          const rm1 = epley1RM(p, r)
          const prev = map[nombre]
          if (!prev || rm1 > prev.rm1) map[nombre] = { peso: p, reps: r, rm1, fecha: ses.fecha }
        }
      }
    }
    return map
  }, [historialSesiones])

  const volTotal = useMemo(() =>
    sesionesFiltradas.reduce((acc, ses) =>
      acc + ses.ejercicios
        .filter((e) => e.completado && !e.saltado)
        .reduce((a, ej) =>
          a + ej.series.reduce((s, sr) => {
            const r = Number(sr.reps), p = Number(sr.pesoKg)
            return s + (r && p ? r * p : 0)
          }, 0), 0), 0),
    [sesionesFiltradas])

  const generarTexto = (): string => {
    const nombre      = usuarioActivo?.nombre ?? 'Usuario'
    const periodoLabel = PERIODOS_IA.find((p) => p.id === periodo)?.label ?? 'Todo'
    const lines: string[] = []

    lines.push('=== DATOS DE ENTRENAMIENTO DE FUERZA PARA ANÁLISIS ===')
    lines.push(`Usuario: ${nombre}`)
    lines.push(`Periodo exportado: ${periodoLabel}`)
    lines.push(`Fecha de exportación: ${new Date().toLocaleDateString('es-ES')}`)
    lines.push('Propósito: análisis de progreso, evolución de cargas y tendencias de rendimiento.')
    lines.push('')

    // Perfil
    if (perfilCorporal?.edad || perfilCorporal?.alturaCm || perfilCorporal?.sexo) {
      lines.push('--- PERFIL ---')
      if (perfilCorporal.edad)     lines.push(`Edad: ${perfilCorporal.edad} años`)
      if (perfilCorporal.alturaCm) lines.push(`Altura: ${perfilCorporal.alturaCm} cm`)
      if (perfilCorporal.sexo)     lines.push(`Sexo: ${perfilCorporal.sexo}`)
      lines.push('')
    }

    // Sesiones
    lines.push(`--- SESIONES DE ENTRENAMIENTO (${sesionesFiltradas.length} total) ---`)
    for (const ses of sesionesFiltradas) {
      const diaLabel = ses.dia === 'parcial' ? 'Parcial'
                     : ses.dia === 'extra'   ? 'Extra'
                     : `Día ${ses.dia}`
      const ejsActivos = ses.ejercicios.filter((e) => e.completado && !e.saltado)
      if (ejsActivos.length === 0) continue
      lines.push('')
      lines.push(`[${fmtFechaIA(ses.fecha)}] ${diaLabel}`)
      let volSesion = 0
      for (const ej of ejsActivos) {
        const ejNombre = ej.nombreSustituido ?? ej.nombreSnapshot
        const seriesConDatos = ej.series.filter((s) => s.reps !== '' && s.pesoKg !== '')
        const seriesStr = seriesConDatos.map((s) => {
          const et = s.etiqueta === 'fallo' ? ' [Fallo]'
                   : s.etiqueta === 'rir0'  ? ' [RIR0]'
                   : s.etiqueta === 'rir1'  ? ' [RIR1]' : ''
          return `${s.reps}r×${s.pesoKg}kg${et}`
        }).join(' | ')
        const volEj = ej.series.reduce((acc, s) => {
          const r = Number(s.reps), p = Number(s.pesoKg)
          return acc + (r && p ? r * p : 0)
        }, 0)
        volSesion += volEj
        lines.push(`  ${ejNombre}: ${seriesStr || '—'} (vol: ${Math.round(volEj)} kg)`)
      }
      lines.push(`  → Volumen sesión: ${Math.round(volSesion)} kg`)
    }
    lines.push('')

    // Récords personales
    const recs = Object.entries(records).sort((a, b) => a[0].localeCompare(b[0]))
    if (recs.length > 0) {
      lines.push('--- RÉCORDS PERSONALES (histórico completo) ---')
      for (const [ejNombre, r] of recs) {
        lines.push(`  ${ejNombre}: ${r.peso}kg×${r.reps}r  (1RM est.: ${Math.round(r.rm1)} kg) — ${fmtFechaIA(r.fecha)}`)
      }
      lines.push('')
    }

    // Peso corporal
    if (pesosFiltrados.length > 0) {
      lines.push(`--- REGISTROS DE PESO CORPORAL (${pesosFiltrados.length} total) ---`)
      for (const r of pesosFiltrados) {
        lines.push(`  ${fmtFechaIA(r.fecha)}: ${r.pesoKg} kg`)
      }
      if (pesosFiltrados.length >= 2) {
        const diff = pesosFiltrados[pesosFiltrados.length - 1].pesoKg - pesosFiltrados[0].pesoKg
        lines.push(`  Tendencia: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg en el periodo`)
      }
      lines.push('')
    }

    // Composición corporal
    if (composicionFiltrada.length > 0) {
      lines.push('--- COMPOSICIÓN CORPORAL ---')
      for (const c of composicionFiltrada) {
        lines.push(`  ${fmtFechaIA(c.fecha)}: ${c.pesoKg} kg | IMC: ${c.imc.toFixed(1)} (${c.categoriaImc}) | Grasa: ${c.pctGrasa.toFixed(1)}% | Músculo: ${c.pctMusculo.toFixed(1)}%`)
      }
      lines.push('')
    }

    // Medidas corporales
    if (medidasFiltradas.length > 0) {
      lines.push(`--- MEDIDAS CORPORALES (${medidasFiltradas.length} total) ---`)
      for (const m of medidasFiltradas) {
        const partes: string[] = []
        if (m.cuello)          partes.push(`Cuello: ${m.cuello}`)
        if (m.hombro)          partes.push(`Hombro: ${m.hombro}`)
        if (m.pecho)           partes.push(`Pecho: ${m.pecho}`)
        if (m.bicepsIzq)       partes.push(`Bíceps Izq: ${m.bicepsIzq}`)
        if (m.bicepsDer)       partes.push(`Bíceps Der: ${m.bicepsDer}`)
        if (m.cinturaAlta)     partes.push(`Cintura alta: ${m.cinturaAlta}`)
        if (m.cinturaBaja)     partes.push(`Cintura baja: ${m.cinturaBaja}`)
        if (m.abdomen)         partes.push(`Abdomen: ${m.abdomen}`)
        if (m.cadera)          partes.push(`Cadera: ${m.cadera}`)
        if (m.musloIzq)        partes.push(`Muslo Izq: ${m.musloIzq}`)
        if (m.musloDer)        partes.push(`Muslo Der: ${m.musloDer}`)
        if (m.pantorrillaIzq)  partes.push(`Pantorrilla Izq: ${m.pantorrillaIzq}`)
        if (m.pantorrillaDer)  partes.push(`Pantorrilla Der: ${m.pantorrillaDer}`)
        lines.push(`  ${fmtFechaIA(m.fecha)}: ${partes.join(' | ')} (cm)`)
      }
      lines.push('')
    }

    // Resumen final
    lines.push('--- RESUMEN DEL PERIODO ---')
    lines.push(`Total de sesiones: ${sesionesFiltradas.length}`)
    lines.push(`Volumen total del periodo: ${Math.round(volTotal).toLocaleString('es-ES')} kg`)
    if (pesosFiltrados.length >= 2) {
      const p0   = pesosFiltrados[0].pesoKg
      const pN   = pesosFiltrados[pesosFiltrados.length - 1].pesoKg
      const diff = pN - p0
      lines.push(`Evolución de peso corporal: de ${p0} kg a ${pN} kg (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg)`)
    }
    lines.push('')
    lines.push('=== FIN DE DATOS ===')

    return lines.join('\n')
  }

  const generarJSON = () => ({
    exportVersion: '1.0',
    exportDate:    new Date().toISOString(),
    usuario:       usuarioActivo?.nombre ?? 'Usuario',
    periodo:       PERIODOS_IA.find((p) => p.id === periodo)?.label,
    perfil:        perfilCorporal,
    sesiones: sesionesFiltradas.map((ses) => ({
      id:    ses.id,
      fecha: ses.fecha,
      dia:   ses.dia,
      ejercicios: ses.ejercicios
        .filter((e) => e.completado && !e.saltado)
        .map((ej) => {
          const volEj = ej.series.reduce((acc, s) => {
            const r = Number(s.reps), p = Number(s.pesoKg)
            return acc + (r && p ? r * p : 0)
          }, 0)
          return {
            nombre:  ej.nombreSustituido ?? ej.nombreSnapshot,
            series:  ej.series.filter((s) => s.reps !== '' && s.pesoKg !== '').map((s) => ({
              numero:   s.numero,
              reps:     s.reps,
              pesoKg:   s.pesoKg,
              etiqueta: s.etiqueta ?? null,
            })),
            volumenKg: Math.round(volEj),
          }
        }),
      volumenTotalKg: Math.round(
        ses.ejercicios.filter((e) => e.completado && !e.saltado).reduce((acc, ej) =>
          acc + ej.series.reduce((s, sr) => {
            const r = Number(sr.reps), p = Number(sr.pesoKg)
            return s + (r && p ? r * p : 0)
          }, 0), 0)
      ),
    })),
    registrosPeso:       pesosFiltrados,
    composicionCorporal: composicionFiltrada,
    medidasCorporales:   medidasFiltradas,
    recordsPersonales:   Object.entries(records)
      .map(([ejNombre, r]) => ({
        ejercicio:     ejNombre,
        mejorPeso:     r.peso,
        mejorReps:     r.reps,
        rm1Estimado:   Math.round(r.rm1),
        fecha:         r.fecha,
      }))
      .sort((a, b) => a.ejercicio.localeCompare(b.ejercicio)),
  })

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(generarTexto())
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch { /* clipboard no disponible */ }
  }

  const handleDescargarJSON = () => {
    const now  = new Date()
    const dd   = String(now.getDate()).padStart(2, '0')
    const mm   = String(now.getMonth() + 1).padStart(2, '0')
    const aaaa = String(now.getFullYear())
    const blob = new Blob([JSON.stringify(generarJSON(), null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `fitlog_ia_${dd}${mm}${aaaa}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
      <p className="text-xs text-zinc-400 leading-relaxed">
        Exporta tus datos listos para pegar en ChatGPT, Claude u otras IAs y que analicen tu progreso.
      </p>

      {/* Selector de periodo */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Periodo</p>
        <div className="flex gap-2 flex-wrap">
          {PERIODOS_IA.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPeriodo(id)}
              className={[
                'px-3.5 py-2 rounded-xl text-sm font-bold transition-colors',
                periodo === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600">
          {sesionesFiltradas.length} sesión{sesionesFiltradas.length !== 1 ? 'es' : ''}
          {pesosFiltrados.length > 0 ? ` · ${pesosFiltrados.length} registros de peso` : ''}
          {medidasFiltradas.length > 0 ? ` · ${medidasFiltradas.length} medidas` : ''}
        </p>
      </div>

      {/* Botones */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleCopiar}
          className={[
            'w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 font-bold text-sm transition-colors',
            copiado ? 'bg-green-600 text-white' : 'bg-blue-600 text-white active:bg-blue-700',
          ].join(' ')}
        >
          {copiado ? '✅ Copiado' : '🤖 Copiar para IA'}
        </button>
        <button
          onClick={handleDescargarJSON}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-800
                     py-3.5 text-sm font-bold text-zinc-200 active:bg-zinc-700 transition-colors"
        >
          📥 Descargar JSON
        </button>
      </div>
    </div>
  )
}

// ── SeccionVersion ────────────────────────────────────────────────────────────

const TIPO_BADGE: Record<string, { label: string; color: string }> = {
  mayor:  { label: 'Mayor',  color: 'bg-blue-500/15 text-blue-400' },
  media:  { label: 'Mejora', color: 'bg-violet-500/15 text-violet-400' },
  menor:  { label: 'Fix',    color: 'bg-zinc-700 text-zinc-400' },
}

// ── SeccionSyncPendientes ─────────────────────────────────────────────────────

function SeccionSyncPendientes() {
  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso     = useFitLogStore(useShallow((s) => s.registrosPeso))
  const [estado,       setEstado]       = useState<'idle' | 'cargando' | 'ok' | 'error'>('idle')
  const [mensaje,      setMensaje]      = useState('')
  const [recargando,   setRecargando]   = useState(false)
  const [msgRecarga,   setMsgRecarga]   = useState('')

  const pendientes =
    historialSesiones.filter((s) => !s.sincronizado).length +
    registrosPeso.filter((r) => !r.sincronizado).length

  const handleForzar = async () => {
    setEstado('cargando')
    setMensaje('')
    try {
      const usuario = getUsuarioActivo()
      const uid = usuario?.esRuben ? getRubenUUID() : (usuario?.id ?? '')
      if (!uid) {
        setEstado('error')
        setMensaje('No hay usuario activo.')
        return
      }
      const { sesiones, pesos, errores } = await forzarSincronizacionPendientes(uid)
      const lineas = []
      if (sesiones > 0) lineas.push(`✅ ${sesiones} sesión${sesiones > 1 ? 'es' : ''} subida${sesiones > 1 ? 's' : ''}`)
      if (pesos   > 0) lineas.push(`✅ ${pesos} registro${pesos > 1 ? 's' : ''} de peso subido${pesos > 1 ? 's' : ''}`)
      if (sesiones === 0 && pesos === 0 && errores.length === 0)
        lineas.push('✅ No había nada pendiente.')
      errores.forEach((e) => lineas.push(`❌ ${e}`))
      setEstado(errores.length > 0 ? 'error' : 'ok')
      setMensaje(lineas.join('\n'))
    } catch (err) {
      setEstado('error')
      setMensaje((err as Error)?.message ?? 'Error desconocido')
    }
  }

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">
          Pendientes de subir a Supabase
        </p>
        <span className={[
          'text-xs font-bold px-2 py-0.5 rounded-full',
          pendientes > 0
            ? 'bg-amber-500/15 text-amber-400'
            : 'bg-green-500/15 text-green-400',
        ].join(' ')}>
          {pendientes > 0 ? `${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : 'Todo sincronizado'}
        </span>
      </div>
      <button
        onClick={handleForzar}
        disabled={estado === 'cargando'}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue-700 py-3 font-bold text-white text-sm active:bg-blue-800 disabled:opacity-50"
      >
        {estado === 'cargando'
          ? <RefreshCw size={15} className="animate-spin" />
          : <RefreshCw size={15} />}
        {estado === 'cargando' ? 'Subiendo…' : 'Forzar sincronización con Supabase'}
      </button>
      {(estado === 'ok' || estado === 'error') && mensaje && (
        <div className={[
          'flex items-start gap-2 rounded-xl px-3 py-2.5',
          estado === 'ok'
            ? 'bg-green-900/30 border border-green-700/40'
            : 'bg-red-900/30 border border-red-700/40',
        ].join(' ')}>
          {estado === 'ok'
            ? <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
            : <AlertCircle  size={14} className="text-red-400 shrink-0 mt-0.5" />}
          <p className={[
            'text-xs whitespace-pre-line',
            estado === 'ok' ? 'text-green-400' : 'text-red-400',
          ].join(' ')}>{mensaje}</p>
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
        <button
          onClick={async () => {
            setRecargando(true)
            setMsgRecarga('')
            try {
              const usuario = getUsuarioActivo()
              if (usuario?.esRuben) {
                setMsgRecarga('⛔ Rubén usa localStorage como fuente de verdad. Esta acción está bloqueada.')
                return
              }
              const uid = usuario?.id ?? ''
              if (!uid) { setMsgRecarga('❌ No hay usuario activo.'); return }
              const { sesiones, registrosPeso: pesos } = await cargarDatosUsuario(uid)
              useFitLogStore.getState().importarHistorialCompleto(sesiones, pesos)
              setMsgRecarga(`✅ ${sesiones.length} sesiones y ${pesos.length} registros de peso cargados.`)
            } catch (err) {
              setMsgRecarga(`❌ ${(err as Error)?.message ?? 'Error de conexión'}`)
            } finally {
              setRecargando(false)
            }
          }}
          disabled={recargando}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-700 py-3 font-bold text-white text-sm active:bg-zinc-600 disabled:opacity-50"
        >
          {recargando ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {recargando ? 'Cargando desde Supabase…' : 'Recargar datos desde Supabase'}
        </button>
        {msgRecarga && (
          <p className={['text-xs px-1', msgRecarga.startsWith('✅') ? 'text-green-400' : 'text-red-400'].join(' ')}>
            {msgRecarga}
          </p>
        )}
      </div>
    </div>
  )
}

// ── SeccionVerificarSupabase ──────────────────────────────────────────────────

function SeccionVerificarSupabase() {
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'ok' | 'error'>('idle')
  const [mensaje, setMensaje] = useState('')

  const verificar = async () => {
    setEstado('cargando')
    setMensaje('')
    const lineas: string[] = []
    let hayError = false
    try {
      // 1. SELECT usuarios — test de conexión básica
      const { data: usuarios, error: errSelect } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .limit(10)
      if (errSelect) {
        lineas.push(`❌ SELECT usuarios: ${errSelect.message}`)
        hayError = true
      } else {
        const nombres = (usuarios ?? []).map((u: { nombre: string }) => u.nombre).join(', ')
        lineas.push(`✅ SELECT usuarios OK — ${usuarios?.length ?? 0} usuarios: ${nombres || '(ninguno)'}`)
      }

      // 2. INSERT en entrenos — test RLS escritura
      const testId = crypto.randomUUID()
      const { error: errIns } = await supabase.from('entrenos').insert({
        usuario_id: testId,
        sesion_id: testId,
        fecha: '1970-01-01',
        dia: 'extra',
        ejercicio: '__test__',
        serie: 0,
      })
      if (errIns) {
        lineas.push(`❌ INSERT entrenos: ${errIns.message}`)
        hayError = true
      } else {
        lineas.push('✅ INSERT entrenos OK')

        // 3. DELETE — test RLS borrado
        const { error: errDel } = await supabase
          .from('entrenos')
          .delete()
          .eq('sesion_id', testId)
        if (errDel) {
          lineas.push(`❌ DELETE entrenos: ${errDel.message}`)
          hayError = true
        } else {
          lineas.push('✅ DELETE entrenos OK')
        }
      }
    } catch (err) {
      lineas.push(`❌ Error inesperado: ${(err as Error)?.message ?? 'desconocido'}`)
      hayError = true
    }
    setEstado(hayError ? 'error' : 'ok')
    setMensaje(lineas.join('\n'))
  }

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex flex-col gap-3">
      <p className="text-xs text-zinc-500 leading-relaxed">
        Comprueba la conexión con Supabase: SELECT de usuarios, INSERT y DELETE en entrenos. Si algo falla verás el error exacto de Supabase.
      </p>
      <button
        onClick={verificar}
        disabled={estado === 'cargando'}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-violet-700 py-3 font-bold text-white text-sm active:bg-violet-800 disabled:opacity-50"
      >
        {estado === 'cargando'
          ? <RefreshCw size={15} className="animate-spin" />
          : <CheckCircle2 size={15} />}
        {estado === 'cargando' ? 'Verificando…' : 'Verificar conexión Supabase'}
      </button>
      {(estado === 'ok' || estado === 'error') && mensaje && (
        <div className={[
          'flex items-start gap-2 rounded-xl px-3 py-2.5',
          estado === 'ok'
            ? 'bg-green-900/30 border border-green-700/40'
            : 'bg-red-900/30 border border-red-700/40',
        ].join(' ')}>
          {estado === 'ok'
            ? <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
            : <AlertCircle  size={14} className="text-red-400 shrink-0 mt-0.5" />}
          <p className={[
            'text-xs whitespace-pre-line break-all',
            estado === 'ok' ? 'text-green-400' : 'text-red-400',
          ].join(' ')}>{mensaje}</p>
        </div>
      )}
    </div>
  )
}

// ── SeccionBorrarCache ────────────────────────────────────────────────────────

function SeccionBorrarCache() {
  const [confirmando, setConfirmando] = useState(false)
  const [borrando,    setBorrando]    = useState(false)

  const handleBorrar = async () => {
    setBorrando(true)
    try {
      // 1. Limpiar todas las cachés del SW
      if ('caches' in window) {
        const nombres = await caches.keys()
        await Promise.all(nombres.map((n) => caches.delete(n)))
      }
      // 2. Desregistrar el service worker
      if ('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registros.map((r) => r.unregister()))
      }
    } catch { /* ignorar errores — recargar igualmente */ }
    // 3. Recargar con URL anti-caché:
    //    location.reload() no fuerza red en Safari iOS.
    //    Cambiar la URL con ?t=timestamp garantiza un GET real al servidor,
    //    descargando index.html fresco y activando el SW nuevo.
    const { origin, pathname } = window.location
    window.location.href = origin + pathname + '?t=' + Date.now()
  }

  if (confirmando) {
    return (
      <div className="bg-red-950/40 border border-red-800/50 rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-sm text-red-300 font-semibold">¿Borrar caché y reiniciar la app?</p>
        <p className="text-xs text-zinc-400">Se eliminarán todos los archivos en caché y el service worker. La app se recargará desde el servidor.</p>
        <div className="flex gap-2">
          <button
            onClick={handleBorrar}
            disabled={borrando}
            className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-bold text-white active:bg-red-700 disabled:opacity-50"
          >
            {borrando ? 'Borrando…' : 'Sí, borrar y reiniciar'}
          </button>
          <button
            onClick={() => setConfirmando(false)}
            className="flex-1 rounded-xl bg-zinc-700 py-2 text-sm font-bold text-white active:bg-zinc-600"
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-800 border border-zinc-700 py-3 text-sm font-bold text-zinc-300 active:bg-zinc-700"
    >
      🔄 Borrar caché y reiniciar app
    </button>
  )
}

// ── SeccionVersion ────────────────────────────────────────────────────────────

function SeccionVersion() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col items-center gap-2 pt-2 pb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
      >
        {open ? 'Ocultar historial' : 'Historial de versiones'}
      </button>

      {open && (
        <div className="w-full max-w-xs flex flex-col gap-3 mt-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-600 text-center">
            Historial de versiones
          </p>
          {CHANGELOG.map((entrada) => {
            const badge = TIPO_BADGE[entrada.tipo] ?? TIPO_BADGE.menor
            return (
              <div
                key={entrada.version}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">v{entrada.version}</span>
                    <span className={['text-[10px] font-bold px-2 py-0.5 rounded-full', badge.color].join(' ')}>
                      {badge.label}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-600 tabular-nums">{entrada.fecha}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {entrada.cambios.map((cambio, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-600 shrink-0 mt-0.5">·</span>
                      {cambio}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SeccionSubidaRuben ────────────────────────────────────────────────────────

function SeccionSubidaRuben() {
  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso     = useFitLogStore(useShallow((s) => s.registrosPeso))

  const [subidaEstado,  setSubidaEstado]  = useState<'idle' | 'working' | 'ok' | 'error'>('idle')
  const [progreso,      setProgreso]      = useState(0)
  const [progresoMsg,   setProgresoMsg]   = useState('')
  const [resultMsg,     setResultMsg]     = useState('')

  const [verificaEstado, setVerificaEstado] = useState<'idle' | 'working' | 'ok' | 'error'>('idle')
  const [verificaMsg,    setVerificaMsg]    = useState('')

  const handleSubir = async () => {
    setSubidaEstado('working')
    setProgreso(0)
    setProgresoMsg('')
    setResultMsg('')
    try {
      const uuid = getRubenUUID()

      // 1. Garantizar que Rubén existe en la tabla usuarios
      setProgresoMsg('Verificando usuario en Supabase…')
      await asegurarUsuarioRuben(uuid)

      // 2. Borrar datos previos de Rubén
      setProgresoMsg('Borrando datos anteriores…')
      const { error: errDelEntrenos } = await supabase.from('entrenos').delete().eq('usuario_id', uuid)
      if (errDelEntrenos) throw errDelEntrenos
      const { error: errDelPesos } = await supabase.from('registros_peso').delete().eq('usuario_id', uuid)
      if (errDelPesos) throw errDelPesos

      // 3. Insertar sesiones (una por una para control de progreso)
      const totalSteps = historialSesiones.length + registrosPeso.length
      let done = 0

      for (const sesion of historialSesiones) {
        const rows = sesion.ejercicios.flatMap((ej) =>
          ej.series.map((serie) => ({
            usuario_id: uuid,
            sesion_id:  sesion.id,
            fecha:      sesion.fecha,
            dia:        String(sesion.dia),
            ejercicio:  ej.nombreSustituido ?? ej.nombreSnapshot,
            serie:      serie.numero,
            reps:       serie.reps   !== '' ? serie.reps   : null,
            peso_kg:    serie.pesoKg !== '' ? serie.pesoKg : null,
            etiqueta:   serie.etiqueta  ?? null,
            nota:       ej.notaSesion   || null,
            ayuda_fede: ej.ayudaFede    ?? false,
          })),
        )
        if (rows.length > 0) {
          const { error } = await supabase.from('entrenos').insert(rows)
          if (error) throw error
        }
        done++
        setProgreso(Math.round((done / totalSteps) * 100))
        setProgresoMsg(`Subiendo sesiones… ${done}/${historialSesiones.length}`)
      }

      // 4. Insertar registros de peso
      for (const registro of registrosPeso) {
        const { error } = await supabase.from('registros_peso').insert({
          usuario_id: uuid,
          fecha:      registro.fecha,
          peso_kg:    registro.pesoKg,
        })
        if (error) throw error
        done++
        const pesosDone = done - historialSesiones.length
        setProgreso(Math.round((done / totalSteps) * 100))
        setProgresoMsg(`Subiendo registros de peso… ${pesosDone}/${registrosPeso.length}`)
      }

      setProgreso(100)
      setSubidaEstado('ok')
      setResultMsg(`${historialSesiones.length} sesiones y ${registrosPeso.length} registros de peso subidos a Supabase`)
    } catch (err) {
      setSubidaEstado('error')
      const e = err as { message?: string; details?: string; hint?: string; code?: string }
      setResultMsg(
        [e?.message, e?.details && `Detalles: ${e.details}`, e?.hint && `Hint: ${e.hint}`, e?.code && `Código: ${e.code}`]
          .filter(Boolean)
          .join(' — ') || 'Error desconocido',
      )
    }
  }

  const handleVerificar = async () => {
    setVerificaEstado('working')
    setVerificaMsg('')
    try {
      const uuid = getRubenUUID()
      const [{ count: cEntrenos, error: e1 }, { count: cPesos, error: e2 }] = await Promise.all([
        supabase.from('entrenos').select('*', { count: 'exact', head: true }).eq('usuario_id', uuid),
        supabase.from('registros_peso').select('*', { count: 'exact', head: true }).eq('usuario_id', uuid),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setVerificaEstado('ok')
      setVerificaMsg(`Entrenos: ${cEntrenos ?? 0} filas · Registros de peso: ${cPesos ?? 0}`)
    } catch (err) {
      setVerificaEstado('error')
      setVerificaMsg((err as Error)?.message ?? 'Error de conexión')
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
      <p className="text-xs text-zinc-500 leading-relaxed">
        Sube todos los datos de Rubén (sesiones + peso) a Supabase como respaldo. Borra datos previos antes de insertar. El login y los datos locales <strong className="text-zinc-400">no se tocan</strong>.
      </p>

      {/* ── Botón subir ───────────────────────────────────────────────────── */}
      <button
        onClick={handleSubir}
        disabled={subidaEstado === 'working'}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3 font-bold text-white text-sm active:bg-emerald-800 disabled:opacity-50"
      >
        {subidaEstado === 'working' && <RefreshCw size={15} className="animate-spin" />}
        {subidaEstado === 'working' ? (progresoMsg || 'Subiendo…') : '⬆️ Subir mis datos a Supabase'}
      </button>

      {/* Barra de progreso */}
      {subidaEstado === 'working' && (
        <div className="flex flex-col gap-1">
          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${progreso}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 text-right tabular-nums">{progreso}%</p>
        </div>
      )}

      {/* Resultado subida */}
      {(subidaEstado === 'ok' || subidaEstado === 'error') && resultMsg && (
        <div className={[
          'flex items-start gap-2 rounded-xl px-3 py-2.5',
          subidaEstado === 'ok'
            ? 'bg-green-900/30 border border-green-700/40'
            : 'bg-red-900/30 border border-red-700/40',
        ].join(' ')}>
          {subidaEstado === 'ok'
            ? <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
            : <AlertCircle  size={14} className="text-red-400 shrink-0 mt-0.5" />}
          <p className={['text-xs break-all', subidaEstado === 'ok' ? 'text-green-400' : 'text-red-400'].join(' ')}>
            {resultMsg}
          </p>
        </div>
      )}

      <div className="border-t border-zinc-800" />

      {/* ── Botón verificar ───────────────────────────────────────────────── */}
      <button
        onClick={handleVerificar}
        disabled={verificaEstado === 'working'}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-700 py-3 font-bold text-white text-sm active:bg-zinc-600 disabled:opacity-50"
      >
        {verificaEstado === 'working'
          ? <RefreshCw size={15} className="animate-spin" />
          : <CheckCircle2 size={15} />}
        {verificaEstado === 'working' ? 'Verificando…' : '✅ Verificar datos en Supabase'}
      </button>

      {/* Resultado verificación */}
      {(verificaEstado === 'ok' || verificaEstado === 'error') && verificaMsg && (
        <div className={[
          'flex items-start gap-2 rounded-xl px-3 py-2.5',
          verificaEstado === 'ok'
            ? 'bg-blue-900/30 border border-blue-700/40'
            : 'bg-red-900/30 border border-red-700/40',
        ].join(' ')}>
          {verificaEstado === 'ok'
            ? <CheckCircle2 size={14} className="text-blue-400 shrink-0 mt-0.5" />
            : <AlertCircle  size={14} className="text-red-400 shrink-0 mt-0.5" />}
          <p className={['text-xs', verificaEstado === 'ok' ? 'text-blue-400' : 'text-red-400'].join(' ')}>
            {verificaMsg}
          </p>
        </div>
      )}
    </div>
  )
}

// ── GoogleLogo ────────────────────────────────────────────────────────────────

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
