// Tests de lógica pura — bundle con rolldown y ejecutar con node (ver memoria / changelog 2.2.7)
import { normalizarNombre, nombreCanonico, matchesEjercicio } from './src/utils/normalizar'
import { serieConDatos } from './src/types/models'
import { DEFAULT_EJERCICIOS, esConfigPorDefecto } from './src/store/defaultData'
import { grupoDeEjercicio } from './src/utils/gruposMusculares'
import { factorEquivalencia, tieneEquivalencia, aReferencia, aGimnasio, factorDesdePareja, redondearPeso, sesionAReferencia, historialAReferencia } from './src/utils/equivalencias'
import type { Sesion } from './src/types/models'
import { calcularVolumenSemanal, lunesDe } from './src/utils/volumenSemanal'
import { analizarProgresion, evaluarDeload } from './src/utils/progresion'

let fallos = 0
function check(desc: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'FAIL'}  ${desc}`)
  if (!cond) fallos++
}

// ── normalizarNombre ─────────────────────────────────────────────────────────
check("normalizar '  Bíceps  ' → 'biceps'", normalizarNombre('  Bíceps  ') === 'biceps')
check("normalizar 'Abdominales ' → 'abdominales'", normalizarNombre('Abdominales ') === 'abdominales')
check("normalizar 'Prensa 45º' conserva º", normalizarNombre('Prensa 45º') === 'prensa 45º')

// ── nombreCanonico (alias) ───────────────────────────────────────────────────
check("canon 'Hip thrust' → 'hiptrust'", nombreCanonico('Hip thrust') === 'hiptrust')
check("canon 'Hip Thrust' → 'hiptrust'", nombreCanonico('Hip Thrust') === 'hiptrust')
check("canon 'HipTrust' → 'hiptrust'", nombreCanonico('HipTrust') === 'hiptrust')
check("canon 'Biceps' → 'biceps con barra fija'", nombreCanonico('Biceps') === 'biceps con barra fija')
check("canon 'Prensa 45º' → 'prensa 45'", nombreCanonico('Prensa 45º') === 'prensa 45')
check("canon 'Prensa 45°' → 'prensa 45'", nombreCanonico('Prensa 45°') === 'prensa 45')
check("canon 'Presa de pierna' → 'press de pierna'", nombreCanonico('Presa de pierna') === 'press de pierna')

// ── matchesEjercicio ─────────────────────────────────────────────────────────
const ej = (nombreSnapshot: string) => ({ ejercicioId: 'hist-sintetico', nombreSnapshot })
check('match por ID exacto', matchesEjercicio({ ejercicioId: 'cfg1', nombreSnapshot: 'X' }, 'cfg1', 'Y'))
check("match normalizado 'Triceps con soga' ~ 'Tríceps con soga'", matchesEjercicio(ej('Triceps con soga'), 'cfg1', 'Tríceps con soga'))
check("match alias 'Hip thrust' ~ 'HipTrust'", matchesEjercicio(ej('Hip thrust'), 'cfg1', 'HipTrust'))
check("match alias 'Hiptrust' ~ 'Hip Thrust' (config default)", matchesEjercicio(ej('Hiptrust'), 'cfg1', 'Hip Thrust'))
check("match alias 'Biceps' ~ 'Bíceps con barra fija'", matchesEjercicio(ej('Biceps'), 'cfg1', 'Bíceps con barra fija'))
check("match alias 'Pecho inclinado' ~ 'Pecho inclinado mancuernas'", matchesEjercicio(ej('Pecho inclinado'), 'cfg1', 'Pecho inclinado mancuernas'))
check("match alias 'Prensa 45º' ~ 'Prensa 45'", matchesEjercicio(ej('Prensa 45º'), 'cfg1', 'Prensa 45'))
check("match alias 'Abdominales ' ~ 'Abdominales'", matchesEjercicio(ej('Abdominales '), 'cfg1', 'Abdominales'))
check("NO match 'Remo' ~ 'Press militar'", !matchesEjercicio(ej('Remo'), 'cfg1', 'Press militar'))
check("NO match 'Oblicuos polea' ~ 'Oblicuos en polea' (sin alias definido)", !matchesEjercicio(ej('Oblicuos polea'), 'cfg1', 'Oblicuos en polea'))
check('NO match con snapshot vacío', !matchesEjercicio(ej(''), 'cfg1', 'Remo'))

// ── serieConDatos ────────────────────────────────────────────────────────────
check('serie 7 reps × 0 kg (peso corporal) → válida', serieConDatos({ numero: 1, reps: 7, pesoKg: 0 }))
check('serie vacía → inválida', !serieConDatos({ numero: 1, reps: '', pesoKg: '' }))
check('serie 0 reps × 0 kg → inválida', !serieConDatos({ numero: 1, reps: 0, pesoKg: 0 }))
check('serie sin reps pero 50 kg → válida', serieConDatos({ numero: 1, reps: '', pesoKg: 50 }))

// ── esConfigPorDefecto ───────────────────────────────────────────────────────
check('config semilla → true', esConfigPorDefecto(DEFAULT_EJERCICIOS))
check('config semilla clonada (otros ids) → true', esConfigPorDefecto(DEFAULT_EJERCICIOS.map((e) => ({ ...e, id: 'otro-' + e.orden + e.dia }))))
const renombrada = DEFAULT_EJERCICIOS.map((e, i) => (i === 3 ? { ...e, nombre: 'Bíceps con barra fija' } : e))
check('config con un rename → false', !esConfigPorDefecto(renombrada))
check('config con ejercicio extra → false', !esConfigPorDefecto([...DEFAULT_EJERCICIOS, { ...DEFAULT_EJERCICIOS[0], id: 'x', nombre: 'Prensa 45', orden: 99 }]))
check('config parcial → false', !esConfigPorDefecto(DEFAULT_EJERCICIOS.slice(0, 10)))

// ── Selección de último entreno (misma lógica que EjercicioCard) ────────────
type S = { fecha: string; ejercicios: { ejercicioId: string; nombreSnapshot: string; completado: boolean; saltado?: boolean; series: { numero: number; reps: number | ''; pesoKg: number | '' }[] }[] }
const historial: S[] = [
  { fecha: '2026-08-12', ejercicios: [{ ejercicioId: 's1-Oblicuos en polea', nombreSnapshot: 'Oblicuos en polea', completado: true, series: [{ numero: 1, reps: '', pesoKg: '' }, { numero: 2, reps: '', pesoKg: '' }] }] },
  { fecha: '2026-08-01', ejercicios: [{ ejercicioId: 's2-Oblicuos en polea', nombreSnapshot: 'Oblicuos en polea', completado: true, series: [{ numero: 1, reps: 12, pesoKg: 80 }] }] },
]
const ordenado = [...historial].sort((a, b) => b.fecha.localeCompare(a.fecha))
const encontrados: string[] = []
for (const sesion of ordenado) {
  const e = sesion.ejercicios.find((x) => matchesEjercicio(x, 'default-d2-4', 'Oblicuos en polea') && x.completado && !x.saltado)
  if (e && e.series.some(serieConDatos)) encontrados.push(sesion.fecha)
}
check('último entreno salta la sesión vacía del 12/08 y elige la del 01/08', encontrados[0] === '2026-08-01')


// ── grupoDeEjercicio (nombres reales del historial de Rubén) ─────────────────
const esperado: Record<string, string> = {
  'Jalón al pecho': 'espalda', 'Peso muerto': 'espalda', 'Peso muerto libre': 'espalda', 'Remo': 'espalda', 'Dominadas': 'espalda',
  'Bíceps': 'brazos', 'Biceps': 'brazos', 'Bíceps con barra fija': 'brazos', 'Biceps martillo': 'brazos', 'Biceps martillo mancuernas': 'brazos',
  'Polea Bíceps': 'brazos', 'Curo de bíceps con mancuerna en banca': 'brazos', 'Triceps francés': 'brazos', 'Triceps con soga': 'brazos',
  'Triceps tras nuca a 1 brazo': 'brazos',
  'Press de pecho': 'pecho', 'Pecho inclinado': 'pecho', 'Pecho inclinado mancuernas': 'pecho', 'Pecho inclinado Máquina': 'pecho',
  'Cruces en polea': 'pecho', 'Mariposa': 'pecho', 'Aperturas': 'pecho', 'Pull over polea alta': 'pecho',
  'Press militar': 'hombro', 'Vuelos laterales': 'hombro', 'Vuelo lateral polea a 1 brazo': 'hombro', 'Vuelo frontal en polea': 'hombro',
  'Posteriores mariposa': 'hombro',
  'Extensión de cuádriceps': 'piernas', 'Extensión de pierna': 'piernas', 'Cuadriceps sillón': 'piernas', 'Prensa 45': 'piernas',
  'Prensa 45º': 'piernas', 'Press de pierna': 'piernas', 'Presa de pierna': 'piernas', 'Jaca': 'piernas', 'Sentadilla Hack': 'piernas',
  'Curl femoral acostado': 'piernas', 'Abductores': 'piernas', 'Aductores': 'piernas', 'HipTrust': 'piernas', 'Hip thrust': 'piernas',
  'Hiptrust': 'piernas', 'Subida al cajón / sentadilla': 'piernas',
  'Abdominales': 'abdomen', 'Abdominales ': 'abdomen', 'Oblicuos': 'abdomen', 'Oblicuos polea': 'abdomen', 'Oblicuos en polea': 'abdomen',
  'Hiperextensiones': 'espalda', 'Elevación de piernas': 'abdomen', 'Ejercicio raro XYZ': 'otros',
}
for (const [nombre, grupo] of Object.entries(esperado)) {
  check(`grupo '${nombre}' → ${grupo} (obtenido: ${grupoDeEjercicio(nombre)})`, grupoDeEjercicio(nombre) === grupo)
}

// ── Equivalencias entre gimnasios ────────────────────────────────────────────
const eq = { 'jalon al pecho': 1.25 }  // 100 kg ET = 80 kg FP
check('factor ET siempre 1', factorEquivalencia(eq, 'Jalón al pecho', 'entrenat') === 1)
check('factor sin gimnasio = 1', factorEquivalencia(eq, 'Jalón al pecho', undefined) === 1)
check('factor FP con equivalencia = 1.25', factorEquivalencia(eq, 'Jalón al pecho', 'fitnesspark') === 1.25)
check('factor FP sin equivalencia = 1 (peso libre)', factorEquivalencia(eq, 'Press de pecho', 'fitnesspark') === 1)
check('factor FP casa por alias (Jalon al pecho sin tilde)', factorEquivalencia(eq, 'Jalon al pecho', 'fitnesspark') === 1.25)
check('tieneEquivalencia', tieneEquivalencia(eq, 'Jalón al pecho', 'fitnesspark') && !tieneEquivalencia(eq, 'Press de pecho', 'fitnesspark') && !tieneEquivalencia(eq, 'Jalón al pecho', 'entrenat'))
check('80 kg FP → 100 kg ET', aReferencia(80, 1.25) === 100)
check('110 kg ET → 88 kg FP', aGimnasio(110, 1.25) === 88)
check('90 kg FP → 112.5 kg ET', aReferencia(90, 1.25) === 112.5)
check('factorDesdePareja(100, 80) = 1.25', factorDesdePareja(100, 80) === 1.25)
check('factorDesdePareja inválido → null', factorDesdePareja(0, 80) === null && factorDesdePareja(100, NaN) === null)
check('redondearPeso a 0.5', redondearPeso(63.7) === 63.5 && redondearPeso(64.26) === 64.5)
const sET: Sesion = { id: 'et', fecha: '2026-08-20', dia: 1, tipo: 'normal', sincronizado: true, ejercicios: [{ ejercicioId: 'a', nombreSnapshot: 'Jalón al pecho', completado: true, notaSesion: '', series: [{ numero: 1, reps: 12, pesoKg: 80 }] }] }
const sFP: Sesion = { ...sET, id: 'fp', gimnasio: 'fitnesspark', ejercicios: [{ ejercicioId: 'b', nombreSnapshot: 'Jalón al pecho', completado: true, notaSesion: '', series: [{ numero: 1, reps: 12, pesoKg: 60 }, { numero: 2, reps: '', pesoKg: '' }] }, { ejercicioId: 'c', nombreSnapshot: 'Press de pecho', completado: true, notaSesion: '', series: [{ numero: 1, reps: 10, pesoKg: 50 }] }] }
check('sesión ET no se toca (misma instancia)', sesionAReferencia(sET, eq) === sET)
const sFPref = sesionAReferencia(sFP, eq)
check('sesión FP: Jalón 60 → 75 kg ET', sFPref.ejercicios[0].series[0].pesoKg === 75)
check('sesión FP: serie vacía sigue vacía', sFPref.ejercicios[0].series[1].pesoKg === '')
check('sesión FP: Press de pecho sin equivalencia queda en 50', sFPref.ejercicios[1].series[0].pesoKg === 50)
check('sesión FP: el gimnasio se conserva', sFPref.gimnasio === 'fitnesspark')
check('historial sin nada que convertir → misma instancia', historialAReferencia([sET], eq) === [sET][0] ? true : historialAReferencia([sET], {})[0] === sET)
check('historial FP sin equivalencias → misma instancia', (() => { const h = [sFP]; return historialAReferencia(h, {}) === h })())
check('historial con FP convertido', historialAReferencia([sET, sFP], eq)[1].ejercicios[0].series[0].pesoKg === 75)

// ── Volumen semanal por grupo ────────────────────────────────────────────────
check('lunesDe domingo 2026-08-23 → 2026-08-17', lunesDe('2026-08-23') === '2026-08-17')
check('lunesDe lunes 2026-08-17 → sí mismo', lunesDe('2026-08-17') === '2026-08-17')
const mkSes = (id: string, fecha: string, ejercicios: [string, number, number, number][]): Sesion => ({ id, fecha, dia: 1, tipo: 'normal', sincronizado: true, ejercicios: ejercicios.map(([nombre, series, reps, kg], i) => ({ ejercicioId: id + '-' + i, nombreSnapshot: nombre, completado: true, notaSesion: '', series: Array.from({ length: series }, (_, n) => ({ numero: n + 1, reps, pesoKg: kg })) })) })
const histVol = [ mkSes('v1', '2026-08-18', [['Press de pecho', 4, 10, 60], ['Jalón al pecho', 3, 12, 80]]), mkSes('v2', '2026-08-20', [['Press militar', 3, 10, 20], ['Dominadas', 3, 7, 0]]), mkSes('v3', '2026-08-11', [['Press de pecho', 5, 10, 55]]) ]
const semanas = calcularVolumenSemanal(histVol, 2, '2026-08-23')
check('2 semanas, la última es la actual', semanas.length === 2 && semanas[1].esActual && semanas[1].inicio === '2026-08-17')
check('semana actual: pecho 4 series', semanas[1].porGrupo.pecho?.series === 4)
check('semana actual: espalda 3 (jalón) + 3 (dominadas) = 6', semanas[1].porGrupo.espalda?.series === 6)
check('semana actual: hombro 3 series', semanas[1].porGrupo.hombro?.series === 3)
check('semana actual: total 13', semanas[1].totalSeries === 13)
check('semana anterior: pecho 5', semanas[0].porGrupo.pecho?.series === 5 && semanas[0].totalSeries === 5)
check('tonelaje pecho actual = 4×10×60', semanas[1].porGrupo.pecho?.tonelaje === 2400)
check('label semana', semanas[1].label === '17–23 ago')

// ── Progresión / estancamiento ───────────────────────────────────────────────
const sesionesDe = (nombre: string, datos: [string, number, number][]): Sesion[] => datos.map(([fecha, reps, kg], i) => mkSes(nombre + i, fecha, [[nombre, 3, reps, kg]]))
const histProg = [ ...sesionesDe('Press banca', [['2026-07-01', 10, 60], ['2026-07-08', 10, 62.5], ['2026-07-15', 10, 65], ['2026-08-20', 10, 67.5]]), ...sesionesDe('Remo', [['2026-07-01', 10, 60], ['2026-07-22', 10, 60], ['2026-08-05', 10, 60], ['2026-08-12', 10, 60], ['2026-08-19', 10, 60]]), ...sesionesDe('Curl', [['2026-07-01', 10, 30], ['2026-07-08', 10, 30], ['2026-08-05', 10, 26], ['2026-08-12', 10, 26], ['2026-08-19', 10, 26]]), ...sesionesDe('Dominadas', [['2026-07-01', 6, 0], ['2026-07-08', 7, 0], ['2026-08-12', 8, 0], ['2026-08-19', 9, 0]]), ...sesionesDe('Prensa', [['2026-07-01', 10, 100], ['2026-08-19', 10, 105]]) ]
const analisis = analizarProgresion(histProg, '2026-08-23')
const por = (n: string) => analisis.find((a) => a.nombre === n)
check('Press banca progresando (último = mejor)', por('Press banca')?.estado === 'progresando')
check('Remo estancado (4 sesiones sin mejorar)', por('Remo')?.estado === 'estancado' && por('Remo')?.sesionesSinMejora === 4)
check('Curl en regresión (media3 < 93% del mejor)', por('Curl')?.estado === 'regresion')
check('Dominadas usa métrica reps y progresa', por('Dominadas')?.metrica === 'reps' && por('Dominadas')?.estado === 'progresando')
check('Prensa fuera (solo 2 sesiones)', por('Prensa') === undefined)
check('orden: regresión antes que estancado', analisis[0].estado === 'regresion' && analisis[1].estado === 'estancado')
const deload1 = evaluarDeload(analisis, '2026-08-23')
check('deload NO con 2 afectados', deload1.sugerir === false && deload1.afectados.length === 2)
const histProg2 = [...histProg, ...sesionesDe('Militar', [['2026-07-01', 10, 40], ['2026-07-22', 10, 40], ['2026-08-05', 10, 40], ['2026-08-12', 10, 40], ['2026-08-19', 10, 40]])]
const deload2 = evaluarDeload(analizarProgresion(histProg2, '2026-08-23'), '2026-08-23')
check('deload SÍ con 3 afectados recientes', deload2.sugerir === true && deload2.afectados.length === 3)
const deload3 = evaluarDeload(analizarProgresion(histProg2, '2026-10-01'), '2026-10-01')
check('deload NO si hace >21 días que no se entrenan', deload3.sugerir === false)

console.log(fallos === 0 ? '\nTODOS LOS TESTS PASAN' : `\n${fallos} TESTS FALLAN`)
process.exit(fallos === 0 ? 0 : 1)
