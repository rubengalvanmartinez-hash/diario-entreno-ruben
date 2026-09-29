/**
 * MEAM — pantalla «Evidencia de adaptación»: estado por músculo, fiabilidad, qué hacer y «¿por qué?».
 * Pensada para gente sin formación en entrenamiento (P14): pictograma + semáforo + una frase en llano + qué hacer.
 * T, D, σ, ρ, tiers y el detalle por ejercicio viven en «¿Por qué?», cada uno con una línea que explica qué significa.
 * La parte de cálculo (worker, huella de contenido, snapshots) no cambia respecto a 2.8.0.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { calcularInforme, type MeamWorkerRequest, type MeamWorkerResponse } from '../meam/compute'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, BatteryLow, Lightbulb, Scale, Copy, Check, ListChecks } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore } from '../store/useFitLogStore'
import { useHistorialRef } from '../hooks/useHistorialRef'
import { nombreCanonico } from '../utils/normalizar'
import type { GrupoId } from '../utils/gruposMusculares'
import { ICONO_GRUPO, COLOR_GRUPO } from '../components/gruposUI'
import type { VariantOverride, MeamMuscle } from '../meam/variants'
import type { InformeMeam, InformeMusculo, InformeEjercicio, EjercicioFuera, Confianza } from '../meam/run'
import { cargarVariantesRevisadas, guardarSnapshots, guardarVarianteRevisada } from '../meam/services'
import { isoAddDays, diasEntre } from '../meam/exposure'
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

const TIER: Record<string, string> = { NONE: 'ruido sin medir', PROVISIONAL: 'ruido poco medido', ESTABLISHED: 'ruido establecido', MATURE: 'ruido maduro' }
const CALIDAD: Record<string, string> = { REGULAR: 'ritmo regular', IRREGULAR: 'ritmo irregular (huecos grandes o desiguales)', ESCASA: 'ventana corta (menos de 8 sesiones o de 8 semanas)' }

/** Tramos de una escala: el valor cae en el primer tramo cuyo `hasta` no alcanza. Los cortes son los umbrales del motor (config) o, donde no los hay, rangos orientativos. */
interface Tramo { hasta: number; label: string; color: string }
const C = { verde: '#4ade80', gris: '#a1a1aa', ambar: '#fbbf24', rojo: '#f87171', azul: '#60a5fa' }
const ESC_T: Tramo[] = [{ hasta: -MEAM_CONFIG.T_enter, label: 'bajada clara', color: C.rojo }, { hasta: -MEAM_CONFIG.T_stay, label: 'apunta a bajada, no concluyente', color: C.ambar }, { hasta: MEAM_CONFIG.T_stay, label: 'no se distingue del ruido', color: C.gris }, { hasta: MEAM_CONFIG.T_enter, label: 'apunta a mejora, no concluyente', color: C.ambar }, { hasta: Infinity, label: 'mejora clara', color: C.verde }]
const ESC_D: Tramo[] = [{ hasta: MEAM_CONFIG.D_enter, label: 'claramente por debajo: primer aviso de cansancio', color: C.rojo }, { hasta: -0.5, label: 'algo por debajo de lo esperado', color: C.ambar }, { hasta: 0.5, label: 'como se esperaba', color: C.gris }, { hasta: 1, label: 'algo por encima de lo esperado', color: C.verde }, { hasta: Infinity, label: 'claramente por encima de lo esperado', color: C.verde }]
// σ, pendiente y mínimo detectable no tienen umbral en el motor: tramos orientativos anclados en los priors (1,8 % compuestos / 2,5 % aislamiento) y en la batería dorada; pendientes de recalibrar con snapshots reales (F3)
const ESC_SIGMA: Tramo[] = [{ hasta: 1.5, label: 'muy bajo: se verían cambios pequeños', color: C.verde }, { hasta: 2.5, label: 'normal', color: C.gris }, { hasta: 4, label: 'alto: solo se ven cambios grandes', color: C.ambar }, { hasta: Infinity, label: 'muy alto: revisa cómo apuntas (reps, kilos, RIR)', color: C.rojo }]
const ESC_RHO: Tramo[] = [{ hasta: 0.15, label: 'sin inercia: cada día va por libre', color: C.verde }, { hasta: 0.3, label: 'algo de inercia', color: C.gris }, { hasta: Infinity, label: 'mucha inercia: los días flojos se encadenan', color: C.ambar }]
const ESC_VOL: Tramo[] = [{ hasta: MEAM_CONFIG.volume_very_low_percentile, label: 'muy bajo para ti', color: C.rojo }, { hasta: MEAM_CONFIG.volume_low_percentile, label: 'bajo para ti', color: C.ambar }, { hasta: MEAM_CONFIG.volume_high_percentile, label: 'normal en ti', color: C.gris }, { hasta: Infinity, label: 'alto para ti: cuenta como carga alta', color: C.azul }]
const ESC_PEND: Tramo[] = [{ hasta: -0.4, label: 'bajando rápido', color: C.rojo }, { hasta: -0.2, label: 'bajando', color: C.rojo }, { hasta: -0.05, label: 'bajando poco a poco', color: C.ambar }, { hasta: 0.05, label: 'plano', color: C.gris }, { hasta: 0.2, label: 'subiendo poco a poco', color: C.verde }, { hasta: 0.4, label: 'buen ritmo', color: C.verde }, { hasta: Infinity, label: 'subiendo rápido', color: C.verde }]
/** mínimo detectable en % de la fuerza estimada al mes */
const ESC_MDS: Tramo[] = [{ hasta: 1, label: 'fino: se verían cambios pequeños', color: C.verde }, { hasta: 1.7, label: 'normal', color: C.gris }, { hasta: 3, label: 'grueso: solo se verían cambios grandes', color: C.ambar }, { hasta: Infinity, label: 'muy grueso: solo se verían cambios muy grandes', color: C.rojo }]
/** sesiones con fuerza estimada en el bloque actual, frente a lo que necesita el motor */
const ESC_NBLOQUE: Tramo[] = [{ hasta: 3, label: 'no cuenta aún', color: C.rojo }, { hasta: MEAM_CONFIG.N_state_min, label: 'arrancando: sin tendencia hasta 8', color: C.ambar }, { hasta: MEAM_CONFIG.tier_mature, label: 'evaluable', color: C.gris }, { hasta: MEAM_CONFIG.N_state, label: 'sólido', color: C.verde }, { hasta: Infinity, label: 'ventana llena: solo cuentan las últimas 32', color: C.verde }]
/** semanas que abarca la ventana de la tendencia de un ejercicio */
const ESC_VENTANA: Tramo[] = [{ hasta: MEAM_CONFIG.state_span_min_weeks, label: 'demasiado corta', color: C.rojo }, { hasta: MEAM_CONFIG.tq_min_span_weeks, label: 'corta', color: C.ambar }, { hasta: 12, label: 'media', color: C.gris }, { hasta: Infinity, label: 'completa', color: C.verde }]
const ESC_NERR: Tramo[] = [{ hasta: 1, label: 'sin medir: se usa la media de tus ejercicios', color: C.rojo }, { hasta: MEAM_CONFIG.tier_established, label: 'pocas: se mezcla con la media de tus ejercicios', color: C.ambar }, { hasta: MEAM_CONFIG.tier_mature, label: 'establecido', color: C.gris }, { hasta: Infinity, label: 'maduro', color: C.verde }]
const tramoDe = (valor: number, tramos: Tramo[]): Tramo | null => (Number.isFinite(valor) ? (tramos.find((t) => valor < t.hasta) ?? tramos[tramos.length - 1]) : null)
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
const marcaLegible = (m: { pesoRegistrado: number; tipoCarga: 'peso' | 'ayuda' | 'lastre'; topReps: number }): string =>
  m.tipoCarga === 'ayuda' ? `${fmt(m.pesoRegistrado, 1)} kg de ayuda × ${m.topReps}` : m.tipoCarga === 'lastre' ? `${m.pesoRegistrado > 0 ? '+' : ''}${fmt(m.pesoRegistrado, 1)} kg de lastre × ${m.topReps}` : `${fmt(m.pesoRegistrado, 1)} kg × ${m.topReps}`
