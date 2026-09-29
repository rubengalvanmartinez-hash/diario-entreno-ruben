// Tests del módulo MEAM: equivalencia con la referencia Python (ficheros dorados) + unitarios de la spec (§6, 51–58).
// Ejecutar: npx rolldown test-meam.mts --file /tmp/test-meam.mjs --format esm && node /tmp/test-meam.mjs
import { readFileSync } from 'node:fs'
import { MEAM_CONFIG } from './src/meam/config'
import { normPpf, tPpf, median, percentile } from './src/meam/mathx'
import { theilSen, hamedRaoFactor, strataFor, dedupeSameDay, temporalQuality, makeExposure, type Exposure, type SessionType } from './src/meam/core'
import { runSnapshots, variantDef, type VariantDef, type EquipmentClass, type VariantRole } from './src/meam/engine'

let fallos = 0, total = 0
function check(desc: string, cond: boolean, detail = '') {
  total++
  if (!cond) { fallos++; console.log(`FAIL  ${desc}${detail ? ' — ' + detail : ''}`) }
}
const close = (a: number, b: number, tol = 1e-9): boolean => (Number.isNaN(a) && Number.isNaN(b)) || (a === null && b === null) || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

// ── numérica ────────────────────────────────────────────────────────────────
check('normPpf(0.975) = 1.959963984540054', close(normPpf(0.975), 1.959963984540054, 1e-12))
check('normPpf(0.99) = 2.3263478740408408', close(normPpf(0.99), 2.3263478740408408, 1e-12))
check('normPpf(0.995) = 2.5758293035489004', close(normPpf(0.995), 2.5758293035489004, 1e-12))
check('tPpf(0.95, 3) = 2.353363435', close(tPpf(0.95, 3), 2.3533634348018264, 1e-9))
check('tPpf(0.95, 12) = 1.782287556', close(tPpf(0.95, 12), 1.782287555649159, 1e-9))
check('tPpf(0.95, 40) = 1.683851013', close(tPpf(0.95, 40), 1.6838510133380355, 1e-9))
check('median par', median([1, 2, 3, 4]) === 2.5)
check('percentile lineal', close(percentile([1, 2, 3, 4], 75), 3.25))
check('hamedRao(8,0.3) = 1.4502', close(hamedRaoFactor(8, 0.3), 1.450180, 1e-5))
check('hamedRao(32,0.3) = 1.7455', close(hamedRaoFactor(32, 0.3), 1.745459, 1e-5))
check('hamedRao(n,0) = 1', hamedRaoFactor(20, 0) === 1)

// ── invarianza de estratos (test 55/59) ──────────────────────────────────────
const E = (i: number, r: number): Exposure => makeExposure({ t: i / 2, y: 0, reps_typical: r })
const uniq = (reps: number[]) => new Set(strataFor(reps.map((r, i) => E(i, r)))).size
check('8/9 alternos ⇒ 1 estrato', uniq([8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9]) === 1)
check('8/9/10/9/10 ⇒ 1 estrato', uniq([8, 9, 10, 9, 10, 8, 9, 10, 9, 10, 8, 9, 10, 9, 10, 8, 9, 10, 9, 10]) === 1)
check('doble progresión 8→10 y vuelta ⇒ 1 estrato', uniq([8, 8, 9, 9, 10, 10, 8, 8, 9, 9, 10, 10]) === 1)
check('bloque 5→10 ⇒ 2 estratos', uniq([5, 5, 5, 5, 5, 5, 5, 5, 10, 10, 10, 10, 10, 10]) === 2)
check('ondulante 5/10 ⇒ 2 estratos por exposición', uniq([5, 10, 5, 10, 5, 10, 5, 10, 5, 10, 5, 10, 5, 10, 5, 10]) === 2)
check('5→8 (dist 3) ⇒ 2 estratos', uniq([5, 5, 5, 5, 5, 5, 5, 5, 8, 8, 8, 8]) === 2)
check('8→10 (dist 2) ⇒ 1 estrato', uniq([8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 10]) === 1)

