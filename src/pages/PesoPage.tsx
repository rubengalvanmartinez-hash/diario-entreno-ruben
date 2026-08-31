import { useState, useMemo, useRef, useEffect } from 'react'
import { Check, Scale, TrendingUp, Minus, ArrowUp, ArrowDown, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useNavigate } from 'react-router-dom'
import { useFitLogStore } from '../store/useFitLogStore'
import type { PerfilCorporal, CategoriaImc } from '../types/models'
import { getUsuarioActivo, getIdActivo, sincronizarPesoSupabase, getRubenUUID, guardarComposicion, guardarPerfilCorporal } from '../services/supabase'
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
  const [syncOk,    setSyncOk]    = useState(false)

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
      // Perfil activo (perfil visto → Rubén → usuario), como el resto de la app
      const uid = getIdActivo() ?? (usuario.esRuben ? getRubenUUID() : usuario.id)
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
        // Error SOLO si falla Supabase (la nube de verdad); Google Sheets es
        // secundario y su fallo (token caducado, etc.) no debe asustar
        if (results[0].status === 'fulfilled') {
          if (pesoId) useFitLogStore.getState().marcarPesoSincronizado(pesoId)
          setSyncOk(true)
          setTimeout(() => setSyncOk(false), 3000)
        } else {
          setSyncError(`No se pudo guardar en Supabase: ${(results[0].reason as Error)?.message ?? 'error desconocido'}`)
          setTimeout(() => setSyncError(null), 6000)
        }
        if (results[1].status === 'rejected') {
          console.warn('[Peso] Google Sheets no sincronizado (secundario):', results[1].reason)
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

      {/* Confirmación de guardado en la nube */}
      {syncOk && (
        <p className="text-xs font-semibold text-emerald-400 -mt-4">☁️ Guardado en Supabase ✓</p>
      )}

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
// Pensada para el móvil:
//  - TOCAR un punto lo deja seleccionado (no hace falta mantener el dedo) y su
//    detalle se muestra fijo bajo el gráfico; tocar otra vez lo deselecciona.
//  - Chips de rango (1M/3M/6M/1A/Todo) + PELLIZCO con dos dedos para ampliar o
//    reducir el rango, y ARRASTRE con un dedo para moverse por el tiempo.

const RANGOS_PESO: { label: string; dias: number }[] = [
  { label: '1M', dias: 30 },
  { label: '3M', dias: 91 },
  { label: '6M', dias: 182 },
  { label: '1A', dias: 365 },
  { label: 'Todo', dias: Infinity },
]

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000)
}

