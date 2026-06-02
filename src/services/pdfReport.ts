import jsPDF from 'jspdf'
import type { Sesion, Ejercicio } from '../types/models'

// ─────────────────────────────────────────────────────────────────────────────
// Paleta de colores
// ─────────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number]

const C = {
  black:      [0,   0,   0  ] as RGB,
  bg1:        [10,  10,  10 ] as RGB,   // #0a0a0a
  bg2:        [17,  17,  17 ] as RGB,   // #111111
  bg3:        [13,  13,  13 ] as RGB,   // #0d0d0d
  grid:       [24,  24,  24 ] as RGB,   // gridlines
  border:     [48,  48,  48 ] as RGB,
  gray1:      [60,  60,  60 ] as RGB,
  gray2:      [110, 110, 110] as RGB,
  gray3:      [170, 170, 170] as RGB,
  white:      [255, 255, 255] as RGB,
  red:        [139, 0,   0  ] as RGB,   // #8B0000
  redBright:  [204, 34,  0  ] as RGB,   // #CC2200
  redFill:    [30,  4,   4  ] as RGB,   // area bajo curva
  redPill:    [55,  5,   5  ] as RGB,
  green:      [0,   168, 72 ] as RGB,
  greenPill:  [5,   40,  18 ] as RGB,
  negRed:     [210, 35,  20 ] as RGB,
  negRedPill: [45,  5,   5  ] as RGB,
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout A4
// ─────────────────────────────────────────────────────────────────────────────

const PW = 210
const ML = 14
const MR = 14
const CW = PW - ML - MR  // 182 mm

const MESES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de color / estilo
// ─────────────────────────────────────────────────────────────────────────────

const F  = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2])
const S  = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
const TC = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2])

// ─────────────────────────────────────────────────────────────────────────────
// Efectos gráficos
// ─────────────────────────────────────────────────────────────────────────────

/** Línea horizontal con gradiente: negro → rojo granate → negro */
function gradientLine(doc: jsPDF, x: number, y: number, w: number): void {
  const N    = 70
  const step = w / N
  doc.setLineWidth(0.35)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const intensity = Math.sin(t * Math.PI)
    const r   = Math.round(C.red[0] * intensity)
    const dark = Math.round(28 * (1 - intensity))
    doc.setDrawColor(Math.max(r, dark), dark, dark)
    doc.line(x + i * step, y, x + (i + 1) * step, y)
  }
}

/** Glow radial en la portada: elipses concéntricas del centro hacia fuera */
function drawGlow(doc: jsPDF, cx: number, cy: number): void {
  const rings: Array<[number, number, RGB]> = [
    [100, 72, [7,  0, 0]],
    [82,  60, [12, 0, 0]],
    [65,  48, [20, 0, 0]],
    [50,  37, [36, 0, 0]],
    [36,  27, [58, 0, 0]],
    [24,  18, [88, 4, 0]],
    [14,  11, [118,8, 0]],
    [7,   5,  [139,0, 0]],
  ]
  for (const [rx, ry, color] of rings) {
    F(doc, color)
    doc.ellipse(cx, cy, rx, ry, 'F')
  }
}

/**
 * Barra con gradiente vertical: oscuro en la base → rojo granate en la cima.
 * Simulado con N franjas horizontales.
 */
function drawGradientBar(doc: jsPDF, bx: number, barTop: number, bw: number, bh: number): void {
  const N = 14
  const sh = bh / N
  for (let i = 0; i < N; i++) {
    const t  = i / (N - 1)           // 0 = bottom, 1 = top
    const r  = Math.round(15 + 124 * t)
    const gy = barTop + (N - 1 - i) * sh
    doc.setFillColor(r, 0, 0)
    doc.rect(bx, gy, bw, sh + 0.15, 'F')
  }
  // Línea brillante en la cima
  doc.setDrawColor(C.redBright[0], C.redBright[1], C.redBright[2])
  doc.setLineWidth(0.45)
  doc.line(bx, barTop, bx + bw, barTop)
}

/**
 * Relleno del área bajo la curva del gráfico de líneas.
 * Path: siguiendo los puntos, bajando al baseline y volviendo al origen.
 */
