import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Trash2, X, Check, Users, Shield, Scale, KeyRound } from 'lucide-react'
import {
  obtenerUsuarios,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  restablecerPassword,
  getUsuarioActivo,
  crearEjerciciosDesdeTemplate,
  type UsuarioSupabase,
} from '../services/supabase'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iniciales(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
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
// Componente
// ---------------------------------------------------------------------------

export default function AdminUsuariosPage() {
  const navigate = useNavigate()
  const usuarioActual = getUsuarioActivo()

  useEffect(() => {
    if (!usuarioActual?.esAdmin) navigate('/login', { replace: true })
  }, [usuarioActual, navigate])

  const [usuarios,   setUsuarios]   = useState<UsuarioSupabase[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState('')

  // Modal crear
  const [modalCrear, setModalCrear] = useState(false)
  const [nombre,     setNombre]     = useState('')
  const [guardando,  setGuardando]  = useState(false)
  const [errorForm,  setErrorForm]  = useState('')

  // Confirmación borrado
  const [borrandoId, setBorrandoId] = useState<string | null>(null)

  // Toggles en proceso
  const [toggling, setToggling] = useState<string | null>(null)

  // Restablecer contraseña (confirmación en dos toques)
  const [reseteandoId, setReseteandoId] = useState<string | null>(null)
  const [reseteando,   setReseteando]   = useState(false)
  const [mensaje,      setMensaje]      = useState('')

  useEffect(() => { cargarUsuarios() }, [])

  async function cargarUsuarios() {
    setCargando(true)
    setError('')
    try {
      setUsuarios(await obtenerUsuarios())
    } catch {
      setError('No se pudo cargar la lista de usuarios.')
    } finally {
      setCargando(false)
    }
  }

  const handleCrear = async () => {
    if (!nombre.trim()) { setErrorForm('El nombre es obligatorio.'); return }
    setGuardando(true)
    setErrorForm('')
    try {
      const nuevo = await crearUsuario({ nombre: nombre.trim() })
      crearEjerciciosDesdeTemplate(nuevo.id).catch(console.error)
      setModalCrear(false)
      setNombre('')
      await cargarUsuarios()
    } catch {
      setErrorForm('Error al crear el usuario. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const handleToggle = async (u: UsuarioSupabase, campo: 'es_admin' | 'puede_peso_corporal') => {
    const key = `${u.id}-${campo}`
    setToggling(key)
    try {
      await actualizarUsuario(u.id, { [campo]: !u[campo] })
      await cargarUsuarios()
    } catch {
      setError('No se pudo actualizar el usuario.')
    } finally {
      setToggling(null)
    }
  }

  const handleRestablecer = async (u: UsuarioSupabase) => {
    if (reseteandoId !== u.id) { setReseteandoId(u.id); return }
    setReseteando(true)
    try {
      await restablecerPassword(u.id)
      setReseteandoId(null)
      setMensaje(`Contraseña de ${u.nombre} restablecida: en su próximo acceso creará una nueva.`)
      await cargarUsuarios()
    } catch {
      setError('No se pudo restablecer la contraseña.')
    } finally {
      setReseteando(false)
    }
  }

  const handleEliminar = async (id: string) => {
    if (borrandoId !== id) { setBorrandoId(id); return }
    try {
      await eliminarUsuario(id)
      setBorrandoId(null)
      await cargarUsuarios()
    } catch {
      setError('No se pudo eliminar el usuario.')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="size-9 flex items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800">
              <ChevronLeft size={22} />
            </button>
            <div>
              <h1 className="text-base font-black text-white">Usuarios</h1>
              <p className="text-xs text-zinc-600">{usuarios.length} registrado{usuarios.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button
            onClick={() => { setModalCrear(true); setNombre(''); setErrorForm('') }}
            className="flex items-center gap-2 bg-red-800 text-white text-sm font-bold px-4 py-2 rounded-xl active:bg-red-900"
          >
            <Plus size={16} />
            Añadir
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {cargando && (
          <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">Cargando usuarios…</div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-800/40 rounded-2xl px-5 py-4 text-red-400 text-sm mb-4">{error}</div>
        )}
        {mensaje && (
          <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-2xl px-5 py-3 text-emerald-400 text-sm mb-4 flex items-start gap-2">
            <Check size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1">{mensaje}</span>
            <button onClick={() => setMensaje('')} className="text-emerald-600 active:text-emerald-300" aria-label="Cerrar aviso"><X size={14} /></button>
          </div>
        )}
        {!cargando && !error && usuarios.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="size-16 rounded-full bg-zinc-900 flex items-center justify-center">
              <Users size={28} className="text-zinc-700" />
            </div>
            <p className="text-zinc-500 text-sm">No hay usuarios registrados.</p>
          </div>
        )}

        {!cargando && usuarios.length > 0 && (
          <ul className="flex flex-col gap-3">
            {usuarios.map(u => (
              <li key={u.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 flex flex-col gap-3">
                {/* Cabecera usuario */}
                <div className="flex items-center gap-3">
                  <div className={['size-11 rounded-full flex items-center justify-center shrink-0 text-white font-black text-sm', colorAvatar(u.nombre)].join(' ')}>
                    {iniciales(u.nombre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-bold text-white">{u.nombre}</p>
                      {u.es_admin && (
                        <span className="text-[10px] font-bold bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">Admin</span>
                      )}
                      {u.puede_peso_corporal && (
                        <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full">Peso</span>
                      )}
                    </div>
                    <p className={['text-xs mt-0.5', u.tiene_password ? 'text-zinc-600' : 'text-amber-500'].join(' ')}>
                      {u.tiene_password ? 'Contraseña establecida' : 'Sin contraseña: la creará en su próximo acceso'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleEliminar(u.id)}
                    className={['size-9 flex items-center justify-center rounded-xl transition-colors', borrandoId === u.id ? 'bg-red-700 text-white' : 'bg-zinc-800 text-zinc-500 active:bg-zinc-700'].join(' ')}
                    title={borrandoId === u.id ? 'Pulsa de nuevo para confirmar' : 'Eliminar'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {/* Toggles */}
                <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
                  <ToggleRow
                    icon={<Shield size={14} />}
                    label="Es administrador"
                    active={u.es_admin}
                    loading={toggling === `${u.id}-es_admin`}
                    onToggle={() => handleToggle(u, 'es_admin')}
                  />
                  <ToggleRow
                    icon={<Scale size={14} />}
                    label="Puede registrar peso corporal"
                    active={u.puede_peso_corporal ?? false}
                    loading={toggling === `${u.id}-puede_peso_corporal`}
                    onToggle={() => handleToggle(u, 'puede_peso_corporal')}
                  />
                </div>

                {/* Restablecer contraseña */}
                {u.tiene_password && (
                  <div className="border-t border-zinc-800 pt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500 leading-snug">
                      {reseteandoId === u.id
                        ? `¿Seguro? ${u.nombre} tendrá que crear una contraseña nueva al entrar.`
                        : '¿Ha olvidado la contraseña? Restablécela aquí.'}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {reseteandoId === u.id && (
                        <button
                          onClick={() => setReseteandoId(null)}
                          className="text-xs font-bold text-zinc-400 px-2 py-2 active:text-white"
                        >
                          No
                        </button>
                      )}
                      <button
                        onClick={() => handleRestablecer(u)}
                        disabled={reseteando}
                        className={[
                          'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50',
                          reseteandoId === u.id
                            ? 'bg-amber-600 text-white active:bg-amber-700'
                            : 'bg-zinc-800 text-zinc-300 active:bg-zinc-700',
                        ].join(' ')}
                      >
                        <KeyRound size={13} />
                        {reseteando && reseteandoId === u.id ? '…' : reseteandoId === u.id ? 'Sí, restablecer' : 'Restablecer'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {borrandoId && (
          <div className="mt-4 text-xs text-zinc-500 text-center">
            Pulsa el icono rojo de nuevo para confirmar.{' '}
            <button onClick={() => setBorrandoId(null)} className="text-zinc-400 underline ml-1">Cancelar</button>
          </div>
        )}
      </div>

      {/* Modal crear usuario */}
      {modalCrear && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 px-4 pb-6 sm:pb-0"
          onClick={e => e.target === e.currentTarget && setModalCrear(false)}
        >
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white">Nuevo usuario</h2>
              <button onClick={() => setModalCrear(false)} className="size-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Nombre *</label>
              <input
                autoFocus
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCrear()}
                placeholder="Nombre del usuario"
                className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-700"
              />
              <p className="text-xs text-zinc-600 mt-1.5">
                La contraseña la creará el usuario en su primer acceso.
              </p>
            </div>

            {errorForm && <p className="text-sm text-red-400 -mt-1">{errorForm}</p>}

            <button
              onClick={handleCrear}
              disabled={!nombre.trim() || guardando}
              className={[
                'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2',
                nombre.trim() && !guardando
                  ? 'bg-gradient-to-r from-red-800 to-rose-900 text-white active:opacity-90'
                  : 'bg-zinc-800 text-zinc-600',
              ].join(' ')}
            >
              <Check size={18} />
              {guardando ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle row
// ---------------------------------------------------------------------------

function ToggleRow({
  icon, label, active, loading, onToggle,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  loading: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-zinc-400">
        {icon}
        <span className="text-xs text-zinc-400">{label}</span>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className={[
          'relative w-11 h-6 rounded-full transition-colors shrink-0',
          active ? 'bg-red-700' : 'bg-zinc-700',
          loading ? 'opacity-50' : '',
        ].join(' ')}
      >
        <span className={[
          'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform',
          active ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')} />
      </button>
    </div>
  )
}