const signo = (x: number, d = 2): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '—')
const fechaCorta = (iso: string): string => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

/** Informe compacto en texto plano: lo mismo que enseña cada tarjeta y su «¿Por qué?» (para pegarlo en vez de capturas). */
function informeTexto(inf: InformeMeam): string {
  const L: string[] = []
  const fase = inf.faseNutricional !== 'desconocida' ? ` · ${FASE[inf.faseNutricional]} (${signo(inf.pesoPendientePctSem)} %/sem)` : ''
  L.push(`MEAM ${inf.configVersion} · semana del ${fechaCorta(inf.corte)} · hoy ${fechaCorta(inf.hoy)}${fase} · sesiones desde ${fechaCorta(inf.epoch)}`)
  if (inf.revisados.length) L.push(`Revisados: ${inf.revisados.map((r) => `${r.nombre} → ${r.retirado ? 'retirado' : `heredado por ${r.sucesorNombre}`}`).join(' · ')}`)
  for (const m of inf.musculos) {
    const nSem = Math.round(m.fila.evidence.span_weeks)
    const rec = RECUP[m.recuperacion]
    L.push('')
    L.push(`## ${m.nombre}: ${SEMAFORO[semaforoDe(m)].label} [${m.estado}${m.etiqueta ? `/${m.etiqueta}` : ''}] · fiabilidad ${FIABILIDAD[m.confianza].label}${m.motivosConfianza.length ? ` (${m.motivosConfianza.join('; ')})` : ''}`)
    L.push(`Texto: ${m.textoUsuario}`)
    if (m.motivoInconcluyente) L.push(`Por qué no se evalúa: ${m.motivoInconcluyente}`)
    if (m.ultimaSesion) L.push(`Última sesión del músculo: ${fechaCorta(m.ultimaSesion)} (${m.diasSinSesion} días antes del corte${m.diasSinSesion > 14 ? '; estado congelado desde entonces' : ''})`)
    if (rec) L.push(`Recuperación: ${rec.label} [${m.recuperacion}${m.etiquetaRecuperacion ? `/${m.etiquetaRecuperacion}` : ''}]`)
    else if (m.etiquetaRecuperacion) L.push(`Recuperación: ${legible(m.etiquetaRecuperacion)} [${m.etiquetaRecuperacion}]`)
    if (m.accion) L.push(`Acción: ${m.accion}`)
    const z = (t: Tramo | null): string => (t ? ` [${t.label}]` : '')
    L.push(`T ${signo(m.T)}${z(tramoDe(m.T, ESC_T))} · D ${signo(m.D)}${z(tramoDe(m.D, ESC_D))} · σ ${fmt(m.sigmaPct)} %${z(tramoDe(m.sigmaPct, ESC_SIGMA))} · ρ ${fmt(m.rho)}${m.rhoCalibrado ? '' : ' (por defecto)'}${z(tramoDe(m.rho, ESC_RHO))} · ventana ${Number.isFinite(nSem) ? nSem : '—'} sem · cambio ${m.cambioKg ? `${signo(m.cambioKg[0], 1)} a ${signo(m.cambioKg[1], 1)} kg [${m.cambioKg[0] > 0 ? 'subida clara' : m.cambioKg[1] < 0 ? 'bajada clara' : 'incluye 0'}]` : '—'}`)
    L.push(`Volumen ${fmt(m.volumenSeriesSemana, 0)} series/sem${Number.isFinite(m.volumenPercentil) ? ` (P${fmt(m.volumenPercentil, 0)})${z(tramoDe(m.volumenPercentil, ESC_VOL))}` : ''}${m.contextoAlto ? ' · carga alta' : ''} · ${fmt(m.frecuenciaSemanal, 1)} sesiones/sem · ${m.nExposicionesTotal} exposiciones`)
    if (m.flags.length) L.push(`Avisos: ${m.flags.map((f) => `${legible(f)} [${f}]`).join(', ')}`)
    for (const e of m.ejercicios) {
      const p: string[] = [
        `T ${signo(e.T)}${z(tramoDe(e.T, ESC_T))}`, `${signo(e.pendientePctSem)} %/sem${z(tramoDe(e.pendientePctSem, ESC_PEND))}`, `e1RM ${fmt(e.e1rmActual, 1)} kg`,
        `mín. detectable ${fmt(e.mdsKgMes, 1)} kg/mes (≈ ${fmt(e.mdsPctMes, 1)} %/mes)${z(tramoDe(e.mdsPctMes, ESC_MDS))}`,
        `sesiones: ${textoSesiones(e)}`, `ruido con ${e.nErr} sesiones (${TIER[e.tier] ?? legible(e.tier)})${z(tramoDe(e.nErr, ESC_NERR))}`,
        `${CALIDAD[e.calidadTemporal] ?? legible(e.calidadTemporal)}${Number.isFinite(e.spanSemanas) && e.spanSemanas > 0 ? ` (ventana ${fmt(e.spanSemanas, 0)} sem: ${tramoDe(e.spanSemanas, ESC_VENTANA)?.label ?? ''})` : ''} [${e.calidadTemporal}]`,
      ]
      if (e.estrato) p.push(estratoLegible(e.estrato))
      if (Number.isFinite(e.TLong)) p.push(`T26 ${signo(e.TLong)}`)
      if (e.rirDisponible > 0) p.push(`RIR en ${e.rirDisponible}`)
      if (e.ultimaFecha) p.push(`última ${fechaCorta(e.ultimaFecha)} (hace ${e.diasDesdeUltima} días${e.diasDesdeUltima > MEAM_CONFIG.gap_segment_reset_days ? ': ABANDONADO, sigue contando con sus números de entonces' : ''})`)
      if (e.interrupcionReciente) p.push('PARÓN RECIENTE: bloquea la evaluación del músculo')
      if (e.heredaDe.length) p.push(`hereda ${e.heredaDe.join(', ')}`)
      if (e.mejorMarca) p.push(`${e.sinMejoraEn6 ? `SIN RÉCORD EN ${MEAM_CONFIG.no_improvement_exposures}` : 'con récord'}; a batir ${marcaLegible(e.mejorMarca)} del ${fechaCorta(e.mejorMarca.fecha)} (mejor de ${e.mejorMarca.nPrevias})`)
      if (e.erratasDetalle.length) p.push(`apartados: ${e.erratasDetalle.map((x) => `${fechaCorta(x.fecha)} ${marcaLegible({ pesoRegistrado: x.pesoRegistrado, tipoCarga: x.tipoCarga, topReps: x.topReps })} → e1RM ${fmt(x.e1rm, 0)}${x.esperado !== null ? ` (esperado ≈ ${fmt(x.esperado, 0)})` : ''}`).join('; ')}`)
      if (e.flags.length) p.push(`avisos: ${e.flags.map((f) => `${legible(f)} [${f}]`).join(', ')}`)
      L.push(`- ${e.nombre} (${e.cluster}/${e.role}): ${p.join(' · ')}`)
    }
    for (const e of m.ejerciciosFuera) L.push(`- ${e.nombre} (sin evaluar): ${textoFuera(e)}`)
  }
  for (const g of inf.musculosSinTarjeta) { L.push(''); L.push(`## ${g.nombre}: SIN TARJETA (ningún ejercicio llega a 3 sesiones con fuerza estimada)`); for (const e of g.ejercicios) L.push(`- ${e.nombre}: ${textoFuera(e)}`) }
  if (inf.nombresSinMapa.length) { L.push(''); L.push(`Sin músculo asignado: ${inf.nombresSinMapa.join(' · ')}`) }
  return L.join('\n')
}

