/**
 * MEAM — pantalla «Evidencia de adaptación»: estado por músculo, fiabilidad, qué hacer y «¿por qué?».
 * Pensada para gente sin formación en entrenamiento (P14): pictograma + semáforo + una frase en llano + qué hacer.
 * T, D, σ, ρ, tiers y el detalle por ejercicio viven en «¿Por qué?», cada uno con una línea que explica qué significa.
 * La parte de cálculo (worker, huella de contenido, snapshots) no cambia respecto a 2.8.0.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { calcularInforme, type MeamWorkerRequest, type MeamWorkerResponse } from '../meam/compute'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, BatteryLow, Lightbulb, Scale } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { useHistorialRef } from '../hooks/useHistorialRef'
import { nombreCanonico } from '../utils/normalizar'
import type { GrupoId } from '../utils/gruposMusculares'
import { ICONO_GRUPO, COLOR_GRUPO } from '../components/gruposUI'
import type { VariantOverride, MeamMuscle } from '../meam/variants'
import type { InformeMeam, InformeMusculo, InformeEjercicio, Confianza } from '../meam/run'
import { cargarVariantesRevisadas, guardarSnapshots } from '../meam/services'
import { MEAM_CONFIG } from '../meam/config'

// ---------------------------------------------------------------------------
// Vocabulario visual (semáforo, fiabilidad, glosario) — solo presentación
// ---------------------------------------------------------------------------

/** Pictograma y color del grupo de la app para cada músculo MEAM. */
const GRUPO_DE: Record<MeamMuscle, GrupoId> = {
  pecho: 'pecho', hombro: 'hombro', biceps: 'brazos', triceps: 'brazos', espalda: 'espalda',
  cuadriceps: 'piernas', femoral_gluteo: 'piernas', gemelo: 'piernas', abdomen: 'abdomen', otros: 'otros',
}

type Semaforo = 'mejora' | 'estable' | 'baja' | 'regresion' | 'sin_datos'
const SEMAFORO: Record<Semaforo, { label: string; color: string; fondo: string; icono: React.ReactNode }> = {
  mejora:    { label: 'Mejorando',          color: '#4ade80', fondo: 'rgba(74,222,128,0.14)',  icono: <TrendingUp size={14} strokeWidth={2.5} /> },
  estable:   { label: 'Estable',            color: '#a1a1aa', fondo: 'rgba(161,161,170,0.14)', icono: <Minus size={14} strokeWidth={2.5} /> },
  baja:      { label: 'Bajando',            color: '#fbbf24', fondo: 'rgba(251,191,36,0.14)',  icono: <TrendingDown size={14} strokeWidth={2.5} /> },
  regresion: { label: 'Regresión probable', color: '#f87171', fondo: 'rgba(248,113,113,0.14)', icono: <TrendingDown size={14} strokeWidth={2.5} /> },
  sin_datos: { label: 'Sin datos aún',      color: '#71717a', fondo: 'rgba(113,113,122,0.14)', icono: <HelpCircle size={14} strokeWidth={2.5} /> },
}
function semaforoDe(m: InformeMusculo): Semaforo {
  switch (m.estado) {
    case 'PROGRESANDO': return 'mejora'
    case 'ESTABLE': return 'estable'
    case 'DECLINANDO': return 'baja'
    case 'REGRESION_PROBABLE': return 'regresion'
    default: return 'sin_datos'
  }
}

const RECUP: Record<string, { label: string; color: string }> = {
  FATIGA_SOSPECHADA: { label: 'Posible cansancio acumulado', color: '#f87171' },
  FATIGA_APOYADA:    { label: 'Recuperándote de un bajón', color: '#60a5fa' },
  NO_ATRIBUIDA:      { label: 'Bajón sin explicar',         color: '#fb923c' },
}

/** Fiabilidad: puntos llenos de 3 + palabra. Mide cuánto fiarse del estado, no cuánto has entrenado. */
const FIABILIDAD: Record<Confianza, { puntos: number; label: string; color: string }> = {
  ALTA:         { puntos: 3, label: 'alta',      color: '#4ade80' },
  MEDIA:        { puntos: 2, label: 'media',     color: '#d4d4d8' },
  BAJA:         { puntos: 1, label: 'baja',      color: '#fbbf24' },
  INSUFICIENTE: { puntos: 0, label: 'sin datos', color: '#71717a' },
}

