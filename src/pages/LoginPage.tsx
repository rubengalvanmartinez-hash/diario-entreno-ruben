import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Eye, EyeOff, RefreshCw, ChevronDown } from 'lucide-react'
import {
  listarUsuariosLogin,
  iniciarSesion,
  comprobarPasswordAntigua,
  migrarPasswordAntigua,
  activarCuentaConCodigo,
  estadoSesionAuth,
  ErrorAcceso,
  PASSWORD_MIN,
  setUsuarioActivo,
  getUsuarioActivo,
  cerrarSesionLocal,
  olvidarUsuarioActivo,
  clearPerfilVisto,
  cargarDatosUsuario,
  obtenerEjerciciosUsuario,
  crearEjerciciosDesdeTemplate,
  forzarSincronizacionPendientes,
  getRubenUUID,
  RUBEN_UUID,
  cargarComposicion,
  cargarPerfilCorporal,
  cargarMedidas,
  type UsuarioSupabase,
  type UsuarioLogin,
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
// Campo de contraseña con botón de mostrar/ocultar
// ---------------------------------------------------------------------------

function CampoPassword({
  value, onChange, placeholder, onEnter, autoFocus, disabled, autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter?: () => void
  autoFocus?: boolean
  disabled?: boolean
  autoComplete?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete={autoComplete}
        className={[
          'w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 pr-12 text-white text-base',
          'placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
      />
      {!disabled && (
        <button type="button" onClick={() => setVisible(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  )
}

function mensajeError(err: unknown, porDefecto: string): string {
  if (err instanceof ErrorAcceso) return err.message
  return porDefecto
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * login          → elegir usuario y contraseña (o código si la cuenta está pendiente)
 * nueva-password → elegir contraseña nueva: tras verificar la antigua ('migrar')
 *                  o con el código de un solo uso del admin ('codigo')
 */
type Fase = 'login' | 'nueva-password' | 'cargando-datos'
type ModoNueva = 'migrar' | 'codigo'

export default function LoginPage() {
  const navigate = useNavigate()
  const [usuarioActual, setUsuarioActual] = useState(getUsuarioActivo)

  const [usuarios,        setUsuarios]        = useState<UsuarioLogin[]>([])
  const [cargandoLista,   setCargandoLista]   = useState(true)
  const [errorLista,      setErrorLista]      = useState('')

  // Formulario de login
  const [usuarioId,    setUsuarioId]    = useState('')
  const [password,     setPassword]     = useState('')
  const [codigo,       setCodigo]       = useState('')
  const [errorLogin,   setErrorLogin]   = useState('')
  const [ayudaPass,    setAyudaPass]    = useState(false)
  const [entrando,     setEntrando]     = useState(false)

  // Contraseña nueva
  const [fase,         setFase]         = useState<Fase>('login')
  const [modoNueva,    setModoNueva]    = useState<ModoNueva>('migrar')
  const [pass1,        setPass1]        = useState('')
  const [pass2,        setPass2]        = useState('')
  const [errorNueva,   setErrorNueva]   = useState('')
  const [guardandoPass, setGuardandoPass] = useState(false)

  useEffect(() => {
    setCargandoLista(true)
    listarUsuariosLogin()
      .then(setUsuarios)
      .catch((err) => setErrorLista(mensajeError(err, 'No se pudo conectar con el servidor.')))
      .finally(() => setCargandoLista(false))
  }, [])

  // "Sesión activa" local sin sesión de Supabase Auth (p. ej. de antes de v2.8.0):
  // ya no sirve para acceder a los datos → se descarta
  useEffect(() => {
    if (!usuarioActual) return
    estadoSesionAuth().then((e) => {
      if (e === 'no') { olvidarUsuarioActivo(); setUsuarioActual(null) }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const usuarioSeleccionado = usuarios.find(u => u.id === usuarioId) ?? null

  // ── Limpiar caché del service worker ──────────────────────────────────────

  const limpiarCache = () => {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
    }
  }

  // ── Completar login (ya hay sesión de Supabase Auth) ─────────────────────

  const completarLogin = async (u: UsuarioSupabase) => {
    limpiarCache()
    clearPerfilVisto() // un "Ver perfil de…" de otra sesión no debe heredarse

    const esRuben = u.id === getRubenUUID() || u.nombre === 'Rubén'

    if (esRuben) {
      localStorage.setItem('fitlog-ruben-uuid', u.id)
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

      // Cargar composición corporal y medidas para usuarios con acceso a esa sección
      const puedePeso = esRuben ? true : (u.puede_peso_corporal ?? false)
      if (puedePeso) {
        try {
          const [composicion, perfil, medidas] = await Promise.all([
            cargarComposicion(idSupabase),
            cargarPerfilCorporal(idSupabase),
            cargarMedidas(idSupabase),
          ])
          useFitLogStore.getState().importarComposicionYPerfil(composicion, perfil)
          useFitLogStore.getState().importarMedidas(medidas)
        } catch {
          console.warn('[Login] Sin conexión — composición/medidas no cargadas')
        }
      }
    } catch {
      console.warn('[Login] Sin conexión — usando datos locales cacheados')
    }
    navigate('/', { replace: true })
  }

  // ── Entrar ────────────────────────────────────────────────────────────────

  const irANuevaPassword = (modo: ModoNueva) => {
    setModoNueva(modo)
    setPass1('')
    setPass2('')
    setErrorNueva('')
    setFase('nueva-password')
  }

  const handleEntrar = async () => {
    const u = usuarioSeleccionado
    if (!u) return

    if (u.estado === 'pendiente') {
      if (!codigo.trim()) return
      irANuevaPassword('codigo')
      return
    }
    if (!password) return

    setErrorLogin('')
    setEntrando(true)
    try {
      if (u.estado === 'migrar') {
        // Contraseña de la app antigua: se verifica en el servidor y se pide una nueva
        await comprobarPasswordAntigua(u.id, password)
        irANuevaPassword('migrar')
        return
      }
      const perfil = await iniciarSesion(u.id, password)
      await completarLogin(perfil)
    } catch (err) {
      setErrorLogin(mensajeError(err, 'Error de conexión. Comprueba tu red.'))
      // El estado de la cuenta puede haber cambiado (bloqueo, migrada en otro móvil…)
      if (err instanceof ErrorAcceso) listarUsuariosLogin().then(setUsuarios).catch(() => {})
    } finally {
      setEntrando(false)
    }
  }

  // ── Guardar contraseña nueva ──────────────────────────────────────────────

  const handleGuardarNueva = async () => {
    const u = usuarioSeleccionado
    if (!u) return
    if (modoNueva === 'codigo' && !codigo.trim()) { setErrorNueva('Escribe el código de acceso.'); return }
    if (pass1.length < PASSWORD_MIN) { setErrorNueva(`Mínimo ${PASSWORD_MIN} caracteres.`); return }
    if (pass1 !== pass2) { setErrorNueva('Las contraseñas no coinciden.'); return }
    if (modoNueva === 'migrar' && pass1 === password) { setErrorNueva('Elige una contraseña distinta de la antigua.'); return }

    setGuardandoPass(true)
    setErrorNueva('')
    try {
      const perfil = modoNueva === 'migrar'
        ? await migrarPasswordAntigua(u.id, password, pass1)
        : await activarCuentaConCodigo(u.id, codigo, pass1)
      await completarLogin(perfil)
    } catch (err) {
      setErrorNueva(mensajeError(err, 'Error de conexión. Comprueba tu red.'))
    } finally {
      setGuardandoPass(false)
    }
  }

  const volverAlLogin = () => {
    setFase('login')
    setPassword('')
    setErrorLogin('')
    // La lista puede haber cambiado de estado (p. ej. bloqueo tras varios intentos)
    listarUsuariosLogin().then(setUsuarios).catch(() => {})
  }

  // ── Renders según fase ───────────────────────────────────────────────────

  if (fase === 'cargando-datos') return <Cargando texto="Cargando datos..." />

  // ── Contraseña nueva (actualización de seguridad o código del admin) ──────

  if (fase === 'nueva-password' && usuarioSeleccionado) {
    const puedeGuardar = !!pass1 && !!pass2 && (modoNueva === 'migrar' || !!codigo.trim()) && !guardandoPass
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 py-12">
        <div className="flex flex-col items-center gap-5 mb-10">
          <div className="size-20 rounded-3xl bg-gradient-to-br from-red-800 to-rose-950 flex items-center justify-center shadow-2xl shadow-red-900/40">
            <Dumbbell size={36} className="text-white" strokeWidth={1.8} />
          </div>
          <div className="text-center max-w-sm">
            <h1 className="text-2xl font-black text-white">Hola, {usuarioSeleccionado.nombre}</h1>
            <p className="text-zinc-500 text-sm mt-1 leading-relaxed">
              {modoNueva === 'migrar'
                ? 'Actualización de seguridad: elige una contraseña nueva. La anterior dejará de funcionar.'
                : 'Introduce el código que te ha dado el administrador y crea tu contraseña.'}
            </p>
          </div>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-4">
          {modoNueva === 'codigo' && (
            <input
              value={codigo}
              onChange={e => setCodigo(e.target.value.toUpperCase())}
              placeholder="Código de acceso (p. ej. ABCD-EFGH)"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-base tracking-widest
                         placeholder-zinc-600 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-red-700"
            />
          )}
          <CampoPassword
            value={pass1}
            onChange={setPass1}
            placeholder={`Contraseña nueva (mín. ${PASSWORD_MIN} caracteres)`}
            autoFocus={modoNueva === 'migrar'}
            autoComplete="new-password"
          />
          <CampoPassword
            value={pass2}
            onChange={setPass2}
            placeholder="Repite la contraseña nueva"
            onEnter={handleGuardarNueva}
            autoComplete="new-password"
          />

          {errorNueva && <p className="text-sm text-red-400 -mt-1">{errorNueva}</p>}

          <button
            onClick={handleGuardarNueva}
            disabled={!puedeGuardar}
            className={[
              'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-opacity',
              puedeGuardar
                ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white'
                : 'bg-zinc-800 text-zinc-600',
            ].join(' ')}
          >
            {guardandoPass ? <RefreshCw size={18} className="animate-spin" /> : null}
            {guardandoPass ? 'Guardando…' : 'Guardar contraseña y entrar'}
          </button>

          <button onClick={volverAlLogin} className="text-sm text-zinc-600 text-center py-1 hover:text-zinc-400 transition-colors">
            ← Volver
          </button>
        </div>
      </div>
    )
  }

  // ── Login principal ───────────────────────────────────────────────────────

  const pendiente = usuarioSeleccionado?.estado === 'pendiente'
  const puedeEntrar = !!usuarioSeleccionado && (pendiente ? !!codigo.trim() : !!password) && !entrando

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
            <button onClick={() => { cerrarSesionLocal(); setUsuarioActual(null) }} className="text-xs font-bold text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-xl">
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
            onChange={e => { setUsuarioId(e.target.value); setErrorLogin(''); setPassword(''); setCodigo('') }}
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

        {/* Contraseña, o código de acceso si la cuenta está pendiente */}
        {pendiente ? (
          <input
            value={codigo}
            onChange={e => { setCodigo(e.target.value.toUpperCase()); setErrorLogin('') }}
            onKeyDown={e => e.key === 'Enter' && handleEntrar()}
            placeholder="Código de acceso"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-base tracking-widest
                       placeholder-zinc-600 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-red-700"
          />
        ) : (
          <CampoPassword
            value={password}
            onChange={v => { setPassword(v); setErrorLogin('') }}
            onEnter={handleEntrar}
            placeholder="Contraseña"
            disabled={!usuarioId}
            autoComplete="current-password"
          />
        )}

        {/* Avisos según el estado de la cuenta */}
        {usuarioSeleccionado?.estado === 'migrar' && (
          <p className="text-xs text-amber-400 -mt-1 px-1 leading-relaxed">
            Actualización de seguridad: entra con tu contraseña de siempre y a continuación elegirás una nueva.
          </p>
        )}
        {pendiente && (
          <p className="text-xs text-amber-400 -mt-1 px-1 leading-relaxed">
            Esta cuenta necesita un código de acceso. Pídeselo a un administrador
            (Ajustes → Gestión de usuarios → Restablecer).
          </p>
        )}

        {errorLogin && <p className="text-sm text-red-400 -mt-1">{errorLogin}</p>}

        {/* Olvidé la contraseña */}
        {usuarioSeleccionado && !pendiente && (
          <div className="-mt-1">
            <button
              type="button"
              onClick={() => setAyudaPass((v) => !v)}
              className="text-xs text-zinc-500 underline underline-offset-2 active:text-zinc-300 px-1"
            >
              ¿Has olvidado la contraseña?
            </button>
            {ayudaPass && (
              <div className="mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-xs text-zinc-400 leading-relaxed">
                La app no envía correos, así que no se puede recuperar por email.
                Pide a un <span className="text-white font-semibold">administrador</span> que la restablezca
                desde <span className="text-white font-semibold">Ajustes → Gestión de usuarios → Restablecer</span>:
                te dará un <span className="text-white font-semibold">código de acceso</span> con el que crearás una contraseña nueva.
              </div>
            )}
          </div>
        )}

        {/* Botón entrar */}
        <button
          onClick={handleEntrar}
          disabled={!puedeEntrar}
          className={[
            'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-opacity',
            puedeEntrar
              ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white shadow-lg shadow-red-900/30'
              : 'bg-zinc-800 text-zinc-600',
          ].join(' ')}
        >
          {entrando && <RefreshCw size={18} className="animate-spin" />}
          {entrando ? 'Verificando…' : pendiente ? 'Continuar' : 'Entrar'}
        </button>
      </div>

      <DebugLocalStorage />
    </div>
  )
}