/** Portapapeles con respaldo para navegadores sin API asíncrona o fuera de contexto seguro. */
async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch { /* respaldo abajo */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch { return false }
}

// ---------------------------------------------------------------------------
// Periodos: «Analizar desde» (qué sesiones entran al motor) y «Resumen del periodo» (descriptivo, sobre lo ya calculado)
// ---------------------------------------------------------------------------

type Desde = '3m' | '6m' | '1a' | 'todo'
type Periodo = '1m' | '3m' | '6m' | '1a' | 'todo'
const DIAS: Record<Exclude<Periodo, 'todo'>, number> = { '1m': 30, '3m': 91, '6m': 182, '1a': 365 }
const ETIQ: Record<Periodo, string> = { '1m': '1 mes', '3m': '3 meses', '6m': '6 meses', '1a': '1 año', todo: 'todo' }
const inicioDe = (p: Periodo | Desde, hoy: string): string => (p === 'todo' ? '' : isoAddDays(hoy, -DIAS[p]))
function leerPref<T extends string>(clave: string, validos: readonly T[], porDefecto: T): T {
  try { const v = localStorage.getItem(clave); return v && (validos as readonly string[]).includes(v) ? (v as T) : porDefecto } catch { return porDefecto }
}
function guardarPref(clave: string, v: string): void { try { localStorage.setItem(clave, v) } catch { /* sin almacenamiento */ } }