const TIER: Record<string, string> = { NONE: 'sin datos', PROVISIONAL: 'pocas sesiones', ESTABLISHED: 'establecido', MATURE: 'maduro' }
const CALIDAD: Record<string, string> = { REGULAR: 'ritmo regular', IRREGULAR: 'ritmo irregular', ESCASA: 'pocas sesiones' }
const estratoLegible = (s: string): string => (s.startsWith('r') ? `${s.slice(1).replace('-', '–')} reps` : s)
/** Etiquetas y avisos del motor en lenguaje llano; los no listados salen en minúsculas con espacios. */
const GLOSARIO: Record<string, string> = {
  D_NO_DISPONIBLE: 'aún no hay sesiones recientes suficientes para comparar (D)',
  N_STATE_INSUFICIENTE: 'pocas sesiones en la ventana para calcular la tendencia',
  POST_INTERRUPCION: 'parón reciente',
  POST_INTERRUPCION_SIN_CAMBIO_DE_NIVEL: 'tras el parón sigues al mismo nivel',
  POST_INTERRUPCION_CON_CAMBIO_DE_NIVEL: 'tras el parón el nivel ha cambiado',
  CAMBIO_DE_ESTRATO_PENDIENTE: 'cambio de rango de repeticiones reciente (pendiente de asentarse)',
  CAMBIO_DE_ESTRATO_RECIENTE: 'cambio de rango de repeticiones reciente',
  PENDIENTE_HETEROGENEA_ENTRE_ESTRATOS: 'la tendencia no coincide entre rangos de repeticiones',
  RECIENTE_ESCASA: 'pocas sesiones recientes',
  SERIE_CUANTIZADA: 'saltos de peso grandes para lo que mueves (poca resolución)',
  EXCLUSION_EXCESIVA: 'demasiadas semanas apartadas del cálculo de ruido',
  TENDENCIA_POSITIVA_NO_CONCLUYENTE: 'apunta a mejora, no concluyente',
  TENDENCIA_NEGATIVA_NO_CONCLUYENTE: 'apunta a bajada, no concluyente',
  PROGRESO_RECIENTE_NO_CONFIRMADO: 'mejora en la ventana no confirmada por las últimas semanas',
  PROGRESO_LENTO_26S: 'mejora lenta a 26 semanas',
  DECLIVE_LENTO_26S: 'bajada lenta a 26 semanas',
  EVIDENCIA_MIXTA: 'unos ejercicios suben y otros bajan',
  SIN_CAMBIO_DETECTABLE: 'sin cambio detectable',
  DESCENSO_DETECTADO_PENDIENTE_CONFIRMACION: 'bajada detectada, pendiente de confirmar',
  DESCENSO_AISLADO_VIGILAR: 'bajada en un solo ejercicio: vigilar',
  CAIDA_TRANSITORIA: 'bajón pasajero',
  CAIDA_PERSISTENTE_NO_ATRIBUIDA: 'bajón que dura y no se explica por cansancio',
  REDUCCION_SIN_REBOTE_CLARO: 'hubo descarga pero sin rebote claro',
  RECUPERADA: 'recuperado',
  RECUPERADA_TARDIA: 'recuperado, tarde',
  RECAIDA: 'recaída',
  CIERRE_APOYADA_POR_TIEMPO: 'episodio cerrado por tiempo',
  CIERRE_POR_NUEVO_NIVEL: 'episodio cerrado: nuevo nivel',
  NO_EVALUABLE_CAMBIO_PROTOCOLO: 'no evaluable: cambio de protocolo',
}
const legible = (s: string): string => GLOSARIO[s] ?? s.toLowerCase().replace(/_/g, ' ')
const FASE: Record<InformeMeam['faseNutricional'], string> = { deficit: 'perdiendo peso', mantenimiento: 'peso estable', superavit: 'ganando peso', desconocida: '' }

const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—')
/** «150 kg × 10», «+10 kg de lastre × 8» o «25 kg de ayuda × 8»: siempre lo que el usuario apuntó, no la carga efectiva */
const marcaLegible = (m: NonNullable<InformeEjercicio['mejorMarca']>): string =>
  m.tipoCarga === 'ayuda' ? `${fmt(m.pesoRegistrado, 1)} kg de ayuda × ${m.topReps}` : m.tipoCarga === 'lastre' ? `${m.pesoRegistrado > 0 ? '+' : ''}${fmt(m.pesoRegistrado, 1)} kg de lastre × ${m.topReps}` : `${fmt(m.pesoRegistrado, 1)} kg × ${m.topReps}`