// ── deduplicación (test 54) ──────────────────────────────────────────────────
const dup = [makeExposure({ t: 0, y: 4.6 }), makeExposure({ t: 0, y: 4.65 }), makeExposure({ t: 0.5, y: 4.62 }), makeExposure({ t: 0.5, y: 4.61, session_type: 'deload' })]
const dd = dedupeSameDay(dup)
check('dedupe: 4 → 2', dd.length === 2)
check('dedupe: conserva la mejor', dd[0].y === 4.65)
check('dedupe: prevalece normal', dd[1].session_type === 'normal')

// ── calidad temporal (test 56) ───────────────────────────────────────────────
check('2/sem regular ⇒ REGULAR', temporalQuality(Array.from({ length: 20 }, (_, i) => i / 2))[0] === 'REGULAR')
check('cada 12 d ⇒ IRREGULAR', temporalQuality(Array.from({ length: 10 }, (_, i) => i * 12 / 7))[0] === 'IRREGULAR')
check('6 exposiciones ⇒ ESCASA', temporalQuality([0, 0.5, 1, 1.5, 2, 2.5])[0] === 'ESCASA')

// ── Theil-Sen básico ─────────────────────────────────────────────────────────
const tt = [0, 1, 2, 3, 4, 5, 6, 7], yy = tt.map((v) => 0.01 * v)
const f = theilSen(tt, yy)!
check('recta perfecta: pendiente 0.01', close(f.slope, 0.01))
check('banca ChatGPT: +1.49 %/sem', close(theilSen([1, 2, 3, 4, 5, 6, 7, 8], [101.3, 104.5, 107.3, 107.7, 110.5, 110.8, 113.8, 113.8].map(Math.log))!.slope * 100, 1.49, 0.01))

// ── ficheros dorados: equivalencia snapshot a snapshot con la referencia Python ───────────
interface GoldenCase { name: string; weeks: number; start_week: number; context_high_weeks: number[]; volume_reduction_ts: number[]; rho_fixed: number
  variants: Record<string, { exps: [number, string, string, boolean, number, number, string][]; cluster: string; equipment_class: string; role: string; protocol_breaks: number[] }>
  rows: Array<Record<string, number | string | null>> }
const golden = JSON.parse(readFileSync(process.env.MEAM_GOLDEN ?? 'tests/meam_golden.json', 'utf8')) as { config_version: string; cases: GoldenCase[] }
check(`golden config_version = ${MEAM_CONFIG.config_version}`, golden.config_version === MEAM_CONFIG.config_version, golden.config_version)
const numKeys = ['sigma_pct', 'DCT_pct', 'D', 'T', 'eff', 'rho', 'mds'] as const
const strKeys = ['tier', 'adaptation', 'adapt_label', 'recovery', 'rec_label', 'flags'] as const
let snapshots = 0
for (const c of golden.cases) {
  const variants = new Map<string, VariantDef>()
  for (const [vid, v] of Object.entries(c.variants)) {
    const exps = v.exps.map(([t, y, st, ex, reps, load, stratum]) => makeExposure({ t, y: Number(y), session_type: st as SessionType, excluded_from_noise: ex, reps_typical: reps, load_kg: load, stratum }))
    variants.set(vid, variantDef(exps, v.cluster, v.equipment_class as EquipmentClass, v.role as VariantRole, v.protocol_breaks))
  }
  const cutoffs = Array.from({ length: c.weeks - c.start_week + 1 }, (_, i) => c.start_week + i)
  const rows = runSnapshots(variants, { cutoffs, contextHighCutoffs: new Set(c.context_high_weeks), volumeReductionTs: c.volume_reduction_ts, rhoFixed: c.rho_fixed })
  check(`${c.name}: nº de snapshots`, rows.length === c.rows.length, `${rows.length} vs ${c.rows.length}`)
  for (let i = 0; i < Math.min(rows.length, c.rows.length); i++) {
    const r = rows[i], g = c.rows[i]; snapshots++
    check(`${c.name} sem ${g.week}: n_exp`, r.n_exp === g.n_exp, `${r.n_exp} vs ${g.n_exp}`)
    check(`${c.name} sem ${g.week}: n_err`, r.n_err === g.n_err, `${r.n_err} vs ${g.n_err}`)
    for (const k of strKeys) check(`${c.name} sem ${g.week}: ${k}`, r[k] === g[k], `${r[k]} vs ${g[k]}`)
    for (const k of numKeys) {
      const gv = g[k] === null ? Number.NaN : (g[k] as number)
      check(`${c.name} sem ${g.week}: ${k}`, close(r[k], gv, 1e-7), `${r[k]} vs ${gv}`)
    }
  }
}
console.log(`${snapshots} snapshots dorados comparados`)