function drawChartFill(doc: jsPDF, pts: [number, number][], baseY: number): void {
  if (pts.length < 2) return
  const [sx, sy] = pts[0]
  const segs: [number, number][] = []
  for (let i = 1; i < pts.length; i++) {
    segs.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]])
  }
  // Bajar al baseline
  segs.push([0, baseY - pts[pts.length - 1][1]])
  // Volver al punto de inicio en horizontal (closed=true cierra de forma vertical)
  segs.push([sx - pts[pts.length - 1][0], 0])
  F(doc, C.redFill)
  doc.lines(segs, sx, sy, [1, 1], 'F', true)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de datos
// ─────────────────────────────────────────────────────────────────────────────

function sesionesDelMes(sesiones: Sesion[], mes: number, anio: number): Sesion[] {
  const prefix = `${anio}-${String(mes).padStart(2, '0')}`
  return sesiones
    .filter((s) => s.fecha.startsWith(prefix))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

function pesoMaxEj(sesion: Sesion, nombre: string): number | null {
  const ej = sesion.ejercicios.find(
    (e) => e.nombreSnapshot === nombre && e.completado && !e.saltado,
  )
  if (!ej) return null
  const vals = ej.series
    .filter((s) => typeof s.pesoKg === 'number' && (s.pesoKg as number) > 0)
    .map((s) => s.pesoKg as number)
  return vals.length > 0 ? Math.max(...vals) : null
}

function dd_mm(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${dd}/${mm}`
}

function buildStats(sesMes: Sesion[]): Array<{ label: string; valor: string }> {
  let series = 0, kg = 0
  const ejs: Record<string, number> = {}
  sesMes.forEach((s) => {
    s.ejercicios.forEach((ej) => {
      if (!ej.completado || ej.saltado) return
      ejs[ej.nombreSnapshot] = (ejs[ej.nombreSnapshot] ?? 0) + 1
      ej.series.forEach((sr) => {
        if (typeof sr.pesoKg === 'number' && typeof sr.reps === 'number' && sr.pesoKg > 0 && sr.reps > 0) {
          series++
          kg += (sr.pesoKg as number) * (sr.reps as number)
        }
      })
    })
  })
  const kgStr = kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${Math.round(kg)}kg`
  return [
    { label: 'SESIONES',              valor: String(sesMes.length)           },
    { label: 'EJERCICIOS DISTINTOS',  valor: String(Object.keys(ejs).length) },
    { label: 'SERIES TOTALES',        valor: String(series)                  },
    { label: 'KG LEVANTADOS',         valor: kgStr                           },
  ]
}

function weekCounts(sesMes: Sesion[]): number[] {
  const counts = [0, 0, 0, 0, 0]
  sesMes.forEach((s) => {
    const day = parseInt(s.fecha.split('-')[2], 10)
    const w   = Math.min(Math.floor((day - 1) / 7), 4)
    counts[w]++
  })
  let last = 4
  while (last > 3 && counts[last] === 0) last--
  return counts.slice(0, last + 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Portada (Página 1)
// ─────────────────────────────────────────────────────────────────────────────

function drawCover(
  doc: jsPDF,
  nombre: string,
  mes: number,
  anio: number,
  sesMes: Sesion[],
): void {
  // Fondo negro total
  F(doc, C.black)
  doc.rect(0, 0, PW, 297, 'F')

  // Glow centrado en la mitad superior
  drawGlow(doc, PW / 2, 83)

  // ── Encabezado ──
  TC(doc, C.gray2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('INFORME DE ENTRENAMIENTO', PW / 2, 22, { align: 'center', charSpace: 2.5 })

  gradientLine(doc, ML, 27, CW)

  // Nombre usuario
  TC(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.text(nombre.toUpperCase(), PW / 2, 52, { align: 'center' })

  // Mes + Año
  TC(doc, C.gray3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.text(
    `${MESES_ES[mes - 1].toUpperCase()}  ${anio}`,
    PW / 2, 64, { align: 'center', charSpace: 1 },
  )

  gradientLine(doc, ML, 72, CW)

  // ── Tarjetas de estadísticas ──
  const stats  = buildStats(sesMes)
  const cardW  = (CW - 6) / 2
  const cardH  = 29

  stats.forEach((st, i) => {
    const cx = ML + (i % 2) * (cardW + 6)
    const cy = 78 + Math.floor(i / 2) * (cardH + 5)
    F(doc, C.bg2)
    doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'F')
    S(doc, C.border)
    doc.setLineWidth(0.25)
    doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'S')
    // Número
    TC(doc, C.white)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(21)
    doc.text(st.valor, cx + cardW / 2, cy + 16, { align: 'center' })
    // Etiqueta
    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text(st.label, cx + cardW / 2, cy + 23.5, { align: 'center', charSpace: 0.8 })
  })

  // ── Gráfica de actividad semanal ──
  const chartY = 78 + 2 * (cardH + 5) + 6

  TC(doc, C.gray2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text('ACTIVIDAD SEMANAL', ML, chartY, { charSpace: 1.5 })

  drawWeeklyChart(doc, sesMes, ML, chartY + 5, CW, 58)

  // ── Línea de cierre en la parte inferior ──
  const footY = chartY + 5 + 58 + 12
  gradientLine(doc, ML, footY, CW)
}

function drawWeeklyChart(
  doc: jsPDF,
  sesMes: Sesion[],
  x: number, y: number, w: number, h: number,
): void {
  const weeks  = weekCounts(sesMes)
  const maxSes = Math.max(...weeks, 1)

  F(doc, C.bg2)
  doc.roundedRect(x, y, w, h, 2, 2, 'F')
  S(doc, C.border)
  doc.setLineWidth(0.2)
  doc.roundedRect(x, y, w, h, 2, 2, 'S')

  // Gridlines horizontales
  S(doc, C.grid)
  doc.setLineWidth(0.15)
  const nGrid = 3
  for (let g = 1; g <= nGrid; g++) {
    const gy = y + h - (h / (nGrid + 1)) * g
    doc.line(x + 6, gy, x + w - 6, gy)
  }

  const areaX = x + 6
  const areaW = w - 12
  const areaH = h - 16
  const areaY = y + 5

  const barTW = areaW / weeks.length
  const barW  = Math.min(barTW * 0.58, 18)
  const labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5']

  weeks.forEach((count, i) => {
    const bx    = areaX + i * barTW + (barTW - barW) / 2
    const barH  = count > 0 ? (count / maxSes) * areaH : 0
    const barTop = areaY + areaH - barH

    if (barH > 0) {
      drawGradientBar(doc, bx, barTop, barW, barH)
      TC(doc, C.white)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(String(count), bx + barW / 2, barTop - 1.8, { align: 'center' })
    }

    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(labels[i], bx + barW / 2, y + h - 2.5, { align: 'center' })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Páginas de ejercicios
// ─────────────────────────────────────────────────────────────────────────────

function drawExercisePage(
  doc: jsPDF,
  ejercicios: string[],
  sesMes: Sesion[],
  sesMesAnt: Sesion[],
  headerTitle: string,
  pageNum: number,
): void {
  F(doc, C.bg3)
  doc.rect(0, 0, PW, 297, 'F')

  // Franja negra de cabecera
  F(doc, C.black)
  doc.rect(0, 0, PW, 14, 'F')
  TC(doc, C.gray2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(headerTitle, ML, 9)
  doc.text(String(pageNum), PW - MR, 9, { align: 'right' })

  // Línea roja bajo cabecera
  S(doc, C.red)
  doc.setLineWidth(0.35)
  doc.line(0, 14, PW, 14)

  const BLOCK_H   = 123
  const BLOCK_GAP = 9
  const START_Y   = 18

  ejercicios.forEach((nombre, idx) => {
    const blockY = START_Y + idx * (BLOCK_H + BLOCK_GAP)
    drawExerciseBlock(doc, nombre, blockY, BLOCK_H, sesMes, sesMesAnt)
  })
}

function drawExerciseBlock(
  doc: jsPDF,
  nombre: string,
  y: number,
  h: number,
  sesMes: Sesion[],
  sesMesAnt: Sesion[],
): void {
  // Fondo del bloque
  F(doc, C.bg1)
  doc.roundedRect(ML, y, CW, h, 3, 3, 'F')
  S(doc, C.border)
  doc.setLineWidth(0.2)
  doc.roundedRect(ML, y, CW, h, 3, 3, 'S')

  // Nombre
  TC(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.text(nombre.toUpperCase(), ML + 5, y + 10)

  // Línea roja bajo el nombre
  const nameW = Math.min(doc.getTextWidth(nombre.toUpperCase()), CW - 10)
  S(doc, C.red)
  doc.setLineWidth(0.55)
  doc.line(ML + 5, y + 12.8, ML + 5 + nameW, y + 12.8)

  // Datos de este mes
  const puntos = sesMes.flatMap((s) => {
    const pm = pesoMaxEj(s, nombre)
    return pm !== null ? [{ valor: pm, etiqueta: dd_mm(s.fecha) }] : []
  })

  // Gráfica de línea
  const CHART_Y = y + 16
  const CHART_H = 75
  drawLineChart(doc, puntos, ML + 5, CHART_Y, CW - 10, CHART_H)

  // Pills de estadísticas
  const STATS_Y = CHART_Y + CHART_H + 4
  const mejorPeso = puntos.length > 0 ? Math.max(...puntos.map((p) => p.valor)) : null
  const pesosAnt  = sesMesAnt.flatMap((s) => {
    const pm = pesoMaxEj(s, nombre)
    return pm !== null ? [pm] : []
  })
  const maxAnt = pesosAnt.length > 0 ? Math.max(...pesosAnt) : null

  // Pill "Mejor"
  if (mejorPeso !== null) {
    F(doc, C.redPill)
    doc.roundedRect(ML + 5, STATS_Y, 74, 12, 2, 2, 'F')
    S(doc, C.red)
    doc.setLineWidth(0.2)
    doc.roundedRect(ML + 5, STATS_Y, 74, 12, 2, 2, 'S')
    TC(doc, C.white)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`MEJOR   ${mejorPeso} kg`, ML + 9, STATS_Y + 8)
  }

  // Pill comparativa
  if (maxAnt !== null && mejorPeso !== null) {
    const diff  = mejorPeso - maxAnt
    const pct   = ((diff / maxAnt) * 100).toFixed(1)
    const isPos = diff >= 0
    const sign  = diff >= 0 ? '+' : ''
    const arrow = diff >= 0 ? '+ ' : '- '
    F(doc, isPos ? C.greenPill : C.negRedPill)
    doc.roundedRect(ML + 84, STATS_Y, 93, 12, 2, 2, 'F')
    TC(doc, isPos ? C.green : C.negRed)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(
      `${arrow}${Math.abs(diff).toFixed(1)} kg  (${sign}${pct}%)  vs mes ant.`,
      ML + 88, STATS_Y + 8,
    )
  } else if (maxAnt === null && mejorPeso !== null) {
    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('Primera vez registrado', ML + 84, STATS_Y + 8)
  }
}

function drawLineChart(
  doc: jsPDF,
  puntos: Array<{ valor: number; etiqueta: string }>,
  x: number, y: number, w: number, h: number,
): void {
  // Fondo negro de la gráfica
  F(doc, C.black)
  doc.roundedRect(x, y, w, h, 2, 2, 'F')

  if (puntos.length === 0) {
    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Sin datos este mes', x + w / 2, y + h / 2 + 2, { align: 'center' })
    return
  }

  const valores = puntos.map((p) => p.valor)
  const minVal  = Math.min(...valores)
  const maxVal  = Math.max(...valores)
  const range   = (maxVal - minVal) || 1

  const PAD_L = 26, PAD_R = 8, PAD_T = 10, PAD_B = 14
  const cx = x + PAD_L
  const cy = y + PAD_T
  const cw = w - PAD_L - PAD_R
  const ch = h - PAD_T - PAD_B

  // Gridlines horizontales
  S(doc, C.grid)
  doc.setLineWidth(0.15)
  const nGrid = 4
  for (let g = 0; g <= nGrid; g++) {
    const gy  = cy + (ch / nGrid) * g
    const val = maxVal - (range / nGrid) * g
    doc.line(cx, gy, cx + cw, gy)
    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.text(
      val % 1 === 0 ? String(val) : val.toFixed(1),
      cx - 2, gy + 1.5, { align: 'right' },
    )
  }

  // Funciones de coordenadas
  const ptX = (i: number) =>
    cx + (puntos.length > 1 ? (cw / (puntos.length - 1)) * i : cw / 2)
  const ptY = (v: number) =>
    cy + ch - ((v - minVal) / range) * ch

  const pts: [number, number][] = puntos.map((_, i) => [ptX(i), ptY(puntos[i].valor)])
  const baseY = cy + ch

  // Relleno bajo la curva
  drawChartFill(doc, pts, baseY)

  // Línea principal en rojo granate brillante
  S(doc, C.redBright)
  doc.setLineWidth(1.1)
  for (let i = 1; i < pts.length; i++) {
    doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
  }

  // Puntos: blanco con borde rojo
  pts.forEach(([px, py], i) => {
    const val  = puntos[i].valor
    const isKey = i === 0 || i === pts.length - 1 || val === maxVal

    // Halo rojo tenue
    F(doc, C.red)
    doc.circle(px, py, 2.8, 'F')
    // Dot blanco
    F(doc, C.white)
    doc.circle(px, py, 1.6, 'F')
    // Borde rojo
    S(doc, C.red)
    doc.setLineWidth(0.35)
    doc.circle(px, py, 1.6, 'S')

    // Valor encima (solo puntos clave)
    if (isKey) {
      TC(doc, C.white)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.text(`${val}`, px, py - 4, { align: 'center' })
    }

    // Etiqueta de fecha abajo
    TC(doc, C.gray2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.text(puntos[i].etiqueta, px, y + h - 2, { align: 'center' })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Nombre de archivo
// ─────────────────────────────────────────────────────────────────────────────

function buildFilename(nombre: string, mes: number, anio: number): string {
  const safe = nombre.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ-]/g, '')
  return `Entreno_${safe}_${String(mes).padStart(2, '0')}${anio}.pdf`
}

// ─────────────────────────────────────────────────────────────────────────────
// Exportación principal
// ─────────────────────────────────────────────────────────────────────────────

export async function generarInformePDF(
  nombreUsuario: string,
  mes: number,
  anio: number,
  sesiones: Sesion[],
  _ejercicios: Ejercicio[],
): Promise<void> {
  const doc       = new jsPDF({ unit: 'mm', format: 'a4' })
  const sesMes    = sesionesDelMes(sesiones, mes, anio)
  const mesAnt    = mes === 1 ? 12 : mes - 1
  const anioAnt   = mes === 1 ? anio - 1 : anio
  const sesMesAnt = sesionesDelMes(sesiones, mesAnt, anioAnt)

  // Página 1: portada
  drawCover(doc, nombreUsuario, mes, anio, sesMes)

  // Ejercicios entrenados este mes
  const ejCount: Record<string, number> = {}
  sesMes.forEach((s) =>
    s.ejercicios.forEach((ej) => {
      if (ej.completado && !ej.saltado)
        ejCount[ej.nombreSnapshot] = (ejCount[ej.nombreSnapshot] ?? 0) + 1
    }),
  )
  const nombresMes = Object.keys(ejCount).sort()
  const titulo     = `${nombreUsuario.toUpperCase()}  —  ${MESES_ES[mes - 1].toUpperCase()} ${anio}`

  const PER_PAGE = 2
  let pageNum    = 1

  for (let i = 0; i < nombresMes.length; i += PER_PAGE) {
    doc.addPage()
    pageNum++
    const chunk = nombresMes.slice(i, i + PER_PAGE)
    drawExercisePage(doc, chunk, sesMes, sesMesAnt, titulo, pageNum)
  }

  doc.save(buildFilename(nombreUsuario, mes, anio))
}
