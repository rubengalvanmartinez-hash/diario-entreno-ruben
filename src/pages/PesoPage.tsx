import { useState, useMemo, useRef, useEffect } from 'react'
import { Check, Scale, TrendingUp, Minus, ArrowUp, ArrowDown, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useNavigate } from 'react-router-dom'
import { useFitLogStore } from '../store/useFitLogStore'
import type { PerfilCorporal, CategoriaImc } from '../types/models'
import { getUsuarioActivo, sincronizarPesoSupabase, getRubenUUID, guardarComposicion, guardarPerfilCorporal } from '../services/supabase'
import { sincronizarPeso } from '../services/googleSheets'

const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre']

function fechaLarga() {
  const h = new Date()
  return `${DIAS[h.getDay()]}, ${h.getDate()} de ${MESES[h.getMonth()]}`
}

export default function PesoPage() {
  const navigate = useNavigate()
  const registrarPeso = useFitLogStore((s) => s.registrarPeso)

  // Solo usuarios con puede_peso_corporal pueden acceder
  useEffect(() => {
    const usuario = getUsuarioActivo()
    if (usuario && !usuario.puedePesoCorporal) navigate('/', { replace: true })
  }, [navigate])

  const [valor,     setValor]     = useState('')
  const [guardado,  setGuardado]  = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const numerico = parseFloat(valor.replace(',', '.'))
  const valido   = !isNaN(numerico) && numerico > 0

  const handleGuardar = () => {
    if (!valido) return
    registrarPeso(numerico)
    // Capturar ID del registro recién añadido (está en [0] porque se prepend)
    const pesoId = useFitLogStore.getState().registrosPeso[0]?.id ?? ''
    setGuardado(true)
    setSyncError(null)
    setTimeout(() => {
      setValor('')
      setGuardado(false)
    }, 2000)
    const usuario = getUsuarioActivo()
    if (usuario && usuario.puedePesoCorporal) {
      const uid = usuario.esRuben ? getRubenUUID() : usuario.id
      const fecha = new Date().toISOString().slice(0, 10)
      const { googleConfig, isAuthenticated } = useFitLogStore.getState()
      const registro = { id: '', fecha, pesoKg: numerico, sincronizado: false }
      // Google Sheets solo para Rubén
      const sheetsPromise =
        usuario.esRuben && isAuthenticated && googleConfig.spreadsheetId
          ? sincronizarPeso(googleConfig.accessToken, googleConfig.spreadsheetId, registro)
          : Promise.resolve()
      Promise.allSettled([
        sincronizarPesoSupabase(uid, { fecha, pesoKg: numerico }),
        sheetsPromise,
      ]).then((results) => {
        if (results[0].status === 'fulfilled' && pesoId) {
          useFitLogStore.getState().marcarPesoSincronizado(pesoId)
        }
        const failed = results.find(r => r.status === 'rejected')
        if (failed && failed.status === 'rejected') {
          setSyncError(`Error sync: ${(failed.reason as Error)?.message ?? 'error desconocido'}`)
          setTimeout(() => setSyncError(null), 6000)
        }
      })
    }
  }

  return (
    <div className="flex flex-col items-center min-h-[calc(100svh-4rem)] px-6 pt-12 pb-8 gap-8">

      {/* Icono + fecha */}
      <div className="flex flex-col items-center gap-3">
        <div className="size-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Scale size={32} className="text-emerald-400" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-black text-white">Peso diario</h2>
          <p className="text-sm text-zinc-400 capitalize mt-0.5">{fechaLarga()}</p>
        </div>
      </div>

      {/* Input grande */}
      <div className="flex items-end gap-3">
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGuardar()}
          placeholder="0.0"
          autoFocus
          className="w-44 bg-transparent text-right text-6xl font-black text-white
                     border-b-2 border-zinc-700 focus:border-emerald-500 focus:outline-none
                     pb-1 transition-colors placeholder-zinc-700"
        />
        <span className="text-2xl font-bold text-zinc-500 pb-2">kg</span>
      </div>

      {/* Botón */}
      <button
        onClick={handleGuardar}
        disabled={!valido}
        className={[
          'w-full max-w-xs flex items-center justify-center gap-2 rounded-2xl py-4',
          'text-base font-bold transition-all',
          guardado
            ? 'bg-green-600 text-white'
            : valido
              ? 'bg-emerald-600 text-white active:bg-emerald-700'
              : 'bg-zinc-800 text-zinc-600',
        ].join(' ')}
      >
        <Check size={20} strokeWidth={2.5} />
        {guardado ? '¡Guardado!' : 'Guardar peso'}
      </button>

      {/* Toast error sync */}
      {syncError && (
        <div className="w-full max-w-xs flex items-start gap-2 bg-red-950 border border-red-700/60 rounded-2xl px-4 py-3">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-300">Error de sincronización</p>
            <p className="text-[11px] text-red-400/80 mt-0.5 break-all">{syncError}</p>
          </div>
        </div>
      )}

      {/* Tarjeta de media */}
      <MediaSieteDias />

      {/* Gráfica de evolución */}
      <GraficaPeso />

      {/* Composición corporal */}
      <ComposicionCorporal />

      {/* Historial reciente */}
      <HistorialReciente />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoHaceN(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function mediaVentana(
  registros: { fecha: string; pesoKg: number }[],
  desde: string,
  hasta: string,
): { media: number; count: number } | null {
  const ventana = registros.filter((r) => r.fecha >= desde && r.fecha <= hasta)
  if (ventana.length < 1) return null
  const suma = ventana.reduce((acc, r) => acc + r.pesoKg, 0)
  return { media: suma / ventana.length, count: ventana.length }
}

type Tendencia = 'subiendo' | 'bajando' | 'estable'

// ── MediaSieteDias ────────────────────────────────────────────────────────────

function MediaSieteDias() {
  const registros = useFitLogStore(useShallow((s) => s.registrosPeso))

  const stats = useMemo(() => {
    const hoy  = isoHaceN(0)
    const d6   = isoHaceN(6)
    const d7   = isoHaceN(7)
    const d13  = isoHaceN(13)
    const d20  = isoHaceN(20)

    const semanaActual   = mediaVentana(registros, d6,  hoy)
    const semanaAnterior = mediaVentana(registros, d13, d7)
    const movil21        = mediaVentana(registros, d20, hoy)

    let tendencia: Tendencia | null = null
    let diff: number | null = null
    if (semanaActual && semanaAnterior) {
      diff = semanaActual.media - semanaAnterior.media
      if (Math.abs(diff) < 0.2) tendencia = 'estable'
      else if (diff > 0)        tendencia = 'subiendo'
      else                      tendencia = 'bajando'
    }

    return { semanaActual, semanaAnterior, movil21, tendencia, diff }
  }, [registros])

  const { semanaActual, semanaAnterior, movil21, tendencia, diff } = stats

  if (!semanaActual && !movil21) {
    return (
      <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
            <Scale size={18} className="text-zinc-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-400">Sin suficientes datos</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Registra tu peso varios días para ver la media.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Subiendo → verde (bueno para hipertrofia); bajando → rojo
  const tendenciaConfig: Record<Tendencia, {
    icon: React.ReactNode; color: string; bg: string; label: string
  }> = {
    subiendo: {
      icon:  <ArrowUp   size={20} />,
      color: 'text-emerald-400',
      bg:    'bg-emerald-500/15',
      label: 'Tendencia: subiendo',
    },
    bajando: {
      icon:  <ArrowDown size={20} />,
      color: 'text-red-400',
      bg:    'bg-red-500/15',
      label: 'Tendencia: bajando',
    },
    estable: {
      icon:  <Minus     size={20} />,
      color: 'text-zinc-400',
      bg:    'bg-zinc-700/40',
      label: 'Tendencia: estable',
    },
  }

  const cfg = tendencia ? tendenciaConfig[tendencia] : null

  const mediaDisplay = semanaActual?.media ?? movil21!.media
  const countDisplay = semanaActual?.count ?? movil21!.count
  const labelCount   = semanaActual
    ? `Media últimos 7 días · ${countDisplay} registro${countDisplay !== 1 ? 's' : ''}`
    : `Media 21 días · ${countDisplay} registro${countDisplay !== 1 ? 's' : ''}`

  return (
    <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className={[
          'size-12 rounded-full flex items-center justify-center shrink-0',
          cfg ? cfg.bg : 'bg-emerald-500/15',
        ].join(' ')}>
          <span className={cfg ? cfg.color : 'text-emerald-400'}>
            {cfg ? cfg.icon : <TrendingUp size={22} />}
          </span>
        </div>
        <div>
          <p className="text-3xl font-black text-white leading-none">
            {mediaDisplay.toFixed(1)}
            <span className="text-lg font-bold text-zinc-400 ml-1">kg</span>
          </p>
          <p className="text-xs text-zinc-500 mt-1">{labelCount}</p>
        </div>
      </div>

      {/* Detalle de medias */}
      {semanaActual && (
        <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Últimos 7 días</span>
            <span className="text-xs font-bold tabular-nums text-white">{semanaActual.media.toFixed(2)} kg</span>
          </div>
          {semanaAnterior && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Semana anterior</span>
              <span className="text-xs font-bold tabular-nums text-zinc-400">{semanaAnterior.media.toFixed(2)} kg</span>
            </div>
          )}
          {cfg && diff !== null && (
            <div className="flex items-center justify-between">
              <span className={['text-xs font-semibold', cfg.color].join(' ')}>{cfg.label}</span>
              <span className={['text-xs font-bold tabular-nums', cfg.color].join(' ')}>
                {diff > 0 ? '+' : ''}{diff.toFixed(2)} kg
              </span>
            </div>
          )}
          {!cfg && (
            <p className="text-xs text-zinc-600">
              Registra la semana anterior para ver la tendencia.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── GraficaPeso ───────────────────────────────────────────────────────────────

function GraficaPeso() {
  const registros = useFitLogStore(useShallow((s) => s.registrosPeso))
  const [tooltip, setTooltip] = useState<{ x: number; y: number; fecha: string; peso: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const datos = useMemo(() => {
    return [...registros]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(-60)
  }, [registros])

  if (datos.length < 3) {
    return (
      <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 px-5 py-8 flex items-center justify-center">
        <p className="text-sm text-zinc-500 text-center">Añade más registros para ver la gráfica</p>
      </div>
    )
  }

  const W = 300, H = 170
  const PAD = { top: 16, right: 12, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const pesos = datos.map((d) => d.pesoKg)
  const rawMin = Math.min(...pesos)
  const rawMax = Math.max(...pesos)
  const margin = Math.max((rawMax - rawMin) * 0.2, 0.5)
  const minP = rawMin - margin
  const maxP = rawMax + margin

  const toX = (i: number) =>
    PAD.left + (datos.length === 1 ? innerW / 2 : (i / (datos.length - 1)) * innerW)
  const toY = (p: number) =>
    PAD.top + innerH - ((p - minP) / (maxP - minP)) * innerH

  const points = datos.map((d, i) => ({
    x: toX(i),
    y: toY(d.pesoKg),
    fecha: d.fecha,
    peso: d.pesoKg,
  }))

  // Smooth cubic bezier path
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      const cx = (prev.x + curr.x) / 2
      d += ` C ${cx} ${prev.y} ${cx} ${curr.y} ${curr.x} ${curr.y}`
    }
    return d
  }

  const linePath = smoothPath(points)
  const lastPt = points[points.length - 1]
  const firstPt = points[0]
  const areaPath = `${linePath} L ${lastPt.x} ${PAD.top + innerH} L ${firstPt.x} ${PAD.top + innerH} Z`

  // 7-day moving average
  const movAvgPoints = datos.map((_, i) => {
    const window = datos.slice(Math.max(0, i - 6), i + 1)
    const avg = window.reduce((s, r) => s + r.pesoKg, 0) / window.length
    return { x: toX(i), y: toY(avg) }
  })
  const movAvgPath = smoothPath(movAvgPoints)

  // Y axis ticks (4 steps)
  const yTicks = [0, 1, 2, 3, 4].map((i) => minP + (i / 4) * (maxP - minP))

  // X axis ticks
  const xTickIndices =
    datos.length <= 7
      ? datos.map((_, i) => i)
      : [0, Math.round(dados_length_third(datos.length)), Math.round(2 * dados_length_third(datos.length)), datos.length - 1]

  function dados_length_third(len: number) { return len / 3 }

  const formatFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    let closest = points[0]
    let minDist = Math.abs(px - points[0].x)
    for (const p of points) {
      const dist = Math.abs(px - p.x)
      if (dist < minDist) { minDist = dist; closest = p }
    }
    if (minDist < (innerW / datos.length) * 0.8) {
      setTooltip({ x: closest.x, y: closest.y, fecha: closest.fecha, peso: closest.peso })
    } else {
      setTooltip(null)
    }
  }

  const ttW = 64, ttH = 28
  const ttX = tooltip ? (tooltip.x + ttW + 12 > W ? tooltip.x - ttW - 8 : tooltip.x + 8) : 0
  const ttY = tooltip ? Math.max(PAD.top, tooltip.y - ttH / 2) : 0

  return (
    <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Evolución del peso</p>
        <div className="flex items-center gap-4 mt-1.5">
          <div className="flex items-center gap-1.5">
            <svg width="16" height="4" viewBox="0 0 16 4"><line x1="0" y1="2" x2="16" y2="2" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/></svg>
            <span className="text-xs text-zinc-500">Peso</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="16" height="4" viewBox="0 0 16 4"><line x1="0" y1="2" x2="16" y2="2" stroke="#a78bfa" strokeWidth="2" strokeDasharray="4 2" strokeLinecap="round"/></svg>
            <span className="text-xs text-zinc-500">Media 7d</span>
          </div>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ touchAction: 'pan-y' }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id="pesoAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines horizontal */}
        {yTicks.map((tick, i) => (
          <line
            key={i}
            x1={PAD.left} y1={toY(tick)}
            x2={W - PAD.right} y2={toY(tick)}
            stroke="#27272a" strokeWidth="1"
          />
        ))}

        {/* Y labels */}
        {yTicks.map((tick, i) => (
          <text
            key={i}
            x={PAD.left - 4} y={toY(tick) + 3.5}
            textAnchor="end" fill="#52525b" fontSize="7.5"
          >
            {tick.toFixed(1)}
          </text>
        ))}

        {/* X labels */}
        {xTickIndices.map((idx) => (
          <text
            key={idx}
            x={toX(idx)} y={H - 6}
            textAnchor="middle" fill="#52525b" fontSize="7.5"
          >
            {formatFecha(datos[idx].fecha)}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#pesoAreaGrad)" />

        {/* Moving average line */}
        <path
          d={movAvgPath}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1.5"
          strokeDasharray="5 3"
          strokeLinecap="round"
        />

        {/* Main line */}
        <path
          d={linePath}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y}
            r={tooltip?.x === p.x && tooltip?.y === p.y ? 4 : 2.5}
            fill="#34d399"
            stroke="#18181b"
            strokeWidth="1.5"
          />
        ))}

        {/* Tooltip */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x} y1={PAD.top}
              x2={tooltip.x} y2={PAD.top + innerH}
              stroke="#52525b" strokeWidth="1" strokeDasharray="3 2"
            />
            <circle cx={tooltip.x} cy={tooltip.y} r="4.5" fill="#34d399" stroke="#ffffff" strokeWidth="1.5" />
            <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="7" fill="#27272a" stroke="#3f3f46" strokeWidth="0.8" />
            <text x={ttX + ttW / 2} y={ttY + 11} textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="bold">
              {tooltip.peso.toFixed(1)} kg
            </text>
            <text x={ttX + ttW / 2} y={ttY + 22} textAnchor="middle" fill="#a1a1aa" fontSize="8">
              {formatFecha(tooltip.fecha)}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}

// ── Composición corporal ──────────────────────────────────────────────────────

function calcularImc(pesoKg: number, alturaCm: number): number {
  const alturaM = alturaCm / 100
  return pesoKg / (alturaM * alturaM)
}

function categoriaImc(imc: number): CategoriaImc {
  if (imc < 18.5) return 'bajo peso'
  if (imc < 25)   return 'normal'
  if (imc < 30)   return 'sobrepeso'
  return 'obesidad'
}

const CATEGORIA_COLOR: Record<CategoriaImc, string> = {
  'bajo peso': 'text-blue-400',
  'normal':    'text-emerald-400',
  'sobrepeso': 'text-yellow-400',
  'obesidad':  'text-red-400',
}

/**
 * Fórmula de Hodgdon-Beckett (US Navy), misma que nutricionistasydietistas.com
 * Hombres:  % = 495 / (1.0324  − 0.19077×log10(cintura−cuello)  + 0.15456×log10(altura)) − 450
 * Mujeres:  % = 495 / (1.29579 − 0.35004×log10(cintura+cadera−cuello) + 0.22100×log10(altura)) − 450
 * Todos los valores en cm.
 */
function calcularPctGrasa(
  sexo: 'hombre' | 'mujer',
  alturaCm: number,
  cinturaCm: number,
  cuelloCm: number,
  caderaCm?: number,
): number | null {
  if (sexo === 'hombre') {
    const diff = cinturaCm - cuelloCm
    if (diff <= 0) return null
    const denom = 1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(alturaCm)
    if (denom <= 0) return null
    return 495 / denom - 450
  } else {
    if (!caderaCm || caderaCm <= 0) return null
    const sum = cinturaCm + caderaCm - cuelloCm
    if (sum <= 0) return null
    const denom = 1.29579 - 0.35004 * Math.log10(sum) + 0.22100 * Math.log10(alturaCm)
    if (denom <= 0) return null
    return 495 / denom - 450
  }
}

function ComposicionCorporal() {
  const perfilStore         = useFitLogStore(useShallow((s) => s.perfilCorporal))
  const historial           = useFitLogStore(useShallow((s) => s.historialComposicion.slice(0, 5)))
  const registrosPeso       = useFitLogStore(useShallow((s) => s.registrosPeso))
  const setPerfilCorporal   = useFitLogStore((s) => s.setPerfilCorporal)
  const registrarComposicion = useFitLogStore((s) => s.registrarComposicion)

  const [open,      setOpen]      = useState(false)
  const [guardado,  setGuardado]  = useState(false)

  // Formulario
  const [altura,  setAltura]  = useState(String(perfilStore?.alturaCm  ?? ''))
  const [edad,    setEdad]    = useState(String(perfilStore?.edad       ?? ''))
  const [sexo,    setSexo]    = useState<'hombre' | 'mujer'>(perfilStore?.sexo ?? 'hombre')
  const [cintura, setCintura] = useState(String(perfilStore?.cinturaCm ?? ''))
  const [cuello,  setCuello]  = useState(String(perfilStore?.cuelloCm  ?? ''))
  const [cadera,  setCadera]  = useState(String(perfilStore?.caderaCm  ?? ''))

  const pesoActual = registrosPeso[0]?.pesoKg ?? null

  // Formulario completo: mínimo altura + cintura + cuello (+ cadera si mujer)
  const formularioCompleto = useMemo(() => {
    const alturaOk  = !isNaN(parseFloat(altura)) && parseFloat(altura) > 0
    const cinturaOk = !isNaN(parseFloat(cintura)) && parseFloat(cintura) > 0
    const cuelloOk  = !isNaN(parseFloat(cuello))  && parseFloat(cuello)  > 0
    const caderaOk  = sexo === 'hombre' || (!isNaN(parseFloat(cadera)) && parseFloat(cadera) > 0)
    return alturaOk && cinturaOk && cuelloOk && caderaOk
  }, [altura, cintura, cuello, cadera, sexo])

  // Calcular resultados solo cuando también hay peso registrado
  const resultados = useMemo(() => {
    if (!formularioCompleto || !pesoActual) return null
    const alturaNum  = parseFloat(altura)
    const cinturaNum = parseFloat(cintura)
    const cuelloNum  = parseFloat(cuello)
    const caderaNum  = parseFloat(cadera)

    const imc    = calcularImc(pesoActual, alturaNum)
    const catImc = categoriaImc(imc)

    const pctGrasa = calcularPctGrasa(
      sexo, alturaNum, cinturaNum, cuelloNum,
      sexo === 'mujer' ? caderaNum : undefined,
    )
    if (pctGrasa === null) return null
    // Limitar a rango fisiológico razonable
    const pctGrasaFinal = Math.min(Math.max(pctGrasa, 3), 60)

    const masaGrasaKg      = pesoActual * (pctGrasaFinal / 100)
    const masaLibreGrasaKg = pesoActual - masaGrasaKg
    // Aproximación: masa muscular ≈ 45% del peso corporal total (hombre entrenado)
    const masaMuscularKg   = pesoActual * 0.45
    const pctMusculo       = 45

    return { imc, catImc, pctGrasa: pctGrasaFinal, masaGrasaKg, masaLibreGrasaKg, masaMuscularKg, pctMusculo }
  }, [formularioCompleto, pesoActual, altura, edad, sexo, cintura, cuello, cadera])

  const handleRegistrar = () => {
    if (!resultados || !pesoActual) return

    const perfil: Partial<PerfilCorporal> = {
      alturaCm:  parseFloat(altura),
      edad:      parseFloat(edad) || 0,
      sexo,
      cinturaCm: parseFloat(cintura),
      cuelloCm:  parseFloat(cuello),
      ...(sexo === 'mujer' ? { caderaCm: parseFloat(cadera) } : {}),
    }
    setPerfilCorporal(perfil)

    const registroComp = {
      fecha:        new Date().toISOString().slice(0, 10),
      pesoKg:       pesoActual,
      imc:          +resultados.imc.toFixed(1),
      categoriaImc: resultados.catImc,
      pctGrasa:     +resultados.pctGrasa.toFixed(1),
      pctMusculo:   +resultados.pctMusculo.toFixed(1),
    }
    registrarComposicion(registroComp)

    // Persistir en Supabase (fire-and-forget)
    const usuarioActivo = getUsuarioActivo()
    if (usuarioActivo) {
      const idSupabase = usuarioActivo.esRuben ? getRubenUUID() : usuarioActivo.id
      guardarComposicion(idSupabase, registroComp).catch(console.error)
      guardarPerfilCorporal(idSupabase, {
        alturaCm:  parseFloat(altura),
        edad:      parseFloat(edad) || 0,
        sexo,
        cinturaCm: parseFloat(cintura),
        cuelloCm:  parseFloat(cuello),
        ...(sexo === 'mujer' ? { caderaCm: parseFloat(cadera) } : {}),
      }).catch(console.error)
    }

    setGuardado(true)
    setTimeout(() => setGuardado(false), 2000)
  }

  return (
    <div className="w-full max-w-xs">
      {/* Cabecera colapsable */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-3"
      >
        <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
          Composición corporal
        </p>
        {open
          ? <ChevronUp size={14} className="text-zinc-600" />
          : <ChevronDown size={14} className="text-zinc-600" />}
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          {!pesoActual && (
            <p className="text-xs text-zinc-500 bg-zinc-900 rounded-xl px-4 py-3">
              Registra tu peso primero para calcular la composición corporal.
            </p>
          )}

          {/* Formulario */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tus datos</p>

            {/* Sexo */}
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Sexo</label>
              <div className="flex gap-2">
                {(['hombre', 'mujer'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSexo(s)}
                    className={[
                      'flex-1 rounded-xl py-2 text-sm font-bold transition-colors capitalize',
                      sexo === s
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-800 text-zinc-400',
                    ].join(' ')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Altura + Edad */}
            <div className="grid grid-cols-2 gap-2">
              <InputCampo
                label="Altura (cm)"
                value={altura}
                onChange={setAltura}
                placeholder="175"
              />
              <InputCampo
                label="Edad"
                value={edad}
                onChange={setEdad}
                placeholder="30"
              />
            </div>

            {/* Cintura + Cuello */}
            <div className="grid grid-cols-2 gap-2">
              <InputCampo
                label="Cintura (cm)"
                value={cintura}
                onChange={setCintura}
                placeholder="80"
              />
              <InputCampo
                label="Cuello (cm)"
                value={cuello}
                onChange={setCuello}
                placeholder="37"
              />
            </div>

            {/* Cadera (solo mujeres) */}
            {sexo === 'mujer' && (
              <InputCampo
                label="Cadera (cm)"
                value={cadera}
                onChange={setCadera}
                placeholder="95"
              />
            )}
          </div>

          {/* Resultados — visible cuando el formulario está completo */}
          {formularioCompleto && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Resultados</p>

              {resultados ? (
                <div className="grid grid-cols-2 gap-3">
                  <ResultadoCard
                    label="IMC"
                    valor={resultados.imc.toFixed(1)}
                    sub={resultados.catImc}
                    colorSub={CATEGORIA_COLOR[resultados.catImc]}
                  />
                  <ResultadoCard
                    label="% Grasa"
                    valor={`${resultados.pctGrasa.toFixed(1)}%`}
                    sub="Marina EE.UU."
                    colorSub="text-zinc-500"
                  />
                  <ResultadoCard
                    label="Masa grasa"
                    valor={`${resultados.masaGrasaKg.toFixed(1)} kg`}
                    sub={`${resultados.pctGrasa.toFixed(1)}% del peso`}
                    colorSub="text-zinc-500"
                  />
                  <ResultadoCard
                    label="Masa libre grasa"
                    valor={`${resultados.masaLibreGrasaKg.toFixed(1)} kg`}
                    sub="peso − masa grasa"
                    colorSub="text-zinc-500"
                  />
                  <ResultadoCard
                    label="Masa muscular est."
                    valor={`${resultados.masaMuscularKg.toFixed(1)} kg`}
                    sub="≈45% peso (hombre)"
                    colorSub="text-zinc-500"
                  />
                  <ResultadoCard
                    label="Peso actual"
                    valor={`${pesoActual} kg`}
                    sub="último registro"
                    colorSub="text-zinc-500"
                  />
                </div>
              ) : (
                <p className="text-xs text-zinc-500 bg-zinc-800 rounded-xl px-3 py-2">
                  Registra tu peso del día (arriba) para calcular IMC y composición.
                </p>
              )}

              <p className="text-[10px] text-zinc-700 leading-snug">
                % grasa: fórmula Hodgdon-Beckett (Marina EE.UU.). Masa muscular: aproximación para hombre entrenado (peso × 0.45).
              </p>

              <button
                onClick={handleRegistrar}
                disabled={!resultados}
                className={[
                  'w-full rounded-2xl py-3 font-bold text-sm transition-colors flex items-center justify-center gap-2',
                  guardado
                    ? 'bg-green-600 text-white'
                    : resultados
                      ? 'bg-blue-600 text-white active:bg-blue-700'
                      : 'bg-zinc-800 text-zinc-600',
                ].join(' ')}
              >
                <Check size={16} strokeWidth={2.5} />
                {guardado ? '¡Registrado!' : 'Registrar medición'}
              </button>
            </div>
          )}

          {/* Historial de composición */}
          {historial.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                Historial de mediciones
              </p>
              <ul className="flex flex-col gap-2">
                {historial.map((r) => (
                  <li
                    key={r.id}
                    className="bg-zinc-900 rounded-xl px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs text-zinc-500">{r.fecha}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        IMC {r.imc} · {r.pctGrasa}% grasa · {r.pctMusculo}% músculo
                      </p>
                    </div>
                    <span className={['text-xs font-bold capitalize', CATEGORIA_COLOR[r.categoriaImc]].join(' ')}>
                      {r.categoriaImc}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InputCampo({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 mb-1 block">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

function ResultadoCard({
  label, valor, sub, colorSub,
}: {
  label: string
  valor: string
  sub: string
  colorSub: string
}) {
  return (
    <div className="bg-zinc-800 rounded-xl px-3 py-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-lg font-black text-white leading-none">{valor}</p>
      <p className={['text-xs mt-0.5 capitalize font-medium', colorSub].join(' ')}>{sub}</p>
    </div>
  )
}

// ── HistorialReciente ─────────────────────────────────────────────────────────

const RECIENTES = 5

function formatFechaES(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function HistorialReciente() {
  const registros = useFitLogStore(useShallow((s) => s.registrosPeso))
  const [verTodos, setVerTodos] = useState(false)

  // Siempre ordenados: más reciente primero (defensivo, por si llega otro orden)
  const ordenados = useMemo(
    () => [...registros].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [registros],
  )

  // Agrupados por mes (solo para la vista completa)
  const porMes = useMemo(() => {
    const grupos: { clave: string; titulo: string; items: typeof ordenados }[] = []
    for (const r of ordenados) {
      const clave = r.fecha.slice(0, 7)
      let g = grupos[grupos.length - 1]
      if (!g || g.clave !== clave) {
        const [y, m] = clave.split('-')
        g = { clave, titulo: `${MESES[Number(m) - 1]} ${y}`, items: [] }
        grupos.push(g)
      }
      g.items.push(r)
    }
    return grupos
  }, [ordenados])

  if (ordenados.length === 0) return null

  const Fila = ({ r, anterior }: { r: typeof ordenados[number]; anterior?: typeof ordenados[number] }) => {
    const diff = anterior ? r.pesoKg - anterior.pesoKg : null
    return (
      <li className="flex items-center justify-between bg-zinc-900 rounded-xl px-4 py-3">
        <span className="text-sm text-zinc-400 tabular-nums">{formatFechaES(r.fecha)}</span>
        <span className="flex items-baseline gap-2">
          {diff !== null && Math.abs(diff) >= 0.05 && (
            <span className={['text-[11px] font-semibold tabular-nums', diff > 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
            </span>
          )}
          <span className="text-base font-bold text-white tabular-nums">{r.pesoKg} kg</span>
        </span>
      </li>
    )
  }

  return (
    <div className="w-full max-w-xs">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
          {verTodos ? `Todos los registros (${ordenados.length})` : 'Últimos registros'}
        </p>
        {ordenados.length > RECIENTES && (
          <button
            onClick={() => setVerTodos((v) => !v)}
            className="flex items-center gap-1 text-xs font-bold text-emerald-400 active:text-emerald-300"
          >
            {verTodos ? <>Ver menos <ChevronUp size={13} /></> : <>Ver todos ({ordenados.length}) <ChevronDown size={13} /></>}
          </button>
        )}
      </div>

      {!verTodos ? (
        <ul className="flex flex-col gap-2">
          {ordenados.slice(0, RECIENTES).map((r, i) => (
            <Fila key={r.id} r={r} anterior={ordenados[i + 1]} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          {porMes.map((g) => (
            <div key={g.clave}>
              <p className="text-[11px] font-bold text-zinc-500 capitalize mb-1.5 px-1">
                {g.titulo}
                <span className="text-zinc-700 font-normal ml-1.5">· {g.items.length}</span>
              </p>
              <ul className="flex flex-col gap-2">
                {g.items.map((r) => {
                  const idx = ordenados.indexOf(r)
                  return <Fila key={r.id} r={r} anterior={ordenados[idx + 1]} />
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
