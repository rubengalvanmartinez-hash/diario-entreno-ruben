import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import type { RegistroMedidas } from '../types/models'
import { getUsuarioActivo } from '../services/supabase'

// ── Tipos internos ────────────────────────────────────────────────────────────

type CampoKey = keyof Omit<RegistroMedidas, 'id' | 'fecha'>

interface ZonaDef {
  label:      string
  campos:     CampoKey[]
  pesoMuscular: number   // peso en índice de hipertrofia (0 = no muscular)
  esCintura:  boolean
  svgDot:     { cx: number; cy: number }  // punto en SVG viewBox 0 0 100 280
}

type TabId = 'resumen' | 'cuerpo' | 'analizar'

// ── Configuración de zonas ────────────────────────────────────────────────────

const ZONAS: Record<string, ZonaDef> = {
  cuello:       { label: 'Cuello',        campos: ['cuello'],                           pesoMuscular: 0,    esCintura: false, svgDot: { cx: 50, cy: 33  } },
  hombro:       { label: 'Hombros',       campos: ['hombro'],                           pesoMuscular: 0.15, esCintura: false, svgDot: { cx: 80, cy: 40  } },
  pecho:        { label: 'Pecho',         campos: ['pecho'],                            pesoMuscular: 0.20, esCintura: false, svgDot: { cx: 50, cy: 65  } },
  biceps:       { label: 'Bíceps',        campos: ['bicepsIzq', 'bicepsDer'],           pesoMuscular: 0.20, esCintura: false, svgDot: { cx: 4,  cy: 90  } },
  cinturaAlta:  { label: 'Cin. Alta',     campos: ['cinturaAlta'],                      pesoMuscular: 0,    esCintura: true,  svgDot: { cx: 22, cy: 112 } },
  abdomen:      { label: 'Abdomen',       campos: ['abdomen'],                          pesoMuscular: 0,    esCintura: true,  svgDot: { cx: 78, cy: 128 } },
  cinturaBaja:  { label: 'Cin. Baja',     campos: ['cinturaBaja'],                      pesoMuscular: 0,    esCintura: true,  svgDot: { cx: 22, cy: 145 } },
  cadera:       { label: 'Cadera',        campos: ['cadera'],                           pesoMuscular: 0,    esCintura: true,  svgDot: { cx: 78, cy: 162 } },
  muslos:       { label: 'Muslos',        campos: ['musloIzq', 'musloDer'],             pesoMuscular: 0.20, esCintura: false, svgDot: { cx: 30, cy: 200 } },
  pantorrillas: { label: 'Pantorrillas',  campos: ['pantorrillaIzq', 'pantorrillaDer'], pesoMuscular: 0.10, esCintura: false, svgDot: { cx: 26, cy: 245 } },
}

// ── Utilidades puras ──────────────────────────────────────────────────────────

