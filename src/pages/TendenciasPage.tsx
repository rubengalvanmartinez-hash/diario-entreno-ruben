import { useState, useEffect, useMemo, useRef } from 'react'
import { Trophy, Layers, TrendingUp, TrendingDown, Flame, BarChart2, Minus, Zap, Medal, FileDown, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, AlertTriangle, X } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { getUsuarioActivo, getIdActivo, actualizarSerieSupabase } from '../services/supabase'
import { setEdicionEnCurso } from '../hooks/useSupabaseSync'
import { generarInformePDF } from '../services/pdfReport'
import type { Ejercicio, EtiquetaSerie, Sesion } from '../types/models'

const MESES_ES_CORTO = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PuntoSesion {
  fecha:    string
  fechaISO: string
  pesoMax:  number
  repsMax:  number
  volumen:  number
  rm1Max:   number
  etiqueta?: EtiquetaSerie
  pesoMA?:  number
  rm1MA?:   number
  repsMA?:  number
}

interface Resumen {
  mejorPeso:    { valor: number; fecha: string }
  mejorVolumen: { valor: number; fecha: string }
  mejor1RM:     { valor: number; fecha: string }
  progresoMes:  number | null
  racha:        number
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ETIQUETA_COLOR: Record<EtiquetaSerie, string> = {
  fallo: '#ef4444', rir0: '#f97316', rir1: '#eab308',
}
const ETIQUETA_LABEL: Record<EtiquetaSerie, string> = {
  fallo: 'Fallo', rir0: 'RIR 0', rir1: 'RIR 1',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(iso: string): string {
  const [, mm, dd] = iso.split('-'); return `${dd}/${mm}`
}
function fechaCorta(iso: string): string {
  const [y, mm, dd] = iso.split('-'); return `${dd}/${mm}/${y.slice(2)}`
}
function epley(peso: number, reps: number): number {
  return reps <= 1 ? peso : peso * (1 + reps / 30)
}
function mediaMovil(datos: number[], n = 3): (number | undefined)[] {
  return datos.map((_, i) => {
    if (i < n - 1) return undefined
    const s = datos.slice(i - n + 1, i + 1)
    return s.reduce((a, b) => a + b, 0) / n
  })
}
function diasDesdeISO(iso: string): number {
  const hoy = new Date().toISOString().slice(0, 10)
  return Math.round((new Date(hoy).getTime() - new Date(iso).getTime()) / 86_400_000)
}

/** Casa por ID exacto (sesiones nativas) o por nombreSnapshot normalizado (sesiones de Supabase con ID sintético). */
function matchesEjercicio(e: { ejercicioId: string; nombreSnapshot: string; completado: boolean }, ejercicioId: string, nombre: string): boolean {
  if (e.ejercicioId === ejercicioId) return true
  if (e.nombreSnapshot && nombre && e.nombreSnapshot.trim().toLowerCase() === nombre.trim().toLowerCase()) return true
  return false
}

function procesarDatos(sesiones: Sesion[], ejercicioId: string, nombre: string): PuntoSesion[] {
  const puntos = sesiones
    .filter((s) => s.ejercicios.some((e) => matchesEjercicio(e, ejercicioId, nombre) && e.completado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .flatMap((sesion) => {
      const ej = sesion.ejercicios.find((e) => matchesEjercicio(e, ejercicioId, nombre))
      if (!ej) return []
      const val = ej.series.filter(
        (s) => typeof s.pesoKg === 'number' && s.pesoKg > 0 &&
               typeof s.reps   === 'number' && s.reps   > 0,
      )
      if (val.length === 0) return []
      const pesoMax = Math.max(...val.map((s) => s.pesoKg as number))
      const repsMax = Math.max(...val.map((s) => s.reps   as number))
      const volumen = val.reduce((a, s) => a + (s.reps as number) * (s.pesoKg as number), 0)
      const rm1Max  = Math.max(...val.map((s) => epley(s.pesoKg as number, s.reps as number)))
      const serie   = val.find((s) => (s.pesoKg as number) === pesoMax)
      return [{ fecha: formatFecha(sesion.fecha), fechaISO: sesion.fecha,
                pesoMax, repsMax, volumen, rm1Max, etiqueta: serie?.etiqueta }]
    })

  const pesoMA = mediaMovil(puntos.map((p) => p.pesoMax))
  const rm1MA  = mediaMovil(puntos.map((p) => p.rm1Max))
  const repsMA = mediaMovil(puntos.map((p) => p.repsMax))
  return puntos.map((p, i) => ({ ...p, pesoMA: pesoMA[i], rm1MA: rm1MA[i], repsMA: repsMA[i] }))
}

function calcularResumen(puntos: PuntoSesion[]): Resumen | null {
  if (puntos.length === 0) return null
  const idxPeso  = puntos.reduce((b, p, i) => p.pesoMax > puntos[b].pesoMax ? i : b, 0)
  const idxVol   = puntos.reduce((b, p, i) => p.volumen > puntos[b].volumen  ? i : b, 0)
  const idx1RM   = puntos.reduce((b, p, i) => p.rm1Max  > puntos[b].rm1Max  ? i : b, 0)

  const hoy  = new Date().toISOString().slice(0, 10)
  const d30  = new Date(); d30.setDate(d30.getDate() - 30)
  const d60  = new Date(); d60.setDate(d60.getDate() - 60)
  const iso30 = d30.toISOString().slice(0, 10)
  const iso60 = d60.toISOString().slice(0, 10)
  const mes1  = puntos.filter((p) => p.fechaISO >= iso30 && p.fechaISO <= hoy)
  const mes2  = puntos.filter((p) => p.fechaISO >= iso60 && p.fechaISO <  iso30)
  let progresoMes: number | null = null
  if (mes1.length > 0 && mes2.length > 0) {
    const avg1 = mes1.reduce((a, p) => a + p.pesoMax, 0) / mes1.length
    const avg2 = mes2.reduce((a, p) => a + p.pesoMax, 0) / mes2.length
    if (avg2 > 0) progresoMes = ((avg1 - avg2) / avg2) * 100
  }

  let racha = 0
  for (let i = puntos.length - 1; i > 0; i--) {
    if (puntos[i].pesoMax > puntos[i-1].pesoMax || puntos[i].volumen > puntos[i-1].volumen) racha++
    else break
  }

  return {
    mejorPeso:    { valor: puntos[idxPeso].pesoMax, fecha: puntos[idxPeso].fechaISO },
    mejorVolumen: { valor: puntos[idxVol].volumen,  fecha: puntos[idxVol].fechaISO  },
    mejor1RM:     { valor: puntos[idx1RM].rm1Max,   fecha: puntos[idx1RM].fechaISO  },
    progresoMes,
    racha,
  }
}

function calcularMejorSerie(
  sesiones: Sesion[], ejercicioId: string, nombre: string,
): { peso: number; reps: number; fecha: string } | null {
  let mejor: { peso: number; reps: number; fecha: string } | null = null
  sesiones.forEach((s) => {
    const ej = s.ejercicios.find((e) => matchesEjercicio(e, ejercicioId, nombre) && e.completado)
    if (!ej) return
    ej.series.forEach((sr) => {
      if (typeof sr.pesoKg === 'number' && sr.pesoKg > 0 &&
          typeof sr.reps   === 'number' && sr.reps   > 0 &&
          (!mejor || sr.pesoKg > mejor.peso)) {
        mejor = { peso: sr.pesoKg, reps: sr.reps, fecha: s.fecha }
      }
    })
  })
  return mejor
}

function calcularDistribucion(
  sesiones: Sesion[], ejercicioId: string, nombre: string,
): { fallo: number; rir0: number; rir1: number } {
  const c = { fallo: 0, rir0: 0, rir1: 0 }
  sesiones.forEach((s) => {
    const ej = s.ejercicios.find((e) => matchesEjercicio(e, ejercicioId, nombre) && e.completado)
    if (!ej) return
    ej.series.forEach((sr) => {
      if (sr.etiqueta === 'fallo') c.fallo++
      else if (sr.etiqueta === 'rir0') c.rir0++
      else if (sr.etiqueta === 'rir1') c.rir1++
    })
  })
  return c
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────

const VW = 400
const VH = 190
const LP = { top: 20, right: 10, bottom: 26, left: 36 }

interface LineChartProps {
  data:     PuntoSesion[]
  values:   number[]
  maValues: (number | undefined)[]
  color:    string
  unit:     string
}

function SVGLineChart({ data, values, maValues, color, unit }: LineChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  const cW = VW - LP.left - LP.right
  const cH = VH - LP.top  - LP.bottom

  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad    = (rawMax - rawMin) * 0.12 || 1
  const minV   = rawMin - pad
  const maxV   = rawMax + pad

  const xOf = (i: number) =>
    LP.left + (data.length < 2 ? cW / 2 : (i / (data.length - 1)) * cW)
  const yOf = (v: number) =>
    LP.top + cH - ((v - minV) / (maxV - minV)) * cH

  const linePath = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')

  const maPath = maValues.reduce<string>((acc, v, i) => {
    if (v === undefined) return acc
    const cmd = maValues.slice(0, i).every((x) => x === undefined) ? 'M' : 'L'
    return `${acc}${cmd}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `
  }, '')

  const yTicks = Array.from({ length: 4 }, (_, i) => {
    const v = rawMin + (i / 3) * (rawMax - rawMin)
    return { v, y: yOf(v) }
  })

  const step = data.length <= 6 ? 1 : data.length <= 12 ? 2 : Math.ceil(data.length / 5)
  const tipXPct   = activeIdx !== null
    ? Math.min(Math.max((xOf(activeIdx) / VW) * 100, 12), 88)
    : 50
  const tipAbove  = activeIdx !== null && yOf(values[activeIdx]) / VH > 0.45

  return (
    <div className="relative" onMouseLeave={() => setActiveIdx(null)}>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 190, display: 'block' }}>
        {yTicks.map(({ v, y }, i) => (
          <g key={i}>
            <line x1={LP.left} x2={VW - LP.right} y1={y} y2={y} stroke="#27272a" strokeWidth={1} />
            <text x={LP.left - 4} y={y + 3.5} textAnchor="end" fill="#52525b" fontSize={8.5}>
              {v % 1 === 0 ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((p, i) => {
          if (i % step !== 0 && i !== data.length - 1) return null
          return (
            <text key={i} x={xOf(i)} y={VH - 4} textAnchor="middle" fill="#52525b" fontSize={8.5}>
              {p.fecha}
            </text>
          )
        })}
        {maPath && (
          <path d={maPath} fill="none" stroke={color} strokeWidth={1.5}
            strokeDasharray="5 3" strokeLinecap="round" opacity={0.4} />
        )}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round" />
        {data.map((p, i) => {
          const cx = xOf(i); const cy = yOf(values[i]); const isA = i === activeIdx
          return (
            <g key={i} style={{ cursor: 'pointer' }}>
              {p.etiqueta && (
                <circle cx={cx} cy={cy - 11} r={3.5} fill={ETIQUETA_COLOR[p.etiqueta]} />
              )}
              {isA && <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.15} />}
              <circle cx={cx} cy={cy} r={isA ? 5.5 : 4} fill={color} stroke="#09090b" strokeWidth={2}
                onMouseEnter={() => setActiveIdx(i)}
                onTouchEnd={(e) => { e.preventDefault(); setActiveIdx((p) => p === i ? null : i) }}
                onClick={() => setActiveIdx((p) => p === i ? null : i)}
              />
            </g>
          )
        })}
      </svg>
      {activeIdx !== null && (
        <div className="absolute z-20 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2
                        text-xs pointer-events-none shadow-xl whitespace-nowrap"
          style={{
            left: `${tipXPct}%`,
            top:    tipAbove ? undefined : '4%',
            bottom: tipAbove ? '14%'     : undefined,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-zinc-400 font-medium mb-1">{fechaCorta(data[activeIdx].fechaISO)}</p>
          <p className="font-bold" style={{ color }}>
            {values[activeIdx].toFixed(1)} {unit}
          </p>
          {unit !== 'reps' && (
            <p className="text-zinc-500 mt-0.5">{data[activeIdx].repsMax} reps</p>
          )}
          {data[activeIdx].etiqueta && (
            <p className="font-semibold mt-0.5" style={{ color: ETIQUETA_COLOR[data[activeIdx].etiqueta!] }}>
              {ETIQUETA_LABEL[data[activeIdx].etiqueta!]}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── SVG Bar Chart (genérico) ──────────────────────────────────────────────────

interface BarChartProps {
  data:   { label: string; value: number; color?: string }[]
  color?: string
  height?: number
}

function SVGBarChart({ data, color = '#3b82f6', height = 110 }: BarChartProps) {
  const W = 350, H = height
  const P = { top: 18, right: 8, bottom: 22, left: 8 }
  const cW = W - P.left - P.right
  const cH = H - P.top  - P.bottom
  const maxV  = Math.max(...data.map((d) => d.value), 1)
  const barW  = cW / data.length
  const gap   = Math.max(barW * 0.3, 4)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height, display: 'block' }}>
      {data.map((d, i) => {
        const bH  = (d.value / maxV) * cH
        const x   = P.left + i * barW + gap / 2
        const y   = P.top  + cH - bH
        const bW  = barW - gap
        const c   = d.color ?? color
        return (
          <g key={i}>
            <rect x={x} y={d.value > 0 ? y : P.top + cH - 2}
              width={bW} height={Math.max(bH, 2)} rx={3}
              fill={c} opacity={d.value > 0 ? 0.85 : 0.2} />
            {d.value > 0 && (
              <text x={x + bW / 2} y={y - 3} textAnchor="middle"
                fill={c} fontSize={9} fontWeight="bold">
                {d.value}
              </text>
            )}
            <text x={x + bW / 2} y={H - 5} textAnchor="middle" fill="#52525b" fontSize={8}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Calendario de calor ───────────────────────────────────────────────────────

function CalendarioCalor({ sesionDates }: { sesionDates: Set<string> }) {
  // Build 60-day array starting from Monday of the week that includes 59 days ago
  const days = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (59 - i))
      const iso = d.toISOString().slice(0, 10)
      return { iso, trained: sesionDates.has(iso), month: d.getMonth(), day: d.getDate() }
    })
  }, [sesionDates])

  // Monday offset for the first day
  const firstDate   = new Date(days[0].iso)
  const startOffset = (firstDate.getDay() + 6) % 7  // Mon=0 … Sun=6

  // Month label positions (show month when it changes)
  const monthLabels: { col: number; label: string }[] = []
  let prevMonth = -1
  days.forEach((d, i) => {
    const col = Math.floor((startOffset + i) / 7)
    if (d.month !== prevMonth) { monthLabels.push({ col, label: d.iso.slice(5, 7) + '/' + d.iso.slice(2, 4) }); prevMonth = d.month }
  })

  return (
    <div className="flex flex-col gap-1.5">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {['L','M','X','J','V','S','D'].map((d) => (
          <div key={d} className="text-center text-[10px] text-zinc-600 font-medium">{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startOffset }, (_, i) => (
          <div key={`e${i}`} className="aspect-square" />
        ))}
        {days.map(({ iso, trained, day }) => (
          <div
            key={iso}
            title={`${iso}${trained ? ' ✓' : ''}`}
            className={[
              'aspect-square rounded-sm',
              trained ? 'bg-emerald-500/75' : 'bg-zinc-800',
            ].join(' ')}
          >
            {day === 1 && (
              <span className="text-[7px] text-zinc-600 leading-none pl-px">{iso.slice(5, 7)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TendenciasPage() {
  const ejercicios        = useFitLogStore(useShallow((s) => s.ejercicios))
  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const sorted = useMemo(
    () => [...ejercicios].sort((a, b) => a.dia - b.dia || a.orden - b.orden),
    [ejercicios],
  )
  const [ejercicioId, setEjercicioId] = useState<string | null>(null)

  // PDF state
  const hoy    = new Date()
  const [pdfMes,       setPdfMes]       = useState(hoy.getMonth() + 1)
  const [pdfAnio,      setPdfAnio]      = useState(hoy.getFullYear())
  const [generandoPdf, setGenerandoPdf] = useState(false)


  useEffect(() => {
    if (!ejercicioId && sorted.length > 0) setEjercicioId(sorted[0].id)
  }, [sorted, ejercicioId])

  const handleGenerarPDF = async () => {
    setGenerandoPdf(true)
    try {
      const usuario = getUsuarioActivo()
      const nombre  = usuario?.nombre ?? 'Usuario'
      await generarInformePDF(nombre, pdfMes, pdfAnio, historialSesiones, ejercicios)
    } catch (e) {
      console.error('Error generando PDF:', e)
    } finally {
      setGenerandoPdf(false)
    }
  }

  // Opciones de mes: 12 meses atrás hasta hoy
  const opcionesMes = useMemo(() => {
    const opts: { mes: number; anio: number; label: string }[] = []
    const base = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
      opts.push({
        mes:   d.getMonth() + 1,
        anio:  d.getFullYear(),
        label: `${MESES_ES_CORTO[d.getMonth()]} ${d.getFullYear()}`,
      })
    }
    return opts
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col pb-8">
      <div className="px-4 pt-6 pb-4 flex items-center gap-3">
        <h1 className="text-2xl font-black text-white tracking-tight">Tendencias</h1>
      </div>

      {/* Informe PDF */}
      <div className="mx-4 mb-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          Informe mensual PDF
        </p>
        <div className="flex items-center gap-3">
          <select
            value={`${pdfMes}-${pdfAnio}`}
            onChange={(e) => {
              const [m, a] = e.target.value.split('-').map(Number)
              setPdfMes(m); setPdfAnio(a)
            }}
            className="flex-1 bg-zinc-800 text-white text-sm font-medium rounded-xl px-3 py-2.5
                       border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {opcionesMes.map((o) => (
              <option key={`${o.mes}-${o.anio}`} value={`${o.mes}-${o.anio}`}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerarPDF}
            disabled={generandoPdf}
            className={[
              'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors shrink-0',
              generandoPdf
                ? 'bg-zinc-700 text-zinc-500'
                : 'bg-blue-600 text-white active:bg-blue-700',
            ].join(' ')}
          >
            <FileDown size={16} />
            {generandoPdf ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </div>

      {/* Resumen general — siempre visible */}
      <ResumenGeneral />

      {/* Separador */}
      <div className="px-4 mt-6 mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          Por ejercicio
        </p>
      </div>

      {/* Selector */}
      <SelectorEjercicio
        ejercicios={sorted}
        seleccionado={ejercicioId}
        onSeleccionar={setEjercicioId}
      />

      {/* Panel */}
      {ejercicioId
        ? <PanelEjercicio ejercicioId={ejercicioId} />
        : (
          <div className="flex items-center justify-center px-6 py-12">
            <p className="text-zinc-500 text-sm text-center">
              Selecciona un ejercicio para ver sus tendencias.
            </p>
          </div>
        )}
    </div>
  )
}

// ── ResumenGeneral ────────────────────────────────────────────────────────────

function ResumenGeneral() {
  const historial  = useFitLogStore(useShallow((s) => s.historialSesiones))
  const ejercicios = useFitLogStore(useShallow((s) => s.ejercicios))
  const [panelPR, setPanelPR] = useState<{ id: string; nombre: string } | null>(null)

  // Días desde último entrenamiento
  const diasDesdeUltimo = useMemo(() => {
    if (historial.length === 0) return null
    const last = historial.reduce((a, b) => a.fecha > b.fecha ? a : b)
    return diasDesdeISO(last.fecha)
  }, [historial])

  // Set de fechas con sesión
  const sesionDates = useMemo(
    () => new Set(historial.map((s) => s.fecha)),
    [historial],
  )

  // Frecuencia semanal — últimas 9 semanas
  const weeklyBars = useMemo(() => {
    const hoy = new Date()
    // Monday of current week
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))

    return Array.from({ length: 9 }, (_, w) => {
      const ini = new Date(lunes); ini.setDate(lunes.getDate() - (8 - w) * 7)
      const fin = new Date(ini);   fin.setDate(ini.getDate() + 6)
      const isoI = ini.toISOString().slice(0, 10)
      const isoF = fin.toISOString().slice(0, 10)
      const cnt  = historial.filter((s) => s.fecha >= isoI && s.fecha <= isoF).length
      return { label: `${ini.getDate()}/${ini.getMonth() + 1}`, value: cnt }
    })
  }, [historial])

  // Personal Records
  const personalRecords = useMemo(() => {
    return ejercicios
      .sort((a, b) => a.dia - b.dia || a.orden - b.orden)
      .flatMap((ej) => {
        let mejorPeso = 0, mejor1RM = 0, mejorFecha = ''
        historial.forEach((ses) => {
          const e = ses.ejercicios.find((e) => matchesEjercicio(e, ej.id, ej.nombre) && e.completado)
          if (!e) return
          e.series.forEach((s) => {
            if (typeof s.pesoKg !== 'number' || typeof s.reps !== 'number') return
            if (s.pesoKg <= 0 || s.reps <= 0) return
            const rm = epley(s.pesoKg, s.reps)
            if (s.pesoKg > mejorPeso) { mejorPeso = s.pesoKg; mejorFecha = ses.fecha }
            if (rm > mejor1RM) mejor1RM = rm
          })
        })
        if (mejorPeso === 0) return []
        return [{ ej, mejorPeso, mejor1RM, mejorFecha }]
      })
  }, [ejercicios, historial])

  if (historial.length === 0) {
    return (
      <div className="px-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
          <BarChart2 size={28} className="text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm font-semibold">Aún sin sesiones registradas</p>
          <p className="text-zinc-600 text-xs mt-1">
            Completa tu primer entrenamiento para ver estadísticas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-4 px-4">

      {/* Días desde último entrenamiento */}
      {diasDesdeUltimo !== null && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div>
            <p className={[
              'text-4xl font-black leading-none tabular-nums',
              diasDesdeUltimo === 0 ? 'text-emerald-400'
              : diasDesdeUltimo <= 2 ? 'text-zinc-300'
              : 'text-orange-400',
            ].join(' ')}>
              {diasDesdeUltimo === 0 ? 'Hoy' : `${diasDesdeUltimo}d`}
            </p>
            <p className="text-xs text-zinc-500 mt-1">desde el último entreno</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm font-bold text-white">{historial.length} sesiones</p>
            <p className="text-xs text-zinc-500">en total</p>
          </div>
        </div>
      )}

      {/* Calendario de calor */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">
          Últimos 60 días
        </p>
        <CalendarioCalor sesionDates={sesionDates} />
        <div className="flex items-center gap-2 mt-3 justify-end">
          <div className="size-3 rounded-sm bg-zinc-800" />
          <span className="text-[10px] text-zinc-600">Sin entreno</span>
          <div className="size-3 rounded-sm bg-emerald-500/75 ml-1" />
          <span className="text-[10px] text-zinc-600">Entrenado</span>
        </div>
      </div>

      {/* Frecuencia semanal */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
          Sesiones por semana
        </p>
        <SVGBarChart data={weeklyBars} color="#3b82f6" height={110} />
      </div>

      {/* Personal Records */}
      {personalRecords.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Personal Records
            </p>
            <p className="text-[10px] text-zinc-600">Toca para ver historial</p>
          </div>
          {/* Cabecera tabla */}
          <div className="grid grid-cols-[1fr_auto_auto_16px] gap-x-3 px-4 py-2 border-b border-zinc-800">
            <span className="text-[10px] text-zinc-600 font-semibold uppercase">Ejercicio</span>
            <span className="text-[10px] text-zinc-600 font-semibold uppercase text-right">Peso</span>
            <span className="text-[10px] text-zinc-600 font-semibold uppercase text-right">1RM</span>
            <span />
          </div>
          {personalRecords.map(({ ej, mejorPeso, mejor1RM, mejorFecha }) => (
            <button
              key={ej.id}
              onClick={() => setPanelPR({ id: ej.id, nombre: ej.nombre })}
              className="w-full grid grid-cols-[1fr_auto_auto_16px] gap-x-3 items-center px-4 py-3
                         border-b border-zinc-800/50 last:border-0 active:bg-zinc-800/50 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{ej.nombre}</p>
                <p className="text-[11px] text-zinc-600">
                  Día {ej.dia} · {fechaCorta(mejorFecha)}
                </p>
              </div>
              <p className="text-sm font-bold text-yellow-400 tabular-nums text-right shrink-0">
                {mejorPeso} kg
              </p>
              <p className="text-sm font-bold text-purple-400 tabular-nums text-right shrink-0">
                {mejor1RM.toFixed(1)}
              </p>
              <ChevronRight size={14} className="text-zinc-600 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Panel de historial editable */}
    {panelPR && (
      <PanelHistoricoSeries
        ejercicioId={panelPR.id}
        nombreEjercicio={panelPR.nombre}
        onCerrar={() => setPanelPR(null)}
      />
    )}
    </>
  )
}

// ── PanelHistoricoSeries ──────────────────────────────────────────────────────

interface EditPending {
  sesionId:      string
  ejNombre:      string   // nombre columna en entrenos (nombreSustituido ?? nombreSnapshot)
  serieNum:      number
  campo:         'reps' | 'pesoKg'
  valorOriginal: number
  valorStr:      string
}

function PanelHistoricoSeries({
  ejercicioId, nombreEjercicio, onCerrar,
}: {
  ejercicioId:     string
  nombreEjercicio: string
  onCerrar:        () => void
}) {
  const historial            = useFitLogStore(useShallow((s) => s.historialSesiones))
  const editarSerieHistorial = useFitLogStore((s) => s.editarSerieHistorial)

  // edit: celda actualmente en edición
  const [edit,      setEdit]      = useState<EditPending | null>(null)
  // pendiente: valor ya validado que espera confirmación en el modal
  const [pendiente, setPendiente] = useState<EditPending | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorMsg,  setErrorMsg]  = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Filas planas ordenadas fecha desc → serie asc, sin filas vacías
  const filas = useMemo(() => {
    type Fila = {
      sesionId:    string
      ejNombre:    string
      fecha:       string
      mostrarFecha: boolean
      serieNum:    number
      reps:        number
      pesoKg:      number
    }
    const result: Fila[] = []
    historial
      .filter((ses) => ses.ejercicios.some((e) => matchesEjercicio(e, ejercicioId, nombreEjercicio) && e.completado))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .forEach((ses) => {
        const ej = ses.ejercicios.find((e) => matchesEjercicio(e, ejercicioId, nombreEjercicio))
        if (!ej) return
        const ejNombre = ej.nombreSustituido ?? ej.nombreSnapshot
        let primeraSerie = true
        ej.series
          .sort((a, b) => a.numero - b.numero)
          .forEach((sr) => {
            const reps   = typeof sr.reps   === 'number' ? sr.reps   : 0
            const pesoKg = typeof sr.pesoKg === 'number' ? sr.pesoKg : 0
            if (reps <= 0 && pesoKg <= 0) return
            result.push({ sesionId: ses.id, ejNombre, fecha: ses.fecha, mostrarFecha: primeraSerie, serieNum: sr.numero, reps, pesoKg })
            primeraSerie = false
          })
      })
    return result
  }, [historial, ejercicioId, nombreEjercicio])

  // Liberar flag al desmontar
  useEffect(() => { return () => { setEdicionEnCurso(false) } }, [])

  useEffect(() => { if (edit) inputRef.current?.focus() }, [edit])

  // ── Paso 1: tocar celda → abrir input ──────────────────────────────────────
  const iniciarEdicion = (sesionId: string, ejNombre: string, serieNum: number, campo: 'reps' | 'pesoKg', valorActual: number) => {
    console.log('[Edit] iniciarEdicion', { sesionId, ejNombre, serieNum, campo, valorActual })
    setErrorMsg('')
    setEdicionEnCurso(true)
    setEdit({ sesionId, ejNombre, serieNum, campo, valorOriginal: valorActual, valorStr: String(valorActual) })
  }

  const cancelarEdicion = () => {
    console.log('[Edit] cancelarEdicion')
    setEdicionEnCurso(false)
    setEdit(null)
    setErrorMsg('')
  }

  // ── Paso 2: pulsar ✓ inline → validar y abrir modal ───────────────────────
  const pedirConfirmacion = () => {
    console.log('[Edit] pedirConfirmacion — edit:', edit)
    if (!edit) return
    const v = parseFloat(edit.valorStr)
    console.log('[Edit] valor parseado:', v, '| original:', edit.valorOriginal)
    if (isNaN(v) || v <= 0) { setErrorMsg('Valor no válido'); return }
    if (v === edit.valorOriginal) { cancelarEdicion(); return }
    // Guardar snapshot del edit en pendiente y cerrar input
    setPendiente({ ...edit })
    setEdit(null)   // cierra el input — el modal se abre sobre la tabla en reposo
  }

  // ── Paso 3: confirmar en el modal → guardar en Supabase ───────────────────
  const confirmarGuardar = async () => {
    console.log('[Edit] confirmarGuardar — pendiente:', pendiente)
    if (!pendiente) { console.warn('[Edit] pendiente es null'); return }

    const nuevoValor = parseFloat(pendiente.valorStr)
    setPendiente(null)
    setGuardando(true)
    setErrorMsg('')

    // Actualización optimista en el store
    editarSerieHistorial(pendiente.sesionId, pendiente.ejNombre, pendiente.serieNum, pendiente.campo, nuevoValor)

    const idActivo = getIdActivo()
    console.log('[Edit] idActivo:', idActivo)
    if (!idActivo) {
      editarSerieHistorial(pendiente.sesionId, pendiente.ejNombre, pendiente.serieNum, pendiente.campo, pendiente.valorOriginal)
      setErrorMsg('Sin usuario activo — vuelve a hacer login')
      setGuardando(false)
      setEdicionEnCurso(false)
      return
    }

    const campoDB: 'reps' | 'peso_kg' = pendiente.campo === 'reps' ? 'reps' : 'peso_kg'
    console.log('[Edit] llamando actualizarSerieSupabase:', { idActivo, sesionId: pendiente.sesionId, ejNombre: pendiente.ejNombre, serieNum: pendiente.serieNum, campoDB, nuevoValor })

    try {
      await actualizarSerieSupabase(idActivo, pendiente.sesionId, pendiente.ejNombre, pendiente.serieNum, campoDB, nuevoValor)
      console.log('[Edit] ✓ guardado en Supabase')
    } catch (err) {
      console.error('[Edit] error Supabase:', err)
      editarSerieHistorial(pendiente.sesionId, pendiente.ejNombre, pendiente.serieNum, pendiente.campo, pendiente.valorOriginal)
      setErrorMsg(`Fallo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGuardando(false)
      setEdicionEnCurso(false)
    }
  }

  const cancelarModal = () => {
    console.log('[Edit] cancelarModal')
    setPendiente(null)
    setEdicionEnCurso(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 bg-zinc-950 border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onCerrar} className="p-1 -ml-1 rounded-lg active:bg-zinc-800">
          <ArrowLeft size={20} className="text-zinc-400" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{nombreEjercicio}</p>
          <p className="text-[10px] text-zinc-500 mt-px">
            {filas.length} series · toca Reps o Kg para editar
          </p>
        </div>
        {guardando && <span className="text-[10px] text-blue-400 font-semibold animate-pulse">Guardando…</span>}
      </div>

      {/* ── Cabecera de tabla ── */}
      <div className="shrink-0 grid grid-cols-[80px_32px_1fr_1fr_48px] bg-zinc-900 border-b border-zinc-700">
        <span className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Fecha</span>
        <span className="px-1 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 text-center">S</span>
        <span className="px-1 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 text-center">Reps</span>
        <span className="px-1 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 text-center">Kg</span>
        <span />
      </div>

      {/* ── Cuerpo de tabla ── */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {filas.length === 0 && <p className="text-center text-zinc-600 text-sm py-16">Sin series registradas.</p>}

        {filas.map((fila, idx) => {
          const isEditReps  = edit?.sesionId === fila.sesionId && edit.serieNum === fila.serieNum && edit.campo === 'reps'
          const isEditKg    = edit?.sesionId === fila.sesionId && edit.serieNum === fila.serieNum && edit.campo === 'pesoKg'
          const isActiveRow = isEditReps || isEditKg
          const borderTop   = fila.mostrarFecha && idx > 0 ? 'border-t border-zinc-600' : 'border-t border-zinc-800/60'

          return (
            <div
              key={`${fila.sesionId}-${fila.serieNum}`}
              className={[
                'grid grid-cols-[80px_32px_1fr_1fr_48px] items-center min-h-[36px]',
                borderTop,
                isActiveRow ? 'bg-blue-950/50' : idx % 2 === 0 ? 'bg-zinc-950' : 'bg-zinc-900/50',
              ].join(' ')}
            >
              {/* Fecha */}
              <span className="px-2 py-1 text-[11px] text-zinc-400 tabular-nums whitespace-nowrap">
                {fila.mostrarFecha ? fechaCorta(fila.fecha) : ''}
              </span>

              {/* Número de serie */}
              <span className="px-1 py-1 text-[11px] text-zinc-600 text-center tabular-nums font-medium">
                S{fila.serieNum}
              </span>

              {/* Reps */}
              <div className="px-1 flex items-center justify-center">
                {isEditReps ? (
                  <input
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    value={edit!.valorStr}
                    onChange={(e) => setEdit((p) => p ? { ...p, valorStr: e.target.value } : p)}
                    className="w-full max-w-[52px] bg-blue-600/25 border border-blue-400 rounded px-1 py-1
                               text-xs font-bold text-center text-white outline-none tabular-nums"
                  />
                ) : (
                  <button
                    onClick={() => iniciarEdicion(fila.sesionId, fila.ejNombre, fila.serieNum, 'reps', fila.reps)}
                    disabled={guardando || !!edit}
                    className="w-full text-[12px] font-medium text-zinc-300 text-center py-1.5
                               active:bg-zinc-700/60 rounded disabled:opacity-40 tabular-nums"
                  >
                    {fila.reps}
                  </button>
                )}
              </div>

              {/* Kg */}
              <div className="px-1 flex items-center justify-center">
                {isEditKg ? (
                  <input
                    ref={inputRef}
                    type="number"
                    inputMode="decimal"
                    value={edit!.valorStr}
                    onChange={(e) => setEdit((p) => p ? { ...p, valorStr: e.target.value } : p)}
                    className="w-full max-w-[60px] bg-blue-600/25 border border-blue-400 rounded px-1 py-1
                               text-xs font-bold text-center text-white outline-none tabular-nums"
                  />
                ) : (
                  <button
                    onClick={() => iniciarEdicion(fila.sesionId, fila.ejNombre, fila.serieNum, 'pesoKg', fila.pesoKg)}
                    disabled={guardando || !!edit}
                    className="w-full text-[12px] font-bold text-white text-center py-1.5
                               active:bg-zinc-700/60 rounded disabled:opacity-40 tabular-nums"
                  >
                    {fila.pesoKg % 1 === 0 ? fila.pesoKg : fila.pesoKg.toFixed(1)}
                  </button>
                )}
              </div>

              {/* Botones inline ✓ / ✗ — solo en la fila activa */}
              <div className="flex flex-col items-center justify-center gap-0.5 px-1">
                {isActiveRow ? (
                  <>
                    <button
                      onMouseDown={(e) => e.preventDefault()} // evitar blur del input antes del click
                      onClick={() => { console.log('[Edit] ✓ inline pulsado'); pedirConfirmacion() }}
                      className="w-8 h-5 rounded bg-emerald-600 active:bg-emerald-500 flex items-center justify-center"
                    >
                      <span className="text-[10px] font-black text-white leading-none">✓</span>
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => cancelarEdicion()}
                      className="w-8 h-5 rounded bg-zinc-700 active:bg-zinc-600 flex items-center justify-center"
                    >
                      <span className="text-[10px] font-black text-zinc-300 leading-none">✗</span>
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          )
        })}
        <div className="h-6" />
      </div>

      {/* ── Error toast ── */}
      {errorMsg && (
        <div className="absolute bottom-4 left-2 right-2 z-10 bg-red-950 border border-red-700
                        rounded-xl px-3 py-3 shadow-xl">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-xs font-bold text-red-300">Error</p>
            <button onClick={() => setErrorMsg('')} className="shrink-0"><X size={14} className="text-red-400" /></button>
          </div>
          <p className="text-[11px] text-red-200 leading-relaxed break-all font-mono">{errorMsg}</p>
        </div>
      )}

      {/* ── Modal de confirmación (fuera del scroll, z-index alto) ── */}
      {pendiente && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 px-4 pb-8">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">¿Guardar cambio?</p>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {pendiente.campo === 'reps' ? 'Reps' : 'Peso (kg)'}:{' '}
                  <span className="text-zinc-300">{pendiente.valorOriginal}</span>
                  {' → '}
                  <span className="text-white font-bold">{pendiente.valorStr}</span>
                  <br />
                  <span className="text-zinc-600">Modifica el historial permanentemente.</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={cancelarModal}
                className="flex-1 rounded-xl py-3 text-sm font-bold text-zinc-400 bg-zinc-800 active:bg-zinc-700"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarGuardar}
                className="flex-1 rounded-xl py-3 text-sm font-bold text-white bg-amber-600 active:bg-amber-700"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SelectorEjercicio ─────────────────────────────────────────────────────────

function SelectorEjercicio({
  ejercicios, seleccionado, onSeleccionar,
}: {
  ejercicios: Ejercicio[]
  seleccionado: string | null
  onSeleccionar: (id: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  // Posición fija del menú — se recalcula en cada apertura
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const seleccionadoObj = ejercicios.find((e) => e.id === seleccionado) ?? null

  const handleToggle = () => {
    console.log('[SelectorEjercicio] click — abierto actual:', abierto)
    if (!abierto && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuRect({ top: r.bottom + 6, left: r.left, width: r.width })
    }
    setAbierto((v) => !v)
  }

  // Cerrar al tocar fuera
  useEffect(() => {
    if (!abierto) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [abierto])

  // Agrupar por día (solo grupos con ejercicios)
  const grupos = ([
    { label: 'Día 1', items: ejercicios.filter((e) => e.dia === 1) },
    { label: 'Día 2', items: ejercicios.filter((e) => e.dia === 2) },
    { label: 'Día 3', items: ejercicios.filter((e) => e.dia === 3) },
    { label: 'Otros',  items: ejercicios.filter((e) => e.dia !== 1 && e.dia !== 2 && e.dia !== 3) },
  ] as const).filter((g) => g.items.length > 0)

  return (
    <div className="px-4 pb-3">
      {/* Botón selector */}
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3.5 text-left active:bg-zinc-800 transition-colors"
      >
        <span className="flex-1 text-sm font-semibold text-white truncate">
          {seleccionadoObj ? seleccionadoObj.nombre : 'Seleccionar ejercicio…'}
        </span>
        {abierto
          ? <ChevronUp size={16} className="text-zinc-400 shrink-0" />
          : <ChevronDown size={16} className="text-zinc-400 shrink-0" />
        }
      </button>

      {/* Menú — position:fixed para escapar de cualquier overflow:hidden padre */}
      {abierto && menuRect && (
        <div
          style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width, zIndex: 9999 }}
          className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="max-h-72 overflow-y-auto overscroll-contain">
            {grupos.map((grupo) => (
              <div key={grupo.label}>
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 bg-zinc-950/70 sticky top-0">
                  {grupo.label}
                </div>
                {grupo.items.map((ej) => (
                  <button
                    key={ej.id}
                    onClick={() => { onSeleccionar(ej.id); setAbierto(false) }}
                    className={[
                      'w-full text-left px-4 py-3.5 text-sm font-medium border-b border-zinc-800/50 last:border-0 transition-colors',
                      ej.id === seleccionado
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-white active:bg-zinc-800',
                    ].join(' ')}
                  >
                    {ej.nombre}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PanelEjercicio ────────────────────────────────────────────────────────────

function PanelEjercicio({ ejercicioId }: { ejercicioId: string }) {
  const historial  = useFitLogStore(useShallow((s) => s.historialSesiones))
  const ejercicios = useFitLogStore(useShallow((s) => s.ejercicios))
  const nombre     = useMemo(
    () => ejercicios.find((e) => e.id === ejercicioId)?.nombre ?? '',
    [ejercicios, ejercicioId],
  )

  const { puntos, mejorSerie, distribucion } = useMemo(() => ({
    puntos:       procesarDatos(historial, ejercicioId, nombre),
    mejorSerie:   calcularMejorSerie(historial, ejercicioId, nombre),
    distribucion: calcularDistribucion(historial, ejercicioId, nombre),
  }), [historial, ejercicioId, nombre])

  if (puntos.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-8 py-12 text-center">
        <div className="size-16 rounded-full bg-zinc-900 flex items-center justify-center">
          <BarChart2 size={32} className="text-zinc-700" />
        </div>
        <p className="text-zinc-300 font-semibold">Sin suficientes datos</p>
        <p className="text-zinc-600 text-sm leading-relaxed">
          Registra al menos 2 sesiones completadas con este ejercicio para ver las tendencias.
        </p>
      </div>
    )
  }

  const resumen = calcularResumen(puntos)!
  const totalEsfuerzo = distribucion.fallo + distribucion.rir0 + distribucion.rir1

  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <ResumenCards resumen={resumen} mejorSerie={mejorSerie} />

      <GraficaCard titulo="Peso máximo" unidad="kg"
        tendencia={puntos[puntos.length-1].pesoMax - puntos[0].pesoMax}>
        <SVGLineChart data={puntos} values={puntos.map((p) => p.pesoMax)}
          maValues={puntos.map((p) => p.pesoMA)} color="#3b82f6" unit="kg" />
      </GraficaCard>

      <GraficaCard titulo="1RM estimado (Epley)" unidad="kg"
        tendencia={puntos[puntos.length-1].rm1Max - puntos[0].rm1Max}>
        <SVGLineChart data={puntos} values={puntos.map((p) => p.rm1Max)}
          maValues={puntos.map((p) => p.rm1MA)} color="#a855f7" unit="kg" />
      </GraficaCard>

      <GraficaCard titulo="Reps máximas" unidad="reps"
        tendencia={puntos[puntos.length-1].repsMax - puntos[0].repsMax}>
        <SVGLineChart data={puntos} values={puntos.map((p) => p.repsMax)}
          maValues={puntos.map((p) => p.repsMA)} color="#f97316" unit="reps" />
      </GraficaCard>

      {/* Distribución de esfuerzo */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-white">Distribución de esfuerzo</p>
          {totalEsfuerzo > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5">{totalEsfuerzo} series etiquetadas</p>
          )}
        </div>
        <div className="pb-2">
          {totalEsfuerzo === 0
            ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                Sin etiquetas de esfuerzo registradas para este ejercicio.
              </p>
            )
            : (
              <SVGBarChart
                data={[
                  { label: 'Fallo', value: distribucion.fallo, color: '#ef4444' },
                  { label: 'RIR 0', value: distribucion.rir0,  color: '#f97316' },
                  { label: 'RIR 1', value: distribucion.rir1,  color: '#eab308' },
                ]}
                height={110}
              />
            )}
        </div>
      </div>
    </div>
  )
}

// ── ResumenCards ──────────────────────────────────────────────────────────────

function ResumenCards({
  resumen, mejorSerie,
}: {
  resumen: Resumen
  mejorSerie: { peso: number; reps: number; fecha: string } | null
}) {
  const { mejorPeso, mejorVolumen, mejor1RM, progresoMes, racha } = resumen

  const pColor = progresoMes === null ? 'text-zinc-500'
    : progresoMes >= 0 ? 'text-emerald-400' : 'text-red-400'
  const pBg    = progresoMes === null ? 'bg-zinc-800'
    : progresoMes >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15'
  const pIcon  = progresoMes === null
    ? <Minus size={15} className="text-zinc-500" />
    : progresoMes >= 0
      ? <TrendingUp  size={15} className="text-emerald-400" />
      : <TrendingDown size={15} className="text-red-400" />
  const pValor = progresoMes === null ? 'Sin datos'
    : `${progresoMes >= 0 ? '+' : ''}${progresoMes.toFixed(1)}%`

  return (
    <div className="grid grid-cols-2 gap-3">
      <ResumenCard iconoBg="bg-yellow-500/15"
        icono={<Trophy size={15} className="text-yellow-400" />}
        titulo="Mejor peso" valor={`${mejorPeso.valor} kg`} sub={fechaCorta(mejorPeso.fecha)} />

      <ResumenCard iconoBg="bg-purple-500/15"
        icono={<Zap size={15} className="text-purple-400" />}
        titulo="Mejor 1RM" valor={`${mejor1RM.valor.toFixed(1)} kg`} sub={fechaCorta(mejor1RM.fecha)} />

      <ResumenCard iconoBg="bg-blue-500/15"
        icono={<Medal size={15} className="text-blue-400" />}
        titulo="Mejor serie"
        valor={mejorSerie ? `${mejorSerie.peso} kg` : '—'}
        sub={mejorSerie ? `${mejorSerie.reps} reps · ${fechaCorta(mejorSerie.fecha)}` : 'Sin datos'} />

      <ResumenCard iconoBg="bg-teal-500/15"
        icono={<Layers size={15} className="text-teal-400" />}
        titulo="Mejor volumen" valor={`${Math.round(mejorVolumen.valor)} kg`} sub={fechaCorta(mejorVolumen.fecha)} />

      <ResumenCard iconoBg={pBg} icono={pIcon}
        titulo="Último mes" valor={pValor} sub="vs mes anterior" valorColor={pColor} />

      <ResumenCard iconoBg={racha > 0 ? 'bg-orange-500/15' : 'bg-zinc-800'}
        icono={<Flame size={15} className={racha > 0 ? 'text-orange-400' : 'text-zinc-600'} />}
        titulo="Racha"
        valor={racha > 0 ? `${racha} sesión${racha > 1 ? 'es' : ''}` : 'Sin racha'}
        sub={racha > 0 ? 'mejorando' : 'sigue así'}
        valorColor={racha > 0 ? 'text-orange-400' : 'text-zinc-500'} />
    </div>
  )
}

function ResumenCard({
  iconoBg, icono, titulo, valor, sub, valorColor = 'text-white',
}: {
  iconoBg: string; icono: React.ReactNode
  titulo: string; valor: string; sub: string; valorColor?: string
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={['size-6 rounded-lg flex items-center justify-center shrink-0', iconoBg].join(' ')}>
          {icono}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 leading-tight">
          {titulo}
        </span>
      </div>
      <p className={['text-[15px] font-black leading-tight', valorColor].join(' ')}>{valor}</p>
      <p className="text-[11px] text-zinc-600 leading-tight">{sub}</p>
    </div>
  )
}

// ── GraficaCard ───────────────────────────────────────────────────────────────

function GraficaCard({
  titulo, unidad, tendencia, children,
}: {
  titulo: string; unidad: string; tendencia: number; children: React.ReactNode
}) {
  const sube = tendencia > 0; const baja = tendencia < 0
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-sm font-bold text-white">{titulo}</p>
        <div className="flex items-center gap-1">
          {sube  && <TrendingUp   size={13} className="text-emerald-400" />}
          {baja  && <TrendingDown size={13} className="text-red-400"    />}
          {!sube && !baja && <Minus size={13} className="text-zinc-600" />}
          <span className={[
            'text-xs font-bold tabular-nums',
            sube ? 'text-emerald-400' : baja ? 'text-red-400' : 'text-zinc-600',
          ].join(' ')}>
            {tendencia >= 0 ? '+' : ''}{tendencia.toFixed(1)} {unidad}
          </span>
        </div>
      </div>
      <div className="pb-2">{children}</div>
    </div>
  )
}
