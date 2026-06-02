import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Pencil, Trash2, X, Check, Users } from 'lucide-react'
import {
  obtenerUsuarios,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  getUsuarioActivo,
  crearEjerciciosDesdeTemplate,
  type UsuarioSupabase,
} from '../services/supabase'

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
// Estado del formulario
// ---------------------------------------------------------------------------

interface FormUsuario {
  nombre: string
  password: string
}

const FORM_VACIO: FormUsuario = {
  nombre: '', password: '',
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function AdminUsuariosPage() {
  const navigate = useNavigate()
  const usuarioActual = getUsuarioActivo()

  // Redirigir si no es admin
  useEffect(() => {
    if (!usuarioActual?.esAdmin) {
      navigate('/login', { replace: true })
    }
  }, [usuarioActual, navigate])

  const [usuarios,    setUsuarios]    = useState<UsuarioSupabase[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [error,       setError]       = useState('')

  // Modal
  const [modoModal,   setModoModal]   = useState<'crear' | 'editar' | null>(null)
  const [editando,    setEditando]    = useState<UsuarioSupabase | null>(null)
  const [form,        setForm]        = useState<FormUsuario>(FORM_VACIO)
  const [guardando,   setGuardando]   = useState(false)
  const [errorForm,   setErrorForm]   = useState('')

  // Confirmación borrado
  const [borrandoId,  setBorrandoId]  = useState<string | null>(null)

  useEffect(() => {
    cargarUsuarios()
  }, [])

  async function cargarUsuarios() {
    setCargando(true)
    setError('')
    try {
      const data = await obtenerUsuarios()
      setUsuarios(data)
    } catch {
      setError('No se pudo cargar la lista de usuarios.')
    } finally {
      setCargando(false)
    }
  }

  const abrirCrear = () => {
    setForm(FORM_VACIO)
    setErrorForm('')
    setEditando(null)
    setModoModal('crear')
  }

  const abrirEditar = (u: UsuarioSupabase) => {
    setForm({
      nombre: u.nombre,
      password: '',
    })
    setErrorForm('')
    setEditando(u)
    setModoModal('editar')
  }

  const cerrarModal = () => {
    setModoModal(null)
    setEditando(null)
    setForm(FORM_VACIO)
    setErrorForm('')
  }

  const handleGuardar = async () => {
    if (!form.nombre.trim()) {
      setErrorForm('El nombre es obligatorio.')
      return
    }
    if (modoModal === 'crear' && !form.password) {
      setErrorForm('La contraseña es obligatoria para usuarios nuevos.')
      return
    }

    setGuardando(true)
    setErrorForm('')
    try {
      if (modoModal === 'crear') {
        const nuevoUsuario = await crearUsuario({
          nombre: form.nombre.trim(),
          password: form.password,
        })
        // Crear ejercicios desde la plantilla base para el nuevo usuario
        crearEjerciciosDesdeTemplate(nuevoUsuario.id).catch(console.error)
      } else if (editando) {
        await actualizarUsuario(editando.id, {
          nombre: form.nombre.trim(),
          password: form.password || undefined,
        })
      }
      cerrarModal()
      await cargarUsuarios()
    } catch (e) {
      setErrorForm('Error al guardar. Comprueba los datos e inténtalo de nuevo.')
      console.error(e)
    } finally {
      setGuardando(false)
    }
  }

  const handleEliminar = async (id: string) => {
    if (borrandoId !== id) {
      setBorrandoId(id)
      return
    }
    try {
      await eliminarUsuario(id)
      setBorrandoId(null)
      await cargarUsuarios()
    } catch {
      setError('No se pudo eliminar el usuario.')
    }
  }

  const setF = (campo: keyof FormUsuario) => (v: string) =>
    setForm((f) => ({ ...f, [campo]: v }))

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="size-9 flex items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800"
            >
              <ChevronLeft size={22} />
            </button>
            <div>
              <h1 className="text-base font-black text-white">Usuarios</h1>
              <p className="text-xs text-zinc-600">{usuarios.length} registrado{usuarios.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button
            onClick={abrirCrear}
            className="flex items-center gap-2 bg-red-800 text-white text-sm font-bold px-4 py-2 rounded-xl active:bg-red-900 transition-colors"
          >
            <Plus size={16} />
            Añadir
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Estado de carga / error */}
        {cargando && (
          <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">
            Cargando usuarios…
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800/40 rounded-2xl px-5 py-4 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Lista vacía */}
        {!cargando && !error && usuarios.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="size-16 rounded-full bg-zinc-900 flex items-center justify-center">
              <Users size={28} className="text-zinc-700" />
            </div>
            <p className="text-zinc-500 text-sm">No hay usuarios registrados.</p>
            <button
              onClick={abrirCrear}
              className="text-sm font-bold text-red-400 bg-red-900/20 px-5 py-2.5 rounded-xl"
            >
              Añadir el primero
            </button>
          </div>
        )}

        {/* Lista de usuarios */}
        {!cargando && usuarios.length > 0 && (
          <ul className="flex flex-col gap-3">
            {usuarios.map((u) => (
              <li
                key={u.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 flex items-start gap-4"
              >
                {/* Avatar */}
                <div className={[
                  'size-12 rounded-full flex items-center justify-center shrink-0 text-white font-black',
                  colorAvatar(u.nombre),
                ].join(' ')}>
                  {iniciales(u.nombre)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold text-white">{u.nombre}</p>
                    {u.es_admin && (
                      <span className="text-xs font-bold bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">
                        Admin
                      </span>
                    )}
                  </div>
                  {u.created_at && (
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Desde {new Date(u.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => abrirEditar(u)}
                    className="size-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 active:bg-zinc-700"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleEliminar(u.id)}
                    className={[
                      'size-9 flex items-center justify-center rounded-xl transition-colors',
                      borrandoId === u.id
                        ? 'bg-red-700 text-white'
                        : 'bg-zinc-800 text-zinc-500 active:bg-zinc-700',
                    ].join(' ')}
                    title={borrandoId === u.id ? 'Pulsa de nuevo para confirmar' : 'Eliminar'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {borrandoId && (
          <div className="mt-4 text-xs text-zinc-500 text-center">
            Pulsa el icono rojo de nuevo para confirmar la eliminación.
            <button
              onClick={() => setBorrandoId(null)}
              className="ml-2 text-zinc-400 underline"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Modal crear / editar */}
      {modoModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 px-4 pb-6 sm:pb-0"
          onClick={(e) => e.target === e.currentTarget && cerrarModal()}
        >
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

            {/* Header modal */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-white">
                {modoModal === 'crear' ? 'Nuevo usuario' : `Editar: ${editando?.nombre}`}
              </h2>
              <button
                onClick={cerrarModal}
                className="size-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400"
              >
                <X size={16} />
              </button>
            </div>

            {/* Campos */}
            <CampoTexto label="Nombre *" value={form.nombre} onChange={setF('nombre')} placeholder="Nombre completo" />
            <CampoTexto
              label={modoModal === 'editar' ? 'Nueva contraseña (dejar en blanco para no cambiar)' : 'Contraseña *'}
              value={form.password}
              onChange={setF('password')}
              placeholder="Contraseña"
              type="password"
            />

            {errorForm && (
              <p className="text-sm text-red-400 -mt-1">{errorForm}</p>
            )}

            {/* Botón guardar */}
            <button
              onClick={handleGuardar}
              disabled={guardando}
              className={[
                'w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-2',
                guardando
                  ? 'bg-zinc-800 text-zinc-600'
                  : 'bg-gradient-to-r from-red-800 to-rose-900 text-white active:opacity-90',
              ].join(' ')}
            >
              <Check size={18} />
              {guardando ? 'Guardando…' : modoModal === 'crear' ? 'Crear usuario' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campo de texto reutilizable
// ---------------------------------------------------------------------------

function CampoTexto({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600
                   focus:outline-none focus:ring-2 focus:ring-red-700"
      />
    </div>
  )
}
