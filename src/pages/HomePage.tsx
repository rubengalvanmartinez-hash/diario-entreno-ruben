import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dumbbell, Scale, AlertCircle, RefreshCw, Users, ChevronDown } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore, selectTotalPendientes } from '../store/useFitLogStore'
import {
  getUsuarioActivo,
  obtenerUsuarios,
  cargarDatosUsuario,
  obtenerEjerciciosUsuario,
  crearEjerciciosDesdeTemplate,
  setPerfilVisto,
  getPerfilVisto,
  type UsuarioSupabase,
} from '../services/supabase'

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES       = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function fechaLarga() {
  const hoy = new Date()
  return `${DIAS_SEMANA[hoy.getDay()]}, ${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`
}

export default function HomePage() {
  const navigate        = useNavigate()
  const sesionActiva    = useFitLogStore(useShallow((s) => s.sesionActiva))
  const totalPendientes = useFitLogStore(selectTotalPendientes)

  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)] px-5 pt-10 pb-6 gap-8">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-black tracking-tight text-white leading-tight">Diario de entreno<br />de Rubén</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-400 capitalize">{fechaLarga()}</p>
      </div>

      {/* Sesión en curso — banner de continuación */}
      {sesionActiva && (
        <button
          onClick={() => navigate(`/rutina/${sesionActiva.dia}`)}
          className="flex items-center gap-4 rounded-2xl bg-blue-500/10 border border-blue-500/30 px-5 py-4 text-left active:scale-[0.98] transition-transform"
        >
          <div className="size-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
            <Dumbbell size={20} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-400">Sesión en curso</p>
            <p className="text-xs text-zinc-400">
              {`Día ${sesionActiva.dia}`} ·{' '}
              {sesionActiva.ejercicios.filter((e) => e.completado).length}/
              {sesionActiva.ejercicios.length} ejercicios
            </p>
          </div>
          <span className="ml-auto text-zinc-500 text-lg">›</span>
        </button>
      )}

      {/* Días desde el último entrenamiento */}
      <DiasDesdeUltimo />

      {/* Acciones principales */}
      <div className="flex flex-col gap-4">
        <ActionCard
          icon={<Dumbbell size={28} />}
          title="Iniciar rutina"
          subtitle="Elige el día y empieza"
          color="blue"
          onClick={() => navigate('/rutina')}
        />
        <ActionCard
          icon={<Scale size={28} />}
          title="Registrar peso"
          subtitle="Anota tu peso de hoy"
          color="emerald"
          onClick={() => navigate('/peso')}
        />
      </div>

      {/* Selector de perfil para admins */}
      <SelectorPerfilAdmin />

      {/* Badge de sincronización pendiente */}
      {totalPendientes > 0 && (
        <div className="mt-auto flex items-center gap-2 rounded-xl bg-orange-500/10 border border-orange-500/25 px-4 py-3">
          <AlertCircle size={16} className="text-orange-400 shrink-0" />
          <p className="text-xs text-orange-300">
            {totalPendientes} registro{totalPendientes > 1 ? 's' : ''} pendiente{totalPendientes > 1 ? 's' : ''} de sincronizar
          </p>
          <RefreshCw size={14} className="text-orange-400 ml-auto shrink-0" />
        </div>
      )}
    </div>
  )
}

// ── SelectorPerfilAdmin ───────────────────────────────────────────────────────

