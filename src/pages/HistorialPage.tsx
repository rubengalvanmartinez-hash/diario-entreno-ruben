import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { useHistorialRef } from '../hooks/useHistorialRef'
import type { Sesion } from '../types/models'
import { ResumenSesion, DIA_NOMBRE } from './SesionPage'

// ── Utilidades de fecha (todo en fecha local, formato ISO YYYY-MM-DD) ─────────

function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** Lunes de la semana de la fecha dada */
function lunesDe(d: Date): Date {
  const r = new Date(d)
  const dow = (r.getDay() + 6) % 7 // 0 = lunes
  r.setDate(r.getDate() - dow)
  r.setHours(0, 0, 0, 0)
  return r
}

function fmtCorta(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const SEMANAS_VISIBLES = 8

// ── Página ────────────────────────────────────────────────────────────────────

export default function HistorialPage() {
  const navigate = useNavigate()
  // Historial en kg de referencia (Entrena-T) para que récords y progresos casen
  const historialRef = useHistorialRef()
  // Historial "crudo" (kg reales de cada gimnasio) para mostrar las series
  const historialCrudo = useFitLogStore(useShallow((s) => s.historialSesiones))

  // Desplazamiento en bloques de 8 semanas (0 = las últimas 8)
  const [offset, setOffset] = useState(0)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  const [sesionSel, setSesionSel] = useState<Sesion | null>(null)

  const hoyIso = isoLocal(new Date())

  // Sesiones agrupadas por fecha
  const porFecha = useMemo(() => {
    const map = new Map<string, Sesion[]>()
    for (const s of historialCrudo) {
      const lista = map.get(s.fecha) ?? []
      lista.push(s)
      map.set(s.fecha, lista)
    }
    return map
  }, [historialCrudo])

  // Semanas a mostrar (de la más antigua a la más reciente)
  const semanas = useMemo(() => {
    const lunesActual = lunesDe(new Date())
    const inicio = addDays(lunesActual, -7 * (SEMANAS_VISIBLES - 1) - 7 * SEMANAS_VISIBLES * offset)
    const filas: Date[][] = []
    for (let w = 0; w < SEMANAS_VISIBLES; w++) {
      const fila: Date[] = []
      for (let d = 0; d < 7; d++) fila.push(addDays(inicio, w * 7 + d))
      filas.push(fila)
    }
    return filas
  }, [offset])

  const rangoTexto = useMemo(() => {
    const a = semanas[0][0]
    const b = semanas[semanas.length - 1][6]
    return `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]} ${b.getFullYear()}`
  }, [semanas])

  // Estadísticas del rango visible
  const statsRango = useMemo(() => {
    let dias = 0, sesiones = 0
    for (const fila of semanas) for (const d of fila) {
      const l = porFecha.get(isoLocal(d))
      if (l && l.length > 0) { dias++; sesiones += l.length }
    }
    return { dias, sesiones }
  }, [semanas, porFecha])

  const sesionesDia = diaSel ? (porFecha.get(diaSel) ?? []) : []

  // Al elegir un día: si hay una sola sesión, abrirla directamente
  const elegirDia = (iso: string) => {
    const lista = porFecha.get(iso) ?? []
    if (lista.length === 0) return
    setDiaSel(iso)
    if (lista.length === 1) setSesionSel(lista[0])
  }

  // Historial previo para el informe: SOLO sesiones anteriores a la fecha consultada
  const historialPrevio = useMemo(() => {
    if (!sesionSel) return []
    return historialRef.filter((s) => s.fecha < sesionSel.fecha && s.id !== sesionSel.id)
  }, [historialRef, sesionSel])

  const cerrarInforme = () => {
    setSesionSel(null)
    // Si ese día tenía una sola sesión, volver directamente al calendario
    if (diaSel && (porFecha.get(diaSel)?.length ?? 0) <= 1) setDiaSel(null)
  }

  return (
    <div className="px-4 pt-6 pb-36 max-w-lg mx-auto flex flex-col gap-4">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="size-9 flex items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 active:bg-zinc-800"
          aria-label="Volver"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-white leading-tight">Historial de entrenos</h1>
          <p className="text-xs text-zinc-500">Toca un día en verde para ver el informe</p>
        </div>
        <span className="size-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
          <CalendarDays size={18} />
        </span>
      </div>

      {/* Navegación de rango */}
      <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-2xl px-2 py-2">
        <button
          onClick={() => setOffset((o) => o + 1)}
          className="size-9 flex items-center justify-center rounded-xl text-zinc-300 active:bg-zinc-800"
          aria-label="Semanas anteriores"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-white tabular-nums">{rangoTexto}</p>
          <p className="text-[11px] text-zinc-500">
            {statsRango.dias} día{statsRango.dias !== 1 ? 's' : ''} entrenado{statsRango.dias !== 1 ? 's' : ''}
            {statsRango.sesiones !== statsRango.dias ? ` · ${statsRango.sesiones} sesiones` : ''}
          </p>
        </div>
        <button
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          className="size-9 flex items-center justify-center rounded-xl text-zinc-300 active:bg-zinc-800 disabled:opacity-20"
          aria-label="Semanas siguientes"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendario */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-3">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {DIAS_SEMANA.map((d) => (
            <span key={d} className="text-center text-[10px] font-bold text-zinc-600 uppercase">{d}</span>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {semanas.map((fila, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {fila.map((d) => {
                const iso = isoLocal(d)
                const lista = porFecha.get(iso) ?? []
                const n = lista.length
                const esHoy = iso === hoyIso
                const futuro = iso > hoyIso
                const sel = iso === diaSel
                const primerDiaMes = d.getDate() === 1
                const cl = n === 0
                  ? (futuro ? 'bg-zinc-950/40 text-zinc-800' : 'bg-zinc-800/60 text-zinc-500')
                  : n === 1
                    ? 'bg-emerald-600/70 text-white'
                    : 'bg-emerald-500 text-white'
                return (
                  <button
                    key={iso}
                    onClick={() => elegirDia(iso)}
                    disabled={n === 0}
                    className={[
                      'relative aspect-square rounded-lg flex flex-col items-center justify-center',
                      'text-[11px] font-bold tabular-nums transition-transform',
                      n > 0 ? 'active:scale-95' : 'cursor-default',
                      cl,
                      esHoy ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-zinc-900' : '',
                      sel ? 'ring-2 ring-emerald-300 ring-offset-1 ring-offset-zinc-900' : '',
                    ].join(' ')}
                    aria-label={`${fmtCorta(iso)}${n > 0 ? `, ${n} sesión${n !== 1 ? 'es' : ''}` : ''}`}
                  >
                    {primerDiaMes && (
                      <span className="absolute -top-0.5 left-0.5 text-[7px] font-black uppercase opacity-80">
                        {MESES[d.getMonth()]}
                      </span>
                    )}
                    {d.getDate()}
                    {n > 1 && (
                      <span className="absolute bottom-0.5 right-1 text-[8px] font-black opacity-90">×{n}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3 px-1 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-emerald-600/70" /> entreno</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-emerald-500" /> varias sesiones</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded ring-2 ring-white/80 ring-offset-1 ring-offset-zinc-900" /> hoy</span>
        </div>
      </div>

      {/* Selector cuando un día tiene varias sesiones */}
      {diaSel && sesionesDia.length > 1 && !sesionSel && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <p className="text-sm font-bold text-white">{fmtCorta(diaSel)} · {sesionesDia.length} sesiones</p>
            <p className="text-[11px] text-zinc-500">Elige cuál quieres ver</p>
          </div>
          <ul className="divide-y divide-zinc-800/60">
            {sesionesDia.map((s) => {
              const completados = s.ejercicios.filter((e) => e.completado && !e.saltado)
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setSesionSel(s)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-zinc-800"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white">{DIA_NOMBRE[String(s.dia)] ?? 'Sesión'}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {completados.map((e) => e.nombreSustituido ?? e.nombreSnapshot).join(' · ') || 'Sin ejercicios'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-zinc-600 shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Sin datos */}
      {historialCrudo.length === 0 && (
        <p className="text-center text-sm text-zinc-500 py-6">
          Todavía no hay entrenos guardados. Cuando completes una sesión aparecerá aquí.
        </p>
      )}

      {/* Informe del día (mismo componente que el resumen de fin de sesión) */}
      {sesionSel && (
        <ResumenSesion
          key={sesionSel.id}
          sesion={sesionSel}
          historialPrevio={historialPrevio}
          diaNombre={DIA_NOMBRE[String(sesionSel.dia)] ?? 'Sesión'}
          hayObjetivoSuperado={false}
          onFinalizar={cerrarInforme}
          onSeguir={cerrarInforme}
          modoHistorial
        />
      )}
    </div>
  )
}
