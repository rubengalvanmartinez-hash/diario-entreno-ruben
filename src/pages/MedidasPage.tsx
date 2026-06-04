import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { getUsuarioActivo, getIdActivo, guardarMedidas } from '../services/supabase'
import type { RegistroMedidas } from '../types/models'

// ── Configuración de campos ───────────────────────────────────────────────────

type CampoKey = keyof Omit<RegistroMedidas, 'id' | 'fecha'>

interface CampoConfig {
  key: CampoKey
  label: string
  side: 'L' | 'R'
  /** Y relativa en el SVG (0–1, donde 1 = fondo = y=280) */
  yFrac: number
}

const CAMPOS: CampoConfig[] = [
  { key: 'cuello',         label: 'Cuello',      side: 'L', yFrac: 33 / 280 },
  { key: 'hombro',         label: 'Hombro',       side: 'R', yFrac: 40 / 280 },
  { key: 'pecho',          label: 'Pecho',         side: 'L', yFrac: 65 / 280 },
  { key: 'bicepsIzq',      label: 'Bíc. Izq',    side: 'L', yFrac: 90 / 280 },
  { key: 'bicepsDer',      label: 'Bíc. Der',    side: 'R', yFrac: 90 / 280 },
  { key: 'cinturaAlta',    label: 'Cin. Alta',   side: 'L', yFrac: 115 / 280 },
  { key: 'abdomen',        label: 'Abdomen',      side: 'R', yFrac: 128 / 280 },
  { key: 'cinturaBaja',    label: 'Cin. Baja',   side: 'L', yFrac: 145 / 280 },
  { key: 'cadera',         label: 'Cadera',       side: 'R', yFrac: 162 / 280 },
  { key: 'musloIzq',       label: 'Muslo Izq',   side: 'L', yFrac: 200 / 280 },
  { key: 'musloDer',       label: 'Muslo Der',   side: 'R', yFrac: 200 / 280 },
  { key: 'pantorrillaIzq', label: 'Pant. Izq',  side: 'L', yFrac: 245 / 280 },
  { key: 'pantorrillaDer', label: 'Pant. Der',  side: 'R', yFrac: 245 / 280 },
]

const CAMPOS_IZQ = CAMPOS.filter((c) => c.side === 'L')
const CAMPOS_DER = CAMPOS.filter((c) => c.side === 'R')

const ITEM_H   = 30  // px — alto de cada campo (label + input)
const MIN_GAP  = 5   // px — separación mínima entre campos

/** Distribuye tops con gap mínimo para evitar solapamientos. */
function distributeItems(items: CampoConfig[], figH: number): number[] {
  if (figH === 0) return items.map(() => 0)
  const tops = items.map((c) => c.yFrac * figH - ITEM_H / 2)
  for (let i = 1; i < tops.length; i++) {
    const minTop = tops[i - 1] + ITEM_H + MIN_GAP
    if (tops[i] < minTop) tops[i] = minTop
  }
  return tops
}

// ── Componente SVG cuerpo ─────────────────────────────────────────────────────

