import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, BarChart2, Trash2, Check, X, Ruler, Save } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { getUsuarioActivo, getIdActivo, guardarMedidas, eliminarMedidasPorFecha } from '../services/supabase'
import type { RegistroMedidas } from '../types/models'

// ── Configuración de campos ───────────────────────────────────────────────────

type CampoKey = keyof Omit<RegistroMedidas, 'id' | 'fecha'>

interface CampoConfig {
  key: CampoKey
  /** Etiqueta corta (figura y tabla) */
  label: string
  /** Nombre completo (wizard) */
  nombre: string
  /** Dónde/cómo medir (wizard) */
  tip: string
  side: 'L' | 'R'
  /** Y relativa en el SVG (0–1, donde 1 = fondo = y=280) */
  yFrac: number
}

const CAMPOS: CampoConfig[] = [
  { key: 'cuello',         label: 'Cuello',     nombre: 'Cuello',               tip: 'Justo por debajo de la nuez, cinta horizontal y sin apretar.',                side: 'L', yFrac: 33 / 280 },
  { key: 'hombro',         label: 'Hombro',     nombre: 'Hombros',              tip: 'Contorno completo a la altura de los deltoides, brazos relajados.',          side: 'R', yFrac: 40 / 280 },
  { key: 'pecho',          label: 'Pecho',      nombre: 'Pecho',                tip: 'A la altura de los pezones, al final de una espiración normal.',             side: 'L', yFrac: 65 / 280 },
  { key: 'bicepsIzq',      label: 'Bíc. Izq',   nombre: 'Bíceps izquierdo',     tip: 'Brazo flexionado y contraído, en el punto más grueso.',                      side: 'L', yFrac: 90 / 280 },
  { key: 'bicepsDer',      label: 'Bíc. Der',   nombre: 'Bíceps derecho',       tip: 'Brazo flexionado y contraído, en el punto más grueso.',                      side: 'R', yFrac: 90 / 280 },
  { key: 'cinturaAlta',    label: 'Cin. Alta',  nombre: 'Cintura alta',         tip: 'En la parte más estrecha del torso, por encima del ombligo.',                side: 'L', yFrac: 115 / 280 },
  { key: 'abdomen',        label: 'Abdomen',    nombre: 'Abdomen',              tip: 'A la altura del ombligo, relajado, sin meter tripa.',                        side: 'R', yFrac: 128 / 280 },
  { key: 'cinturaBaja',    label: 'Cin. Baja',  nombre: 'Cintura baja',         tip: 'Unos 5 cm por debajo del ombligo, cinta horizontal.',                        side: 'L', yFrac: 145 / 280 },
  { key: 'cadera',         label: 'Cadera',     nombre: 'Cadera',               tip: 'En la parte más ancha de los glúteos, pies juntos.',                         side: 'R', yFrac: 162 / 280 },
  { key: 'musloIzq',       label: 'Muslo Izq',  nombre: 'Muslo izquierdo',      tip: 'En la parte más gruesa, justo debajo del glúteo, de pie y relajado.',        side: 'L', yFrac: 200 / 280 },
  { key: 'musloDer',       label: 'Muslo Der',  nombre: 'Muslo derecho',        tip: 'En la parte más gruesa, justo debajo del glúteo, de pie y relajado.',        side: 'R', yFrac: 200 / 280 },
  { key: 'pantorrillaIzq', label: 'Pant. Izq',  nombre: 'Pantorrilla izquierda', tip: 'En el punto más grueso del gemelo, de pie con el peso repartido.',          side: 'L', yFrac: 245 / 280 },
  { key: 'pantorrillaDer', label: 'Pant. Der',  nombre: 'Pantorrilla derecha',  tip: 'En el punto más grueso del gemelo, de pie con el peso repartido.',           side: 'R', yFrac: 245 / 280 },
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
  const historialMedidas        = useFitLogStore(useShallow((s) => s.historialMedidas))
  const guardarMedidasLocales   = useFitLogStore((s) => s.guardarMedidasLocales)
  const eliminarMedidasLocales  = useFitLogStore((s) => s.eliminarMedidasLocales)

  const hoy = new Date().toISOString().slice(0, 10)
  const [fecha, setFecha] = useState(hoy)

  // Último registro guardado (referencia)
  const ultima = historialMedidas[0] ?? null

  // Estado de los inputs (vacíos al cargar; el placeholder muestra el último valor)
  const [valores, setValores] = useState<Partial<Record<CampoKey, string>>>({})

  const [guardando, setGuardando] = useState(false)
  const [msg,       setMsg]       = useState('')
  const [histOpen,  setHistOpen]  = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)

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
        fecha:           fecha,
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
        <h1 className="text-base font-bold text-white leading-tight">Medidas corporales</h1>
      </header>

      {/* Cuerpo principal */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Wizard paso a paso ── */}
        <div className="mx-4 mt-4">
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5
                       text-sm font-bold text-white active:bg-emerald-700"
          >
            <Ruler size={16} />
            Introducir medidas paso a paso
          </button>
          <p className="text-[11px] text-zinc-600 text-center mt-1.5">
            O rellena directamente los campos sobre la figura
          </p>
        </div>

        {/* ── Selector de fecha ── */}
        <div className="mx-4 mt-4 mb-1 flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
          <span className="text-xs font-semibold text-zinc-400 whitespace-nowrap">Fecha de la medición:</span>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => { if (e.target.value) { setFecha(e.target.value); setMsg('') } }}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-blue-500"
          />
        </div>

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
            onClick={() => navigate('/progreso-corporal')}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-800 border border-zinc-700
                       py-3 text-sm font-bold text-zinc-300 active:bg-zinc-700"
          >
            <BarChart2 size={16} />
            Ver progreso corporal
          </button>
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
            <div className="mt-1">
              {historialMedidas.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-4">Sin registros aún</p>
              ) : (
                <TablaMedidas
                  registros={historialMedidas}
                  onGuardar={async (registro) => {
                    const uid = getIdActivo()
                    if (!uid) throw new Error('Sin sesión activa')
                    await guardarMedidas(uid, registro)
                    guardarMedidasLocales(registro)
                  }}
                  onEliminar={async (r) => {
                    const uid = getIdActivo()
                    if (uid) {
                      try { await eliminarMedidasPorFecha(uid, r.fecha) } catch { /* offline OK */ }
                    }
                    eliminarMedidasLocales(r.id)
                  }}
                />
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Wizard ── */}
      {wizardOpen && (
        <WizardMedidas
          ultima={ultima}
          onCerrar={() => setWizardOpen(false)}
          onGuardar={async (registro) => {
            const uid = getIdActivo()
            if (!uid) throw new Error('Sin sesión activa')
            await guardarMedidas(uid, registro)
            guardarMedidasLocales(registro)
            setMsg('✅ Medidas guardadas')
            setHistOpen(true)
          }}
        />
      )}
    </div>
  )
}

