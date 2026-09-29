/**
 * MEAM — servicios Supabase: correcciones del mapa de variantes (meam_variants) y snapshots append-only (meam_snapshots).
 * Todo tolerante a que las tablas aún no existan (SQL v2.8.0 pendiente): nunca rompe la app, solo avisa por consola.
 */
import { supabase, getIdActivo } from '../services/supabase'
import type { VariantOverride, MeamMuscle } from './variants'
import type { VariantRole, EquipmentClass } from './engine'
import type { InformeMeam, InformeMusculo } from './run'

const MUSCULOS = new Set<string>(['pecho', 'hombro', 'biceps', 'triceps', 'espalda', 'cuadriceps', 'femoral_gluteo', 'gemelo', 'abdomen', 'otros'])
const ROLES = new Set<string>(['DIRECT', 'SECONDARY', 'STABILIZER'])
const EQUIPOS = new Set<string>(['compound_free', 'isolation_machine', 'assisted', 'weighted_bodyweight'])

export async function cargarVariantesRevisadas(): Promise<VariantOverride[]> {
  const id = getIdActivo()
  if (!id) return []
  try {
    const { data, error } = await supabase.from('meam_variants').select('*').eq('usuario_id', id)
    if (error) throw error
    return (data ?? []).flatMap((r: Record<string, unknown>) => {
      const musculo = String(r.musculo ?? ''), role = String(r.role ?? 'DIRECT'), equipment = String(r.equipment ?? 'compound_free')
      if (!MUSCULOS.has(musculo)) return []
      return [{
        ejercicio: String(r.ejercicio ?? ''), musculo: musculo as MeamMuscle, cluster: String(r.cluster ?? 'OTROS'),
        role: (ROLES.has(role) ? role : 'DIRECT') as VariantRole, equipment: (EQUIPOS.has(equipment) ? equipment : 'compound_free') as EquipmentClass,
        es_asistencia: !!r.es_asistencia, aislamiento: !!r.aislamiento,
      }]
    })
  } catch (e) {
    console.warn('[MEAM] meam_variants no disponible (¿falta el SQL de v2.8.0?):', e)
    return []
  }
}

export async function guardarVarianteRevisada(o: VariantOverride): Promise<boolean> {
  const id = getIdActivo()
  if (!id) return false
  try {
    const { error } = await supabase.from('meam_variants').upsert({ usuario_id: id, ...o, updated_at: new Date().toISOString() }, { onConflict: 'usuario_id,ejercicio' })
    if (error) throw error
    return true
  } catch (e) {
    console.warn('[MEAM] no se pudo guardar la variante revisada:', e)
    return false
  }
}

/** Fila de meam_snapshots. Append-only: una fila por (usuario, semana, músculo, model_version, config_version, input_hash). */
export interface SnapshotFila {
  usuario_id: string; semana: string; musculo: string; model_version: string; config_version: string; input_hash: string
  estado: string; etiqueta: string; recuperacion: string; etiqueta_recuperacion: string; confianza: string; accion: string
  evidencia: unknown; calculated_at: string
}

function filaDe(usuarioId: string, inf: InformeMeam, m: InformeMusculo): SnapshotFila {
  return {
    usuario_id: usuarioId, semana: m.semana, musculo: m.musculo, model_version: inf.modelVersion, config_version: inf.configVersion, input_hash: m.inputHash,
    estado: m.estado, etiqueta: m.etiqueta, recuperacion: m.recuperacion, etiqueta_recuperacion: m.etiquetaRecuperacion, confianza: m.confianza, accion: m.accion,
    evidencia: {
      T: m.T, D: m.D, sigma_pct: m.sigmaPct, rho: m.rho, rho_calibrado: m.rhoCalibrado, motivos_confianza: m.motivosConfianza, cambio_kg: m.cambioKg, volumen_series_semana: m.volumenSeriesSemana,
      volumen_percentil: m.volumenPercentil, frecuencia_semanal: m.frecuenciaSemanal, contexto_alto: m.contextoAlto, flags: m.flags,
      ejercicios: m.ejercicios.map((e) => ({ key: e.key, nombre: e.nombre, cluster: e.cluster, T: e.T, pendiente_pct_sem: e.pendientePctSem, mds_kg_mes: e.mdsKgMes, e1rm: e.e1rmActual, tier: e.tier,
        n: e.nExposiciones, calidad_temporal: e.calidadTemporal, estrato: e.estrato, sin_mejora_6: e.sinMejoraEn6, T_long: e.TLong, flags: e.flags })),
      fase_nutricional: inf.faseNutricional, peso_pendiente_pct_sem: inf.pesoPendientePctSem,
    },
    calculated_at: new Date().toISOString(),
  }
}

/**
 * Guarda los snapshots del corte actual si no existen ya con el mismo input_hash (idempotente; nunca UPDATE).
 * Devuelve el número de filas insertadas (0 si la tabla no existe o ya estaban).
 */
export async function guardarSnapshots(inf: InformeMeam): Promise<number> {
  const id = getIdActivo()
  if (!id || inf.musculos.length === 0) return 0
  try {
    const semana = inf.musculos[0].semana
    const { data: existentes, error: e1 } = await supabase.from('meam_snapshots').select('musculo,input_hash')
      .eq('usuario_id', id).eq('semana', semana).eq('model_version', inf.modelVersion).eq('config_version', inf.configVersion)
    if (e1) throw e1
    const ya = new Set((existentes ?? []).map((r: Record<string, unknown>) => `${r.musculo}|${r.input_hash}`))
    const nuevas = inf.musculos.filter((m) => !ya.has(`${m.musculo}|${m.inputHash}`)).map((m) => filaDe(id, inf, m))
    if (nuevas.length === 0) return 0
    // upsert con ignoreDuplicates: dos dispositivos calculando la misma semana no chocan (UNIQUE de la tabla; nunca UPDATE)
    const { error: e2 } = await supabase.from('meam_snapshots').upsert(nuevas, { onConflict: 'usuario_id,semana,musculo,model_version,config_version,input_hash', ignoreDuplicates: true })
    if (e2) throw e2
    return nuevas.length
  } catch (e) {
    console.warn('[MEAM] snapshots no guardados (¿falta el SQL de v2.8.0?):', e)
    return 0
  }
}

/** Últimos snapshots guardados de un músculo (para el histórico del informe mensual). */
export async function cargarSnapshots(musculo: string, limite = 26): Promise<SnapshotFila[]> {
  const id = getIdActivo()
  if (!id) return []
  try {
    const { data, error } = await supabase.from('meam_snapshots').select('*').eq('usuario_id', id).eq('musculo', musculo).order('semana', { ascending: false }).limit(limite)
    if (error) throw error
    return (data ?? []) as SnapshotFila[]
  } catch (e) {
    console.warn('[MEAM] snapshots no disponibles:', e)
    return []
  }
}