function Chips<T extends string>({ opciones, valor, onChange, etiqueta }: { opciones: readonly T[]; valor: T; onChange: (v: T) => void; etiqueta: string }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-zinc-500 mr-0.5">{etiqueta}</span>
      {opciones.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${valor === o ? 'bg-white text-zinc-900' : 'bg-zinc-800 text-zinc-300 active:bg-zinc-700'}`}>{ETIQ[o as Periodo]}</button>
      ))}
    </div>
  )
}

/** Resumen descriptivo del periodo con lo ya calculado: semáforo semana a semana, fuerza estimada primera→última y mejor marca por ejercicio, volumen. No es el motor. */
function ResumenPeriodo({ m, periodo, epoch, hoy }: { m: InformeMusculo; periodo: Periodo; epoch: string; hoy: string }) {
  const inicio = inicioDe(periodo, hoy)
  const filas = m.historial.filter((r) => isoAddDays(epoch, r.week * 7) >= inicio)
  const cuenta: Record<Semaforo, number> = { mejora: 0, estable: 0, baja: 0, regresion: 0, sin_datos: 0 }
  for (const r of filas) cuenta[semaforoDe({ estado: r.adaptation } as InformeMusculo)]++
  const semanasVol = m.volumenSemanal.filter((s) => s.lunes >= inicio && s.series > 0)
  const volMedio = semanasVol.length ? semanasVol.reduce((a, s) => a + s.series, 0) / semanasVol.length : NaN
  const ruido = Number.isFinite(m.sigmaPct) ? m.sigmaPct : NaN
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Resumen del periodo ({ETIQ[periodo]})</p>
      {filas.length === 0 ? <p className="text-[11px] text-zinc-500">Sin cortes semanales en este periodo.</p> : (
        <>
          <div className="flex flex-wrap gap-0.5 mb-1" aria-label="Estado semana a semana">
            {filas.map((r) => { const s = SEMAFORO[semaforoDe({ estado: r.adaptation } as InformeMusculo)]; const fecha = isoAddDays(epoch, r.week * 7); return <span key={r.week} title={`${fechaCorta(fecha)}: ${s.label}${r.recovery !== 'NORMAL' ? ` · ${legible(r.recovery)}` : ''}`} className="size-3 rounded-sm" style={{ background: s.color, opacity: 0.85, outline: r.recovery === 'FATIGA_SOSPECHADA' || r.recovery === 'NO_ATRIBUIDA' ? `2px solid ${RECUP[r.recovery]?.color ?? C.rojo}` : undefined, outlineOffset: -1 }} /> })}
          </div>
          <p className="text-[11px] text-zinc-400">{filas.length} semanas: {(['mejora', 'estable', 'baja', 'regresion', 'sin_datos'] as Semaforo[]).filter((k) => cuenta[k] > 0).map((k) => `${cuenta[k]} ${SEMAFORO[k].label.toLowerCase()}`).join(' · ')}{Number.isFinite(volMedio) ? ` · volumen ${fmt(volMedio, 0)} series/sem en ${semanasVol.length} semanas con sesión` : ''}</p>
        </>
      )}
      <ul className="mt-1.5 flex flex-col gap-1">
        {m.ejercicios.map((e) => {
          const pts = e.serie.filter((x) => x.fecha >= inicio && x.tipo === 'normal')
          if (pts.length < 2) return <li key={e.key} className="text-[11px] text-zinc-500"><span className="text-zinc-300 font-bold">{e.nombre}</span>: {pts.length} sesión{pts.length === 1 ? '' : 'es'} normal{pts.length === 1 ? '' : 'es'} en el periodo.</li>
          const a = pts[0], b = pts[pts.length - 1]
          let mejor = pts[0]; for (const x of pts) if (x.e1rm > mejor.e1rm) mejor = x
          const dPct = (b.e1rm / a.e1rm - 1) * 100
          const veredicto = Number.isFinite(ruido) && Math.abs(dPct) < 2 * ruido ? 'dentro del ruido' : dPct > 0 ? 'por encima del ruido' : 'por debajo del ruido'
          return (
            <li key={e.key} className="text-[11px] text-zinc-400">
              <span className="text-zinc-300 font-bold">{e.nombre}</span>{e.heredaDe.length ? <span className="text-zinc-500"> (incluye {e.heredaDe.join(', ')})</span> : null}: {pts.length} sesiones · fuerza estimada {fmt(a.e1rm, 1)} → {fmt(b.e1rm, 1)} kg ({signo(dPct, 1)} %, {veredicto}) · mejor {fmt(mejor.e1rm, 1)} kg el {fechaCorta(mejor.fecha)}
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-zinc-500 mt-1.5">Descriptivo: compara la primera y la última sesión normal del periodo y la mejor marca; el estado del motor sale solo de las últimas 16 semanas. Con ruido σ = {fmt(ruido, 1)} %, una diferencia menor de {fmt(2 * ruido, 1)} % no es distinguible del azar.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revisión de ejercicios sin uso: retirar, heredar («sucesor de») o seguir usándolo. Manual: la app solo propone.
// ---------------------------------------------------------------------------

const DIAS_SIN_USO = 7 * MEAM_CONFIG.state_span_max_weeks

type Candidato = InformeMeam['variantes'][number] & { sugerido: InformeMeam['variantes'][number] | null; activos: InformeMeam['variantes'][number][] }

function candidatosRevision(inf: InformeMeam, overrides: readonly VariantOverride[], hoy: string): Candidato[] {
  const ov = new Map(overrides.map((o) => [o.ejercicio, o]))
  const activos = inf.variantes.filter((v) => diasEntre(v.ultimaFecha, hoy) <= DIAS_SIN_USO)
  return inf.variantes
    .filter((v) => v.meta.musculo !== 'otros' && diasEntre(v.ultimaFecha, hoy) > DIAS_SIN_USO)
    .filter((v) => { const r = ov.get(v.key)?.revisado_en; return !(r && diasEntre(r, hoy) <= DIAS_SIN_USO) })
    .map((v) => {
      const mismos = activos.filter((w) => w.meta.musculo === v.meta.musculo && w.key !== v.key)
      // sugerencia: empezó entre 1 semana antes y 4 después de la última sesión del viejo (relevo sin solaparse)
      const sug = mismos.filter((w) => w.primeraFecha >= isoAddDays(v.ultimaFecha, -7) && w.primeraFecha <= isoAddDays(v.ultimaFecha, 28)).sort((a, b) => a.primeraFecha.localeCompare(b.primeraFecha))[0] ?? null
      return { ...v, sugerido: sug, activos: mismos }
    })
    .sort((a, b) => b.nRegistros - a.nRegistros)
}

function RevisionEjercicios({ candidatos, hoy, onGuardar }: { candidatos: Candidato[]; hoy: string; onGuardar: (o: VariantOverride) => Promise<boolean> }) {
  const [i, setI] = useState(0)
  const [otro, setOtro] = useState('')
  const [aviso, setAviso] = useState('')
  const c = candidatos[Math.min(i, candidatos.length - 1)]
  if (!c) return <p className="text-xs text-zinc-400">No queda nada por revisar.</p>
  const base = (extra: Partial<VariantOverride>): VariantOverride => ({
    ejercicio: c.key, musculo: c.meta.musculo, cluster: c.meta.cluster, role: c.meta.role, equipment: c.meta.equipment, es_asistencia: c.meta.esAsistencia, aislamiento: c.meta.aislamiento,
    retirado: false, sucesor: null, revisado_en: hoy, ...extra,
  })
  const decidir = async (o: VariantOverride) => {
    setAviso('')
    const ok = await onGuardar(o)
    if (!ok) setAviso('Aplicado en esta sesión, pero no se ha podido guardar: falta ejecutar supabase_v2.8.2_meam.sql.')
    setOtro('')
  }
  return (
    <div className="flex flex-col gap-2 text-xs text-zinc-300">
      <p className="text-[11px] text-zinc-500">{candidatos.length} ejercicio{candidatos.length === 1 ? '' : 's'} sin sesión en más de {MEAM_CONFIG.state_span_max_weeks} semanas. Mientras sigan activos cuentan en su músculo con los números de entonces.</p>
      <p><b className="text-white">{c.nombre}</b> · última sesión {fechaCorta(c.ultimaFecha)} ({diasEntre(c.ultimaFecha, hoy)} días) · {c.nRegistros} sesiones desde {fechaCorta(c.primeraFecha)}</p>
      {c.sugerido && <p className="text-zinc-400">Parece sustituido por <b className="text-zinc-200">{c.sugerido.nombre}</b> (mismo músculo, empezó el {fechaCorta(c.sugerido.primeraFecha)}).</p>}
      <div className="flex flex-wrap gap-1.5">
        {c.sugerido && <button onClick={() => decidir(base({ sucesor: c.sugerido!.key }))} className="rounded-full px-3 py-1.5 text-[11px] font-bold bg-green-500/15 text-green-300 active:bg-green-500/30">La hereda «{c.sugerido.nombre}»</button>}
        <button onClick={() => decidir(base({ retirado: true }))} className="rounded-full px-3 py-1.5 text-[11px] font-bold bg-zinc-800 text-zinc-200 active:bg-zinc-700">Retirar sin heredero</button>
        <button onClick={() => decidir(base({}))} className="rounded-full px-3 py-1.5 text-[11px] font-bold bg-zinc-800 text-zinc-200 active:bg-zinc-700">Sigo usándolo</button>
        <button onClick={() => setI((k) => (k + 1) % candidatos.length)} className="rounded-full px-3 py-1.5 text-[11px] font-bold text-zinc-400 active:bg-zinc-800">Saltar</button>
      </div>
      {c.activos.length > 0 && (
        <div className="flex items-center gap-2">
          <select value={otro} onChange={(ev) => setOtro(ev.target.value)} className="flex-1 min-w-0 bg-zinc-800 text-zinc-200 text-[11px] rounded-lg px-2 py-1.5">
            <option value="">Otro heredero…</option>
            {c.activos.map((w) => <option key={w.key} value={w.key}>{w.nombre} (desde {fechaCorta(w.primeraFecha)})</option>)}
          </select>
          <button disabled={!otro} onClick={() => decidir(base({ sucesor: otro }))} className="rounded-full px-3 py-1.5 text-[11px] font-bold bg-zinc-800 text-zinc-200 disabled:opacity-40 active:bg-zinc-700">Heredar</button>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Heredar: las dos pasan a ser un solo ejercicio para el motor, con bloque nuevo desde la primera sesión del heredero (no se mezclan kilos de máquinas distintas). Elige un heredero que empezara después de dejar el viejo: si se solapan en el tiempo, sus kilos se mezclarían en el mismo bloque. Retirar: sale del cálculo. Sigo usándolo: no vuelve a preguntar hasta dentro de {MEAM_CONFIG.state_span_max_weeks} semanas.</p>
      {aviso && <p className="text-[11px] text-amber-400">{aviso}</p>}
    </div>
  )
}

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
  const [copiado, setCopiado] = useState<'ok' | 'error' | null>(null)
  const [desde, setDesde] = useState<Desde>(() => leerPref('meam.desde', ['3m', '6m', '1a', 'todo'] as const, 'todo'))
  const [periodo, setPeriodo] = useState<Periodo>(() => leerPref('meam.periodo', ['1m', '3m', '6m', '1a', 'todo'] as const, '3m'))
  const [revisando, setRevisando] = useState(false)
  const hoyIso = new Date().toISOString().slice(0, 10)
  // «Analizar desde»: solo entran al motor las sesiones desde esa fecha (los nombres, para el mapa, salen de todo el historial)
  const inicioAnalisis = inicioDe(desde, hoyIso)
  const historialAnalizado = useMemo(() => (inicioAnalisis ? historial.filter((s) => s.fecha >= inicioAnalisis) : historial), [historial, inicioAnalisis])
  const guardadoRef = useRef<string>('')
  const workerRef = useRef<Worker | null>(null)
  const reqIdRef = useRef(0)
  const huellaRef = useRef('')
  const ultimaReqRef = useRef<MeamWorkerRequest | null>(null)

  useEffect(() => { cargarVariantesRevisadas().then(setOverrides).catch(() => setOverrides([])) }, [])

  // Huella de CONTENIDO del historial (no de referencia): el pull cada 5 s crea arrays nuevos con los mismos datos (auditoría 6, C1)
  const huella = useMemo(() => {
    const partes: string[] = []
    partes.push(`D:${inicioAnalisis}`)
    for (const s of historialAnalizado) partes.push(`${s.id}|${s.fecha}|${s.tipoSesion ?? ''}|${s.gimnasio ?? ''}|${s.ejercicios.map((e) => `${e.nombreSustituido ?? e.nombreSnapshot}:${e.series.map((x) => `${x.reps}/${x.pesoKg}/${x.etiqueta ?? ''}`).join(',')}`).join(';')}`)
    partes.push(`P:${registrosPeso.map((p) => `${p.fecha}=${p.pesoKg}`).join(',')}`)
    partes.push(`E:${ejercicios.map((e) => `${e.nombre}${e.esAsistencia ? '*' : ''}`).join(',')}`)
    partes.push(`O:${JSON.stringify(overrides ?? [])}`)
    return partes.join('\n')
  }, [historialAnalizado, inicioAnalisis, registrosPeso, ejercicios, overrides])

  useEffect(() => {
    if (overrides === null) return
    if (huella === huellaRef.current) return
    huellaRef.current = huella
    const nombres = new Set<string>()
    for (const s of historial) for (const e of s.ejercicios) nombres.add(e.nombreSustituido ?? e.nombreSnapshot)
    for (const e of ejercicios) nombres.add(e.nombre)
    const asistencia = [...new Set(ejercicios.filter((e) => e.esAsistencia).map((e) => nombreCanonico(e.nombre)))]
    const req: MeamWorkerRequest = { id: ++reqIdRef.current, sesiones: historialAnalizado, pesos: registrosPeso, nombres: [...nombres], overrides, asistencia }
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
  }, [huella, historial, historialAnalizado, registrosPeso, ejercicios, overrides])

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  // snapshots append-only: una vez por corte y sesión de la app (idempotente por input_hash)
  useEffect(() => {
    if (!informe || informe.musculos.length === 0 || inicioAnalisis) return   // con «Analizar desde» acotado no se guardan snapshots (serían de otro análisis)
    const clave = `${informe.corte}|${informe.musculos.map((m) => m.inputHash).join(',')}`
    if (guardadoRef.current === clave) return
    guardadoRef.current = clave
    guardarSnapshots(informe).then((n) => { if (n > 0) console.log(`[MEAM] ${n} snapshots guardados (${informe.corte})`) })
  }, [informe, inicioAnalisis])

  const candidatos = useMemo(() => (informe && overrides ? candidatosRevision(informe, overrides, hoyIso) : []), [informe, overrides, hoyIso])
  const guardarRevision = async (o: VariantOverride): Promise<boolean> => {
    const ok = await guardarVarianteRevisada(o)
    // se aplica en la sesión aunque no se haya podido guardar (el recálculo sale de `overrides`)
    setOverrides((prev) => [...(prev ?? []).filter((x) => x.ejercicio !== o.ejercicio), o])
    return ok
  }

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
            {calculando ? 'Calculando…' : informe ? `Semana del ${fechaCorta(informe.corte)} · ${inicioAnalisis ? `sesiones desde el ${fechaCorta(inicioAnalisis)}` : 'con todas las sesiones anteriores'}` : 'Sin datos'}
          </p>
        </div>
        {informe && !calculando && informe.musculos.length > 0 && (
          <button onClick={() => { copiarTexto(informeTexto(informe)).then((ok) => { setCopiado(ok ? 'ok' : 'error'); setTimeout(() => setCopiado(null), 2000) }) }}
            aria-label="Copiar informe" title="Copiar informe"
            className={`h-9 px-2.5 flex items-center gap-1 rounded-xl text-[11px] font-bold active:bg-zinc-800 ${copiado === 'ok' ? 'text-green-400' : copiado === 'error' ? 'text-red-400' : 'text-zinc-400'}`}>
            {copiado === 'ok' ? <Check size={16} /> : <Copy size={16} />}{copiado === 'ok' ? 'Copiado' : copiado === 'error' ? 'Error' : 'Copiar informe'}
          </button>
        )}
        <button onClick={() => setAyuda((v) => !v)} aria-expanded={ayuda} aria-label="Cómo leer esta pantalla"
          className={`size-9 flex items-center justify-center rounded-xl active:bg-zinc-800 ${ayuda ? 'text-white bg-zinc-800' : 'text-zinc-400'}`}>
          <HelpCircle size={20} />
        </button>
      </div>

      <div className="mx-4 mb-3 flex flex-col gap-1.5">
        <Chips etiqueta="Analizar desde" opciones={['3m', '6m', '1a', 'todo'] as const} valor={desde} onChange={(v) => { setDesde(v); guardarPref('meam.desde', v) }} />
        <Chips etiqueta="Resumen del periodo" opciones={['1m', '3m', '6m', '1a', 'todo'] as const} valor={periodo} onChange={(v) => { setPeriodo(v); guardarPref('meam.periodo', v) }} />
        {inicioAnalisis && historialAnalizado.length > 0 && diasEntre(historialAnalizado[0].fecha, hoyIso) < 7 * (MEAM_CONFIG.state_span_min_weeks + 1) && (
          <p className="text-[11px] text-amber-400">Con menos de {MEAM_CONFIG.state_span_min_weeks + 1} semanas de sesiones el motor no puede evaluar nada: amplía el periodo.</p>
        )}
      </div>

      {!calculando && informe && (candidatos.length > 0 || informe.revisados.length > 0) && (
        <div className="mx-4 mb-3 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <button onClick={() => setRevisando((v) => !v)} aria-expanded={revisando} className="w-full flex items-center gap-2 px-4 py-2.5 text-left active:bg-zinc-800">
            <ListChecks size={16} className="text-amber-300 shrink-0" />
            <span className="text-xs font-bold text-white flex-1">Revisar ejercicios{candidatos.length > 0 ? ` · ${candidatos.length} sin uso` : ''}</span>
            {revisando ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
          </button>
          {revisando && (
            <div className="px-4 pb-3 flex flex-col gap-2">
              <RevisionEjercicios candidatos={candidatos} hoy={hoyIso} onGuardar={guardarRevision} />
              {informe.revisados.length > 0 && (
                <p className="text-[11px] text-zinc-500">Ya revisados: {informe.revisados.map((r) => `${r.nombre} → ${r.retirado ? 'retirado' : `heredado por ${r.sucesorNombre}`}`).join(' · ')}. Para deshacer, edita la fila en meam_variants (pantalla de edición pendiente).</p>
              )}
            </div>
          )}
        </div>
      )}

      {ayuda && (
        <div className="mx-4 mb-3 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-xs text-zinc-300 leading-relaxed flex flex-col gap-2">
          <p><b className="text-white">Qué mira:</b> para cada músculo, si tu fuerza estimada (a partir del peso y las repeticiones de tu mejor serie en cada ejercicio) sube, baja o se mantiene a lo largo de las últimas semanas (hasta 16). No mide el músculo en sí, mide lo que rindes.</p>
          <p><b className="text-white">Colores:</b> <span style={{ color: SEMAFORO.mejora.color }}>verde</span> mejorando · <span style={{ color: SEMAFORO.estable.color }}>gris</span> estable · <span style={{ color: SEMAFORO.baja.color }}>ámbar</span> bajando · <span style={{ color: SEMAFORO.regresion.color }}>rojo</span> bajada confirmada varias veces.</p>
          <p><b className="text-white">Fiabilidad:</b> cuánto puedes fiarte de ese color. Baja cuando vienes de un parón, cuando los ejercicios de un músculo se contradicen o cuando aún hay pocas sesiones. Se actualiza cada lunes con las sesiones ya apuntadas.</p>
          <p><b className="text-white">Bloques:</b> cada ejercicio se evalúa dentro de su bloque actual. Un parón de más de {MEAM_CONFIG.gap_segment_reset_days} días o un cambio de nivel (otra máquina, kilos por lado…) abre un bloque nuevo y lo anterior deja de compararse: por eso un ejercicio con mucho historial puede salir con pocas sesiones. En «¿Por qué?» se ve cuántas sesiones tiene registradas, cuántas cuentan y por qué.</p>
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
          <TarjetaMusculo key={m.musculo} m={m} abierto={abierto === m.musculo} onToggle={() => setAbierto(abierto === m.musculo ? null : m.musculo)} periodo={periodo} epoch={informe.epoch} hoy={hoyIso} />
        ))}
      </div>

      {informe && !calculando && informe.musculosSinTarjeta.length > 0 && (
        <div className="mx-4 mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Sin tarjeta todavía</p>
          <p className="text-xs text-zinc-400 mt-1">Músculos con ejercicios registrados pero sin ninguno que llegue a 3 sesiones con fuerza estimada.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {informe.musculosSinTarjeta.map((g) => (
              <li key={g.musculo} className="text-[11px] text-zinc-400"><span className="text-zinc-200 font-bold">{g.nombre}</span>: {g.ejercicios.map((e) => `${e.nombre} (${textoFuera(e).replace(/\.$/, '')})`).join('; ')}</li>
            ))}
          </ul>
        </div>
      )}

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

function TarjetaMusculo({ m, abierto, onToggle, periodo, epoch, hoy }: { m: InformeMusculo; abierto: boolean; onToggle: () => void; periodo: Periodo; epoch: string; hoy: string }) {
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
          {m.diasSinSesion > 14 && m.ultimaSesion && (
            <p className="text-[11px] text-amber-400/90 mt-1">Última sesión de este músculo el {fechaCorta(m.ultimaSesion)} ({m.diasSinSesion} días antes del corte): el estado y sus números son los de entonces; no se actualizan hasta que vuelvas a entrenarlo.</p>
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
      {abierto && <Detalle m={m} periodo={periodo} epoch={epoch} hoy={hoy} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// «¿Por qué?» — números con su explicación en llano y una escala con tramos
// ---------------------------------------------------------------------------

function Metrica({ nombre, valor, explica, zona, escala }: { nombre: string; valor: React.ReactNode; explica: string; zona?: Tramo | null; escala?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-zinc-800/60 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-zinc-300 font-bold">{nombre}</span>
        <span className="text-zinc-100 tabular-nums font-bold shrink-0">{valor}</span>
      </div>
      {zona && <span className="text-[11px] font-bold" style={{ color: zona.color }}>{zona.label}</span>}
      {escala}
      <span className="text-[11px] text-zinc-400 leading-snug">{explica}</span>
    </div>
  )
}

/** Barra por tramos con el valor marcado: sitúa el número en una escala con etiquetas en llano; los cortes son los umbrales del motor. */
function Escala({ valor, min, max, tramos, fmtCorte }: { valor: number; min: number; max: number; tramos: Tramo[]; fmtCorte?: (x: number) => string }) {
  const f = fmtCorte ?? ((x: number) => String(x))
  const pos = (x: number): string => `${(100 * (Math.min(max, Math.max(min, x)) - min)) / (max - min)}%`
  // anchura de cada tramo dentro de [min, max]
  const anchos = tramos.map((t, i) => Math.max(0, Math.min(max, t.hasta) - (i === 0 ? min : Math.min(max, Math.max(min, tramos[i - 1].hasta)))))
  return (
    <div className="mt-1 mb-0.5">
      <div className="relative h-1.5 rounded-full overflow-visible flex">
        {tramos.map((t, i) => <div key={i} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(100 * anchos[i]) / (max - min)}%`, background: t.color, opacity: 0.5 }} />)}
        {Number.isFinite(valor) && <span className="absolute top-1/2 size-3 rounded-full bg-white border-2 border-zinc-900 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(valor) }} aria-hidden />}
      </div>
      <div className="relative h-3 text-[9px] text-zinc-500 tabular-nums">
        {tramos.slice(0, -1).filter((t) => t.hasta > min && t.hasta < max).map((t, i) => <span key={i} className="absolute -translate-x-1/2" style={{ left: pos(t.hasta) }}>{f(t.hasta)}</span>)}
      </div>
    </div>
  )
}

