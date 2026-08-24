/**
 * Volumen semanal por grupo muscular: nº de series efectivas (con datos) por
 * semana (lunes–domingo) y grupo, sobre el historial en kg de referencia.
 *
 * La métrica estándar de hipertrofia es series/semana por grupo; el rango
 * orientativo 10–20 se usa como banda objetivo en la UI.
 */
import type { Sesion } from '../types/models'
import { serieConDatos } from '../types/models'
import { grupoDeEjercicio, type GrupoId } from './gruposMusculares'

export interface VolumenGrupo {
  series: number
  tonelaje: number
}

export interface SemanaVolumen {
  /** Lunes de la semana (ISO yyyy-mm-dd) */
  inicio: string
  /** Domingo de la semana (ISO yyyy-mm-dd) */
  fin: string
  /** Etiqueta corta, p. ej. "18–24 ago" */
  label: string
  esActual: boolean
  porGrupo: Partial<Record<GrupoId, VolumenGrupo>>
  totalSeries: number
}

export const OBJETIVO_SERIES_MIN = 10
export const OBJETIVO_SERIES_MAX = 20

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Aritmética de fechas en LOCAL (nunca toISOString: desplaza un día según la zona horaria)
function isoAddDays(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + dias)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Lunes de la semana de una fecha ISO. */
export function lunesDe(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7 // lunes=0 … domingo=6
  return isoAddDays(iso, -offset)
}

function labelSemana(inicio: string, fin: string): string {
  const [, mI, dI] = inicio.split('-').map(Number)
  const [, mF, dF] = fin.split('-').map(Number)
  return mI === mF
    ? `${dI}–${dF} ${MESES_CORTO[mF - 1]}`
    : `${dI} ${MESES_CORTO[mI - 1]} – ${dF} ${MESES_CORTO[mF - 1]}`
}

/**
 * Series y tonelaje por grupo muscular de las últimas `numSemanas` semanas
 * (la última es la semana en curso). `hoy` inyectable para tests.
 */
export function calcularVolumenSemanal(
  historial: Sesion[],
  numSemanas: number,
  hoy: string = new Date().toISOString().slice(0, 10),
): SemanaVolumen[] {
  const lunesActual = lunesDe(hoy)
  const semanas: SemanaVolumen[] = []
  for (let i = numSemanas - 1; i >= 0; i--) {
    const inicio = isoAddDays(lunesActual, -7 * i)
    const fin = isoAddDays(inicio, 6)
    semanas.push({ inicio, fin, label: labelSemana(inicio, fin), esActual: i === 0, porGrupo: {}, totalSeries: 0 })
  }
  const primera = semanas[0].inicio

  for (const ses of historial) {
    if (ses.fecha < primera || ses.fecha > semanas[semanas.length - 1].fin) continue
    const semana = semanas.find((s) => ses.fecha >= s.inicio && ses.fecha <= s.fin)
    if (!semana) continue
    for (const ej of ses.ejercicios) {
      if (!ej.completado || ej.saltado) continue
      const validas = ej.series.filter(serieConDatos)
      if (validas.length === 0) continue
      const grupo = grupoDeEjercicio(ej.nombreSustituido ?? ej.nombreSnapshot)
      const acc = semana.porGrupo[grupo] ?? { series: 0, tonelaje: 0 }
      acc.series += validas.length
      acc.tonelaje += validas.reduce((a, s) => {
        const kg = Number(s.pesoKg), reps = Number(s.reps)
        return a + (kg > 0 && reps > 0 ? kg * reps : 0)
      }, 0)
      semana.porGrupo[grupo] = acc
      semana.totalSeries += validas.length
    }
  }
  return semanas
}