// ── capa P0–P3 (tests 41, 47, 48, 51, 54, 57, 58 de la spec) ─────────────────
import { derivarExposiciones, reduccionesDeVolumen, type SesionConTipo } from './src/meam/exposure'
import { construirMapaVariantes, inferirVariante } from './src/meam/variants'
import { ejecutarMeam } from './src/meam/run'
import type { RegistroPeso, Serie } from './src/types/models'

const serie = (numero: number, reps: number, pesoKg: number, etiqueta?: Serie['etiqueta']): Serie => ({ numero, reps, pesoKg, ...(etiqueta ? { etiqueta } : {}) })
const sesion = (id: string, fecha: string, ejercicios: Array<{ nombre: string; series: Serie[] }>, tipoSesion?: SesionConTipo['tipoSesion']): SesionConTipo => ({
  id, fecha, dia: 1, ejercicios: ejercicios.map((e) => ({ ejercicioId: e.nombre, nombreSnapshot: e.nombre, series: e.series, notaSesion: '', completado: true })), sincronizado: true,
  ...(tipoSesion ? { tipoSesion } : {}),
})
const fechaN = (n: number): string => { const d = new Date(Date.UTC(2026, 0, 5 + n)); return d.toISOString().slice(0, 10) }   // 2026-01-05 es lunes

// mapa de variantes por palabras clave
check("'Press de pecho' → pecho/PRESS_HORIZONTAL", inferirVariante('Press de pecho').cluster === 'PRESS_HORIZONTAL' && inferirVariante('Press de pecho').musculo === 'pecho')
check("'Jalón al pecho' → espalda (no pecho)", inferirVariante('Jalón al pecho').musculo === 'espalda')
check("'Curl femoral' → femoral (no bíceps)", inferirVariante('Curl femoral').musculo === 'femoral_gluteo')
check("'Vuelos laterales' → hombro/ELEVACION aislamiento", inferirVariante('Vuelos laterales').aislamiento === true)
check("'Dominadas' asistidas → equipment assisted", inferirVariante('Dominadas', true).equipment === 'assisted')
check("'Bíceps' vía alias → clave canónica 'biceps con barra fija'", construirMapaVariantes(['Bíceps']).has('biceps con barra fija'))