const signo = (x: number, d = 2): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const fechaCorta = (iso: string): string => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

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
  const [ayuda, setAyuda] = useState(false)
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

  // resumen de cabecera: cuántos músculos en cada color + cuántos con señal de cansancio
  const resumen = useMemo(() => {
    const c: Record<Semaforo, number> = { mejora: 0, estable: 0, baja: 0, regresion: 0, sin_datos: 0 }
    let cansancio = 0, sinExplicar = 0
    for (const m of informe?.musculos ?? []) { c[semaforoDe(m)]++; if (m.recuperacion === 'FATIGA_SOSPECHADA') cansancio++; else if (m.recuperacion === 'NO_ATRIBUIDA') sinExplicar++ }
    return { ...c, cansancio, sinExplicar }
  }, [informe])

  return (
    <div className="flex flex-col pb-8">
      <div className="px-4 pt-6 pb-2 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="size-9 flex items-center justify-center rounded-xl text-zinc-300 active:bg-zinc-800" aria-label="Volver">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-white tracking-tight leading-tight">Evidencia de adaptación</h1>
          <p className="text-[11px] text-zinc-500">
            {calculando ? 'Calculando…' : informe ? `Semana del ${fechaCorta(informe.corte)} · con todas las sesiones anteriores` : 'Sin datos'}
          </p>
        </div>
        <button onClick={() => setAyuda((v) => !v)} aria-expanded={ayuda} aria-label="Cómo leer esta pantalla"
          className={`size-9 flex items-center justify-center rounded-xl active:bg-zinc-800 ${ayuda ? 'text-white bg-zinc-800' : 'text-zinc-400'}`}>
          <HelpCircle size={20} />
        </button>
      </div>

      {ayuda && (
        <div className="mx-4 mb-3 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-xs text-zinc-300 leading-relaxed flex flex-col gap-2">
          <p><b className="text-white">Qué mira:</b> para cada músculo, si tu fuerza estimada (a partir del peso y las repeticiones de tu mejor serie en cada ejercicio) sube, baja o se mantiene a lo largo de las últimas semanas (hasta 16). No mide el músculo en sí, mide lo que rindes.</p>
          <p><b className="text-white">Colores:</b> <span style={{ color: SEMAFORO.mejora.color }}>verde</span> mejorando · <span style={{ color: SEMAFORO.estable.color }}>gris</span> estable · <span style={{ color: SEMAFORO.baja.color }}>ámbar</span> bajando · <span style={{ color: SEMAFORO.regresion.color }}>rojo</span> bajada confirmada varias veces.</p>
          <p><b className="text-white">Fiabilidad:</b> cuánto puedes fiarte de ese color. Baja cuando vienes de un parón, cuando los ejercicios de un músculo se contradicen o cuando aún hay pocas sesiones. Se actualiza cada lunes con las sesiones ya apuntadas.</p>
          <p><b className="text-white">Para que afine:</b> repite el mismo ejercicio, en el mismo rango de repeticiones, y anota cuántas repeticiones te quedaban (RIR) en la serie más fuerte. Si haces una semana suave, márcala como descarga.</p>
        </div>
      )}

      {!calculando && informe && informe.musculos.length > 0 && (
        <div className="mx-4 mb-3 flex flex-wrap gap-1.5">
          {(['mejora', 'estable', 'baja', 'regresion', 'sin_datos'] as Semaforo[]).filter((k) => resumen[k] > 0).map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: SEMAFORO[k].color, background: SEMAFORO[k].fondo }}>
              {SEMAFORO[k].icono}{resumen[k]} {SEMAFORO[k].label.toLowerCase()}
            </span>
          ))}
          {resumen.cansancio > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: RECUP.FATIGA_SOSPECHADA.color, background: 'rgba(248,113,113,0.14)' }}>
              <BatteryLow size={14} strokeWidth={2.5} />{resumen.cansancio} con señal de cansancio
            </span>
          )}
          {resumen.sinExplicar > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: RECUP.NO_ATRIBUIDA.color, background: 'rgba(251,146,60,0.14)' }}>
              <BatteryLow size={14} strokeWidth={2.5} />{resumen.sinExplicar} con bajón sin explicar
            </span>
          )}
          {informe.faseNutricional !== 'desconocida' && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-zinc-400 bg-zinc-800/80">
              <Scale size={14} strokeWidth={2.5} />{FASE[informe.faseNutricional]} ({signo(informe.pesoPendientePctSem)} %/sem)
            </span>
          )}
        </div>
      )}

      {calculando && (
        <div className="mx-4 flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-zinc-900 border border-zinc-800 animate-pulse" />)}
        </div>
      )}

      {!calculando && informe && informe.musculos.length === 0 && (
        <div className="mx-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-400">
          <p className="font-bold text-white mb-1">Todavía no hay datos suficientes.</p>
          <p className="text-xs">Hacen falta al menos 6 semanas de sesiones apuntadas y 3 sesiones del mismo ejercicio. Sigue registrando y esta pantalla se irá llenando sola.</p>
        </div>
      )}

      <div className="mx-4 flex flex-col gap-3">
        {!calculando && informe?.musculos.map((m) => (
          <TarjetaMusculo key={m.musculo} m={m} abierto={abierto === m.musculo} onToggle={() => setAbierto(abierto === m.musculo ? null : m.musculo)} />
        ))}
      </div>

      {informe && informe.nombresSinMapa.length > 0 && (
        <div className="mx-4 mt-4 bg-zinc-900 border border-amber-500/30 rounded-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> Ejercicios sin músculo asignado</p>
          <p className="text-xs text-zinc-400 mt-1">La app no sabe a qué músculo pertenecen, así que no cuentan para ninguna tarjeta. Revisa el nombre del ejercicio o añade un alias.</p>
          <p className="text-xs text-zinc-300 mt-2">{informe.nombresSinMapa.join(' · ')}</p>
        </div>
      )}

      {informe && !calculando && (
        <p className="mx-4 mt-4 text-[11px] text-zinc-500">Motor {informe.configVersion}{ms !== null ? ` · calculado en ${(ms / 1000).toFixed(1)} s` : ''}. Cada tarjeta usa solo las sesiones anteriores al lunes de esta semana.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta por músculo
// ---------------------------------------------------------------------------

function Fiabilidad({ conf }: { conf: Confianza }) {
  const f = FIABILIDAD[conf]
  return (
    <span className="inline-flex items-center gap-1.5" title={`Fiabilidad ${f.label}`}>
      <span className="text-zinc-500">Fiabilidad</span>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className="size-2 rounded-full" style={{ background: i < f.puntos ? f.color : 'rgba(113,113,122,0.35)' }} />)}
      </span>
      <b style={{ color: f.color }}>{f.label}</b>
    </span>
  )
}

