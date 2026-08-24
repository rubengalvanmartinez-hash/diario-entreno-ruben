/**
 * Volumen semanal por grupo muscular.
 *  - Filas por grupo: series de la semana actual sobre la banda objetivo 10–20.
 *  - Gráfico de 8 semanas: apilado por grupo, o solo el grupo elegido.
 * Colores de grupo validados para el fondo oscuro; la identidad va siempre con
 * icono + nombre (las filas son la leyenda). Los textos usan tokens de texto.
 */
import { useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { useHistorialRef } from '../hooks/useHistorialRef'
import { calcularVolumenSemanal, OBJETIVO_SERIES_MIN, OBJETIVO_SERIES_MAX, type SemanaVolumen } from '../utils/volumenSemanal'
import { GRUPOS_VISTA, type GrupoId } from '../utils/gruposMusculares'
import { ICONO_GRUPO, COLOR_GRUPO } from './gruposUI'

const NUM_SEMANAS = 8

export default function VolumenSemanalCard() {
  const historial = useHistorialRef()
  const [grupoSel, setGrupoSel]   = useState<GrupoId | null>(null)
  const [semanaSel, setSemanaSel] = useState<number | null>(null)

  const semanas = useMemo(() => calcularVolumenSemanal(historial, NUM_SEMANAS), [historial])
  const actual  = semanas[semanas.length - 1]

  // Grupos con actividad en la ventana (orden de vista fijo)
  const grupos = useMemo(
    () => GRUPOS_VISTA.filter((g) => semanas.some((s) => (s.porGrupo[g.id]?.series ?? 0) > 0)),
    [semanas],
  )

  if (grupos.length === 0) return null

  const maxSemana = Math.max(...semanas.map((s) => s.totalSeries), 1)
  const semanaInfo = semanaSel !== null ? semanas[semanaSel] : null

  return (
    <div className="mx-4 mt-5 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Cabecera */}
      <div className="px-4 pt-4 pb-1 flex items-center gap-3">
        <div className="size-9 rounded-xl bg-blue-900/30 flex items-center justify-center shrink-0">
          <Layers size={16} className="text-blue-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Volumen semanal</p>
          <p className="text-[11px] text-zinc-500">
            Series por grupo · esta semana ({actual.label}) · banda objetivo {OBJETIVO_SERIES_MIN}–{OBJETIVO_SERIES_MAX}
          </p>
        </div>
        <span className="ml-auto text-right shrink-0">
          <span className="block text-xl font-black text-white tabular-nums leading-none">{actual.totalSeries}</span>
          <span className="block text-[10px] text-zinc-500">series</span>
        </span>
      </div>

      {/* Filas por grupo (leyenda + semana actual) */}
      <div className="px-4 pt-2 flex flex-col">
        {grupos.map((g) => {
          const series = actual.porGrupo[g.id]?.series ?? 0
          const activo = grupoSel === g.id
          const escala = Math.max(OBJETIVO_SERIES_MAX + 4, ...grupos.map((x) => actual.porGrupo[x.id]?.series ?? 0))
          const pct    = (n: number) => `${(n / escala) * 100}%`
          return (
            <button
              key={g.id}
              onClick={() => { setGrupoSel(activo ? null : g.id); setSemanaSel(null) }}
              aria-pressed={activo}
              className={[
                'group flex items-center gap-2.5 rounded-xl px-2 py-1.5 -mx-2 text-left transition-colors',
                activo ? 'bg-zinc-800/80' : 'active:bg-zinc-800/50',
              ].join(' ')}
            >
              <span className="size-6 shrink-0" style={{ color: COLOR_GRUPO[g.id] }}>{ICONO_GRUPO[g.id]}</span>
              <span className={['w-16 shrink-0 text-xs font-semibold', activo ? 'text-white' : 'text-zinc-300'].join(' ')}>
                {g.nombre}
              </span>

              {/* Barra: pista + banda objetivo + dato */}
              <span className="relative flex-1 h-4 min-w-0" aria-hidden>
                <span className="absolute inset-y-1 left-0 right-0 rounded-full bg-zinc-800" />
                <span
                  className="absolute inset-y-1 rounded-sm bg-white/[0.07]"
                  style={{ left: pct(OBJETIVO_SERIES_MIN), width: pct(OBJETIVO_SERIES_MAX - OBJETIVO_SERIES_MIN) }}
                />
                {series > 0 && (
                  <span
                    className="absolute inset-y-1 left-0 rounded-r-[4px]"
                    style={{ width: pct(series), background: COLOR_GRUPO[g.id] }}
                  />
                )}
                {/* Ticks de la banda */}
                <span className="absolute inset-y-0.5 w-px bg-zinc-600" style={{ left: pct(OBJETIVO_SERIES_MIN) }} />
                <span className="absolute inset-y-0.5 w-px bg-zinc-600" style={{ left: pct(OBJETIVO_SERIES_MAX) }} />
              </span>

              <span className="w-9 shrink-0 text-right">
                <span className="text-sm font-bold text-white tabular-nums">{series}</span>
              </span>
            </button>
          )
        })}
        <p className="text-[10px] text-zinc-600 pl-[8.9rem] -mt-0.5 flex justify-between pr-11" aria-hidden>
          <span>{OBJETIVO_SERIES_MIN}</span>
          <span>{OBJETIVO_SERIES_MAX} series/semana</span>
        </p>
      </div>

      {/* Evolución 8 semanas */}
      <div className="px-4 pt-3 pb-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
          {grupoSel ? `${GRUPOS_VISTA.find((g) => g.id === grupoSel)?.nombre} · ${NUM_SEMANAS} semanas` : `Total · ${NUM_SEMANAS} semanas`}
        </p>
        <GraficoSemanas
          semanas={semanas}
          grupos={grupos.map((g) => g.id)}
          grupoSel={grupoSel}
          maxSemana={maxSemana}
          semanaSel={semanaSel}
          onSemana={(i) => setSemanaSel(semanaSel === i ? null : i)}
        />
        {/* Lectura de la semana tocada (equivalente táctil del tooltip) */}
        <p className="text-[11px] text-zinc-500 mt-2 min-h-4">
          {semanaInfo ? (
            <>
              <span className="text-zinc-300 font-semibold">{semanaInfo.label}</span>
              {' · '}
              <span className="text-white font-bold tabular-nums">
                {grupoSel ? (semanaInfo.porGrupo[grupoSel]?.series ?? 0) : semanaInfo.totalSeries}
              </span>{' series'}
              {!grupoSel && semanaInfo.totalSeries > 0 && (
                <span className="text-zinc-500">
                  {' — '}
                  {grupos
                    .map((g) => ({ g, n: semanaInfo.porGrupo[g.id]?.series ?? 0 }))
                    .filter((x) => x.n > 0)
                    .map((x) => `${x.g.nombre} ${x.n}`)
                    .join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-600">Toca una semana para ver el detalle{grupoSel ? '' : ' · toca un grupo para aislarlo'}</span>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Gráfico de barras semanal (apilado o de un grupo) ────────────────────────

function GraficoSemanas({
  semanas, grupos, grupoSel, maxSemana, semanaSel, onSemana,
}: {
  semanas: SemanaVolumen[]
  grupos: GrupoId[]
  grupoSel: GrupoId | null
  maxSemana: number
  semanaSel: number | null
  onSemana: (i: number) => void
}) {
  const W = 400, H = 132
  const P = { top: 14, right: 6, bottom: 18, left: 24 }
  const innerW = W - P.left - P.right
  const innerH = H - P.top - P.bottom

  const maxY = grupoSel
    ? Math.max(OBJETIVO_SERIES_MAX + 2, ...semanas.map((s) => s.porGrupo[grupoSel]?.series ?? 0))
    : Math.max(maxSemana, 1)
  const yDe = (v: number) => P.top + innerH - (v / maxY) * innerH

  const n = semanas.length
  const paso = innerW / n
  const barW = Math.min(30, paso * 0.62)
  const xDe = (i: number) => P.left + paso * i + (paso - barW) / 2

  const GAP = 2      // hueco entre segmentos apilados (px de viewBox)
  const RADIO = 3    // extremo de dato redondeado

  // Etiquetas directas selectivas: solo la semana actual y la mayor
  const idxMax = semanas.reduce((b, s, i) => {
    const v = grupoSel ? (s.porGrupo[grupoSel]?.series ?? 0) : s.totalSeries
    const vb = grupoSel ? (semanas[b].porGrupo[grupoSel]?.series ?? 0) : semanas[b].totalSeries
    return v > vb ? i : b
  }, 0)

  const ticksY = [Math.round(maxY / 2), maxY]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Series por semana">
      {/* Rejilla recesiva + eje Y */}
      {ticksY.map((t) => (
        <g key={t}>
          <line x1={P.left} y1={yDe(t)} x2={W - P.right} y2={yDe(t)} stroke="#27272a" strokeWidth="1" />
          <text x={P.left - 4} y={yDe(t) + 3} textAnchor="end" fill="#52525b" fontSize="8">{t}</text>
        </g>
      ))}

      {/* Banda objetivo (solo vista de un grupo) */}
      {grupoSel && (
        <g>
          <rect
            x={P.left} y={yDe(OBJETIVO_SERIES_MAX)}
            width={innerW} height={yDe(OBJETIVO_SERIES_MIN) - yDe(OBJETIVO_SERIES_MAX)}
            fill="#ffffff" opacity="0.05"
          />
          {[OBJETIVO_SERIES_MIN, OBJETIVO_SERIES_MAX].map((v) => (
            <g key={v}>
              <line x1={P.left} y1={yDe(v)} x2={W - P.right} y2={yDe(v)} stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
              <text x={W - P.right} y={yDe(v) - 2.5} textAnchor="end" fill="#71717a" fontSize="7.5">{v}</text>
            </g>
          ))}
        </g>
      )}

      {/* Barras */}
      {semanas.map((s, i) => {
        const x = xDe(i)
        const seleccionada = semanaSel === i
        const atenuar = semanaSel !== null && !seleccionada

        if (grupoSel) {
          const v = s.porGrupo[grupoSel]?.series ?? 0
          const y = yDe(v)
          return (
            <g key={s.inicio} opacity={atenuar ? 0.45 : 1} onClick={() => onSemana(i)} style={{ cursor: 'pointer' }}>
              <rect x={P.left + paso * i} y={P.top} width={paso} height={innerH + P.bottom} fill="transparent" />
              {v > 0 && (
                <path
                  d={`M ${x} ${yDe(0)} V ${y + RADIO} Q ${x} ${y} ${x + RADIO} ${y} H ${x + barW - RADIO} Q ${x + barW} ${y} ${x + barW} ${y + RADIO} V ${yDe(0)} Z`}
                  fill={COLOR_GRUPO[grupoSel]}
                />
              )}
              {(i === idxMax || s.esActual) && v > 0 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill={s.esActual ? '#ffffff' : '#a1a1aa'} fontSize="8.5" fontWeight="700">{v}</text>
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fill={s.esActual ? '#e4e4e7' : '#52525b'} fontSize="7.5" fontWeight={s.esActual ? 700 : 400}>
                {s.inicio.slice(8, 10)}/{s.inicio.slice(5, 7)}
              </text>
            </g>
          )
        }

        // Apilado: segmentos en orden fijo de grupos, hueco de 2px entre ellos,
        // extremo superior del apilado redondeado (anclado a la base)
        const segmentos = grupos
          .map((g) => ({ g, v: s.porGrupo[g]?.series ?? 0 }))
          .filter((seg) => seg.v > 0)
        let yBase = yDe(0)
        return (
          <g key={s.inicio} opacity={atenuar ? 0.45 : 1} onClick={() => onSemana(i)} style={{ cursor: 'pointer' }}>
            <rect x={P.left + paso * i} y={P.top} width={paso} height={innerH + P.bottom} fill="transparent" />
            {segmentos.map((seg, k) => {
              const hv = yDe(0) - yDe(seg.v)
              const yTop = yBase - hv
              const esUltimo = k === segmentos.length - 1
              const drawY = esUltimo ? yTop : yTop + GAP
              const drawH = Math.max(1, hv - (esUltimo ? 0 : GAP))
              yBase = yTop
              if (esUltimo && drawH > RADIO) {
                return (
                  <path
                    key={seg.g}
                    d={`M ${x} ${drawY + drawH} V ${drawY + RADIO} Q ${x} ${drawY} ${x + RADIO} ${drawY} H ${x + barW - RADIO} Q ${x + barW} ${drawY} ${x + barW} ${drawY + RADIO} V ${drawY + drawH} Z`}
                    fill={COLOR_GRUPO[seg.g]}
                  />
                )
              }
              return <rect key={seg.g} x={x} y={drawY} width={barW} height={drawH} fill={COLOR_GRUPO[seg.g]} />
            })}
            {(i === idxMax || s.esActual) && s.totalSeries > 0 && (
              <text x={x + barW / 2} y={yDe(s.totalSeries) - 4} textAnchor="middle" fill={s.esActual ? '#ffffff' : '#a1a1aa'} fontSize="8.5" fontWeight="700">
                {s.totalSeries}
              </text>
            )}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle" fill={s.esActual ? '#e4e4e7' : '#52525b'} fontSize="7.5" fontWeight={s.esActual ? 700 : 400}>
              {s.inicio.slice(8, 10)}/{s.inicio.slice(5, 7)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
