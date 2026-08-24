/**
 * Progresión por ejercicio y aviso de deload.
 *  - Analiza el 1RM estimado (o reps si es peso corporal) de las últimas
 *    sesiones de cada ejercicio y lo clasifica: progresando / estable /
 *    estancado / en regresión.
 *  - Si ≥3 ejercicios recientes están estancados o en regresión, sugiere
 *    una semana de descarga.
 * Colores de ESTADO reservados (good/warning/serious) siempre con icono +
 * texto; las sparklines usan un único azul de serie y el texto tokens de texto.
 */
import { useMemo, useState } from 'react'
import { Activity, TrendingUp, TrendingDown, Minus, PauseCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useHistorialRef } from '../hooks/useHistorialRef'
import { analizarProgresion, evaluarDeload, type AnalisisEjercicio, type EstadoProgresion } from '../utils/progresion'
import { ICONO_GRUPO } from './gruposUI'

const VISIBLES = 6

const ESTADO_CFG: Record<EstadoProgresion, { label: string; color: string; icono: React.ReactNode }> = {
  progresando: { label: 'Progresando', color: '#0ca30c', icono: <TrendingUp size={11} strokeWidth={2.5} /> },
  estable:     { label: 'Estable',     color: '#a1a1aa', icono: <Minus size={11} strokeWidth={2.5} /> },
  estancado:   { label: 'Estancado',   color: '#fab219', icono: <PauseCircle size={11} strokeWidth={2.5} /> },
  regresion:   { label: 'Regresión',   color: '#ec835a', icono: <TrendingDown size={11} strokeWidth={2.5} /> },
}

export default function ProgresionCard() {
  const historial = useHistorialRef()
  const [verTodos, setVerTodos] = useState(false)
  const [filtro, setFiltro] = useState<EstadoProgresion | null>(null)

  const analisis = useMemo(() => analizarProgresion(historial), [historial])
  const deload   = useMemo(() => evaluarDeload(analisis), [analisis])

  if (analisis.length === 0) return null

  const conteo = (e: EstadoProgresion) => analisis.filter((a) => a.estado === e).length
  const filtrados = filtro ? analisis.filter((a) => a.estado === filtro) : analisis
  const visibles  = verTodos ? filtrados : filtrados.slice(0, VISIBLES)

  return (
    <div className="mx-4 mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Cabecera */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <div className="size-9 rounded-xl bg-violet-900/30 flex items-center justify-center shrink-0">
          <Activity size={16} className="text-violet-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Progresión</p>
          <p className="text-[11px] text-zinc-500">1RM estimado de las últimas sesiones por ejercicio</p>
        </div>
      </div>

      {/* Aviso de deload */}
      {deload.sugerir && (
        <div className="mx-4 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 flex gap-2.5">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-300">
              Toca descarga: {deload.afectados.length} ejercicios sin mejorar
            </p>
            <p className="text-[11px] text-amber-200/70 mt-0.5 leading-relaxed">
              {deload.afectados.slice(0, 4).map((a) => a.nombre).join(', ')}
              {deload.afectados.length > 4 ? '…' : ''} llevan varias sesiones estancados o cayendo.
              Considera una semana con ~la mitad de series y peso cómodo, y vuelve a subir.
            </p>
          </div>
        </div>
      )}

      {/* Resumen por estado (filtros) */}
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        {(Object.keys(ESTADO_CFG) as EstadoProgresion[]).map((e) => {
          const n = conteo(e)
          if (n === 0) return null
          const cfg = ESTADO_CFG[e]
          const activo = filtro === e
          return (
            <button
              key={e}
              onClick={() => { setFiltro(activo ? null : e); setVerTodos(false) }}
              aria-pressed={activo}
              className={[
                'flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition-colors',
                activo ? 'border-zinc-500 bg-zinc-800 text-white' : 'border-zinc-800 bg-zinc-900 text-zinc-400 active:bg-zinc-800',
              ].join(' ')}
            >
              <span style={{ color: cfg.color }}>{cfg.icono}</span>
              {cfg.label}
              <span className="text-zinc-500 tabular-nums">{n}</span>
            </button>
          )
        })}
      </div>

      {/* Filas por ejercicio */}
      <ul className="px-2 pb-2">
        {visibles.map((a) => <FilaEjercicio key={a.clave} a={a} />)}
      </ul>

      {filtrados.length > VISIBLES && (
        <button
          onClick={() => setVerTodos((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-2.5 border-t border-zinc-800 text-xs font-bold text-zinc-400 active:bg-zinc-800"
        >
          {verTodos ? <>Ver menos <ChevronUp size={13} /></> : <>Ver todos ({filtrados.length}) <ChevronDown size={13} /></>}
        </button>
      )}
    </div>
  )
}

function FilaEjercicio({ a }: { a: AnalisisEjercicio }) {
  const cfg = ESTADO_CFG[a.estado]
  const unidad = a.metrica === 'e1rm' ? 'kg 1RM' : 'reps'
  return (
    <li className="flex items-center gap-2.5 rounded-xl px-2 py-2">
      <span className="size-5 shrink-0 text-zinc-600" title={a.grupo} aria-hidden>{ICONO_GRUPO[a.grupo]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-200 truncate">{a.nombre}</p>
        <p className="text-[10px] text-zinc-500 tabular-nums">
          {a.ultimo} {unidad}
          <span className="text-zinc-600"> · mejor {a.mejor}</span>
          {(a.estado === 'estancado' || a.estado === 'regresion') && (
            <span className="text-zinc-500"> · {a.sesionesSinMejora} ses. sin mejorar</span>
          )}
        </p>
      </div>
      <Sparkline valores={a.puntos.map((p) => p.valor)} />
      <span
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold shrink-0 w-[5.6rem] justify-center"
        style={{ color: cfg.color, background: `${cfg.color}1a` }}
      >
        {cfg.icono}
        {cfg.label}
      </span>
    </li>
  )
}

/** Mini-línea de las últimas sesiones (un solo azul de serie; el estado va en la insignia). */
function Sparkline({ valores }: { valores: number[] }) {
  const W = 72, H = 26, PAD = 3
  if (valores.length < 2) return <span style={{ width: W }} />
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const rango = max - min || 1
  const x = (i: number) => PAD + (i / (valores.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - min) / rango) * (H - PAD * 2)
  const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const xf = x(valores.length - 1), yf = y(valores[valores.length - 1])
  const yMejor = y(max)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <line x1={PAD} y1={yMejor} x2={W - PAD} y2={yMejor} stroke="#3f3f46" strokeWidth="1" strokeDasharray="2 3" />
      <polyline points={puntos} fill="none" stroke="#3987e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xf} cy={yf} r="2.6" fill="#ffffff" stroke="#18181b" strokeWidth="1.4" />
    </svg>
  )
}
