/**
 * MEAM — pantalla «Evidencia de adaptación»: estado por músculo, confianza, acción y «¿por qué?».
 * Lo que ve el usuario (P14): estado + confianza + acción; indicador de entrenador por ejercicio; series/semana y frecuencia;
 * fase nutricional; fatiga solo si existe. T, D, σ, ρ y tiers viven en «¿por qué?».
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { calcularInforme, type MeamWorkerRequest, type MeamWorkerResponse } from '../meam/compute'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, Activity } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { useHistorialRef } from '../hooks/useHistorialRef'
import { nombreCanonico } from '../utils/normalizar'
import type { VariantOverride } from '../meam/variants'
import type { InformeMeam, InformeMusculo, Confianza } from '../meam/run'
import { cargarVariantesRevisadas, guardarSnapshots } from '../meam/services'
import { MEAM_CONFIG } from '../meam/config'

const ESTADO: Record<string, { label: string; color: string; icono: React.ReactNode }> = {
  PROGRESANDO:        { label: 'Progresando',        color: '#0ca30c', icono: <TrendingUp size={12} strokeWidth={2.5} /> },
  ESTABLE:            { label: 'Estable',            color: '#a1a1aa', icono: <Minus size={12} strokeWidth={2.5} /> },
  DECLINANDO:         { label: 'Descenso',           color: '#fab219', icono: <TrendingDown size={12} strokeWidth={2.5} /> },
  REGRESION_PROBABLE: { label: 'Regresión probable', color: '#ec835a', icono: <TrendingDown size={12} strokeWidth={2.5} /> },
  INCONCLUYENTE:      { label: 'Sin evidencia',      color: '#71717a', icono: <HelpCircle size={12} strokeWidth={2.5} /> },
}
const CONFIANZA: Record<Confianza, string> = { ALTA: 'text-emerald-400', MEDIA: 'text-zinc-300', BAJA: 'text-amber-400', INSUFICIENTE: 'text-zinc-500' }
const RECUP: Record<string, string> = { FATIGA_SOSPECHADA: 'Fatiga sospechada', FATIGA_APOYADA: 'Fatiga confirmada', NO_ATRIBUIDA: 'Caída no atribuida' }

const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—')
const signo = (x: number, d = 2): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')

export default function MeamPage() {
  const navigate = useNavigate()
  const historial = useHistorialRef()
  const registrosPeso = useFitLogStore(useShallow((s) => s.registrosPeso))
  const ejercicios = useFitLogStore(useShallow((s) => s.ejercicios))
  const [overrides, setOverrides] = useState<VariantOverride[] | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [informe, setInforme] = useState<InformeMeam | null>(null)
  const [calculando, setCalculando] = useState(true)
  const [ms, setMs] = useState<number | null>(null)
  const guardadoRef = useRef<string>('')
  const workerRef = useRef<Worker | null>(null)
  const reqIdRef = useRef(0)
  const huellaRef = useRef('')
  const ultimaReqRef = useRef<MeamWorkerRequest | null>(null)

  useEffect(() => { cargarVariantesRevisadas().then(setOverrides).catch(() => setOverrides([])) }, [])

  // Huella de CONTENIDO del historial (no de referencia): el pull cada 5 s crea arrays nuevos con los mismos datos (auditoría 6, C1)
  const huella = useMemo(() => {
    const partes: string[] = []
    for (const s of historial) partes.push(`${s.id}|${s.fecha}|${s.tipoSesion ?? ''}|${s.gimnasio ?? ''}|${s.ejercicios.map((e) => `${e.nombreSustituido ?? e.nombreSnapshot}:${e.series.map((x) => `${x.reps}/${x.pesoKg}/${x.etiqueta ?? ''}`).join(',')}`).join(';')}`)
    partes.push(`P:${registrosPeso.map((p) => `${p.fecha}=${p.pesoKg}`).join(',')}`)
    partes.push(`E:${ejercicios.map((e) => `${e.nombre}${e.esAsistencia ? '*' : ''}`).join(',')}`)
    partes.push(`O:${JSON.stringify(overrides ?? [])}`)
    return partes.join('\n')
  }, [historial, registrosPeso, ejercicios, overrides])

  useEffect(() => {
    if (overrides === null) return
    if (huella === huellaRef.current) return
    huellaRef.current = huella
    const nombres = new Set<string>()
    for (const s of historial) for (const e of s.ejercicios) nombres.add(e.nombreSustituido ?? e.nombreSnapshot)
    for (const e of ejercicios) nombres.add(e.nombre)
    const asistencia = [...new Set(ejercicios.filter((e) => e.esAsistencia).map((e) => nombreCanonico(e.nombre)))]
    const req: MeamWorkerRequest = { id: ++reqIdRef.current, sesiones: historial, pesos: registrosPeso, nombres: [...nombres], overrides, asistencia }
    ultimaReqRef.current = req
    setCalculando(true)
    const aplicar = (res: MeamWorkerResponse) => {
      if (res.id !== reqIdRef.current) return
      if (res.error) console.error('[MEAM] error al calcular:', res.error)
      setInforme(res.informe); setMs(res.ms); setCalculando(false)
    }
    try {
      if (typeof Worker !== 'undefined') {
        if (!workerRef.current) {
          workerRef.current = new Worker(new URL('../meam/meam.worker.ts', import.meta.url), { type: 'module' })
          workerRef.current.onmessage = (ev: MessageEvent<MeamWorkerResponse>) => aplicar(ev.data)
          workerRef.current.onerror = (e) => {
            console.warn('[MEAM] worker no disponible, calculando en el hilo principal:', e.message)
            workerRef.current?.terminate(); workerRef.current = null
            const ultima = ultimaReqRef.current
            if (ultima) setTimeout(() => aplicar(calcularInforme(ultima)), 0)
          }
        }
        workerRef.current.postMessage(req)
        return
      }
    } catch (e) {
      console.warn('[MEAM] worker no disponible, calculando en el hilo principal:', e)
    }
    // sin Worker (navegadores antiguos): cálculo en el hilo principal, diferido para no bloquear el primer render
    setTimeout(() => aplicar(calcularInforme(req)), 0)
  }, [huella, historial, registrosPeso, ejercicios, overrides])

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  // snapshots append-only: una vez por corte y sesión de la app (idempotente por input_hash)
  useEffect(() => {
    if (!informe || informe.musculos.length === 0) return
    const clave = `${informe.corte}|${informe.musculos.map((m) => m.inputHash).join(',')}`
    if (guardadoRef.current === clave) return
    guardadoRef.current = clave
    guardarSnapshots(informe).then((n) => { if (n > 0) console.log(`[MEAM] ${n} snapshots guardados (${informe.corte})`) })
  }, [informe])

  return (
    <div className="flex flex-col pb-8">
      <div className="px-4 pt-6 pb-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="size-9 flex items-center justify-center rounded-xl text-zinc-300 active:bg-zinc-800" aria-label="Volver">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-white tracking-tight">Evidencia de adaptación</h1>
          <p className="text-[11px] text-zinc-500">
            {calculando ? 'Calculando…' : informe ? `Corte ${informe.corte} · motor ${informe.configVersion}${ms !== null ? ` · ${(ms / 1000).toFixed(1)} s` : ''}` : 'Sin datos'}
            {informe && informe.faseNutricional !== 'desconocida' && ` · peso ${signo(informe.pesoPendientePctSem)} %/sem (${informe.faseNutricional})`}
          </p>
        </div>
      </div>

      {!calculando && informe && informe.musculos.length === 0 && (
        <p className="mx-4 text-sm text-zinc-500">Todavía no hay suficientes sesiones (hacen falta al menos 3 exposiciones por ejercicio y 6 semanas).</p>
      )}

      <div className="mx-4 flex flex-col gap-3">
        {informe?.musculos.map((m) => (
          <TarjetaMusculo key={m.musculo} m={m} abierto={abierto === m.musculo} onToggle={() => setAbierto(abierto === m.musculo ? null : m.musculo)} />
        ))}
      </div>

      {informe && informe.nombresSinMapa.length > 0 && (
        <div className="mx-4 mt-4 bg-zinc-900 border border-amber-500/30 rounded-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> Ejercicios sin músculo asignado</p>
          <p className="text-xs text-zinc-400 mt-1">Se analizan como «otros» y no cuentan para ningún músculo. Revisa su nombre o añade un alias.</p>
          <p className="text-xs text-zinc-300 mt-2">{informe.nombresSinMapa.join(' · ')}</p>
        </div>
      )}

      <div className="mx-4 mt-4 text-[11px] text-zinc-600 leading-relaxed">
        <p>El motor mide rendimiento (e1RM del top set, sin cambiar de canal por el RIR), no músculo. Cada corte semanal usa solo los datos anteriores al lunes.
          Los estados exigen tendencia detectable, efecto mínimo y concordancia entre ejercicios; una descarga marcada permite comprobar el rebote de una fatiga.</p>
        <p className="mt-1">Confianza BAJA mientras el ruido no esté calibrado (hacen falta ≥ {MEAM_CONFIG.rho_min_variants} ejercicios con ≥ {MEAM_CONFIG.rho_min_n_err} exposiciones).</p>
      </div>
    </div>
  )
}

function TarjetaMusculo({ m, abierto, onToggle }: { m: InformeMusculo; abierto: boolean; onToggle: () => void }) {
  const est = ESTADO[m.estado] ?? ESTADO.INCONCLUYENTE
  const rec = RECUP[m.recuperacion]
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-black text-white">{m.nombre}</p>
          <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: est.color }}>{est.icono}{est.label}</span>
        </div>
        <p className="text-xs text-zinc-300 mt-1">{m.textoUsuario}</p>
        {rec && (
          <p className="text-xs font-bold text-amber-400 mt-1 flex items-center gap-1"><Activity size={12} /> {rec}</p>
        )}
        <p className="text-[11px] text-zinc-400 mt-1">{m.accion}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-[10px] text-zinc-500">
          <span>Confianza <b className={CONFIANZA[m.confianza]}>{m.confianza}</b></span>
          <span>{fmt(m.volumenSeriesSemana, 0)} series/sem{Number.isFinite(m.volumenPercentil) ? ` (P${fmt(m.volumenPercentil, 0)} personal)` : ''}</span>
          <span>{fmt(m.frecuenciaSemanal, 1)} sesiones/sem</span>
          {m.ejercicios.some((e) => e.sinMejoraEn6) && <span className="text-amber-400/90">sin mejora en 6 exposiciones: {m.ejercicios.filter((e) => e.sinMejoraEn6).map((e) => e.nombre).join(', ')}</span>}
        </div>
      </div>
      <button onClick={onToggle} aria-expanded={abierto} aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle de ${m.nombre}`} className="w-full flex items-center justify-center gap-1 py-2 text-[11px] font-bold text-zinc-400 border-t border-zinc-800 active:bg-zinc-800">
        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} ¿Por qué?
      </button>
      {abierto && (
        <div className="px-4 pb-4 text-[11px] text-zinc-400 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <span>T (tendencia): <b className="text-zinc-200">{fmt(m.T)}</b></span>
            <span>D (salida reciente): <b className="text-zinc-200">{fmt(m.D)}</b></span>
            <span>σ residual: <b className="text-zinc-200">{fmt(m.sigmaPct)} %</b></span>
            <span>ρ̂ lag-1: <b className="text-zinc-200">{fmt(m.rho)}</b> {m.rhoCalibrado ? '' : '(sin calibrar)'}</span>
            {m.cambioKg && <span className="col-span-2">Cambio en la ventana: entre {signo(m.cambioKg[0], 1)} y {signo(m.cambioKg[1], 1)} kg de e1RM</span>}
            {m.etiqueta && <span className="col-span-2">Etiqueta: {m.etiqueta}</span>}
            {m.etiquetaRecuperacion && <span className="col-span-2">Recuperación: {m.etiquetaRecuperacion}</span>}
            {m.flags.length > 0 && <span className="col-span-2">Avisos: {m.flags.join(', ')}</span>}
            {m.contextoAlto && <span className="col-span-2">Contexto de carga alta (volumen ≥ P70 personal)</span>}
          </div>
          <div className="mt-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Por ejercicio</p>
            <ul className="divide-y divide-zinc-800/60">
              {m.ejercicios.map((e) => (
                <li key={e.key} className="py-1.5 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-200 font-bold truncate">{e.nombre}</span>
                    <span className="tabular-nums shrink-0">T {fmt(e.T)} · {signo(e.pendientePctSem)} %/sem</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-[10px] text-zinc-500 tabular-nums">
                    <span>e1RM {fmt(e.e1rmActual, 1)} kg</span>
                    <span>MDS {fmt(e.mdsKgMes, 1)} kg/mes</span>
                    <span>{e.nExposiciones} exp · {e.tier}</span>
                    <span>{e.calidadTemporal}</span>
                    <span>{e.estrato}</span>
                    {Number.isFinite(e.TLong) && <span>26 s: T {fmt(e.TLong)}</span>}
                    {e.rirDisponible > 0 && <span>RIR en {e.rirDisponible}</span>}
                    {e.erratas > 0 && <span className="text-amber-400/80">{e.erratas} posible(s) errata(s)</span>}
                    {e.flags.length > 0 && <span>{e.flags.join(', ')}</span>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-zinc-600 mt-2">MDS: cambios menores que ese valor pueden quedar dentro del ruido observado de ese ejercicio. Para afinar: mismo rango de repeticiones, RIR del top set, misma variante.</p>
          </div>
        </div>
      )}
    </div>
  )
}