function GraficaPeso() {
  const registros = useFitLogStore(useShallow((s) => s.registrosPeso))

  // Todos los registros, ascendentes, con media móvil de 7 registros
  const todos = useMemo(() => {
    const asc = [...registros]
      .filter((r) => r.pesoKg > 0)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    return asc.map((r, i) => {
      const ventana = asc.slice(Math.max(0, i - 6), i + 1)
      return { fecha: r.fecha, peso: r.pesoKg, ma: ventana.reduce((s, x) => s + x.pesoKg, 0) / ventana.length }
    })
  }, [registros])

  const totalDias = todos.length > 1 ? Math.max(diasEntre(todos[0].fecha, todos[todos.length - 1].fecha), 14) : 14

  const [rango,  setRango]  = useState(91)       // días visibles
  const [offset, setOffset] = useState(0)        // días desplazados hacia atrás desde el último registro
  const [selFecha, setSelFecha] = useState<string | null>(null)

  // Gestos
  const svgRef = useRef<SVGSVGElement>(null)
  const punteros = useRef(new Map<number, { x: number; y: number }>())
  const gesto = useRef<{ rango: number; offset: number; dist: number; x0: number; t0: number; movido: boolean } | null>(null)

  const rangoEfectivo = Math.min(rango === Infinity ? totalDias : rango, totalDias)
  const maxOffset = Math.max(0, totalDias - rangoEfectivo)
  const offsetEfectivo = Math.min(offset, maxOffset)

  // Datos visibles
  const { visibles, desdeISO, hastaISO } = useMemo(() => {
    if (todos.length === 0) return { visibles: [], desdeISO: '', hastaISO: '' }
    const ultima = todos[todos.length - 1].fecha
    const fin = new Date(ultima + 'T00:00:00'); fin.setDate(fin.getDate() - offsetEfectivo)
    const ini = new Date(fin); ini.setDate(ini.getDate() - rangoEfectivo)
    const hastaISO = fin.toLocaleDateString('sv')
    const desdeISO = ini.toLocaleDateString('sv')
    return { visibles: todos.filter((d) => d.fecha >= desdeISO && d.fecha <= hastaISO), desdeISO, hastaISO }
  }, [todos, rangoEfectivo, offsetEfectivo])

  const sel = selFecha !== null ? visibles.find((d) => d.fecha === selFecha) ?? null : null
  const selIdxTodos = sel ? todos.findIndex((d) => d.fecha === sel.fecha) : -1
  const anterior = selIdxTodos > 0 ? todos[selIdxTodos - 1] : null

  if (todos.length < 3) {
    return (
      <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 px-5 py-8 flex items-center justify-center">
        <p className="text-sm text-zinc-500 text-center">Añade más registros para ver la gráfica</p>
      </div>
    )
  }

  const W = 300, H = 170
  const PAD = { top: 14, right: 12, bottom: 24, left: 34 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const pesos = visibles.map((d) => d.peso)
  const rawMin = pesos.length ? Math.min(...pesos) : 0
  const rawMax = pesos.length ? Math.max(...pesos) : 1
  const margen = Math.max((rawMax - rawMin) * 0.2, 0.5)
  const minP = rawMin - margen
  const maxP = rawMax + margen

  const tsDesde = new Date(desdeISO + 'T00:00:00').getTime()
  const tsHasta = new Date(hastaISO + 'T00:00:00').getTime()
  const toX = (fecha: string) => {
    const t = new Date(fecha + 'T00:00:00').getTime()
    return PAD.left + (tsHasta === tsDesde ? innerW / 2 : ((t - tsDesde) / (tsHasta - tsDesde)) * innerW)
  }
  const toY = (p: number) => PAD.top + innerH - ((p - minP) / (maxP - minP)) * innerH

  const pts = visibles.map((d) => ({ x: toX(d.fecha), y: toY(d.peso), yMa: toY(d.ma), d }))

  const smooth = (getY: (p: typeof pts[number]) => number): string => {
    if (pts.length === 0) return ''
    if (pts.length === 1) return `M ${pts[0].x} ${getY(pts[0])}`
    let path = `M ${pts[0].x} ${getY(pts[0])}`
    for (let i = 1; i < pts.length; i++) {
      const cx = (pts[i - 1].x + pts[i].x) / 2
      path += ` C ${cx} ${getY(pts[i - 1])} ${cx} ${getY(pts[i])} ${pts[i].x} ${getY(pts[i])}`
    }
    return path
  }
  const linePath   = smooth((p) => p.y)
  const maPath     = smooth((p) => p.yMa)
  const areaPath   = pts.length > 1
    ? `${linePath} L ${pts[pts.length - 1].x} ${PAD.top + innerH} L ${pts[0].x} ${PAD.top + innerH} Z`
    : ''

  const yTicks = [0, 1, 2, 3, 4].map((i) => minP + (i / 4) * (maxP - minP))
  const fFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const xTicks = pts.length <= 6 ? pts.map((p) => p.d.fecha)
    : [0, 1, 2, 3].map((i) => visibles[Math.round((i / 3) * (visibles.length - 1))].fecha)

  // ── Gestos ────────────────────────────────────────────────────────────────
  const posDe = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }
  const distancia = (): number => {
    const [a, b] = [...punteros.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }

  const onDown = (e: React.PointerEvent) => {
    try { svgRef.current?.setPointerCapture(e.pointerId) } catch { /* puntero sintético o ya liberado */ }
    punteros.current.set(e.pointerId, posDe(e))
    gesto.current = {
      rango: rangoEfectivo, offset: offsetEfectivo,
      dist: punteros.current.size === 2 ? distancia() : 0,
      x0: posDe(e).x, t0: e.timeStamp, movido: gesto.current?.movido ?? false,
    }
  }

  const onMove = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId) || !gesto.current) return
    punteros.current.set(e.pointerId, posDe(e))
    if (punteros.current.size === 2) {
      // Pellizco: separar dedos = acercar (menos días); juntar = alejar
      if (gesto.current.dist === 0) { gesto.current.dist = distancia(); gesto.current.rango = rangoEfectivo }
      const factor = gesto.current.dist / distancia()
      const nuevo = Math.round(Math.min(Math.max(gesto.current.rango * factor, 14), totalDias))
      gesto.current.movido = true
      setRango(nuevo >= totalDias ? Infinity : nuevo)
    } else if (punteros.current.size === 1) {
      const dx = posDe(e).x - gesto.current.x0
      if (Math.abs(dx) > 6) gesto.current.movido = true
      // Arrastrar hacia la derecha = ver días más antiguos
      const dias = (dx / innerW) * rangoEfectivo
      setOffset(Math.min(Math.max(gesto.current.offset + dias, 0), maxOffset))
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const fueTap = punteros.current.size === 1 && gesto.current && !gesto.current.movido && e.timeStamp - gesto.current.t0 < 600
    punteros.current.delete(e.pointerId)
    if (fueTap && pts.length > 0) {
      const { x } = posDe(e)
      let cercano = pts[0]
      for (const p of pts) if (Math.abs(p.x - x) < Math.abs(cercano.x - x)) cercano = p
      setSelFecha((prev) => (prev === cercano.d.fecha ? null : cercano.d.fecha))
    }
    if (punteros.current.size === 0) gesto.current = null
    else if (gesto.current) { gesto.current.dist = 0; gesto.current.x0 = [...punteros.current.values()][0].x; gesto.current.offset = offsetEfectivo }
  }

  const rangoActivo = RANGOS_PESO.find((r) => r.dias === rango || (r.dias === Infinity && rango === Infinity))

  return (
    <div className="w-full max-w-xs rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Evolución del peso</p>
          {!rangoActivo && (
            <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded-full px-2 py-0.5 tabular-nums">
              {rangoEfectivo} días
            </span>
          )}
        </div>

        {/* Rango de tiempo */}
        <div className="flex items-center gap-1.5 mt-2">
          {RANGOS_PESO.map((r) => {
            const activo = rangoActivo?.label === r.label
            return (
              <button
                key={r.label}
                onClick={() => { setRango(r.dias); setOffset(0) }}
                aria-pressed={activo}
                className={[
                  'flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors',
                  activo ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700',
                ].join(' ')}
              >
                {r.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-4 mt-2">
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
        className="w-full select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <linearGradient id="pesoAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={toY(t)} x2={W - PAD.right} y2={toY(t)} stroke="#27272a" strokeWidth="1" />
            <text x={PAD.left - 4} y={toY(t) + 3.5} textAnchor="end" fill="#52525b" fontSize="7.5">{t.toFixed(1)}</text>
          </g>
        ))}

        {xTicks.map((f) => (
          <text key={f} x={toX(f)} y={H - 6} textAnchor="middle" fill="#52525b" fontSize="7.5">{fFecha(f)}</text>
        ))}

        {pts.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="#71717a" fontSize="9">
            Sin registros en este rango — arrastra o cambia el rango
          </text>
        )}

        {pts.length > 1 && <path d={areaPath} fill="url(#pesoAreaGrad)" />}
        {pts.length > 1 && <path d={maPath} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5 3" strokeLinecap="round" />}
        {pts.length > 1 && <path d={linePath} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

        {pts.map((p) => (
          <circle
            key={p.d.fecha}
            cx={p.x} cy={p.y}
            r={sel?.fecha === p.d.fecha ? 4.5 : pts.length > 40 ? 1.8 : 2.5}
            fill="#34d399"
            stroke={sel?.fecha === p.d.fecha ? '#ffffff' : '#18181b'}
            strokeWidth="1.5"
          />
        ))}

        {sel && (
          <line x1={toX(sel.fecha)} y1={PAD.top} x2={toX(sel.fecha)} y2={PAD.top + innerH} stroke="#52525b" strokeWidth="1" strokeDasharray="3 2" />
        )}
      </svg>

      {/* Detalle fijo del punto seleccionado (no desaparece al levantar el dedo) */}
      <div className="px-4 pb-3 min-h-10">
        {sel ? (
          <div className="flex items-center justify-between rounded-xl bg-zinc-800/80 px-3 py-2">
            <div>
              <p className="text-xs font-bold text-white tabular-nums">
                {sel.fecha.slice(8, 10)}/{sel.fecha.slice(5, 7)}/{sel.fecha.slice(0, 4)}
                <span className="ml-2 text-emerald-400">{sel.peso} kg</span>
              </p>
              <p className="text-[10px] text-zinc-500 tabular-nums">
                Media 7d: {sel.ma.toFixed(1)} kg
                {anterior && (
                  <span className={sel.peso - anterior.peso > 0 ? 'text-red-400' : sel.peso - anterior.peso < 0 ? 'text-emerald-400' : ''}>
                    {' · '}{sel.peso - anterior.peso > 0 ? '+' : ''}{(sel.peso - anterior.peso).toFixed(1)} vs anterior ({fFecha(anterior.fecha)})
                  </span>
                )}
              </p>
            </div>
            <button onClick={() => setSelFecha(null)} className="text-zinc-500 text-xs font-bold px-2 py-1 active:text-white" aria-label="Quitar selección">✕</button>
          </div>
        ) : (
          <p className="text-[10px] text-zinc-600 text-center pt-1">
            Toca un punto para fijarlo · pellizca para ampliar · arrastra para moverte
          </p>
        )}
      </div>
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
