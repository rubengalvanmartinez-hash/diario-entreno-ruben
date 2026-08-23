// Tests de lógica pura — bundle con rolldown y ejecutar con node (ver memoria / changelog 2.2.7)
import { normalizarNombre, nombreCanonico, matchesEjercicio } from './src/utils/normalizar'
import { serieConDatos } from './src/types/models'
import { DEFAULT_EJERCICIOS, esConfigPorDefecto } from './src/store/defaultData'
import { grupoDeEjercicio } from './src/utils/gruposMusculares'

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

console.log(fallos === 0 ? '\nTODOS LOS TESTS PASAN' : `\n${fallos} TESTS FALLAN`)
process.exit(fallos === 0 ? 0 : 1)