function BodyFigureSVG() {
  return (
    <svg viewBox="0 0 100 280" className="w-full" aria-hidden fill="none">
      <defs>
        <linearGradient id="bfg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#93c5fd" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.2"  />
        </linearGradient>
      </defs>

      {/* ── Rellenos (agrupados con opacidad conjunta para evitar doble-transparencia) ── */}
      <g fill="url(#bfg)">
        {/* Cabeza */}
        <ellipse cx="50" cy="14" rx="11" ry="12.5" />
        {/* Cuello */}
        <rect x="44" y="25" width="12" height="9" />
        {/* Torso */}
        <path d="M 20,34 L 80,34 C 82,58 82,88 78,112 C 76,128 74,146 78,162 L 22,162 C 26,146 24,128 22,112 C 18,88 18,58 20,34 Z" />
        {/* Brazo izquierdo */}
        <path d="M 20,36 L 10,42 C 6,60 4,88 4,118 L 4,130 L 14,130 C 15,108 17,86 18,62 Z" />
        {/* Brazo derecho */}
        <path d="M 80,36 L 90,42 C 94,60 96,88 96,118 L 96,130 L 86,130 C 85,108 83,86 82,62 Z" />
        {/* Pierna izquierda */}
        <path d="M 22,162 C 20,178 17,200 16,228 L 15,258 L 15,272 L 38,272 L 40,258 L 43,228 C 45,200 44,178 44,162 Z" />
        {/* Pierna derecha */}
        <path d="M 78,162 C 80,178 83,200 84,228 L 85,258 L 85,272 L 62,272 L 60,258 L 57,228 C 55,200 56,178 56,162 Z" />
      </g>

      {/* ── Contornos ── */}
      <g stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="50" cy="14" rx="11" ry="12.5" />
        {/* Torso: lados + hombros */}
        <path d="M 20,34 L 80,34" />
        <path d="M 20,34 C 18,58 18,88 22,112 C 24,128 26,146 22,162" />
        <path d="M 80,34 C 82,58 82,88 78,112 C 76,128 74,146 78,162" />
        {/* Brazo izquierdo */}
        <path d="M 20,36 L 10,42 C 6,60 4,88 4,118 L 4,130 L 14,130 C 15,108 17,86 18,62" />
        {/* Brazo derecho */}
        <path d="M 80,36 L 90,42 C 94,60 96,88 96,118 L 96,130 L 86,130 C 85,108 83,86 82,62" />
        {/* Pierna izquierda */}
        <path d="M 22,162 C 20,178 17,200 16,228 L 15,258 L 15,272 L 38,272 L 40,258 L 43,228 C 45,200 44,178 44,162" />
        {/* Pierna derecha */}
        <path d="M 78,162 C 80,178 83,200 84,228 L 85,258 L 85,272 L 62,272 L 60,258 L 57,228 C 55,200 56,178 56,162" />
      </g>

      {/* ── Líneas de referencia (izquierda) ── */}
      <g stroke="#3b82f6" strokeWidth="0.7" strokeDasharray="2,2" opacity="0.7">
        <line x1="44"  y1="33"  x2="2"  y2="33"  />  {/* cuello */}
        <line x1="22"  y1="65"  x2="2"  y2="65"  />  {/* pecho */}
        <line x1="4"   y1="90"  x2="2"  y2="90"  />  {/* bicepsIzq */}
        <line x1="22"  y1="112" x2="2"  y2="112" />  {/* cinturaAlta */}
        <line x1="22"  y1="145" x2="2"  y2="145" />  {/* cinturaBaja */}
        <line x1="16"  y1="200" x2="2"  y2="200" />  {/* musloIzq */}
        <line x1="15"  y1="245" x2="2"  y2="245" />  {/* pantorrillaIzq */}
      </g>

      {/* ── Líneas de referencia (derecha) ── */}
      <g stroke="#3b82f6" strokeWidth="0.7" strokeDasharray="2,2" opacity="0.7">
        <line x1="80"  y1="40"  x2="98" y2="40"  />  {/* hombro */}
        <line x1="96"  y1="90"  x2="98" y2="90"  />  {/* bicepsDer */}
        <line x1="78"  y1="128" x2="98" y2="128" />  {/* abdomen */}
        <line x1="78"  y1="162" x2="98" y2="162" />  {/* cadera */}
        <line x1="84"  y1="200" x2="98" y2="200" />  {/* musloDer */}
        <line x1="85"  y1="245" x2="98" y2="245" />  {/* pantorrillaDer */}
      </g>

      {/* ── Puntos de medición ── */}
      <g fill="#60a5fa">
        <circle cx="44"  cy="33"  r="1.8" />
        <circle cx="80"  cy="40"  r="1.8" />
        <circle cx="22"  cy="65"  r="1.8" />
        <circle cx="4"   cy="90"  r="1.8" />
        <circle cx="96"  cy="90"  r="1.8" />
        <circle cx="22"  cy="112" r="1.8" />
        <circle cx="78"  cy="128" r="1.8" />
        <circle cx="22"  cy="145" r="1.8" />
        <circle cx="78"  cy="162" r="1.8" />
        <circle cx="16"  cy="200" r="1.8" />
        <circle cx="84"  cy="200" r="1.8" />
        <circle cx="15"  cy="245" r="1.8" />
        <circle cx="85"  cy="245" r="1.8" />
      </g>
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(s: string): number | undefined {
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) || n <= 0 ? undefined : n
}

function formatFechaES(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function MedidasPage() {
  const navigate              = useNavigate()
  const historialMedidas      = useFitLogStore(useShallow((s) => s.historialMedidas))
  const guardarMedidasLocales = useFitLogStore((s) => s.guardarMedidasLocales)

  const hoy = new Date().toISOString().slice(0, 10)

  // Último registro guardado (referencia)
  const ultima = historialMedidas[0] ?? null

  // Estado de los inputs (vacíos al cargar; el placeholder muestra el último valor)
  const [valores, setValores] = useState<Partial<Record<CampoKey, string>>>({})

  const [guardando, setGuardando] = useState(false)
  const [msg,       setMsg]       = useState('')
  const [histOpen,  setHistOpen]  = useState(false)

  // Guard: solo para usuarios con puede_peso_corporal
  useEffect(() => {
    const u = getUsuarioActivo()
    if (u && !u.puedePesoCorporal) navigate('/', { replace: true })
  }, [navigate])

  // ── Referencia al contenedor de la figura para calcular altura ────────────
  const figureRef = useRef<HTMLDivElement>(null)
  const [figH, setFigH] = useState(0)

  useEffect(() => {
    const el = figureRef.current
    if (!el) return
    const update = () => setFigH(el.getBoundingClientRect().height)
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Posiciones calculadas para cada campo ─────────────────────────────────
  const topsIzq = useMemo(() => distributeItems(CAMPOS_IZQ, figH), [figH])
  const topsDer = useMemo(() => distributeItems(CAMPOS_DER, figH), [figH])

  // Altura total de cada columna lateral = posición del último campo + su altura
  const colH = useMemo(() => {
    const maxIzq = topsIzq.length > 0 ? topsIzq[topsIzq.length - 1] + ITEM_H : figH
    const maxDer = topsDer.length > 0 ? topsDer[topsDer.length - 1] + ITEM_H : figH
    return Math.max(figH, maxIzq, maxDer)
  }, [topsIzq, topsDer, figH])

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleGuardar = async () => {
    const uid = getIdActivo()
    if (!uid) { setMsg('❌ Sin sesión activa'); return }

    setGuardando(true)
    setMsg('')
    try {
      const registro: Omit<RegistroMedidas, 'id'> = {
        fecha:           hoy,
        cuello:          parseNum(valores.cuello          ?? ''),
        hombro:          parseNum(valores.hombro          ?? ''),
        pecho:           parseNum(valores.pecho           ?? ''),
        bicepsIzq:       parseNum(valores.bicepsIzq       ?? ''),
        bicepsDer:       parseNum(valores.bicepsDer       ?? ''),
        cinturaAlta:     parseNum(valores.cinturaAlta     ?? ''),
        cinturaBaja:     parseNum(valores.cinturaBaja     ?? ''),
        cadera:          parseNum(valores.cadera          ?? ''),
        musloIzq:        parseNum(valores.musloIzq        ?? ''),
        musloDer:        parseNum(valores.musloDer        ?? ''),
        pantorrillaIzq:  parseNum(valores.pantorrillaIzq  ?? ''),
        pantorrillaDer:  parseNum(valores.pantorrillaDer  ?? ''),
        abdomen:         parseNum(valores.abdomen         ?? ''),
      }

      await guardarMedidas(uid, registro)
      guardarMedidasLocales(registro)
      setMsg('✅ Medidas guardadas')
      setValores({})
    } catch (e) {
      console.error('[MedidasPage] Error guardando:', e)
      setMsg('❌ Error al guardar — revisa la conexión')
    } finally {
      setGuardando(false)
    }
  }

  const setVal = (key: CampoKey, v: string) =>
    setValores((prev) => ({ ...prev, [key]: v }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)] bg-black text-white">

      {/* Cabecera */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
        <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-zinc-400 active:text-white">
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-white leading-tight">Medidas corporales</h1>
          <p className="text-xs text-zinc-500">{formatFechaES(hoy)}</p>
        </div>
        {ultima && (
          <p className="text-[10px] text-zinc-600">
            Ref: {formatFechaES(ultima.fecha)}
          </p>
        )}
      </header>

      {/* Cuerpo principal */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Diagrama corporal ── */}
        <div className="flex items-start px-2 pt-4 pb-2">

          {/* Columna izquierda */}
          <div className="flex-1 relative" style={{ height: colH || undefined }}>
            {CAMPOS_IZQ.map((campo, i) => {
              const top = topsIzq[i] ?? 0
              const placeholder = ultima?.[campo.key]?.toString() ?? ''
              return (
                <div
                  key={campo.key}
                  className="absolute right-0 flex flex-col items-end pr-1"
                  style={{ top }}
                >
                  <span className="text-[9px] font-medium text-zinc-500 leading-none mb-0.5">
                    {campo.label}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <input
                      inputMode="decimal"
                      value={valores[campo.key] ?? ''}
                      onChange={(e) => setVal(campo.key, e.target.value)}
                      placeholder={placeholder || '—'}
                      className="w-12 bg-zinc-800/80 border border-zinc-700 rounded-lg
                                 px-1.5 py-1 text-xs text-white text-right
                                 placeholder:text-zinc-600
                                 focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-[9px] text-zinc-600 w-4">cm</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Figura SVG */}
          <div ref={figureRef} className="w-32 flex-shrink-0">
            <BodyFigureSVG />
          </div>

          {/* Columna derecha */}
          <div className="flex-1 relative" style={{ height: colH || undefined }}>
            {CAMPOS_DER.map((campo, i) => {
              const top = topsDer[i] ?? 0
              const placeholder = ultima?.[campo.key]?.toString() ?? ''
              return (
                <div
                  key={campo.key}
                  className="absolute left-0 flex flex-col items-start pl-1"
                  style={{ top }}
                >
                  <span className="text-[9px] font-medium text-zinc-500 leading-none mb-0.5">
                    {campo.label}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <input
                      inputMode="decimal"
                      value={valores[campo.key] ?? ''}
                      onChange={(e) => setVal(campo.key, e.target.value)}
                      placeholder={placeholder || '—'}
                      className="w-12 bg-zinc-800/80 border border-zinc-700 rounded-lg
                                 px-1.5 py-1 text-xs text-white
                                 placeholder:text-zinc-600
                                 focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-[9px] text-zinc-600 w-4">cm</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Botón guardar ── */}
        <div className="px-5 pt-4 pb-2 flex flex-col gap-2">
          <button
            onClick={handleGuardar}
            disabled={guardando}
            className="w-full rounded-2xl bg-blue-600 py-3.5 text-sm font-bold text-white
                       active:bg-blue-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar medidas'}
          </button>
          {msg && (
            <p className={['text-xs text-center px-1', msg.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
              {msg}
            </p>
          )}
        </div>

        {/* ── Historial ── */}
        <div className="px-5 pb-8 mt-2">
          <button
            onClick={() => setHistOpen((v) => !v)}
            className="flex items-center gap-2 w-full py-2"
          >
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Historial
            </span>
            <span className="text-xs text-zinc-600 ml-1">
              ({historialMedidas.length} registros)
            </span>
            {histOpen
              ? <ChevronUp size={14} className="ml-auto text-zinc-600" />
              : <ChevronDown size={14} className="ml-auto text-zinc-600" />
            }
          </button>

          {histOpen && (
            <div className="flex flex-col gap-2 mt-1">
              {historialMedidas.length === 0 && (
                <p className="text-xs text-zinc-600 text-center py-4">Sin registros aún</p>
              )}
              {historialMedidas.slice(0, 20).map((r) => (
                <HistorialItem key={r.id} registro={r} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── HistorialItem ─────────────────────────────────────────────────────────────

function HistorialItem({ registro }: { registro: RegistroMedidas }) {
  const campos: Array<{ label: string; val?: number }> = [
    { label: 'Cuello',    val: registro.cuello        },
    { label: 'Hombro',    val: registro.hombro        },
    { label: 'Pecho',     val: registro.pecho         },
    { label: 'Bíc.Izq',  val: registro.bicepsIzq     },
    { label: 'Bíc.Der',  val: registro.bicepsDer     },
    { label: 'Cin.Alta',  val: registro.cinturaAlta   },
    { label: 'Abdomen',   val: registro.abdomen       },
    { label: 'Cin.Baja',  val: registro.cinturaBaja   },
    { label: 'Cadera',    val: registro.cadera        },
    { label: 'Muslo Izq', val: registro.musloIzq      },
    { label: 'Muslo Der', val: registro.musloDer      },
    { label: 'Pant.Izq',  val: registro.pantorrillaIzq },
    { label: 'Pant.Der',  val: registro.pantorrillaDer },
  ].filter((c) => c.val != null)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
      <p className="text-xs font-bold text-zinc-400 mb-2">{formatFechaES(registro.fecha)}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {campos.map((c) => (
          <span key={c.label} className="text-xs text-zinc-300">
            <span className="text-zinc-500">{c.label}</span>{' '}
            <span className="font-semibold tabular-nums">{c.val}</span>
            <span className="text-zinc-600">cm</span>
          </span>
        ))}
      </div>
    </div>
  )
}