// 41: calentamiento inferido, top set entre las 3 primeras de trabajo, RIR del top set
{
  const ses = [sesion('s1', fechaN(0), [{ nombre: 'Press de pecho', series: [serie(1, 12, 40), serie(2, 8, 100, 'rir1'), serie(3, 7, 100, 'rir0'), serie(4, 9, 95), serie(5, 8, 100, 'fallo')] }])]
  const mapa = construirMapaVariantes(['Press de pecho'])
  const der = derivarExposiciones(ses, mapa)
  const dv = der.variantes.get('press de pecho')!
  check('41: una exposición', dv.exps.length === 1)
  check('41: calentamiento (40 kg) excluido; top set = 100×8 (e1RM 126,7) entre las 3 primeras de trabajo', Math.abs(dv.extras[0].e1rm - 100 * (1 + 8 / 30)) < 1e-9 && dv.extras[0].topReps === 8)
  check('41: RIR del top set = 1 (rir1)', dv.extras[0].rir === 1)
  check('41: series de trabajo = 4 (≥ 90 % de 100)', dv.extras[0].seriesTrabajo === 4)
  check('41: series duras = 3 (con etiqueta)', dv.extras[0].seriesDuras === 3)
  check('t = 0 el lunes de la primera sesión', dv.exps[0].t === 0)
}
// 47/57: errata excluida; deload inferido; tipo declarado
{
  const ses: SesionConTipo[] = []
  for (let i = 0; i < 8; i++) ses.push(sesion(`s${i}`, fechaN(i * 3), [{ nombre: 'Remo', series: [serie(1, 8, 80), serie(2, 8, 80), serie(3, 8, 80)] }]))
  ses.push(sesion('err', fechaN(24), [{ nombre: 'Remo', series: [serie(1, 8, 800)] }]))                                   // errata ×10
  ses.push(sesion('dl', fechaN(27), [{ nombre: 'Remo', series: [serie(1, 8, 60)] }]))                                     // 1 serie (≤60 % de 3) y 60 kg (≤90 % de 80)
  ses.push(sesion('dcl', fechaN(30), [{ nombre: 'Remo', series: [serie(1, 8, 80), serie(2, 8, 80), serie(3, 8, 80)] }], 'deload'))
  const der = derivarExposiciones(ses, construirMapaVariantes(['Remo']))
  const dv = der.variantes.get('remo')!
  check('47: la errata (800 kg) queda fuera de las exposiciones', dv.exps.length === 10 && dv.erratas.length === 1)
  check('57: deload_inferido (1 serie a 60 kg)', dv.extras.find((x) => x.sesionId === 'dl')?.tipo === 'deload' && dv.extras.find((x) => x.sesionId === 'dl')?.deloadInferido === true)
  check('57: deload declarado se respeta', dv.extras.find((x) => x.sesionId === 'dcl')?.tipo === 'deload')
}
// asistidos: W = BW_ref − asistencia; sin peso corporal ⇒ sin exposición
{
  const pesos: RegistroPeso[] = [{ id: 'p1', fecha: fechaN(0), pesoKg: 87, sincronizado: true }]
  const ses = [sesion('a1', fechaN(1), [{ nombre: 'Dominadas', series: [serie(1, 8, 20)] }]), sesion('a2', fechaN(40), [{ nombre: 'Dominadas', series: [serie(1, 8, 20)] }])]
  const mapa = construirMapaVariantes(['Dominadas'], [], new Set(['dominadas']))
  const der = derivarExposiciones(ses, mapa, pesos)
  const dv = der.variantes.get('dominadas')!
  check('asistido: carga efectiva 87 − 20 = 67 kg', dv.exps.length === 1 && Math.abs(dv.extras[0].topLoad - 67) < 1e-9)
  check('asistido sin peso corporal en 21 d ⇒ sin exposición', dv.exps.length === 1)
}
// peso corporal puro (0 kg) ⇒ canal de reps
{
  const der = derivarExposiciones([sesion('b1', fechaN(0), [{ nombre: 'Abdominales', series: [serie(1, 20, 0)] }])], construirMapaVariantes(['Abdominales']))
  check('peso 0 ⇒ sin e1RM, canal de reps', der.variantes.get('abdominales')!.exps.length === 0 && der.variantes.get('abdominales')!.repsSinE1rm.length === 1)
}
// 58: reducción de volumen ≤ 70 % de la mediana de 4 semanas
{
  const sem = [10, 10, 10, 10, 6, 8].map((series, i) => ({ lunes: '', semana: i, series, duras: 0 }))
  const red = reduccionesDeVolumen(sem)
  check('58: 6 series (60 %) es reducción; 8 (80 %) no', red.length === 1 && red[0] === 4)
}
// extremo a extremo: 30 semanas de progreso real ⇒ PROGRESANDO en el músculo
{
  const ses: SesionConTipo[] = []
  let rng = 12345
  const rand = (): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648 }
  for (let w = 0; w < 30; w++) for (const d of [0, 3]) {
    const t = w + d / 7; const cap = 100 * Math.exp(0.003 * t + 0.02 * (rand() - 0.5) * 3.4)
    const reps = Math.max(1, Math.round(cap / 100 * 30 - 30))          // reps a 100 kg según capacidad (cuantizado)
    ses.push(sesion(`p${w}${d}`, fechaN(Math.round(t * 7)), [{ nombre: 'Press de pecho', series: [serie(1, reps, 100, 'rir1'), serie(2, reps, 100), serie(3, Math.max(1, reps - 1), 100)] }]))
  }
  const inf = ejecutarMeam(ses, construirMapaVariantes(['Press de pecho']), [], { hoy: fechaN(30 * 7), rhoFixed: 0.1 })
  const pecho = inf.musculos.find((m) => m.musculo === 'pecho')
  check('e2e: hay informe de pecho', !!pecho)
  check('e2e: estado PROGRESANDO o tendencia positiva', !!pecho && (pecho.estado === 'PROGRESANDO' || pecho.etiqueta.includes('POSITIVA') || pecho.etiqueta === 'PROGRESO_LENTO_26S'), pecho ? `${pecho.estado}/${pecho.etiqueta}` : '')
  check('e2e: input_hash determinista', !!pecho && ejecutarMeam(ses, construirMapaVariantes(['Press de pecho']), [], { hoy: fechaN(30 * 7), rhoFixed: 0.1 }).musculos[0].inputHash === pecho.inputHash)
}