// ── TablaMedidas ──────────────────────────────────────────────────────────────
// Medidas en filas, una columna por fecha (más reciente primero). Celdas
// editables; al modificar una columna aparece "Guardar" en su cabecera.

function TablaMedidas({
  registros,
  onGuardar,
  onEliminar,
}: {
  registros: RegistroMedidas[]
  onGuardar: (registro: Omit<RegistroMedidas, 'id'>) => Promise<void>
  onEliminar: (registro: RegistroMedidas) => Promise<void>
}) {
  // edits[id][campo] = texto en edición (solo celdas tocadas)
  const [edits,       setEdits]       = useState<Record<string, Partial<Record<CampoKey, string>>>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)
  const [confirmarId, setConfirmarId] = useState<string | null>(null)
  const [error,       setError]       = useState('')

  const setCelda = (id: string, key: CampoKey, v: string) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: v } }))

  const descartar = (id: string) =>
    setEdits((prev) => { const next = { ...prev }; delete next[id]; return next })

  const guardarColumna = async (r: RegistroMedidas) => {
    const cambios = edits[r.id] ?? {}
    const registro: Omit<RegistroMedidas, 'id'> = { fecha: r.fecha }
    for (const c of CAMPOS) {
      const texto = cambios[c.key]
      // Celda tocada → valor nuevo (vacío = borrar medida); no tocada → valor actual
      registro[c.key] = texto !== undefined ? parseNum(texto) : r[c.key]
    }
    setGuardandoId(r.id)
    setError('')
    try {
      await onGuardar(registro)
      descartar(r.id)
    } catch (e) {
      console.error('[TablaMedidas] Error guardando:', e)
      setError('❌ No se pudo guardar — revisa la conexión')
    } finally {
      setGuardandoId(null)
    }
  }

  const fechaCorta = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y.slice(2)}`
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-zinc-600">
        Toca una celda para editarla. Desliza para ver más fechas.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-zinc-900 text-left font-semibold text-zinc-500 px-3 py-2 border-b border-r border-zinc-800 min-w-[5.5rem]">
                Medida
              </th>
              {registros.map((r) => {
                const dirty = edits[r.id] !== undefined && Object.keys(edits[r.id]).length > 0
                const guardando = guardandoId === r.id
                return (
                  <th key={r.id} className="px-1.5 py-1.5 border-b border-zinc-800 min-w-[4.5rem] align-top">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold text-zinc-300 tabular-nums whitespace-nowrap">{fechaCorta(r.fecha)}</span>
                      {dirty ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => guardarColumna(r)}
                            disabled={guardando}
                            className="flex items-center gap-0.5 rounded-md bg-emerald-600 text-white px-1.5 py-0.5 text-[10px] font-bold active:bg-emerald-700 disabled:opacity-50"
                          >
                            <Save size={10} />{guardando ? '…' : 'Guardar'}
                          </button>
                          <button onClick={() => descartar(r.id)} className="p-0.5 text-zinc-500 active:text-white" aria-label="Descartar cambios">
                            <X size={12} />
                          </button>
                        </div>
                      ) : confirmarId === r.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => { await onEliminar(r); setConfirmarId(null) }}
                            className="rounded-md bg-red-600 text-white px-1.5 py-0.5 text-[10px] font-bold active:bg-red-700"
                          >
                            Borrar
                          </button>
                          <button onClick={() => setConfirmarId(null)} className="p-0.5 text-zinc-500 active:text-white" aria-label="Cancelar">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmarId(r.id)} className="p-0.5 text-zinc-600 active:text-red-400" aria-label={`Eliminar ${fechaCorta(r.fecha)}`}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {CAMPOS.map((c) => (
              <tr key={c.key}>
                <td className="sticky left-0 z-10 bg-zinc-900 text-zinc-400 font-medium px-3 py-1 border-b border-r border-zinc-800/70 whitespace-nowrap">
                  {c.label}
                </td>
                {registros.map((r) => {
                  const editado = edits[r.id]?.[c.key]
                  const valor   = editado !== undefined ? editado : (r[c.key]?.toString() ?? '')
                  const tocada  = editado !== undefined
                  return (
                    <td key={r.id} className="px-1 py-0.5 border-b border-zinc-800/70">
                      <input
                        inputMode="decimal"
                        value={valor}
                        onChange={(e) => setCelda(r.id, c.key, e.target.value)}
                        placeholder="—"
                        aria-label={`${c.nombre} ${fechaCorta(r.fecha)}`}
                        className={[
                          'w-16 rounded-md px-1.5 py-1 text-xs text-right tabular-nums text-white',
                          'bg-transparent border placeholder:text-zinc-700 focus:outline-none focus:border-blue-500',
                          tocada ? 'border-emerald-500/70 bg-emerald-500/10' : 'border-transparent focus:bg-zinc-800',
                        ].join(' ')}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── WizardMedidas ─────────────────────────────────────────────────────────────
// Asistente a pantalla completa: fecha → una medida por paso (cm) → resumen.

function WizardMedidas({
  ultima,
  onCerrar,
  onGuardar,
}: {
  ultima: RegistroMedidas | null
  onCerrar: () => void
  onGuardar: (registro: Omit<RegistroMedidas, 'id'>) => Promise<void>
}) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [fecha,   setFecha]   = useState(hoy)
  // paso 0 = fecha; 1..CAMPOS.length = medidas; CAMPOS.length+1 = resumen
  const [paso,    setPaso]    = useState(0)
  const [valores, setValores] = useState<Partial<Record<CampoKey, string>>>({})
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const totalPasos = CAMPOS.length
  const campo      = paso >= 1 && paso <= totalPasos ? CAMPOS[paso - 1] : null
  const enResumen  = paso === totalPasos + 1

  useEffect(() => {
    // Enfocar el input al cambiar de paso (tras el render)
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [paso])

  const siguiente = () => setPaso((p) => Math.min(p + 1, totalPasos + 1))
  const atras     = () => setPaso((p) => Math.max(p - 1, 0))

  const rellenas = CAMPOS.filter((c) => parseNum(valores[c.key] ?? '') !== undefined).length

  const guardar = async () => {
    const registro: Omit<RegistroMedidas, 'id'> = { fecha }
    for (const c of CAMPOS) registro[c.key] = parseNum(valores[c.key] ?? '')
    setGuardando(true)
    setError('')
    try {
      await onGuardar(registro)
      onCerrar()
    } catch (e) {
      console.error('[WizardMedidas] Error guardando:', e)
      setError('❌ No se pudo guardar — revisa la conexión')
    } finally {
      setGuardando(false)
    }
  }

  const valorActual = campo ? (valores[campo.key] ?? '') : ''
  const anterior    = campo ? ultima?.[campo.key] : undefined
  const numActual   = parseNum(valorActual)
  const diff        = numActual !== undefined && anterior !== undefined ? numActual - anterior : null

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white flex flex-col">
      {/* Cabecera + progreso */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
        <button onClick={onCerrar} className="p-1 -ml-1 text-zinc-400 active:text-white" aria-label="Cerrar">
          <X size={22} />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold leading-tight">Medidas paso a paso</p>
          <p className="text-[11px] text-zinc-500">
            {paso === 0 ? 'Fecha de la medición' : enResumen ? 'Resumen' : `Medida ${paso} de ${totalPasos}`}
          </p>
        </div>
        <span className="text-[11px] text-zinc-500 tabular-nums">{rellenas}/{totalPasos}</span>
      </header>
      <div className="h-1 bg-zinc-900">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${(Math.min(paso, totalPasos + 1) / (totalPasos + 1)) * 100}%` }}
        />
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto px-6 pt-8 pb-4">
        {paso === 0 && (
          <div className="flex flex-col items-center gap-6">
            <div className="size-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <Ruler size={30} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-black">¿De qué día son las medidas?</h2>
              <p className="text-sm text-zinc-500 mt-1">Después irás midiendo una zona cada vez.</p>
            </div>
            <input
              ref={inputRef}
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => { if (e.target.value) setFecha(e.target.value) }}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-lg text-white
                         focus:outline-none focus:border-emerald-500"
            />
            {ultima && (
              <p className="text-xs text-zinc-600 text-center">
                Última medición guardada: {formatFechaES(ultima.fecha)}
              </p>
            )}
          </div>
        )}

        {campo && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-2xl font-black">{campo.nombre}</h2>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-xs">{campo.tip}</p>
            </div>

            <div className="flex items-end gap-3">
              <input
                ref={inputRef}
                inputMode="decimal"
                value={valorActual}
                onChange={(e) => setValores((prev) => ({ ...prev, [campo.key]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && siguiente()}
                placeholder={anterior !== undefined ? String(anterior) : '0.0'}
                className="w-40 bg-transparent text-right text-6xl font-black text-white
                           border-b-2 border-zinc-700 focus:border-emerald-500 focus:outline-none
                           pb-1 placeholder-zinc-800"
              />
              <span className="text-2xl font-bold text-zinc-500 pb-2">cm</span>
            </div>

            <div className="h-6 text-center">
              {anterior !== undefined && (
                <p className="text-xs text-zinc-500">
                  Anterior: <span className="text-zinc-300 font-semibold">{anterior} cm</span>
                  {diff !== null && Math.abs(diff) >= 0.05 && (
                    <span className={['ml-2 font-bold', diff > 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)} cm
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Mini-índice de pasos */}
            <div className="flex flex-wrap justify-center gap-1.5 max-w-xs">
              {CAMPOS.map((c, i) => {
                const hecho = parseNum(valores[c.key] ?? '') !== undefined
                const actual = i === paso - 1
                return (
                  <button
                    key={c.key}
                    onClick={() => setPaso(i + 1)}
                    className={[
                      'size-2.5 rounded-full transition-colors',
                      actual ? 'bg-emerald-400 scale-125' : hecho ? 'bg-emerald-700' : 'bg-zinc-700',
                    ].join(' ')}
                    aria-label={c.nombre}
                  />
                )
              })}
            </div>
          </div>
        )}

        {enResumen && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <h2 className="text-xl font-black">Resumen · {formatFechaES(fecha)}</h2>
              <p className="text-sm text-zinc-500 mt-1">
                {rellenas} de {totalPasos} medidas. Toca una para corregirla.
              </p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {CAMPOS.map((c, i) => {
                const n = parseNum(valores[c.key] ?? '')
                const prev = ultima?.[c.key]
                const d = n !== undefined && prev !== undefined ? n - prev : null
                return (
                  <li key={c.key}>
                    <button
                      onClick={() => setPaso(i + 1)}
                      className="w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 active:bg-zinc-800"
                    >
                      <span className="text-sm text-zinc-300">{c.nombre}</span>
                      <span className="flex items-baseline gap-2">
                        {d !== null && Math.abs(d) >= 0.05 && (
                          <span className={['text-[11px] font-semibold tabular-nums', d > 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                            {d > 0 ? '+' : ''}{d.toFixed(1)}
                          </span>
                        )}
                        <span className={['text-sm font-bold tabular-nums', n !== undefined ? 'text-white' : 'text-zinc-600'].join(' ')}>
                          {n !== undefined ? `${n} cm` : '—'}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          </div>
        )}
      </div>

      {/* Navegación */}
      <div className="px-5 pb-6 pt-3 border-t border-zinc-800/60 flex items-center gap-2">
        <button
          onClick={atras}
          disabled={paso === 0}
          className="flex items-center gap-1 rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-bold text-zinc-300
                     active:bg-zinc-700 disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Atrás
        </button>
        {!enResumen ? (
          <button
            onClick={siguiente}
            className="flex-1 flex items-center justify-center gap-1 rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white active:bg-emerald-700"
          >
            {campo && valorActual.trim() === '' ? 'Saltar' : 'Siguiente'} <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={guardar}
            disabled={guardando || rellenas === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3 text-sm font-bold text-white
                       active:bg-blue-700 disabled:opacity-50"
          >
            <Check size={16} strokeWidth={2.5} />
            {guardando ? 'Guardando…' : `Guardar ${rellenas} medida${rellenas !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </div>
  )
}
