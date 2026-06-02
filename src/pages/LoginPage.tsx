import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Users, ChevronRight, Settings, X, Eye, EyeOff, LogIn, RefreshCw } from 'lucide-react'
import {
  obtenerUsuarios,
  verificarPassword,
  setUsuarioActivo,
  getUsuarioActivo,
  cerrarSesionLocal,
  cargarDatosUsuario,
  obtenerEjerciciosUsuario,
  crearEjerciciosDesdeTemplate,
  forzarSincronizacionPendientes,
  getRubenUUID,
  asegurarUsuarioRuben,
  type UsuarioSupabase,
} from '../services/supabase'
import { useFitLogStore } from '../store/useFitLogStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const COLORES_AVATAR = [
  'bg-rose-800', 'bg-violet-800', 'bg-blue-800',
  'bg-emerald-800', 'bg-amber-800', 'bg-cyan-800',
]

function colorAvatar(nombre: string): string {
  let hash = 0
  for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash)
  return COLORES_AVATAR[Math.abs(hash) % COLORES_AVATAR.length]
}

// ---------------------------------------------------------------------------
// Debug visible en pantalla — muestra estado de localStorage sin DevTools
// ---------------------------------------------------------------------------

function DebugLocalStorage() {
  const [abierto, setAbierto] = useState(false)

  const obtenerInfo = () => {
    try {
      const storeRuben  = localStorage.getItem('fitlog-store-ruben')
      const storeLegacy = localStorage.getItem('fitlog-store')
      const rubenUUID   = localStorage.getItem('fitlog-ruben-uuid')
      const usuarioActivo = localStorage.getItem('fitlog_usuario_activo')

      let sesiones = 0
      let pesos    = 0
      let fuente   = '(vacío)'

      const raw = storeRuben || storeLegacy
      if (raw) {
        fuente = storeRuben ? 'fitlog-store-ruben' : 'fitlog-store (legacy)'
        const parsed = JSON.parse(raw)
        sesiones = parsed?.state?.historialSesiones?.length ?? 0
        pesos    = parsed?.state?.registrosPeso?.length ?? 0
      }

      return {
        fuente,
        sesiones,
        pesos,
        rubenUUID: rubenUUID ?? '(no existe)',
        usuarioActivo: usuarioActivo ?? '(no hay sesión)',
        tieneStoreRuben:  !!storeRuben,
        tieneStoreLegacy: !!storeLegacy,
      }
    } catch (e) {
      return { error: String(e) }
    }
  }

  const info = obtenerInfo()

  return (
    <div className="w-full max-w-sm mt-6">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full text-xs text-zinc-700 py-2 hover:text-zinc-500 transition-colors"
      >
        {abierto ? '▲ Ocultar debug' : '▼ Debug localStorage'}
      </button>

      {abierto && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mt-1 flex flex-col gap-2">
          {'error' in info ? (
            <p className="text-xs text-red-400 font-mono break-all">{info.error}</p>
          ) : (
            <>
              <Row label="Fuente datos"      value={info.fuente}          ok={info.tieneStoreRuben || info.tieneStoreLegacy} />
              <Row label="Sesiones locales"  value={String(info.sesiones)} ok={(info.sesiones ?? 0) > 0} />
              <Row label="Pesos locales"     value={String(info.pesos)}    ok={(info.pesos ?? 0) > 0} />
              <Row label="Rubén UUID"        value={info.rubenUUID}        ok={info.rubenUUID !== '(no existe)'} />
              <div className="border-t border-zinc-800 pt-2 mt-1">
                <p className="text-[10px] text-zinc-600 font-mono break-all">{info.usuarioActivo}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={['text-xs font-mono font-bold truncate max-w-[55%] text-right', ok ? 'text-green-400' : 'text-red-400'].join(' ')}>
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const navigate = useNavigate()
  const usuarioActual = getUsuarioActivo()

  const [mostrarOtros,   setMostrarOtros]   = useState(false)
  const [usuarios,       setUsuarios]       = useState<UsuarioSupabase[]>([])
  const [cargando,       setCargando]       = useState(false)
  const [errorLista,     setErrorLista]     = useState('')
  const [cargandoDatos,  setCargandoDatos]  = useState(false)

  // Modal de contraseña
  const [usuarioModal,   setUsuarioModal]   = useState<UsuarioSupabase | null>(null)
  const [password,       setPassword]       = useState('')
  const [showPass,       setShowPass]       = useState(false)
  const [errorPass,      setErrorPass]      = useState('')
  const [verificando,    setVerificando]    = useState(false)

  useEffect(() => {
    if (!mostrarOtros) return
    setCargando(true)
    setErrorLista('')
    obtenerUsuarios()
      .then(setUsuarios)
      .catch(() => setErrorLista('No se pudo conectar con el servidor.'))
      .finally(() => setCargando(false))
  }, [mostrarOtros])

  const limpiarCache = () => {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)))
    }
  }

  const entrarComoRuben = async () => {
    limpiarCache()
    setUsuarioActivo({ id: 'ruben', nombre: 'Rubén', esAdmin: true, esRuben: true })
    await useFitLogStore.persist.rehydrate()

    // Asegurar que Rubén tiene fila en la tabla usuarios de Supabase (requisito FK).
    // Se hace siempre, independientemente de si hay datos locales.
    const rubenUUID = getRubenUUID()
    try {
      await asegurarUsuarioRuben(rubenUUID)
    } catch {
      // Sin conexión — continuar. El INSERT de sync fallará luego pero no bloquea el login.
    }

    // Rubén: localStorage es la fuente de verdad absoluta.
    // NUNCA cargar de Supabase al hacer login — los datos locales siempre tienen prioridad.
    navigate('/', { replace: true })
  }

  const abrirModal = (u: UsuarioSupabase) => {
    setUsuarioModal(u)
    setPassword('')
    setErrorPass('')
    setShowPass(false)
  }

  const cerrarModal = () => {
    setUsuarioModal(null)
    setPassword('')
    setErrorPass('')
  }

  const handleLogin = async () => {
    if (!usuarioModal || !password) return
    setVerificando(true)
    setErrorPass('')
    try {
      const ok = await verificarPassword(usuarioModal.id, password)
      if (ok) {
        limpiarCache()
        const usuario = {
          id: usuarioModal.id,
          nombre: usuarioModal.nombre,
          esAdmin: usuarioModal.es_admin,
          esRuben: false,
        }
        setUsuarioActivo(usuario)
        await useFitLogStore.persist.rehydrate()
        cerrarModal()
        setCargandoDatos(true)
        try {
          // Subir primero los pendientes locales
          await forzarSincronizacionPendientes(usuario.id).catch(console.error)
          // Cargar datos frescos de Supabase y reemplazar el caché local
          const { sesiones, registrosPeso } = await cargarDatosUsuario(usuario.id)
          useFitLogStore.getState().importarHistorialCompleto(sesiones, registrosPeso)
          // Cargar ejercicios (o crear desde plantilla si es nuevo)
          const ejercicios = await obtenerEjerciciosUsuario(usuario.id)
          if (ejercicios) {
            useFitLogStore.getState().importarEjercicios(ejercicios)
          } else {
            const nuevos = await crearEjerciciosDesdeTemplate(usuario.id)
            useFitLogStore.getState().importarEjercicios(nuevos)
          }
        } catch {
          // Sin conexión: se usan los datos locales cacheados
        } finally {
          setCargandoDatos(false)
        }
        navigate('/', { replace: true })
      } else {
        setErrorPass('Contraseña incorrecta. Inténtalo de nuevo.')
      }
    } catch {
      setErrorPass('Error de conexión. Comprueba tu red.')
    } finally {
      setVerificando(false)
    }
  }

  if (cargandoDatos) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <div className="size-12 rounded-2xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center">
          <Dumbbell size={24} className="text-white" strokeWidth={1.8} />
        </div>
        <div className="flex items-center gap-2 text-zinc-400">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm font-medium">Cargando datos...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 py-12">

      {/* Sesión activa (banner si ya hay alguien logado) */}
      {usuarioActual && (
        <div className="absolute top-4 left-4 right-4 max-w-sm mx-auto bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Sesión activa</p>
            <p className="text-sm font-bold text-white">{usuarioActual.nombre}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/', { replace: true })}
              className="text-xs font-bold text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded-xl"
            >
              Continuar
            </button>
            <button
              onClick={cerrarSesionLocal}
              className="text-xs font-bold text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-xl"
            >
              Salir
            </button>
          </div>
        </div>
      )}

      {/* Logo + título */}
      <div className="flex flex-col items-center gap-5 mb-12">
        <div className="size-24 rounded-3xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center shadow-2xl shadow-red-900/40">
          <Dumbbell size={44} className="text-white" strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <h1 className="text-4xl font-black text-white tracking-tight">
            App de Rubén
          </h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">
            Diario de entrenamiento personal
          </p>
        </div>
      </div>

      {/* Botones de acceso */}
      <div className="w-full max-w-sm flex flex-col gap-3">

        {/* Botón Rubén */}
        <button
          onClick={entrarComoRuben}
          className="w-full h-16 rounded-2xl bg-gradient-to-r from-red-800 to-rose-900
                     text-white text-lg font-black flex items-center justify-between px-6
                     shadow-lg shadow-red-900/30 active:opacity-90 transition-opacity"
        >
          <span>Soy Rubén 💪</span>
          <ChevronRight size={22} strokeWidth={2.5} />
        </button>

        {/* Botón Otros usuarios */}
        <button
          onClick={() => setMostrarOtros((v) => !v)}
          className="w-full h-14 rounded-2xl bg-zinc-900 border border-zinc-800
                     text-zinc-300 text-base font-bold flex items-center justify-between px-6
                     active:bg-zinc-800 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Users size={20} className="text-zinc-500" />
            <span>Otros usuarios</span>
          </div>
          <ChevronRight
            size={18}
            className={['text-zinc-600 transition-transform', mostrarOtros ? 'rotate-90' : ''].join(' ')}
          />
        </button>

        {/* Lista de usuarios */}
        {mostrarOtros && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {cargando && (
              <div className="px-5 py-6 text-center text-sm text-zinc-500">
                Cargando usuarios…
              </div>
            )}

            {errorLista && (
              <div className="px-5 py-4 text-sm text-red-400 text-center">
                {errorLista}
              </div>
            )}

            {!cargando && !errorLista && usuarios.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-zinc-600">
                No hay usuarios registrados.
              </div>
            )}

            {!cargando && usuarios.map((u, i) => (
              <button
                key={u.id}
                onClick={() => abrirModal(u)}
                className={[
                  'w-full flex items-center gap-4 px-5 py-4 active:bg-zinc-800 transition-colors',
                  i < usuarios.length - 1 ? 'border-b border-zinc-800' : '',
                ].join(' ')}
              >
                {/* Avatar */}
                <div className={[
                  'size-11 rounded-full flex items-center justify-center shrink-0 text-white font-black text-sm',
                  colorAvatar(u.nombre),
                ].join(' ')}>
                  {iniciales(u.nombre)}
                </div>
                {/* Info */}
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-white">{u.nombre}</p>
                  {u.email && (
                    <p className="text-xs text-zinc-500 mt-0.5">{u.email}</p>
                  )}
                </div>
                <LogIn size={16} className="text-zinc-600" />
              </button>
            ))}

            {/* Botón admin (solo si hay usuario activo con es_admin) */}
            {usuarioActual?.esAdmin && (
              <button
                onClick={() => navigate('/admin/usuarios')}
                className="w-full flex items-center gap-3 px-5 py-4 border-t border-zinc-800
                           text-amber-500 active:bg-zinc-800 transition-colors"
              >
                <Settings size={16} />
                <span className="text-sm font-bold">Administrar usuarios</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Debug localStorage — visible en pantalla para verificar datos de Rubén */}
      <DebugLocalStorage />

      {/* Modal de contraseña */}
      {usuarioModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 px-4 flex flex-col items-center"
          style={{ paddingTop: '32vh' }}
          onClick={(e) => e.target === e.currentTarget && cerrarModal()}
        >
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col gap-5
                          animate-in fade-in zoom-in-95 duration-200">
            {/* Header modal */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={[
                  'size-11 rounded-full flex items-center justify-center text-white font-black text-sm',
                  colorAvatar(usuarioModal.nombre),
                ].join(' ')}>
                  {iniciales(usuarioModal.nombre)}
                </div>
                <div>
                  <p className="text-base font-bold text-white">{usuarioModal.nombre}</p>
                  <p className="text-xs text-zinc-500">Introduce tu contraseña</p>
                </div>
              </div>
              <button
                onClick={cerrarModal}
                className="size-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400"
              >
                <X size={16} />
              </button>
            </div>

            {/* Input contraseña */}
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Contraseña"
                autoFocus
                className="w-full bg-zinc-800 rounded-2xl px-4 py-4 pr-12 text-white text-base
                           placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700"
              />
              <button
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {errorPass && (
              <p className="text-sm text-red-400 -mt-2">{errorPass}</p>
            )}

            {/* Botón entrar */}
            <button
              onClick={handleLogin}
              disabled={!password || verificando}
              className={[
                'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-opacity',
                password && !verificando
                  ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white'
                  : 'bg-zinc-800 text-zinc-600',
              ].join(' ')}
            >
              {verificando ? 'Verificando…' : 'Entrar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