function SelectorPerfilAdmin() {
  const navigate = useNavigate()
  const usuario = getUsuarioActivo()

  const [usuarios,   setUsuarios]   = useState<UsuarioSupabase[]>([])
  const [cargando,   setCargando]   = useState(false)
  const [cargandoDatos, setCargandoDatos] = useState(false)
  const [abierto,    setAbierto]    = useState(false)
  const perfilActivo = getPerfilVisto()

  useEffect(() => {
    if (!usuario?.esAdmin || !abierto || usuarios.length > 0) return
    setCargando(true)
    obtenerUsuarios()
      .then(setUsuarios)
      .catch(console.error)
      .finally(() => setCargando(false))
  }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!usuario?.esAdmin) return null

  const handleSeleccionar = async (u: UsuarioSupabase) => {
    setAbierto(false)
    if (u.id === (perfilActivo?.id ?? '')) return // ya viendo este perfil
    setCargandoDatos(true)
    try {
      setPerfilVisto({ id: u.id, nombre: u.nombre })
      // Disparar evento storage para que Layout actualice el banner
      window.dispatchEvent(new Event('storage'))
      const { sesiones, registrosPeso } = await cargarDatosUsuario(u.id)
      useFitLogStore.getState().importarHistorialCompleto(sesiones, registrosPeso)
      const ejercicios = await obtenerEjerciciosUsuario(u.id)
      if (ejercicios) {
        useFitLogStore.getState().importarEjercicios(ejercicios)
      } else {
        const nuevos = await crearEjerciciosDesdeTemplate(u.id)
        useFitLogStore.getState().importarEjercicios(nuevos)
      }
    } catch (e) { console.error(e) }
    setCargandoDatos(false)
    navigate('/', { replace: true })
  }

  if (cargandoDatos) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
        <RefreshCw size={13} className="animate-spin" />
        Cargando perfil…
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto(v => !v)}
        className="flex items-center gap-2 text-xs font-semibold text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-xl active:bg-zinc-800 transition-colors"
      >
        <Users size={14} className="text-zinc-500" />
        Ver perfil de…
        <ChevronDown size={13} className={['text-zinc-600 transition-transform', abierto ? 'rotate-180' : ''].join(' ')} />
      </button>

      {abierto && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-xl z-40 overflow-hidden">
          {cargando && (
            <p className="text-xs text-zinc-500 px-4 py-3">Cargando…</p>
          )}
          {!cargando && usuarios.map((u, i) => (
            <button
              key={u.id}
              onClick={() => handleSeleccionar(u)}
              className={[
                'w-full flex items-center gap-3 px-4 py-3 text-left active:bg-zinc-800 transition-colors',
                i > 0 ? 'border-t border-zinc-800' : '',
              ].join(' ')}
            >
              <span className="text-sm text-white font-medium">{u.nombre}</span>
              {u.es_admin && <span className="text-[10px] text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full ml-auto">Admin</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DiasDesdeUltimo ───────────────────────────────────────────────────────────

function DiasDesdeUltimo() {
  const historial = useFitLogStore(useShallow((s) => s.historialSesiones))

  const dias = useMemo(() => {
    if (historial.length === 0) return null
    const ultima = historial.reduce((a, b) => a.fecha > b.fecha ? a : b)
    const hoy    = new Date().toISOString().slice(0, 10)
    return Math.round(
      (new Date(hoy).getTime() - new Date(ultima.fecha).getTime()) / 86_400_000,
    )
  }, [historial])

  if (dias === null) return null

  const mensaje =
    dias === 0 ? '¡Acabas de entrenar!'       :
    dias === 1 ? 'Descansando, mañana toca'   :
    dias === 2 ? 'Listo para volver'          :
                 '¡Es hora de entrenar!'

  const colorNum = dias === 0 ? 'text-emerald-400' : dias <= 2 ? 'text-zinc-300' : 'text-orange-400'
  const colorMsg = dias === 0 ? 'text-emerald-400' : dias <= 2 ? 'text-zinc-400' : 'text-orange-400'
  const borderCl = dias === 0 ? 'border-emerald-500/20' : dias <= 2 ? 'border-zinc-800' : 'border-orange-500/20'
  const bgCl     = dias === 0 ? 'bg-emerald-500/5'      : dias <= 2 ? 'bg-zinc-900'     : 'bg-orange-500/5'

  return (
    <div className={['flex items-center gap-4 rounded-2xl border px-4 py-3', bgCl, borderCl].join(' ')}>
      <div>
        <p className={['text-3xl font-black tabular-nums leading-none', colorNum].join(' ')}>
          {dias === 0 ? 'Hoy' : `${dias}d`}
        </p>
        <p className="text-[11px] text-zinc-600 mt-0.5">último entreno</p>
      </div>
      <p className={['ml-auto text-sm font-semibold text-right', colorMsg].join(' ')}>
        {mensaje}
      </p>
    </div>
  )
}

// ── ActionCard ────────────────────────────────────────────────────────────────

type Color = 'blue' | 'emerald'

const COLOR_MAP: Record<Color, { bg: string; icon: string; border: string }> = {
  blue:    { bg: 'bg-blue-500/10',    icon: 'text-blue-400',    border: 'border-blue-500/20'    },
  emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', border: 'border-emerald-500/20' },
}

function ActionCard({
  icon, title, subtitle, color, onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  color: Color
  onClick: () => void
}) {
  const c = COLOR_MAP[color]
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-5 rounded-2xl border px-6 py-5 text-left',
        'active:scale-[0.98] transition-transform',
        c.bg, c.border,
      ].join(' ')}
    >
      <span className={c.icon}>{icon}</span>
      <div>
        <p className="text-base font-bold text-white">{title}</p>
        <p className="text-sm text-zinc-400">{subtitle}</p>
      </div>
      <span className="ml-auto text-zinc-600 text-xl">›</span>
    </button>
  )
}