// ── correcciones de la auditoría 6 ───────────────────────────────────────────
{
  // erratas consecutivas del mismo signo (cambio real de nivel: otra máquina) ⇒ se aceptan como nuevo nivel con ruptura propuesta
  const ses: SesionConTipo[] = []
  for (let i = 0; i < 8; i++) ses.push(sesion(`n${i}`, fechaN(i * 3), [{ nombre: 'Prensa 45', series: [serie(1, 10, 100), serie(2, 10, 100)] }]))
  for (let i = 8; i < 14; i++) ses.push(sesion(`n${i}`, fechaN(i * 3), [{ nombre: 'Prensa 45', series: [serie(1, 10, 150), serie(2, 10, 150)] }]))   // +50 % (kg por lado → total)
  const der = derivarExposiciones(ses, construirMapaVariantes(['Prensa 45']))
  const dv = der.variantes.get('prensa 45')!
  check('nuevo nivel: las 6 sesiones a 150 kg entran como exposiciones (no erratas permanentes)', dv.exps.length === 14 && dv.erratas.length === 0, `${dv.exps.length}/${dv.erratas.length}`)
  check('nuevo nivel: ruptura de protocolo propuesta en la primera sesión del nuevo nivel', dv.rupturasPropuestas.length === 1 && Math.abs(dv.rupturasPropuestas[0] - 24 / 7) < 1e-9)
  check('nuevo nivel: exposiciones ordenadas por t', dv.exps.every((e, i) => i === 0 || e.t >= dv.exps[i - 1].t))
}
{
  // una errata aislada sigue excluida
  const ses: SesionConTipo[] = []
  for (let i = 0; i < 6; i++) ses.push(sesion(`e${i}`, fechaN(i * 3), [{ nombre: 'Remo', series: [serie(1, 8, 80)] }]))
  ses.push(sesion('e6', fechaN(18), [{ nombre: 'Remo', series: [serie(1, 8, 800)] }]))
  ses.push(sesion('e7', fechaN(21), [{ nombre: 'Remo', series: [serie(1, 8, 80)] }]))
  const dv = derivarExposiciones(ses, construirMapaVariantes(['Remo'])).variantes.get('remo')!
  check('errata aislada excluida y la racha se reinicia', dv.exps.length === 7 && dv.erratas.length === 1)
}
{
  // lastre: dominadas sin asistencia = BW_ref + lastre; a 0 kg también cuenta (BW)
  const pesos: RegistroPeso[] = [{ id: 'p1', fecha: fechaN(0), pesoKg: 87, sincronizado: true }, { id: 'p2', fecha: fechaN(2), pesoKg: 89, sincronizado: true }]
  const ses = [sesion('l1', fechaN(3), [{ nombre: 'Dominadas', series: [serie(1, 8, 0)] }]), sesion('l2', fechaN(6), [{ nombre: 'Dominadas', series: [serie(1, 6, 10)] }])]
  const dv = derivarExposiciones(ses, construirMapaVariantes(['Dominadas']), pesos).variantes.get('dominadas')!
  check('lastre: BW_ref = mediana de 7 d (88) ⇒ 0 kg → 88 kg y 10 kg → 98 kg', dv.exps.length === 2 && Math.abs(dv.extras[0].topLoad - 88) < 1e-9 && Math.abs(dv.extras[1].topLoad - 98) < 1e-9, dv.extras.map((x) => x.topLoad).join(','))
}
{
  // volumen: los calentamientos no cuentan como series
  const der = derivarExposiciones([sesion('v1', fechaN(0), [{ nombre: 'Press de pecho', series: [serie(1, 12, 40), serie(2, 8, 100), serie(3, 8, 100)] }])], construirMapaVariantes(['Press de pecho']))
  check('volumen semanal cuenta solo series de trabajo (2, no 3)', der.volumenPorMusculo.get('pecho')![0].series === 2)
  check('reducción de volumen ignora la semana en curso', reduccionesDeVolumen([10, 10, 10, 10, 5].map((series, i) => ({ lunes: '', semana: i, series, duras: 0 })), 4).length === 0)
}
{
  // mapa: correcciones de la auditoría 6
  check("'Elevación de talones' → gemelo", inferirVariante('Elevación de talones').musculo === 'gemelo')
  check("'Curl nórdico' → femoral", inferirVariante('Curl nórdico').musculo === 'femoral_gluteo')
  check("'Remo al mentón' → hombro", inferirVariante('Remo al mentón').musculo === 'hombro')
  check("'Fondos' → pecho, peso corporal + lastre", inferirVariante('Fondos').equipment === 'weighted_bodyweight')
}
{
  // indicador SIN_MEJORA_EN_6 (auditoría 7): bloque actual + referencia = mejor de las 12 anteriores + récord de reps por carga
  const N = 'Press de pecho'
  const mapa = construirMapaVariantes([N])
  const s3 = (id: string, fecha: string, reps: number, kg: number) => sesion(id, fecha, [{ nombre: N, series: [serie(1, reps, kg), serie(2, reps, kg), serie(3, reps, kg)] }])
  // (a) 20 semanas subiendo hasta un pico, luego parón de 60 días y 8 sesiones a un nivel más bajo pero subiendo ⇒ el récord antiguo NO cuenta
  {
    const ses: SesionConTipo[] = []
    for (let i = 0; i < 20; i++) ses.push(s3(`a${i}`, fechaN(i * 7), 8, 100 + 2.5 * i))          // pico 147,5 × 8
    for (let j = 0; j < 8; j++) ses.push(s3(`b${j}`, fechaN(19 * 7 + 60 + j * 7), 8, 110 + 2.5 * j))   // vuelta: 110 → 127,5, con récord en cada sesión del bloque
    const dv = derivarExposiciones(ses, mapa).variantes.get('press de pecho')!
    check('7a: el bloque actual empieza tras el parón', dv.bloqueDesde === fechaN(19 * 7 + 60))
    check('7a: hay récord dentro del bloque aunque no se bata el pico previo al parón', dv.sinMejoraEn6 === false)
    check('7a: la referencia es del bloque actual (< 147,5 kg)', dv.mejorMarca !== null && dv.mejorMarca.topLoad < 147.5 && dv.mejorMarca.nPrevias === 2)
    const inf = ejecutarMeam(ses, mapa, [], { hoy: fechaN(19 * 7 + 60 + 8 * 7) })
    const e = inf.musculos.find((m) => m.musculo === 'pecho')!.ejercicios[0]
    check('7a: la UI cuenta sesiones y fecha del mismo bloque', e.bloqueDesde === fechaN(19 * 7 + 60) && e.nExposiciones === 8)
  }
  // (b) 30 semanas: pico aislado en la semana 5 (una errata readmitida no: un buen día), luego meseta ⇒ la referencia son las 12 anteriores, no el pico
  {
    const ses: SesionConTipo[] = []
    for (let i = 0; i < 30; i++) ses.push(s3(`c${i}`, fechaN(i * 7), i === 5 ? 10 : 8, 100))         // semana 5: 100 × 10 (e1RM 133) — luego siempre 100 × 8
    ses[29] = s3('c29', fechaN(29 * 7), 9, 100)                                                        // última: 100 × 9 = récord de reps frente a las 12 anteriores
    const dv = derivarExposiciones(ses, mapa).variantes.get('press de pecho')!
    check('7b: referencia = mejor de las 12 anteriores (100 × 8), no el pico de la semana 5', dv.mejorMarca !== null && dv.mejorMarca.topReps === 8 && dv.mejorMarca.nPrevias === 12)
    check('7b: 100 × 9 en la última sesión es récord de reps a esa carga', dv.sinMejoraEn6 === false)
  }
  // (c) mismas 18 sesiones planas ⇒ sin récord; y con < 7 normales en el bloque no se calcula (mejorMarca null)
  {
    const ses: SesionConTipo[] = []
    for (let i = 0; i < 18; i++) ses.push(s3(`d${i}`, fechaN(i * 7), 8, 100))
    const dv = derivarExposiciones(ses, mapa).variantes.get('press de pecho')!
    check('7c: meseta ⇒ sin récord', dv.sinMejoraEn6 === true && dv.mejorMarca !== null)
    const pocas = derivarExposiciones(ses.slice(0, 6), mapa).variantes.get('press de pecho')!
    check('7c: con 6 sesiones no se calcula', pocas.sinMejoraEn6 === false && pocas.mejorMarca === null)
  }
  // (e) tras un parón > 42 días la referencia de erratas se reinicia: volver un 22 % más flojo NO es una errata
  {
    const ses: SesionConTipo[] = []
    for (let i = 0; i < 10; i++) ses.push(s3(`f${i}`, fechaN(i * 7), 8, 140))
    ses.push(s3('g0', fechaN(9 * 7 + 60), 8, 110))
    const dv = derivarExposiciones(ses, mapa).variantes.get('press de pecho')!
    check('7e: la primera sesión tras el parón se conserva (no errata)', dv.erratas.length === 0 && dv.exps.length === 11)
    const sinParon = derivarExposiciones([...ses.slice(0, 10), s3('g0', fechaN(10 * 7), 8, 110)], mapa).variantes.get('press de pecho')!
    check('7e: el mismo bajón sin parón sí es errata', sinParon.erratas.length === 1)
  }
  // (d) asistido: la marca muestra los kg de ayuda apuntados, no la carga efectiva
  {
    const pesos: RegistroPeso[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, fecha: fechaN(i * 7), pesoKg: 80, sincronizado: true }))
    const ses: SesionConTipo[] = []
    for (let i = 0; i < 10; i++) ses.push(sesion(`e${i}`, fechaN(i * 7), [{ nombre: 'Dominadas asistidas', series: [serie(1, 8, 25), serie(2, 8, 25), serie(3, 7, 25)] }]))
    const mapaA = construirMapaVariantes(['Dominadas asistidas'], [], new Set(['dominadas asistidas']))
    const dv = derivarExposiciones(ses, mapaA, pesos).variantes.get('dominadas asistidas')!
    check('7d: asistido ⇒ carga efectiva 55 y peso registrado 25 kg de ayuda', dv.mejorMarca !== null && Math.abs(dv.mejorMarca.topLoad - 55) < 1e-9 && Math.abs(dv.mejorMarca.pesoRegistrado - 25) < 1e-9 && dv.mejorMarca.tipoCarga === 'ayuda')
  }
}
// revisión de ejercicios sin uso (2.8.2): sucesor hereda el historial con ruptura de protocolo; retirado sale del cálculo
{
  const ses: SesionConTipo[] = []
  for (let i = 0; i < 8; i++) ses.push(sesion(`v${i}`, fechaN(i * 7), [{ nombre: 'Prensa', series: [serie(1, 8, 200), serie(2, 8, 200), serie(3, 8, 200)] }]))
  for (let i = 8; i < 16; i++) ses.push(sesion(`n${i}`, fechaN(i * 7), [{ nombre: 'Prensa Technogym', series: [serie(1, 8, 140), serie(2, 8, 140), serie(3, 8, 140)] }]))
  const base = { musculo: 'cuadriceps' as const, cluster: 'PRENSA', role: 'DIRECT' as const, equipment: 'isolation_machine' as const, es_asistencia: false, aislamiento: false }
  const mapaH = construirMapaVariantes(['Prensa', 'Prensa Technogym'], [{ ejercicio: 'prensa', ...base, sucesor: 'prensa technogym' }])
  const derH = derivarExposiciones(ses, mapaH)
  const dvH = derH.variantes.get('prensa technogym')
  check('sucesor: una sola variante con 16 exposiciones (el salto 200→140 no es errata)', !derH.variantes.has('prensa') && dvH !== undefined && dvH.exps.length === 16)
  check('sucesor: ruptura de protocolo en la primera sesión propia del heredero', dvH !== undefined && dvH.rupturasPropuestas.length === 1 && dvH.rupturasPropuestas[0] === 8 && dvH.heredaDe.join() === 'Prensa')
  const mapaR = construirMapaVariantes(['Prensa', 'Prensa Technogym'], [{ ejercicio: 'prensa', ...base, retirado: true }])
  const derR = derivarExposiciones(ses, mapaR)
  check('retirado: fuera del cálculo; el nuevo sigue solo con las suyas', !derR.variantes.has('prensa') && derR.variantes.get('prensa technogym')!.exps.length === 8)
  // ciclo A→B→A: se anula la revisión y cada ejercicio queda como está
  const mapaC = construirMapaVariantes(['Prensa', 'Prensa Technogym'], [{ ejercicio: 'prensa', ...base, sucesor: 'prensa technogym' }, { ejercicio: 'prensa technogym', ...base, sucesor: 'prensa' }])
  const derC = derivarExposiciones(ses, mapaC)
  check('ciclo de sucesores: se ignora (dos variantes con 8 exposiciones y sin herencia)', derC.variantes.get('prensa')?.exps.length === 8 && derC.variantes.get('prensa technogym')?.exps.length === 8 && derC.variantes.get('prensa technogym')?.heredaDe.length === 0)
  // primera sesión propia del heredero sin e1RM (20 reps en compuesto): la referencia de erratas se reinicia igualmente
  const ses2 = [...ses.slice(0, 8), sesion('n8', fechaN(56), [{ nombre: 'Prensa Technogym', series: [serie(1, 20, 100)] }]), ...ses.slice(9)]
  const dv2 = derivarExposiciones(ses2, mapaH).variantes.get('prensa technogym')!
  check('herencia con primera sesión propia sin e1RM: una sola ruptura y ninguna errata', dv2.rupturasPropuestas.length === 1 && dv2.erratas.length === 0 && dv2.exps.length === 15)
  const informeH = ejecutarMeam(ses, mapaH, [], { hoy: fechaN(16 * 7) })
  check('informe: el heredero declara heredaDe y no hay revisados pendientes', informeH.revisados.length === 1 && informeH.revisados[0].sucesorNombre === 'Prensa Technogym' && informeH.variantes.every((v) => v.key !== 'prensa'))
}
console.log(`${total} comprobaciones, ${fallos} fallos (con las correcciones de la auditoría 6)`)
if (fallos > 0) process.exit(1)