function TarjetaMusculo({ m, abierto, onToggle }: { m: InformeMusculo; abierto: boolean; onToggle: () => void }) {
  const sem = SEMAFORO[semaforoDe(m)]
  const rec = RECUP[m.recuperacion]
  const grupo = GRUPO_DE[m.musculo]
  const color = COLOR_GRUPO[grupo]
  // el borde lleva la señal más urgente: cansancio (rojo/naranja) por encima del estado
  const borde = rec && m.recuperacion !== 'FATIGA_APOYADA' ? rec.color : sem.color
  // título = primera frase de la acción (sin lookbehind: Safari < 16.4 rompería al parsear el módulo)
  const corte = m.accion.indexOf('. ')
  const tituloAccion = corte >= 0 ? m.accion.slice(0, corte + 1) : m.accion
  const textoAccion = corte >= 0 ? m.accion.slice(corte + 2) : ''
  const estancados = m.ejercicios.filter((e) => e.sinMejoraEn6)
  const motivoBaja = m.confianza === 'BAJA' ? (m.motivosConfianza.length > 0 ? `Fiabilidad baja porque ${m.motivosConfianza.join('; ')}.` : 'Fiabilidad baja: se confirma en el próximo corte semanal.') : ''
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden" style={{ borderLeft: `4px solid ${borde}` }}>
      <div className="px-4 pt-3 pb-3 flex gap-3">
        <div className="size-12 shrink-0 rounded-xl flex items-center justify-center" style={{ color, background: `${color}22` }} aria-hidden>
          <div className="size-8">{ICONO_GRUPO[grupo]}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-black text-white leading-tight">{m.nombre}</p>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0" style={{ color: sem.color, background: sem.fondo }}>{sem.icono}{sem.label}</span>
          </div>
          <p className="text-[13px] text-zinc-200 mt-1 leading-snug">{m.textoUsuario}</p>
          {rec && (
            <p className="text-xs font-bold mt-1.5 flex items-center gap-1" style={{ color: rec.color }}><BatteryLow size={14} /> {rec.label}</p>
          )}
          {m.accion && (
            <div className="mt-2 flex gap-2 rounded-xl bg-zinc-800/70 px-3 py-2">
              <Lightbulb size={16} className="shrink-0 mt-0.5 text-amber-300" />
              <p className="text-xs text-zinc-200 leading-snug"><b className="text-white">{tituloAccion}</b>{textoAccion ? ` ${textoAccion}` : ''}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-zinc-400">
            <Fiabilidad conf={m.confianza} />
            <span>{fmt(m.volumenSeriesSemana, 0)} series/sem</span>
            <span>{fmt(m.frecuenciaSemanal, 1)} sesiones/sem</span>
          </div>
          {motivoBaja && (
            <p className="text-[11px] text-zinc-400 mt-1">{motivoBaja}</p>
          )}
          {estancados.length > 0 && (
            <p className="text-[11px] text-amber-400/90 mt-1">
              Sin récord en las últimas {MEAM_CONFIG.no_improvement_exposures} sesiones: {estancados.map((e) => e.mejorMarca ? `${e.nombre} (a batir: ${marcaLegible(e.mejorMarca)} del ${fechaCorta(e.mejorMarca.fecha)}, mejor de las ${e.mejorMarca.nPrevias} anteriores)` : e.nombre).join('; ')}
            </p>
          )}
        </div>
      </div>
      <button onClick={onToggle} aria-expanded={abierto} aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle de ${m.nombre}`} className="w-full flex items-center justify-center gap-1 py-2 text-[11px] font-bold text-zinc-400 border-t border-zinc-800 active:bg-zinc-800">
        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} ¿Por qué?
      </button>
      {abierto && <Detalle m={m} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// «¿Por qué?» — números con su explicación en llano
// ---------------------------------------------------------------------------

function Metrica({ nombre, valor, explica }: { nombre: string; valor: React.ReactNode; explica: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-zinc-800/60 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-zinc-300 font-bold">{nombre}</span>
        <span className="text-zinc-100 tabular-nums font-bold shrink-0">{valor}</span>
      </div>
      <span className="text-[11px] text-zinc-400 leading-snug">{explica}</span>
    </div>
  )
}

function Detalle({ m }: { m: InformeMusculo }) {
  const nSem = Math.round(m.fila.evidence.span_weeks)
  const ventana = Number.isFinite(nSem) && nSem > 0 ? `las últimas ${nSem} semanas` : 'la ventana analizada'
  const tendenciaT = Math.abs(m.T) >= 1 ? 'destaca sobre el ruido' : Math.abs(m.T) >= 0.5 ? 'apunta a algo, pero aún se confunde con el ruido' : 'no se distingue del ruido'
  const recienteD = !Number.isFinite(m.D) ? 'ahora mismo no hay sesiones recientes suficientes para calcularlo' : m.D <= -1 ? 'tus últimas sesiones están claramente por debajo de lo esperado' : m.D <= -0.5 ? 'tus últimas sesiones están algo por debajo de lo esperado' : m.D >= 0.5 ? 'tus últimas sesiones están por encima de lo esperado' : 'tus últimas sesiones están a la altura de lo esperado'
  return (
    <div className="px-4 pb-4 text-[11px] text-zinc-400 flex flex-col gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Los números</p>
        <Metrica nombre="Tendencia (T)" valor={signo(m.T)} explica={`Cuántas veces la tendencia de ${ventana} supera al ruido de tus datos. Hace falta ±1 para entrar en «mejorando» o «bajando» y ±0.5 para mantenerse; ahora ${tendenciaT}.`} />
        <Metrica nombre="Últimas sesiones (D)" valor={signo(m.D)} explica={`Compara tus últimas 3 sesiones con las 6 anteriores, descontando la tendencia. Por debajo de −1 es el primer requisito de la señal de cansancio (después hace falta que persista); ${recienteD}.`} />
        <Metrica nombre="Ruido (σ)" valor={`${fmt(m.sigmaPct)} %`} explica="Cuánto varía tu rendimiento de un día a otro sin que cambie nada real (sueño, energía, cómo cuentas las repeticiones). Cuanto más bajo, antes se detectan los cambios." />
        <Metrica nombre="Inercia del ruido (ρ)" valor={`${fmt(m.rho)}${m.rhoCalibrado ? '' : ' (por defecto)'}`} explica={m.rhoCalibrado ? 'Si un día flojo tiende a arrastrar al siguiente. Medido con tus datos.' : 'Si un día flojo tiende a arrastrar al siguiente. Aún no hay sesiones suficientes para medirlo con tus datos, así que se usa un valor prudente que hace el análisis más conservador.'} />
        {m.cambioKg && <Metrica nombre={`Cambio en ${ventana}`} valor={`${signo(m.cambioKg[0], 1)} a ${signo(m.cambioKg[1], 1)} kg`} explica="Horquilla, con margen prudente, del cambio de tu fuerza estimada (1RM: lo máximo que podrías mover una vez) en este músculo a lo largo de la ventana." />}
        <Metrica nombre="Volumen" valor={`${fmt(m.volumenSeriesSemana, 0)} series/sem${Number.isFinite(m.volumenPercentil) ? ` (P${fmt(m.volumenPercentil, 0)})` : ''}`} explica={Number.isFinite(m.volumenPercentil) ? `Media de las 3 últimas semanas con sesiones de este músculo. P${fmt(m.volumenPercentil, 0)}: por encima del ${fmt(m.volumenPercentil, 0)} % de tus semanas anteriores.${m.contextoAlto ? ' Cuenta como semanas de carga alta.' : ''}` : 'Media de las 3 últimas semanas con sesiones de este músculo.'} />
        {(m.etiqueta || m.etiquetaRecuperacion || m.flags.length > 0) && (
          <div className="pt-1.5 text-[11px] text-zinc-400 flex flex-col gap-0.5">
            {m.etiqueta && <span>Etiqueta del motor: {legible(m.etiqueta)}</span>}
            {m.etiquetaRecuperacion && <span>Recuperación: {legible(m.etiquetaRecuperacion)}</span>}
            {m.flags.length > 0 && <span>Avisos: {m.flags.map(legible).join(', ')}</span>}
          </div>
        )}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Por ejercicio</p>
        <ul className="divide-y divide-zinc-800/60">
          {m.ejercicios.map((e) => <FilaEjercicio key={e.key} e={e} />)}
        </ul>
        <p className="text-[11px] text-zinc-500 mt-2">Las sesiones cuentan desde el bloque actual: un parón de más de 6 semanas o un cambio de máquina o de forma de apuntar los kilos abre un bloque nuevo, y el histórico anterior deja de compararse. «Mínimo detectable»: cambios más pequeños que ese valor se pierden dentro del ruido de ese ejercicio. Para afinar: mismo rango de repeticiones, anota el RIR de la serie fuerte y no cambies de variante.</p>
      </div>
    </div>
  )
}

function FilaEjercicio({ e }: { e: InformeEjercicio }) {
  // el icono va por T (¿destaca sobre el ruido?), no por la pendiente: una pendiente grande con T bajo sigue siendo dudosa
  const dir = e.T >= 1 ? SEMAFORO.mejora : e.T <= -1 ? SEMAFORO.baja : SEMAFORO.estable
  const claro = !Number.isFinite(e.T) ? 'sin tendencia' : Math.abs(e.T) >= 1 ? 'claro' : 'no concluyente'
  return (
    <li className="py-1.5 flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-200 font-bold truncate">{e.nombre}</span>
        <span className="inline-flex items-center gap-1 tabular-nums shrink-0" style={{ color: dir.color }}>{dir.icono}{signo(e.pendientePctSem)} %/sem</span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
        <span>T {signo(e.T)} ({claro})</span>
        <span>fuerza estimada {fmt(e.e1rmActual, 1)} kg</span>
        <span>mínimo detectable {fmt(e.mdsKgMes, 1)} kg/mes</span>
        <span>{e.nExposiciones} sesiones{e.bloqueDesde ? ` desde el ${fechaCorta(e.bloqueDesde)}` : ''} · {TIER[e.tier] ?? legible(e.tier)}</span>
        <span>{CALIDAD[e.calidadTemporal] ?? legible(e.calidadTemporal)}</span>
        {e.estrato && <span>{estratoLegible(e.estrato)}</span>}
        {Number.isFinite(e.TLong) && <span>26 semanas: T {signo(e.TLong)}</span>}
        {e.rirDisponible > 0 && <span>RIR anotado en {e.rirDisponible}</span>}
        {e.erratas > 0 && <span className="text-amber-400/80">{e.erratas} dato(s) raro(s) apartado(s)</span>}
        {e.flags.length > 0 && <span>{e.flags.map(legible).join(', ')}</span>}
      </div>
    </li>
  )
}