function avgCampos(r: RegistroMedidas, campos: CampoKey[]): number | undefined {
  const vals = campos.map((c) => r[c]).filter((v): v is number => v != null)
  if (vals.length === 0) return undefined
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

function isoHaceNDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Registro más reciente cuya fecha sea <= `hasta` */
function registroEn(hist: RegistroMedidas[], hasta: string): RegistroMedidas | null {
  return hist.find((r) => r.fecha <= hasta) ?? null
}

/** Cambio de una zona entre dos registros */
function deltaZona(
  antes: RegistroMedidas | null,
  despues: RegistroMedidas | null,
  campos: CampoKey[],
): number | undefined {
  if (!antes || !despues) return undefined
  const a = avgCampos(antes, campos)
  const b = avgCampos(despues, campos)
  if (a == null || b == null) return undefined
  return +(b - a).toFixed(1)
}

/** Regresión lineal simple → pendiente (unidades/día) */
function regresionLineal(pts: { x: number; y: number }[]): number {
  const n = pts.length
  if (n < 2) return 0
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const num = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  return den === 0 ? 0 : num / den
}

function formatFechaES(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function signo(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1)
}

// ── Cálculos principales ──────────────────────────────────────────────────────

interface ScoreResult {
  score:       number
  deltaMes:    number | null
  muscular:    number
  cintura:     number
  simetria:    number
  consistencia: number
}

function calcularScore(hist: RegistroMedidas[]): ScoreResult {
  if (hist.length < 2) return { score: 0, deltaMes: null, muscular: 0, cintura: 0, simetria: 0, consistencia: 0 }

  const actual    = hist[0]
  const hace90    = registroEn(hist, isoHaceNDias(90))
  const hace30    = registroEn(hist, isoHaceNDias(30))
  const hace30m90 = registroEn(hist, isoHaceNDias(120))

  // ── Muscular (0-100)
  const zonasMusc = Object.values(ZONAS).filter((z) => z.pesoMuscular > 0)
  let muscTotal = 0, pesoTotal = 0
  for (const z of zonasMusc) {
    const d = deltaZona(hace90, actual, z.campos)
    if (d == null) continue
    // +2cm o más = 100 pts; 0 = 50; -2cm = 0
    const pts = Math.max(0, Math.min(100, 50 + d * 25))
    muscTotal += pts * z.pesoMuscular
    pesoTotal += z.pesoMuscular
  }
  const muscular = pesoTotal > 0 ? Math.round(muscTotal / pesoTotal) : 50

  // ── Cintura (0-100): mantener o bajar = bien
  const cinturaZonas = [ZONAS.cinturaAlta, ZONAS.cinturaBaja, ZONAS.abdomen]
  let cintTotal = 0, cintN = 0
  for (const z of cinturaZonas) {
    const d = deltaZona(hace90, actual, z.campos)
    if (d == null) continue
    // -2 = 100, 0 = 75, +2 = 25, +3+ = 0
    const pts = Math.max(0, Math.min(100, 75 - d * 25))
    cintTotal += pts; cintN++
  }
  const cintura = cintN > 0 ? Math.round(cintTotal / cintN) : 50

  // ── Simetría (0-100)
  const pares: [CampoKey, CampoKey][] = [
    ['bicepsIzq', 'bicepsDer'],
    ['musloIzq', 'musloDer'],
    ['pantorrillaIzq', 'pantorrillaDer'],
  ]
  let simTotal = 0, simN = 0
  for (const [a, b] of pares) {
    const va = actual[a], vb = actual[b]
    if (va == null || vb == null) continue
    const avg2 = (va + vb) / 2
    const diff = Math.abs(va - vb)
    const pct = diff / avg2  // asimetría relativa
    simTotal += Math.max(0, 100 - pct * 500)  // 0.2% diff = -1 pts; 20% diff = -100
    simN++
  }
  const simetria = simN > 0 ? Math.round(simTotal / simN) : 75

  // ── Consistencia: mediciones en últimos 90 días (4+ = 100)
  const med90 = hist.filter((r) => r.fecha >= isoHaceNDias(90)).length
  const consistencia = Math.min(100, Math.round(med90 / 4 * 100))

  const score = Math.round(muscular * 0.40 + cintura * 0.20 + simetria * 0.20 + consistencia * 0.20)

  // ── Delta vs mes pasado
  let deltaMes: number | null = null
  if (hace30 && hace30m90) {
    const scoreAntes = calcularScoreSimple(hist, hace30)
    deltaMes = score - scoreAntes
  }

  return { score, deltaMes, muscular, cintura, simetria, consistencia }
}

/** Score simplificado para comparación histórica (sin recursión) */
function calcularScoreSimple(hist: RegistroMedidas[], actual: RegistroMedidas): number {
  const hace90 = registroEn(hist.filter((r) => r.fecha < actual.fecha), isoHaceNDias(90))
  if (!hace90) return 50
  const zonasMusc = Object.values(ZONAS).filter((z) => z.pesoMuscular > 0)
  let muscTotal = 0, pesoTotal = 0
  for (const z of zonasMusc) {
    const d = deltaZona(hace90, actual, z.campos)
    if (d == null) continue
    muscTotal += Math.max(0, Math.min(100, 50 + d * 25)) * z.pesoMuscular
    pesoTotal += z.pesoMuscular
  }
  return pesoTotal > 0 ? Math.round(muscTotal / pesoTotal) : 50
}

interface EstadoInfo {
  etiqueta:    string
  descripcion: string
  color:       string
}

function detectarEstado(hist: RegistroMedidas[]): EstadoInfo | null {
  if (hist.length < 2) return null
  const actual  = hist[0]
  const hace60  = registroEn(hist, isoHaceNDias(60))
  if (!hace60 || hace60.fecha === actual.fecha) return null

  const dMusc = (['hombro', 'pecho', 'biceps', 'muslos'] as const)
    .map((k) => deltaZona(hace60, actual, ZONAS[k].campos))
    .filter((d): d is number => d != null)
  const dCintura = (['cinturaAlta', 'abdomen', 'cinturaBaja'] as const)
    .map((k) => deltaZona(hace60, actual, ZONAS[k].campos))
    .filter((d): d is number => d != null)

  if (dMusc.length === 0) return null

  const avgMusc   = dMusc.reduce((s, v) => s + v, 0) / dMusc.length
  const avgCint   = dCintura.length > 0 ? dCintura.reduce((s, v) => s + v, 0) / dCintura.length : 0

  if (avgMusc >= 0.5 && avgCint <= 0.3)
    return { etiqueta: 'Hipertrofia limpia (estimada)', descripcion: `Músculos crecen +${avgMusc.toFixed(1)} cm de media con cintura estable. Señal de ganancia muscular con poca acumulación de grasa abdominal.`, color: 'text-emerald-400' }
  if (avgMusc >= 0.5 && avgCint > 1.0)
    return { etiqueta: 'Posible volumen con grasa', descripcion: `Músculos crecen +${avgMusc.toFixed(1)} cm pero cintura también +${avgCint.toFixed(1)} cm. Puede indicar superávit calórico amplio.`, color: 'text-amber-400' }
  if (avgMusc >= 0.0 && avgMusc < 0.5 && avgCint < 0)
    return { etiqueta: 'Posible recomposición', descripcion: `Cintura baja ${Math.abs(avgCint).toFixed(1)} cm mientras músculos se mantienen. Señal de pérdida de grasa sin perder músculo.`, color: 'text-blue-400' }
  if (avgMusc < -0.5)
    return { etiqueta: 'Posible pérdida muscular', descripcion: `Los perímetros musculares bajan de media ${Math.abs(avgMusc).toFixed(1)} cm. Puede indicar déficit calórico o menor volumen de entrenamiento.`, color: 'text-red-400' }
  return { etiqueta: 'Estancamiento', descripcion: 'Sin cambios significativos en músculos ni cintura en los últimos 60 días.', color: 'text-zinc-400' }
}

interface ZonaProgreso {
  zonaId: string
  label:  string
  delta:  number
  dias:   number
}

function rankingProgreso(hist: RegistroMedidas[], dias: number): ZonaProgreso[] {
  if (hist.length < 2) return []
  const actual  = hist[0]
  const antes   = registroEn(hist, isoHaceNDias(dias))
  if (!antes || antes.fecha === actual.fecha) return []

  return Object.entries(ZONAS)
    .map(([id, z]) => {
      const d = deltaZona(antes, actual, z.campos)
      return d != null ? { zonaId: id, label: z.label, delta: d, dias } : null
    })
    .filter((x): x is ZonaProgreso => x != null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

interface SimetriaItem {
  label:  string
  izq:    number
  der:    number
  diff:   number
  pct:    number
}

function calcularSimetria(actual: RegistroMedidas | null): SimetriaItem[] {
  if (!actual) return []
  const pares: { label: string; izq: CampoKey; der: CampoKey }[] = [
    { label: 'Bíceps',      izq: 'bicepsIzq',      der: 'bicepsDer'      },
    { label: 'Muslos',      izq: 'musloIzq',        der: 'musloDer'       },
    { label: 'Pantorrillas',izq: 'pantorrillaIzq',  der: 'pantorrillaDer' },
  ]
  return pares
    .map(({ label, izq, der }) => {
      const vi = actual[izq], vd = actual[der]
      if (vi == null || vd == null) return null
      const diff = +(vi - vd).toFixed(1)
      const pct  = +((Math.abs(diff) / ((vi + vd) / 2)) * 100).toFixed(1)
      return { label, izq: vi, der: vd, diff, pct }
    })
    .filter((x): x is SimetriaItem => x != null)
}

function generarInsights(hist: RegistroMedidas[]): string[] {
  if (hist.length < 2) return []
  const actual  = hist[0]
  const hace90  = registroEn(hist, isoHaceNDias(90))
  const hace180 = registroEn(hist, isoHaceNDias(180))
  const insights: string[] = []

  if (hace90) {
    const dPecho  = deltaZona(hace90, actual, ['pecho'])
    const dBiceps = deltaZona(hace90, actual, ['bicepsIzq', 'bicepsDer'])
    if (dPecho != null && dBiceps != null && Math.abs(dBiceps) > 0.1) {
      const ratio = dPecho / (dBiceps || 0.01)
      if (ratio > 1.5) insights.push(`Tu pecho crece ${ratio.toFixed(1)}× más rápido que tus bíceps en 90 días.`)
      else if (ratio < 0.5 && dBiceps > 0) insights.push(`Tus bíceps progresan más rápido que el pecho. El trabajo de tirón está funcionando.`)
    }

    const dCintura = deltaZona(hace90, actual, ['cinturaAlta', 'cinturaBaja'])
    const dMuscTot = (['hombro', 'pecho', 'biceps', 'muslos'] as const)
      .map((k) => deltaZona(hace90, actual, ZONAS[k].campos))
      .filter((d): d is number => d != null)
    if (dCintura != null && dMuscTot.length > 0) {
      const avgMusc = dMuscTot.reduce((s, v) => s + v, 0) / dMuscTot.length
      if (avgMusc > 0.5 && dCintura != null && dCintura <= 0)
        insights.push(`Has ganado ${avgMusc.toFixed(1)} cm de músculo (media) con ${Math.abs(dCintura).toFixed(1)} cm menos de cintura. Excelente recomposición.`)
    }
  }

  if (hace180) {
    // Mejor periodo: busca el tramo de 60 días con mayor suma de progreso muscular
    const periodos: { desde: string; hasta: string; ganancia: number }[] = []
    for (let i = 0; i < hist.length - 1; i++) {
      const h2 = hist[i]
      const h1 = registroEn(hist.slice(i + 1), isoHaceNDias(60))
      if (!h1) continue
      const d = deltaZona(h1, h2, ['pecho', 'hombro', 'musloIzq'])
      if (d != null) periodos.push({ desde: h1.fecha, hasta: h2.fecha, ganancia: d })
    }
    if (periodos.length > 0) {
      const mejor = periodos.reduce((m, p) => p.ganancia > m.ganancia ? p : m)
      if (mejor.ganancia > 0.5)
        insights.push(`Tu mejor periodo fue entre ${formatFechaES(mejor.desde)} y ${formatFechaES(mejor.hasta)} (+${mejor.ganancia.toFixed(1)} cm de media).`)
    }
  }

  // Consistencia
  const med90 = hist.filter((r) => r.fecha >= isoHaceNDias(90)).length
  if (med90 >= 4) insights.push(`Tienes ${med90} mediciones en los últimos 90 días. Buena consistencia de seguimiento.`)
  else if (med90 === 1) insights.push('Solo tienes 1 medición en 90 días. Mídete más a menudo para ver tendencias fiables.')

  return insights.slice(0, 4)
}

// ── Colores ───────────────────────────────────────────────────────────────────

function colorPorDelta(delta: number | undefined, esCintura: boolean): string {
  if (delta == null) return '#52525b'       // gris — sin datos
  const positivo = esCintura ? delta < 0 : delta > 0
  const negativo = esCintura ? delta > 0 : delta < 0
  if (Math.abs(delta) < 0.05) return '#eab308'  // amarillo — sin cambio
  if (positivo && Math.abs(delta) >= 0.5) return '#22c55e' // verde
  if (positivo) return '#86efac'             // verde claro
  if (negativo) return '#ef4444'             // rojo
  return '#eab308'
}

// ── SVG: Gauge de puntuación ──────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const r    = 42
  const circ = 2 * Math.PI * r
  const arc  = circ * 0.75
  const fill = arc * Math.min(1, Math.max(0, score / 100))
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'

  return (
    <svg viewBox="0 0 110 90" className="w-28">
      <circle cx="55" cy="58" r={r} fill="none" stroke="#27272a" strokeWidth="9"
        strokeDasharray={`${arc} ${circ}`} strokeDashoffset={0}
        transform="rotate(135 55 58)" strokeLinecap="round" />
      <circle cx="55" cy="58" r={r} fill="none" stroke={color} strokeWidth="9"
        strokeDasharray={`${fill} ${circ}`} strokeDashoffset={0}
        transform="rotate(135 55 58)" strokeLinecap="round" />
      <text x="55" y="55" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">{score}</text>
      <text x="55" y="70" textAnchor="middle" fill="#71717a" fontSize="9">/ 100</text>
    </svg>
  )
}

// ── SVG: Line Chart ───────────────────────────────────────────────────────────

function LineChart({
  datos,
  color = '#3b82f6',
  alto = 80,
}: {
  datos: { fecha: string; valor: number }[]
  color?: string
  alto?:  number
}) {
  if (datos.length < 2) return null
  const W = 280, H = alto, PAD = 12
  const ys   = datos.map((d) => d.valor)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rng  = maxY - minY || 1
  const toX  = (i: number) => PAD + (i / (datos.length - 1)) * (W - 2 * PAD)
  const toY  = (v: number) => H - PAD - ((v - minY) / rng) * (H - 2 * PAD)
  const pts  = datos.map((d, i) => `${toX(i)},${toY(d.valor)}`).join(' ')
  const areaBase = `${toX(0)},${H - PAD} ${pts} ${toX(datos.length - 1)},${H - PAD}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id={`lg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaBase} fill={`url(#lg-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {datos.map((d, i) => (
        <circle key={i} cx={toX(i)} cy={toY(d.valor)} r="3" fill={color} />
      ))}
    </svg>
  )
}

// ── SVG: Radar Chart ─────────────────────────────────────────────────────────

function RadarChart({ series }: {
  series: { label: string; valor: number; max: number }[]
}) {
  const N  = series.length
  const cx = 100, cy = 100, R = 80

  function pt(i: number, val: number, mx: number): string {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2
    const dist  = (Math.min(val, mx) / mx) * R
    return `${(cx + dist * Math.cos(angle)).toFixed(1)},${(cy + dist * Math.sin(angle)).toFixed(1)}`
  }

  const polygon = series.map((s, i) => pt(i, s.valor, s.max)).join(' ')

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
      {[0.25, 0.5, 0.75, 1.0].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="#3f3f46" strokeWidth="0.6" />
      ))}
      {series.map((_, i) => {
        const angle = (i / N) * 2 * Math.PI - Math.PI / 2
        return (
          <line key={i}
            x1={cx} y1={cy}
            x2={(cx + R * Math.cos(angle)).toFixed(1)}
            y2={(cy + R * Math.sin(angle)).toFixed(1)}
            stroke="#3f3f46" strokeWidth="0.6"
          />
        )
      })}
      <polygon points={polygon} fill="#3b82f630" stroke="#3b82f6" strokeWidth="1.5" />
      {series.map((s, i) => {
        const angle  = (i / N) * 2 * Math.PI - Math.PI / 2
        const lx     = cx + (R + 14) * Math.cos(angle)
        const ly     = cy + (R + 14) * Math.sin(angle)
        return (
          <text key={i} x={lx.toFixed(1)} y={ly.toFixed(1)}
            textAnchor="middle" dominantBaseline="middle"
            fill="#a1a1aa" fontSize="8">
            {s.label}
          </text>
        )
      })}
    </svg>
  )
}

// ── SVG: Body Map ─────────────────────────────────────────────────────────────

function BodyMapSVG({
  colores,
  seleccionada,
  onSelect,
}: {
  colores:     Record<string, string>
  seleccionada: string | null
  onSelect:    (id: string) => void
}) {
  return (
    <svg viewBox="0 0 100 280" className="w-28" aria-label="Mapa corporal">
      <defs>
        <linearGradient id="bfg2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#93c5fd" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {/* Silueta base */}
      <g fill="url(#bfg2)">
        <ellipse cx="50" cy="14" rx="11" ry="12.5" />
        <rect x="44" y="25" width="12" height="9" />
        <path d="M 20,34 L 80,34 C 82,58 82,88 78,112 C 76,128 74,146 78,162 L 22,162 C 26,146 24,128 22,112 C 18,88 18,58 20,34 Z" />
        <path d="M 20,36 L 10,42 C 6,60 4,88 4,118 L 4,130 L 14,130 C 15,108 17,86 18,62 Z" />
        <path d="M 80,36 L 90,42 C 94,60 96,88 96,118 L 96,130 L 86,130 C 85,108 83,86 82,62 Z" />
        <path d="M 22,162 C 20,178 17,200 16,228 L 15,258 L 15,272 L 38,272 L 40,258 L 43,228 C 45,200 44,178 44,162 Z" />
        <path d="M 78,162 C 80,178 83,200 84,228 L 85,258 L 85,272 L 62,272 L 60,258 L 57,228 C 55,200 56,178 56,162 Z" />
      </g>
      {/* Contornos */}
      <g stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.6">
        <ellipse cx="50" cy="14" rx="11" ry="12.5" />
        <path d="M 20,34 L 80,34" />
        <path d="M 20,34 C 18,58 18,88 22,112 C 24,128 26,146 22,162" />
        <path d="M 80,34 C 82,58 82,88 78,112 C 76,128 74,146 78,162" />
        <path d="M 20,36 L 10,42 C 6,60 4,88 4,118 L 4,130 L 14,130 C 15,108 17,86 18,62" />
        <path d="M 80,36 L 90,42 C 94,60 96,88 96,118 L 96,130 L 86,130 C 85,108 83,86 82,62" />
        <path d="M 22,162 C 20,178 17,200 16,228 L 15,258 L 15,272 L 38,272 L 40,258 L 43,228 C 45,200 44,178 44,162" />
        <path d="M 78,162 C 80,178 83,200 84,228 L 85,258 L 85,272 L 62,272 L 60,258 L 57,228 C 55,200 56,178 56,162" />
      </g>
      {/* Puntos de zona */}
      {Object.entries(ZONAS).map(([id, z]) => {
        const col = colores[id] ?? '#52525b'
        const sel = seleccionada === id
        return (
          <g key={id} onClick={() => onSelect(id)} style={{ cursor: 'pointer' }}>
            {sel && <circle cx={z.svgDot.cx} cy={z.svgDot.cy} r="7" fill={col} opacity="0.25" />}
            <circle cx={z.svgDot.cx} cy={z.svgDot.cy} r={sel ? 5 : 3.5} fill={col} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Tab: Resumen ──────────────────────────────────────────────────────────────

function TabResumen({ hist }: { hist: RegistroMedidas[] }) {
  const minData = hist.length < 2

  const score   = useMemo(() => calcularScore(hist), [hist])
  const estado  = useMemo(() => detectarEstado(hist), [hist])
  const progres = useMemo(() => rankingProgreso(hist, 90), [hist])
  const simetria= useMemo(() => calcularSimetria(hist[0] ?? null), [hist])
  const insights= useMemo(() => generarInsights(hist), [hist])

  if (minData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <AlertCircle size={36} className="text-zinc-600" />
        <p className="text-sm text-zinc-400">Necesitas al menos 2 mediciones para ver el análisis.</p>
        <p className="text-xs text-zinc-600">Registra tus mediciones en /medidas y vuelve aquí.</p>
      </div>
    )
  }

  const que_progresan = progres.filter((z) => !ZONAS[z.zonaId].esCintura && z.delta > 0.1).slice(0, 3)
  const rezagados     = progres.filter((z) => !ZONAS[z.zonaId].esCintura && z.delta <= 0.1).slice(0, 3)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 pb-10">

      {/* Puntuación Global */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Puntuación Corporal Global</p>
        <div className="flex items-center gap-4">
          <ScoreGauge score={score.score} />
          <div className="flex flex-col gap-2 flex-1">
            {score.deltaMes != null && (
              <div className={['text-sm font-bold', score.deltaMes >= 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                {score.deltaMes >= 0 ? '▲' : '▼'} {Math.abs(score.deltaMes)} pts vs mes pasado
              </div>
            )}
            <div className="flex flex-col gap-1">
              {[
                { label: 'Muscular',     val: score.muscular,     max: 100 },
                { label: 'Cintura',      val: score.cintura,      max: 100 },
                { label: 'Simetría',     val: score.simetria,     max: 100 },
                { label: 'Consistencia', val: score.consistencia, max: 100 },
              ].map(({ label, val }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-20">{label}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${val}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-400 w-6 text-right">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[9px] text-zinc-700 mt-2">
          Fórmula: Muscular×40% + Cintura×20% + Simetría×20% + Consistencia×20%
        </p>
      </div>

      {/* Estado actual */}
      {estado && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Estado actual</p>
          <p className={['text-base font-bold', estado.color].join(' ')}>{estado.etiqueta}</p>
          <p className="text-xs text-zinc-400 mt-1">{estado.descripcion}</p>
          <p className="text-[9px] text-zinc-700 mt-2 italic">Estimación orientativa basada en perímetros. No es diagnóstico médico.</p>
        </div>
      )}

      {/* Progresa / Rezagados */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-emerald-400" />
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Progresa</p>
          </div>
          {que_progresan.length === 0
            ? <p className="text-[10px] text-zinc-600">Sin datos suficientes</p>
            : que_progresan.map((z) => (
              <div key={z.zonaId} className="flex justify-between items-center py-0.5">
                <span className="text-xs text-zinc-300">{z.label}</span>
                <span className="text-xs font-bold text-emerald-400">{signo(z.delta)} cm</span>
              </div>
            ))
          }
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown size={13} className="text-amber-400" />
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Rezagados</p>
          </div>
          {rezagados.length === 0
            ? <p className="text-[10px] text-zinc-600">Sin datos suficientes</p>
            : rezagados.map((z) => (
              <div key={z.zonaId} className="flex justify-between items-center py-0.5">
                <span className="text-xs text-zinc-300">{z.label}</span>
                <span className={['text-xs font-bold', z.delta < 0 ? 'text-red-400' : 'text-zinc-400'].join(' ')}>
                  {signo(z.delta)} cm
                </span>
              </div>
            ))
          }
        </div>
      </div>

      {/* Simetría */}
      {simetria.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Simetría Izq / Der</p>
          <div className="flex flex-col gap-2">
            {simetria.map((s) => (
              <div key={s.label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-zinc-300">{s.label}</span>
                  <span className={['text-xs font-bold', s.pct > 5 ? 'text-amber-400' : 'text-emerald-400'].join(' ')}>
                    {s.pct <= 1 ? '✓ Simétrico' : `${s.pct}% asimetría`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>Izq: <span className="text-zinc-300 font-semibold">{s.izq} cm</span></span>
                  <span>•</span>
                  <span>Der: <span className="text-zinc-300 font-semibold">{s.der} cm</span></span>
                  {Math.abs(s.diff) > 0.2 && (
                    <span className="text-amber-500">({s.diff > 0 ? 'Izq' : 'Der'} mayor por {Math.abs(s.diff).toFixed(1)} cm)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Insights automáticos</p>
          <div className="flex flex-col gap-2">
            {insights.map((ins, i) => (
              <p key={i} className="text-xs text-zinc-300 leading-relaxed">
                <span className="text-blue-400 mr-1">→</span>{ins}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Cuerpo ───────────────────────────────────────────────────────────────

function TabCuerpo({ hist }: { hist: RegistroMedidas[] }) {
  const [sel, setSel] = useState<string | null>(null)
  const actual = hist[0] ?? null

  const colores = useMemo((): Record<string, string> => {
    if (!actual) return {}
    const out: Record<string, string> = {}
    for (const [id, z] of Object.entries(ZONAS)) {
      const d    = deltaZona(registroEn(hist, isoHaceNDias(90)), actual, z.campos)
      const best = Math.max(...hist.map((r) => avgCampos(r, z.campos) ?? 0))
      const curr = avgCampos(actual, z.campos) ?? 0
      if (curr >= best - 0.05 && hist.length > 1)
        out[id] = '#3b82f6' // azul: mejor marca
      else
        out[id] = colorPorDelta(d, z.esCintura)
    }
    return out
  }, [hist, actual])

  const detalle = sel ? ZONAS[sel] : null
  const detalleValores = useMemo(() => {
    if (!sel || !detalle) return null
    const curr = actual ? avgCampos(actual, detalle.campos) : undefined
    const d30  = deltaZona(registroEn(hist, isoHaceNDias(30)),  actual, detalle.campos)
    const d90  = deltaZona(registroEn(hist, isoHaceNDias(90)),  actual, detalle.campos)
    const d365 = deltaZona(registroEn(hist, isoHaceNDias(365)), actual, detalle.campos)
    const best = actual ? Math.max(...hist.map((r) => avgCampos(r, detalle.campos) ?? 0)) : 0
    return { curr, d30, d90, d365, best }
  }, [sel, detalle, hist, actual])

  return (
    <div className="flex flex-col gap-4 px-4 py-4 pb-10">
      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-[10px] text-zinc-500">
        {[
          { color: 'bg-blue-500',    label: 'Mejor marca' },
          { color: 'bg-green-500',   label: 'Progresando' },
          { color: 'bg-yellow-500',  label: 'Lento' },
          { color: 'bg-red-500',     label: 'Sin progreso' },
          { color: 'bg-zinc-500',    label: 'Sin datos' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
            {label}
          </div>
        ))}
      </div>

      {/* Mapa + detalle */}
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <BodyMapSVG colores={colores} seleccionada={sel} onSelect={(id) => setSel(sel === id ? null : id)} />
        </div>

        <div className="flex-1 flex flex-col gap-2">
          {!sel && (
            <p className="text-xs text-zinc-600 pt-4">Toca un punto para ver el detalle de esa zona.</p>
          )}
          {sel && detalle && detalleValores && (
            <div className="bg-zinc-800 rounded-2xl p-3 flex flex-col gap-2">
              <p className="text-sm font-bold text-white">{detalle.label}</p>
              {detalleValores.curr != null
                ? <p className="text-xl font-bold text-blue-400">{detalleValores.curr.toFixed(1)} <span className="text-xs text-zinc-500">cm</span></p>
                : <p className="text-xs text-zinc-600">Sin medida actual</p>
              }
              <div className="flex flex-col gap-1">
                {([['30 días', detalleValores.d30], ['90 días', detalleValores.d90], ['1 año', detalleValores.d365]] as [string, number | undefined][]).map(([lbl, d]) => (
                  d != null ? (
                    <div key={lbl} className="flex justify-between">
                      <span className="text-[10px] text-zinc-500">{lbl}</span>
                      <span className={['text-[10px] font-bold', d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-zinc-400'].join(' ')}>
                        {signo(d)} cm
                      </span>
                    </div>
                  ) : null
                ))}
                {detalleValores.best > 0 && (
                  <div className="flex justify-between border-t border-zinc-700 pt-1 mt-1">
                    <span className="text-[10px] text-zinc-500">Mejor marca</span>
                    <span className="text-[10px] font-bold text-blue-400">{detalleValores.best.toFixed(1)} cm</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Zonas lista */}
          <div className="flex flex-col gap-1 mt-1">
            {Object.entries(ZONAS).map(([id, z]) => {
              const curr = actual ? avgCampos(actual, z.campos) : undefined
              const col  = colores[id] ?? '#52525b'
              return (
                <button key={id} onClick={() => setSel(sel === id ? null : id)}
                  className={['flex items-center justify-between rounded-xl px-2 py-1.5 text-left', sel === id ? 'bg-zinc-700' : 'active:bg-zinc-800'].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col }} />
                    <span className="text-xs text-zinc-300">{z.label}</span>
                  </div>
                  <span className="text-xs font-bold text-zinc-400">
                    {curr != null ? `${curr.toFixed(1)} cm` : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Analizar ─────────────────────────────────────────────────────────────

type Periodo = '30' | '90' | '365' | 'max'

function TabAnalizar({ hist }: { hist: RegistroMedidas[] }) {
  const [periodoComp, setPeriodoComp] = useState<Periodo>('90')
  const [campoGraf, setCampoGraf]     = useState<string>('pecho')

  const actual = hist[0] ?? null

  // Comparador temporal
  const diasComp = periodoComp === 'max' ? 99999 : parseInt(periodoComp)
  const antes = useMemo(
    () => periodoComp === 'max' ? (hist[hist.length - 1] ?? null) : registroEn(hist, isoHaceNDias(diasComp)),
    [hist, diasComp, periodoComp],
  )

  // Datos para gráfica
  const datosGraf = useMemo(() => {
    const z = ZONAS[campoGraf]
    if (!z) return []
    return hist
      .slice()
      .reverse()
      .map((r) => {
        const v = avgCampos(r, z.campos)
        return v != null ? { fecha: r.fecha, valor: v } : null
      })
      .filter((x): x is { fecha: string; valor: number } => x != null)
  }, [hist, campoGraf])

  // Predicción lineal (orientativa)
  const prediccion = useMemo(() => {
    const z = ZONAS[campoGraf]
    if (!z || datosGraf.length < 3) return null
    const base = new Date(datosGraf[0].fecha).getTime()
    const pts   = datosGraf.map((d) => ({
      x: (new Date(d.fecha).getTime() - base) / 86400000,
      y: d.valor,
    }))
    const slope = regresionLineal(pts)
    const currY = datosGraf[datosGraf.length - 1].valor
    return {
      d30:  +(currY + slope * 30).toFixed(1),
      d90:  +(currY + slope * 90).toFixed(1),
      d180: +(currY + slope * 180).toFixed(1),
      tendencia: slope,
    }
  }, [datosGraf, campoGraf])

  // Datos radar
  const radarSeries = useMemo(() => {
    return Object.entries(ZONAS)
      .filter(([, z]) => z.pesoMuscular > 0)
      .map(([, z]) => {
        const curr = actual ? (avgCampos(actual, z.campos) ?? 0) : 0
        const mx   = Math.max(...hist.map((r) => avgCampos(r, z.campos) ?? 0), 1)
        return { label: z.label, valor: curr, max: mx }
      })
  }, [hist, actual])

  if (hist.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <AlertCircle size={36} className="text-zinc-600" />
        <p className="text-sm text-zinc-400">Necesitas al menos 2 mediciones para el análisis comparativo.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 pb-10">

      {/* Comparador temporal */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Comparador temporal</p>
        <div className="flex gap-2 mb-4">
          {(['30', '90', '365', 'max'] as Periodo[]).map((p) => (
            <button key={p} onClick={() => setPeriodoComp(p)}
              className={['px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
                periodoComp === p ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'].join(' ')}>
              {p === 'max' ? 'Máx' : `${p}d`}
            </button>
          ))}
        </div>
        {!antes || antes.fecha === actual?.fecha ? (
          <p className="text-xs text-zinc-600">No hay medición anterior para este periodo.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1 px-1">
              <span>{formatFechaES(antes.fecha)}</span>
              <span>Cambio</span>
              <span>{actual ? formatFechaES(actual.fecha) : '—'}</span>
            </div>
            {Object.entries(ZONAS).map(([id, z]) => {
              if (!actual) return null
              const va   = avgCampos(antes, z.campos)
              const vb   = avgCampos(actual, z.campos)
              if (va == null && vb == null) return null
              const diff = va != null && vb != null ? +(vb - va).toFixed(1) : null
              const bienSiSube = !z.esCintura
              const color = diff == null ? 'text-zinc-600'
                : diff === 0 ? 'text-zinc-400'
                : (bienSiSube ? diff > 0 : diff < 0) ? 'text-emerald-400' : 'text-red-400'
              return (
                <div key={id} className="flex items-center gap-2 py-0.5">
                  <span className="text-xs text-zinc-400 w-20">{z.label}</span>
                  <span className="text-xs text-zinc-500 flex-1 text-right">{va?.toFixed(1) ?? '—'}</span>
                  <span className={['text-xs font-bold w-16 text-center', color].join(' ')}>
                    {diff != null ? (diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${diff}`) : '—'}
                  </span>
                  <span className="text-xs text-zinc-300 flex-1">{vb?.toFixed(1) ?? '—'}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Gráfica de evolución */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Evolución</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(ZONAS).map(([id, z]) => (
            <button key={id} onClick={() => setCampoGraf(id)}
              className={['px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                campoGraf === id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'].join(' ')}>
              {z.label}
            </button>
          ))}
        </div>
        {datosGraf.length >= 2
          ? (
            <>
              <LineChart datos={datosGraf} color="#3b82f6" alto={90} />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1 px-1">
                <span>{formatFechaES(datosGraf[0].fecha)}</span>
                <span>{ZONAS[campoGraf]?.label}</span>
                <span>{formatFechaES(datosGraf[datosGraf.length - 1].fecha)}</span>
              </div>
            </>
          )
          : <p className="text-xs text-zinc-600 text-center py-4">Necesitas más mediciones para esta zona.</p>
        }
      </div>

      {/* Predicción */}
      {prediccion && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Proyección orientativa — {ZONAS[campoGraf]?.label}
          </p>
          <p className="text-[9px] text-zinc-700 mb-3 italic">
            Extrapolación lineal de la tendencia actual. El cuerpo no crece linealmente — es solo orientativo.
          </p>
          <div className="flex flex-col gap-2">
            {([['30 días', prediccion.d30], ['90 días', prediccion.d90], ['180 días', prediccion.d180]] as [string, number][]).map(([lbl, val]) => {
              const curr = datosGraf[datosGraf.length - 1]?.valor ?? 0
              const diff = +(val - curr).toFixed(1)
              return (
                <div key={lbl} className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">{lbl}</span>
                  <div className="flex items-center gap-2">
                    <span className={['text-xs font-semibold', diff >= 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                      {signo(diff)} cm
                    </span>
                    <span className="text-xs text-zinc-300">≈ {val} cm</span>
                  </div>
                </div>
              )
            })}
            <div className="flex items-center gap-1 mt-1">
              {prediccion.tendencia > 0.01
                ? <TrendingUp size={12} className="text-emerald-400" />
                : prediccion.tendencia < -0.01
                ? <TrendingDown size={12} className="text-red-400" />
                : <Minus size={12} className="text-zinc-500" />
              }
              <span className="text-[10px] text-zinc-600">
                Tendencia: {prediccion.tendencia > 0 ? '+' : ''}{(prediccion.tendencia * 30).toFixed(2)} cm/mes
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Radar */}
      {radarSeries.length >= 3 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Radar muscular</p>
          <p className="text-[9px] text-zinc-700 mb-2">Cada zona muestra el valor actual como % de su mejor marca histórica.</p>
          <RadarChart series={radarSeries} />
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: 'resumen',  label: 'Resumen'  },
  { id: 'cuerpo',   label: 'Cuerpo'   },
  { id: 'analizar', label: 'Analizar' },
]

export default function ProgresoCorporalPage() {
  const navigate       = useNavigate()
  const historialMedidas = useFitLogStore(useShallow((s) => s.historialMedidas))

  const [tab, setTab] = useState<TabId>('resumen')

  useEffect(() => {
    const u = getUsuarioActivo()
    if (u && !u.puedePesoCorporal) navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="flex flex-col min-h-[calc(100svh-4rem)] bg-black text-white">

      {/* Cabecera */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
        <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-zinc-400 active:text-white">
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-white leading-tight">Centro de Progreso Corporal</h1>
          <p className="text-[10px] text-zinc-600">{historialMedidas.length} medición{historialMedidas.length !== 1 ? 'es' : ''} registradas</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800/60">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'flex-1 py-3 text-xs font-semibold transition-colors',
              tab === id
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-500 active:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'resumen'  && <TabResumen  hist={historialMedidas} />}
        {tab === 'cuerpo'   && <TabCuerpo   hist={historialMedidas} />}
        {tab === 'analizar' && <TabAnalizar hist={historialMedidas} />}
      </div>

    </div>
  )
}
