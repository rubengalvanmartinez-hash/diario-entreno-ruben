import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Eye, EyeOff, RefreshCw, ChevronDown } from 'lucide-react'
import {
  obtenerUsuarios,
  verificarPassword,
  tienePasswordVacio,
  establecerPassword,
  setUsuarioActivo,
  getUsuarioActivo,
  cerrarSesionLocal,
  cargarDatosUsuario,
  obtenerEjerciciosUsuario,
  crearEjerciciosDesdeTemplate,
  forzarSincronizacionPendientes,
  getRubenUUID,
  RUBEN_UUID,
  asegurarUsuarioRuben,
  type UsuarioSupabase,
} from '../services/supabase'
import { useFitLogStore } from '../store/useFitLogStore'

// ---------------------------------------------------------------------------
// Debug localStorage
// ---------------------------------------------------------------------------

function DebugLocalStorage() {
  const [abierto, setAbierto] = useState(false)

  const obtenerInfo = () => {
    try {
      const storeRuben    = localStorage.getItem('fitlog-store-ruben')
      const storeLegacy   = localStorage.getItem('fitlog-store')
      const rubenUUID     = localStorage.getItem('fitlog-ruben-uuid')
      const usuarioActivo = localStorage.getItem('fitlog_usuario_activo')

      let sesiones = 0, pesos = 0
      let fuente = '(vacío)'
      const raw = storeRuben || storeLegacy
      if (raw) {
        fuente = storeRuben ? 'fitlog-store-ruben' : 'fitlog-store (legacy)'
        const parsed = JSON.parse(raw)
        sesiones = parsed?.state?.historialSesiones?.length ?? 0
        pesos    = parsed?.state?.registrosPeso?.length ?? 0
      }
      return { fuente, sesiones, pesos, rubenUUID: rubenUUID ?? '(no existe)', usuarioActivo: usuarioActivo ?? '(no hay sesión)', tieneStoreRuben: !!storeRuben, tieneStoreLegacy: !!storeLegacy }
    } catch (e) { return { error: String(e) } }
  }

  const info = obtenerInfo()

  return (
    <div className="w-full max-w-sm mt-6">
      <button onClick={() => setAbierto(v => !v)} className="w-full text-xs text-zinc-700 py-2 hover:text-zinc-500 transition-colors">
        {abierto ? '▲ Ocultar debug' : '▼ Debug localStorage'}
      </button>
      {abierto && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mt-1 flex flex-col gap-2">
          {'error' in info ? (
            <p className="text-xs text-red-400 font-mono break-all">{info.error}</p>
          ) : (
            <>
              <RowDebug label="Fuente datos"     value={info.fuente}           ok={info.tieneStoreRuben || info.tieneStoreLegacy} />
              <RowDebug label="Sesiones locales" value={String(info.sesiones)} ok={(info.sesiones ?? 0) > 0} />
              <RowDebug label="Pesos locales"    value={String(info.pesos)}    ok={(info.pesos ?? 0) > 0} />
              <RowDebug label="Rubén UUID"       value={info.rubenUUID}        ok={info.rubenUUID !== '(no existe)'} />
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

function RowDebug({ label, value, ok }: { label: string; value: string; ok: boolean }) {
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
// Pantalla de carga
// ---------------------------------------------------------------------------

function Cargando({ texto }: { texto: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
      <div className="size-12 rounded-2xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center">
        <Dumbbell size={24} className="text-white" strokeWidth={1.8} />
      </div>
      <div className="flex items-center gap-2 text-zinc-400">
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-sm font-medium">{texto}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

type Fase = 'login' | 'primer-acceso' | 'cargando-datos'

export default function LoginPage() {
  const navigate = useNavigate()
  const usuarioActual = getUsuarioActivo()

  const [usuarios,        setUsuarios]        = useState<UsuarioSupabase[]>([])
  const [cargandoLista,   setCargandoLista]   = useState(true)
  const [errorLista,      setErrorLista]      = useState('')

  // Campos del formulario de login
  const [usuarioId,    setUsuarioId]    = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [errorLogin,   setErrorLogin]   = useState('')
  const [entrando,     setEntrando]     = useState(false)

  // Primer acceso
  const [fase,         setFase]         = useState<Fase>('login')
  const [usuarioPrimerAcceso, setUsuarioPrimerAcceso] = useState<UsuarioSupabase | null>(null)
  const [pass1,        setPass1]        = useState('')
  const [pass2,        setPass2]        = useState('')
  const [showPass1,    setShowPass1]    = useState(false)
  const [showPass2,    setShowPass2]    = useState(false)
  const [errorPrimer,  setErrorPrimer]  = useState('')
  const [guardandoPass, setGuardandoPass] = useState(false)

  useEffect(() => {
    setCargandoLista(true)
    obtenerUsuarios()
      .then(setUsuarios)
      .catch(() => setErrorLista('No se pudo conectar con el servidor.'))
      .finally(() => setCargandoLista(false))
  }, [])

  // ── Limpiar caché del service worker ──────────────────────────────────────

  const limpiarCache = () => {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
    }
  }

  // ── Completar login tras verificación ────────────────────────────────────

  const completarLogin = async (u: UsuarioSupabase) => {
    limpiarCache()

    const esRuben = u.id === getRubenUUID() || u.nombre === 'Rubén'

    if (esRuben) {
      localStorage.setItem('fitlog-ruben-uuid', u.id)
      try { await asegurarUsuarioRuben(u.id) } catch { /* sin conexión: OK */ }
    }

    setUsuarioActivo({
      id:                esRuben ? 'ruben' : u.id,
      nombre:            u.nombre,
      esAdmin:           u.es_admin,
      esRuben,
      puedePesoCorporal: esRuben ? true : (u.puede_peso_corporal ?? false),
    })

    await useFitLogStore.persist.rehydrate()

    // ── Carga unificada desde Supabase para TODOS los usuarios ───────────────
    setFase('cargando-datos')
    const idSupabase = esRuben ? RUBEN_UUID : u.id
    try {
      await forzarSincronizacionPendientes(idSupabase).catch(console.error)
      const sesionesLocales = useFitLogStore.getState().historialSesiones
      const { sesiones, registrosPeso } = await cargarDatosUsuario(idSupabase)
      if (sesiones.length > 0) {
        // Supabase tiene datos — es la fuente de verdad entre dispositivos
        useFitLogStore.getState().importarHistorialCompleto(sesiones, registrosPeso)
      } else if (sesionesLocales.length > 0) {
        // Supabase vacío pero hay datos locales — conservar sin sobrescribir
        console.warn('[Login] Supabase vacío — conservando datos locales:', sesionesLocales.length, 'sesiones')
      }
      const ejercicios = await obtenerEjerciciosUsuario(idSupabase)
      if (ejercicios) {
        useFitLogStore.getState().importarEjercicios(ejercicios)
      } else if (!esRuben) {
        const nuevos = await crearEjerciciosDesdeTemplate(idSupabase)
        useFitLogStore.getState().importarEjercicios(nuevos)
      }
    } catch {
      console.warn('[Login] Sin conexión — usando datos locales cacheados')
    }
    navigate('/', { replace: true })
  }

  // ── Entrar ────────────────────────────────────────────────────────────────

  const handleEntrar = async () => {
    if (!usuarioId || !password) return
    const u = usuarios.find(x => x.id === usuarioId)
    if (!u) return

    setErrorLogin('')
    setEntrando(true)
    try {
      // Comprobar primer acceso (password_hash null)
      const sinPassword = await tienePasswordVacio(u.id)
      if (sinPassword) {
        // El campo password que introdujo el usuario es irrelevante — pedirle que cree contraseña
        setUsuarioPrimerAcceso(u)
        setPass1('')
        setPass2('')
        setErrorPrimer('')
        setFase('primer-acceso')
        return
      }

      const ok = await verificarPassword(u.id, password)
      if (ok) {
        await completarLogin(u)
      } else {
        setErrorLogin('Usuario o contraseña incorrectos.')
      }
    } catch {
      setErrorLogin('Error de conexión. Comprueba tu red.')
    } finally {
      setEntrando(false)
    }
  }

  // ── Crear contraseña (primer acceso) ──────────────────────────────────────

  const handleCrearPassword = async () => {
    if (!usuarioPrimerAcceso) return
    if (!pass1) { setErrorPrimer('Escribe una contraseña.'); return }
    if (pass1 !== pass2) { setErrorPrimer('Las contraseñas no coinciden.'); return }
    if (pass1.length < 4) { setErrorPrimer('Mínimo 4 caracteres.'); return }

    setGuardandoPass(true)
    setErrorPrimer('')
    try {
      await establecerPassword(usuarioPrimerAcceso.id, pass1)
      await completarLogin(usuarioPrimerAcceso)
    } catch (err) {
      setErrorPrimer((err as Error)?.message ?? 'Error al guardar la contraseña.')
    } finally {
      setGuardandoPass(false)
    }
  }

  // ── Renders según fase ───────────────────────────────────────────────────

  if (fase === 'cargando-datos') return <Cargando texto="Cargando datos..." />

  // ── Primer acceso: crear contraseña ───────────────────────────────────────

  if (fase === 'primer-acceso' && usuarioPrimerAcceso) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 py-12">
        <div className="flex flex-col items-center gap-5 mb-10">
          <div className="size-20 rounded-3xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center shadow-2xl shadow-red-900/40">
            <Dumbbell size={36} className="text-white" strokeWidth={1.8} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-black text-white">Hola, {usuarioPrimerAcceso.nombre}</h1>
            <p className="text-zinc-500 text-sm mt-1">Es tu primer acceso. Crea tu contraseña.</p>
          </div>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-4">
          {/* Nueva contraseña */}
          <div className="relative">
            <input
              type={showPass1 ? 'text' : 'password'}
              value={pass1}
              onChange={e => setPass1(e.target.value)}
              placeholder="Crea tu contraseña"
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 pr-12 text-white
                         placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700"
            />
            <button onClick={() => setShowPass1(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
              {showPass1 ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Confirmar contraseña */}
          <div className="relative">
            <input
              type={showPass2 ? 'text' : 'password'}
              value={pass2}
              onChange={e => setPass2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCrearPassword()}
              placeholder="Confirma contraseña"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 pr-12 text-white
                         placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700"
            />
            <button onClick={() => setShowPass2(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
              {showPass2 ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {errorPrimer && <p className="text-sm text-red-400 -mt-1">{errorPrimer}</p>}

          <button
            onClick={handleCrearPassword}
            disabled={!pass1 || !pass2 || guardandoPass}
            className={[
              'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-opacity',
              pass1 && pass2 && !guardandoPass
                ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white'
                : 'bg-zinc-800 text-zinc-600',
            ].join(' ')}
          >
            {guardandoPass ? <RefreshCw size={18} className="animate-spin" /> : null}
            {guardandoPass ? 'Guardando…' : 'Crear contraseña y entrar'}
          </button>

          <button onClick={() => setFase('login')} className="text-sm text-zinc-600 text-center py-1 hover:text-zinc-400 transition-colors">
            ← Volver
          </button>
        </div>
      </div>
    )
  }

  // ── Login principal ───────────────────────────────────────────────────────

  const usuarioSeleccionado = usuarios.find(u => u.id === usuarioId) ?? null

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 py-12">

      {/* Sesión activa */}
      {usuarioActual && (
        <div className="absolute top-4 left-4 right-4 max-w-sm mx-auto bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Sesión activa</p>
            <p className="text-sm font-bold text-white">{usuarioActual.nombre}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/', { replace: true })} className="text-xs font-bold text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded-xl">
              Continuar
            </button>
            <button onClick={cerrarSesionLocal} className="text-xs font-bold text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-xl">
              Salir
            </button>
          </div>
        </div>
      )}

      {/* Logo */}
      <div className="flex flex-col items-center gap-5 mb-10">
        <div className="size-24 rounded-3xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center shadow-2xl shadow-red-900/40">
          <Dumbbell size={44} className="text-white" strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <h1 className="text-4xl font-black text-white tracking-tight">App de Rubén</h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">Diario de entrenamiento personal</p>
        </div>
      </div>

      {/* Formulario */}
      <div className="w-full max-w-sm flex flex-col gap-4">

        {/* Select usuario */}
        <div className="relative">
          <select
            value={usuarioId}
            onChange={e => { setUsuarioId(e.target.value); setErrorLogin('') }}
            disabled={cargandoLista}
            className={[
              'w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 pr-10 text-base appearance-none',
              'focus:outline-none focus:ring-2 focus:ring-red-700',
              usuarioId ? 'text-white' : 'text-zinc-500',
              cargandoLista ? 'opacity-50' : '',
            ].join(' ')}
          >
            <option value="">{cargandoLista ? 'Cargando usuarios…' : 'Selecciona usuario…'}</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
          <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>

        {errorLista && (
          <p className="text-xs text-red-400 -mt-1">{errorLista}</p>
        )}

        {/* Contraseña */}
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setErrorLogin('') }}
            onKeyDown={e => e.key === 'Enter' && handleEntrar()}
            placeholder="Contraseña"
            disabled={!usuarioId}
            className={[
              'w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 pr-12 text-white text-base',
              'placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700',
              !usuarioId ? 'opacity-40' : '',
            ].join(' ')}
          />
          {usuarioId && (
            <button onClick={() => setShowPass(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>

        {/* Hint primer acceso */}
        {usuarioSeleccionado && (
          <p className="text-xs text-zinc-600 -mt-1 px-1">
            ¿Primera vez? Introduce cualquier texto y se te pedirá crear tu contraseña.
          </p>
        )}

        {errorLogin && <p className="text-sm text-red-400 -mt-1">{errorLogin}</p>}

        {/* Botón entrar */}
        <button
          onClick={handleEntrar}
          disabled={!usuarioId || !password || entrando}
          className={[
            'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-opacity',
            usuarioId && password && !entrando
              ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white shadow-lg shadow-red-900/30'
              : 'bg-zinc-800 text-zinc-600',
          ].join(' ')}
        >
          {entrando && <RefreshCw size={18} className="animate-spin" />}
          {entrando ? 'Verificando…' : 'Entrar'}
        </button>
      </div>

      <DebugLocalStorage />
    </div>
  )
}