function Detalle({ m, periodo, epoch, hoy }: { m: InformeMusculo; periodo: Periodo; epoch: string; hoy: string }) {
  const nSem = Math.round(m.fila.evidence.span_weeks)
  const ventana = Number.isFinite(nSem) && nSem > 0 ? `las últimas ${nSem} semanas` : 'la ventana analizada'
  const mu = m.fila.evidence.muscle
  const cambioPct: [number, number] | null = mu && Number.isFinite(mu.change_lower) ? [(Math.exp(mu.change_lower) - 1) * 100, (Math.exp(mu.change_upper) - 1) * 100] : null
  const ancha = cambioPct && cambioPct[1] - cambioPct[0] > 10 ? ' (horquilla muy ancha: mucho ruido o pocas sesiones)' : ''
  const zonaCambio: Tramo | null = m.cambioKg ? (m.cambioKg[0] > 0 ? { hasta: 0, label: `subida segura: hasta el peor caso de la horquilla es positivo${ancha}`, color: C.verde } : m.cambioKg[1] < 0 ? { hasta: 0, label: `bajada segura: hasta el mejor caso de la horquilla es negativo${ancha}`, color: C.rojo } : { hasta: 0, label: `la horquilla incluye el 0: no se puede afirmar cambio${ancha}`, color: C.gris }) : null
  const zonaVol = Number.isFinite(m.volumenPercentil) ? tramoDe(m.volumenPercentil, ESC_VOL) : null
  return (
    <div className="px-4 pb-4 text-[11px] text-zinc-400 flex flex-col gap-3">
      {m.motivoInconcluyente && (
        <p className="text-[11px] text-zinc-200 bg-zinc-800/70 rounded-xl px-3 py-2 leading-snug"><b className="text-white">Por qué no se evalúa:</b> {m.motivoInconcluyente}</p>
      )}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Los números</p>
        <Metrica nombre="Tendencia (T)" valor={signo(m.T)} zona={tramoDe(m.T, ESC_T)} escala={<Escala valor={m.T} min={-3} max={3} tramos={ESC_T} />}
          explica={`Cuántas veces la tendencia de ${ventana} supera al ruido de tus datos. Umbrales del motor: ±0.5 para mantenerse en «mejorando»/«bajando» y ±1 para entrar; por encima de 3 ya no cambia nada.`} />
        <Metrica nombre="Últimas sesiones (D)" valor={signo(m.D)} zona={Number.isFinite(m.D) ? tramoDe(m.D, ESC_D) : { hasta: 0, label: 'no calculable ahora: faltan sesiones recientes o de base en el mismo rango de reps', color: C.gris }} escala={<Escala valor={m.D} min={-3} max={3} tramos={ESC_D} />}
          explica="Compara tus últimas 3 sesiones con las 6 anteriores, descontando la tendencia y en unidades de ruido. Por debajo de −1 es el primer requisito de la señal de cansancio (después hace falta que persista y que lo apoyen otro ejercicio o una carga alta)." />
        <Metrica nombre="Ruido (σ)" valor={`${fmt(m.sigmaPct)} %`} zona={tramoDe(m.sigmaPct, ESC_SIGMA)} escala={<Escala valor={m.sigmaPct} min={0} max={8} tramos={ESC_SIGMA} fmtCorte={(x) => `${x} %`} />}
          explica="Cuánto varía tu fuerza estimada de un día a otro sin que cambie nada real (sueño, energía, cómo cuentas las repeticiones). Con pocas sesiones se mezcla con la media de tus ejercicios. Cuanto más bajo, antes se detectan los cambios." />
        <Metrica nombre="Inercia del ruido (ρ)" valor={`${fmt(m.rho)}${m.rhoCalibrado ? '' : ' (por defecto)'}`} zona={m.rhoCalibrado ? tramoDe(m.rho, ESC_RHO) : null} escala={m.rhoCalibrado ? <Escala valor={m.rho} min={0} max={0.6} tramos={ESC_RHO} /> : undefined}
          explica={m.rhoCalibrado ? 'Si un día flojo tiende a arrastrar al siguiente (0 = nada, 0.6 = tope). Medido con tus datos.' : 'Si un día flojo tiende a arrastrar al siguiente (0 = nada, 0.6 = tope). Aún no se puede medir con tus datos (hacen falta 3 ejercicios con 20 sesiones normales en 16 semanas), así que se usa 0.3, un valor prudente que hace el análisis más conservador y veta la fiabilidad «alta».'} />
        {m.cambioKg && <Metrica nombre={`Cambio en ${ventana}`} valor={`${signo(m.cambioKg[0], 1)} a ${signo(m.cambioKg[1], 1)} kg`} zona={zonaCambio}
          explica={`Horquilla, con margen prudente, del cambio de tu fuerza estimada (1RM) en este músculo a lo largo de la ventana${cambioPct ? ` (${signo(cambioPct[0], 1)} % a ${signo(cambioPct[1], 1)} %)` : ''}. Se lee por sus extremos: si los dos tienen el mismo signo, el cambio es seguro.`} />}
        <Metrica nombre="Volumen" valor={`${fmt(m.volumenSeriesSemana, 0)} series/sem${Number.isFinite(m.volumenPercentil) ? ` (P${fmt(m.volumenPercentil, 0)})` : ''}`} zona={zonaVol}
          escala={Number.isFinite(m.volumenPercentil) ? <Escala valor={m.volumenPercentil} min={0} max={100} tramos={ESC_VOL} fmtCorte={(x) => `P${x}`} /> : undefined}
          explica={Number.isFinite(m.volumenPercentil) ? `Media de las 3 últimas semanas con sesiones de este músculo, comparada contigo mismo: P${fmt(m.volumenPercentil, 0)} = por encima del ${fmt(m.volumenPercentil, 0)} % de tus semanas anteriores. Por debajo de P40 cuenta como poco volumen para ti; desde P70, como carga alta.${m.contextoAlto ? ' Ahora cuenta como carga alta.' : ''}` : 'Media de las 3 últimas semanas con sesiones de este músculo. Con menos de 4 semanas de histórico no se puede comparar contigo mismo.'} />
        <Metrica nombre="Frecuencia" valor={`${fmt(m.frecuenciaSemanal, 1)} sesiones/sem`} explica="Sesiones distintas con este músculo por semana, media de las 3 últimas semanas completas." />
        {(m.etiqueta || m.etiquetaRecuperacion || m.flags.length > 0) && (
          <div className="pt-1.5 text-[11px] text-zinc-400 flex flex-col gap-0.5">
            {m.etiqueta && <span>Etiqueta del motor: {legible(m.etiqueta)}</span>}
            {m.etiquetaRecuperacion && <span>Recuperación: {legible(m.etiquetaRecuperacion)}</span>}
            {m.flags.length > 0 && <span>Avisos: {m.flags.map(legible).join(', ')}</span>}
          </div>
        )}
      </div>
      <ResumenPeriodo m={m} periodo={periodo} epoch={epoch} hoy={hoy} />
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Por ejercicio</p>
        <ul className="divide-y divide-zinc-800/60">
          {m.ejercicios.map((e) => <FilaEjercicio key={e.key} e={e} />)}
        </ul>
        {m.ejerciciosFuera.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Sin evaluar en este corte</p>
            <ul className="flex flex-col gap-1">
              {m.ejerciciosFuera.map((e) => <li key={e.nombre} className="text-[11px] text-zinc-400"><span className="text-zinc-200 font-bold">{e.nombre}</span>: {textoFuera(e)}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-zinc-500 mt-2">Cómo se cuenta: un ejercicio se evalúa dentro de su <b>bloque actual</b>; un parón de más de {MEAM_CONFIG.gap_segment_reset_days} días o un cambio de nivel (tres sesiones seguidas muy por encima o por debajo: otra máquina, kilos por lado…) abre un bloque nuevo y lo anterior deja de compararse. Dentro del bloque solo cuentan las sesiones con fuerza estimada (hasta {MEAM_CONFIG.e1rm_reps_max} reps en el top set, {MEAM_CONFIG.e1rm_reps_max_isolation} en aislamiento) y las de esta semana entran el lunes. La tendencia necesita {MEAM_CONFIG.N_state_min} sesiones normales repartidas en al menos {MEAM_CONFIG.state_span_min_weeks} semanas (mira hasta {MEAM_CONFIG.state_span_max_weeks}); el ruido se mide con los errores de pronóstico de esas sesiones ({MEAM_CONFIG.tier_established} = establecido, {MEAM_CONFIG.tier_mature} = maduro).</p>
      </div>
    </div>
  )
}

/** Por qué un ejercicio con registros no entra en el motor en este corte (menos de 3 sesiones con fuerza estimada en su bloque actual). */
function textoFuera(e: EjercicioFuera): string {
  const p: string[] = []
  if (e.nExposicionesTotal === 0) {
    p.push(`${e.nRegistros} sesiones registradas y ninguna con fuerza estimada`)
    if (e.nSinE1rmPorReps > 0) p.push(`${e.nSinE1rmPorReps} pasan del máximo de reps`)
    if (e.nSinE1rmPorCarga > 0) p.push(`${e.nSinE1rmPorCarga} sin kilos, sin reps o sin peso corporal apuntado`)
    return `${p.join('; ')}.`
  }
  p.push(`${e.nBloque} sesión${e.nBloque === 1 ? '' : 'es'} en el bloque actual (hacen falta 3)`)
  if (e.bloqueMotivo === 'paron') p.push(`bloque abierto el ${fechaCorta(e.bloqueDesde)} tras un parón de ${e.bloqueParonDias} días`)
  else if (e.bloqueMotivo === 'protocolo') p.push(`bloque abierto el ${fechaCorta(e.bloqueDesde)} por un cambio de nivel`)
  p.push(`${e.nExposicionesTotal} con fuerza estimada en total, ${e.nRegistros} registradas`)
  if (e.nEstaSemana > 0) p.push(`${e.nEstaSemana} de esta semana cuentan el lunes`)
  if (e.ultimaFecha) p.push(`última el ${fechaCorta(e.ultimaFecha)}`)
  return `${p.join(' · ')}.`
}

/** Cuenta de sesiones de un ejercicio en llano: las que cuentan, por qué empieza ahí el bloque y las que no cuentan (y por qué). */
function textoSesiones(e: InformeEjercicio): string {
  const descargas = e.nExposiciones - e.nNormales
  const bloque = e.bloqueMotivo === 'paron' ? ` (bloque abierto tras un parón de ${e.bloqueParonDias} días; lo anterior ya no se compara)` : e.bloqueMotivo === 'protocolo' ? ' (bloque abierto por un cambio de nivel: otra máquina o forma de apuntar los kilos)' : ''
  const zonaB = tramoDe(e.nExposiciones, ESC_NBLOQUE)
  const partes = [`${e.nExposiciones} en el bloque actual${zonaB ? ` [${zonaB.label}]` : ''}${e.bloqueDesde ? ` desde el ${fechaCorta(e.bloqueDesde)}` : ''}${bloque}${descargas > 0 ? `, ${descargas} de ellas descarga (no cuentan para ruido ni tendencia)` : ''}`]
  if (e.nBloques > 1) partes.push(`${e.nExposicionesTotal} con fuerza estimada en todo el histórico (${e.nBloques} bloques)`)
  const sin: string[] = []
  if (e.nSinE1rmPorReps > 0) sin.push(`${e.nSinE1rmPorReps} por pasar de ${e.repsMax} reps`)
  if (e.nSinE1rmPorCarga > 0) sin.push(`${e.nSinE1rmPorCarga} sin kilos, sin reps o sin peso corporal apuntado`)
  partes.push(`${e.nRegistros} registradas${sin.length ? `, sin fuerza estimada ${sin.join(' y ')}` : ''}`)
  if (e.nEstaSemana > 0) partes.push(`${e.nEstaSemana} de esta semana cuentan el lunes`)
  return partes.join(' · ')
}

function FilaEjercicio({ e }: { e: InformeEjercicio }) {
  const navigate = useNavigate()
  // el icono va por T (¿destaca sobre el ruido?), no por la pendiente: una pendiente grande con T bajo sigue siendo dudosa
  const dir = e.T >= 1 ? SEMAFORO.mejora : e.T <= -1 ? SEMAFORO.baja : SEMAFORO.estable
  const zonaT = tramoDe(e.T, ESC_T), zonaP = tramoDe(e.pendientePctSem, ESC_PEND), zonaM = tramoDe(e.mdsPctMes, ESC_MDS), zonaN = tramoDe(e.nErr, ESC_NERR)
  const abandonado = e.diasDesdeUltima > MEAM_CONFIG.gap_segment_reset_days
  return (
    <li className="py-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-200 font-bold truncate">{e.nombre}{e.heredaDe.length ? <span className="font-normal text-zinc-500"> · hereda {e.heredaDe.join(', ')}</span> : null}{e.role !== 'DIRECT' ? <span className="font-normal text-zinc-500"> · apoyo (no decide el estado)</span> : null}</span>
        <span className="inline-flex items-center gap-1 tabular-nums shrink-0" style={{ color: dir.color }}>{dir.icono}{signo(e.pendientePctSem)} %/sem</span>
      </div>
      {abandonado && (
        <p className="text-[11px] text-amber-400/90">Sin sesiones desde el {fechaCorta(e.ultimaFecha)} ({e.diasDesdeUltima} días). Ojo: sigue contando en el músculo con sus números de entonces hasta que lo retomes (y al retomarlo abrirá un bloque nuevo).</p>
      )}
      <div className="flex flex-col gap-0.5 text-[11px] text-zinc-400 tabular-nums">
        <span>Pendiente {signo(e.pendientePctSem)} %/sem{zonaP ? <> · <b style={{ color: zonaP.color }}>{zonaP.label}</b></> : null} · T {signo(e.T)}{zonaT ? <> (<span style={{ color: zonaT.color }}>{zonaT.label}</span>)</> : <> (sin tendencia: hacen falta {MEAM_CONFIG.N_state_min} sesiones normales en ≥ {MEAM_CONFIG.state_span_min_weeks} semanas dentro del bloque)</>}{Number.isFinite(e.TLong) ? ` · a 26 semanas T ${signo(e.TLong)}` : ''}</span>
        <span>Fuerza estimada {fmt(e.e1rmActual, 1)} kg · mínimo detectable {fmt(e.mdsKgMes, 1)} kg/mes{Number.isFinite(e.mdsPctMes) ? <> (≈ {fmt(e.mdsPctMes, 1)} %/mes{zonaM ? <>: <b style={{ color: zonaM.color }}>{zonaM.label}</b></> : null})</> : null}</span>
        <span>Sesiones: {textoSesiones(e)}</span>
        <span>Ruido medido con {e.nErr} sesiones{zonaN ? <>: <b style={{ color: zonaN.color }}>{zonaN.label}</b></> : null} ({MEAM_CONFIG.tier_established} = establecido, {MEAM_CONFIG.tier_mature} = maduro) · {CALIDAD[e.calidadTemporal] ?? legible(e.calidadTemporal)}{Number.isFinite(e.spanSemanas) && e.spanSemanas > 0 ? ` (ventana de ${fmt(e.spanSemanas, 0)} semanas: ${tramoDe(e.spanSemanas, ESC_VENTANA)?.label ?? ''})` : ''}{e.estrato ? ` · ${estratoLegible(e.estrato)}` : ''}{e.rirDisponible > 0 ? ` · RIR anotado en ${e.rirDisponible}` : ''}</span>
        {e.erratasDetalle.length > 0 && (
          <div className="text-amber-400/90 flex flex-col gap-0.5">
            <span>{e.erratasDetalle.length} dato{e.erratasDetalle.length === 1 ? '' : 's'} apartado{e.erratasDetalle.length === 1 ? '' : 's'} por salirse más de un {Math.round((Math.exp(MEAM_CONFIG.errata_log_dev) - 1) * 100)} % de lo esperado (si es un error de apunte, corrígelo en el historial; si es real y se repite 3 veces seguidas, se acepta como nuevo nivel):</span>
            {e.erratasDetalle.map((x) => (
              <span key={`${x.sesionId}|${x.fecha}`}>
                <button onClick={() => navigate(`/historial?fecha=${x.fecha}&sesion=${encodeURIComponent(x.sesionId)}`)} className="underline underline-offset-2 font-bold text-amber-300 active:text-white">{fechaCorta(x.fecha)}</button>
                {' '}· {marcaLegible({ pesoRegistrado: x.pesoRegistrado, tipoCarga: x.tipoCarga, topReps: x.topReps })} → fuerza est. {fmt(x.e1rm, 0)} kg{x.esperado !== null ? `, esperada ≈ ${fmt(x.esperado, 0)} kg` : ''}
              </span>
            ))}
          </div>
        )}
        {e.flags.length > 0 && <span>Avisos: {e.flags.map(legible).join(', ')}</span>}
      </div>
    </li>
  )
}
