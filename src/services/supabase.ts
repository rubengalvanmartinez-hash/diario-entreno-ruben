import { createClient } from '@supabase/supabase-js'
import type {
  Sesion,
  RegistroPeso,
  SesionEjercicio,
  Serie,
  EtiquetaSerie,
  DiaId,
  TipoSesion,
  Ejercicio,
} from '../types/models'
import { DEFAULT_EJERCICIOS } from '../store/defaultData'
import { useFitLogStore } from '../store/useFitLogStore'

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://fxhkzstvxljlohrlgyyc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4aGt6c3R2eGxqbG9ocmxneXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzA1OTMsImV4cCI6MjA5MTQwNjU5M30.BHoDE8V0ZLclkvSBdrFkAeqCQAkHW1j3IxzwchJh9B8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface UsuarioActivo {
  id: string          // UUID de Supabase o 'ruben'
  nombre: string
  esAdmin: boolean
  esRuben: boolean
  puedePesoCorporal?: boolean
}

export interface UsuarioSupabase {
  id: string
  nombre: string
  email?: string
  edad?: number
  altura_cm?: number
  sexo?: 'hombre' | 'mujer'
  es_admin: boolean
  puede_peso_corporal?: boolean
  created_at?: string
}

// ── Perfil visto por admin ──────────────────────────────────────────────────

export interface PerfilVisto {
  id: string
  nombre: string
}

export function getPerfilVisto(): PerfilVisto | null {
  try {
    const raw = localStorage.getItem('fitlog_perfil_visto')
    return raw ? (JSON.parse(raw) as PerfilVisto) : null
  } catch { return null }
}

export function setPerfilVisto(p: PerfilVisto): void {
  localStorage.setItem('fitlog_perfil_visto', JSON.stringify(p))
}

export function clearPerfilVisto(): void {
  localStorage.removeItem('fitlog_perfil_visto')
}

/**
 * Devuelve el UUID que deben usar las operaciones de Supabase.
 * Prioridad: perfilVisto → Rubén UUID → usuario activo UUID.
 */
export function getIdActivo(): string | null {
  const perfil = getPerfilVisto()
  if (perfil) return perfil.id
  const u = getUsuarioActivo()
  if (!u) return null
  return u.esRuben ? getRubenUUID() : u.id
}

// ---------------------------------------------------------------------------
// Helpers de sesión local
// ---------------------------------------------------------------------------

export function getUsuarioActivo(): UsuarioActivo | null {
  try {
    const raw = localStorage.getItem('fitlog_usuario_activo')
    if (!raw) return null
    return JSON.parse(raw) as UsuarioActivo
  } catch {
    return null
  }
}

export function setUsuarioActivo(u: UsuarioActivo): void {
  localStorage.setItem('fitlog_usuario_activo', JSON.stringify(u))
}

export function cerrarSesionLocal(): void {
  localStorage.removeItem('fitlog_usuario_activo')
}

/** Devuelve el UUID persistente de Rubén (lo crea con randomUUID si aún no existe). */
export function getRubenUUID(): string {
  const stored = localStorage.getItem('fitlog-ruben-uuid')
  if (stored) return stored
  const uuid = crypto.randomUUID()
  localStorage.setItem('fitlog-ruben-uuid', uuid)
  return uuid
}

/**
 * Garantiza que Rubén tiene una fila en la tabla `usuarios` de Supabase.
 * Es necesario porque `entrenos` y `registros_peso` tienen FK → `usuarios.id`.
 * Usa upsert con ignoreDuplicates para que sea idempotente (seguro llamarlo
 * varias veces sin crear duplicados).
 */
export async function asegurarUsuarioRuben(uuid: string): Promise<void> {
  const hash = await hashPassword('') // hash de contraseña vacía — Rubén no usa password
  const { error } = await supabase
    .from('usuarios')
    .upsert(
      { id: uuid, nombre: 'Rubén', es_admin: true, password_hash: hash },
      { onConflict: 'id', ignoreDuplicates: true },
    )
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Hash de contraseña (Web Crypto API — nativa en todos los navegadores)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// CRUD de usuarios
// ---------------------------------------------------------------------------

export async function obtenerUsuarios(): Promise<UsuarioSupabase[]> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email, edad, altura_cm, sexo, es_admin, puede_peso_corporal, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as UsuarioSupabase[]
}

export async function verificarPassword(userId: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password)
  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('id', userId)
    .eq('password_hash', hash)
    .maybeSingle()
  if (error) return false
  return !!data
}

export async function crearUsuario(datos: {
  nombre: string
  email?: string
  password?: string   // opcional: si no se pasa, password_hash queda null (primer acceso)
  edad?: number
  altura_cm?: number
  sexo?: 'hombre' | 'mujer'
}): Promise<UsuarioSupabase> {
  const password_hash = datos.password ? await hashPassword(datos.password) : null
  const { data, error } = await supabase
    .from('usuarios')
    .insert({
      nombre: datos.nombre,
      email: datos.email || null,
      password_hash,
      edad: datos.edad || null,
      altura_cm: datos.altura_cm || null,
      sexo: datos.sexo || null,
      es_admin: false,
      puede_peso_corporal: false,
    })
    .select('id, nombre, email, edad, altura_cm, sexo, es_admin, puede_peso_corporal, created_at')
    .single()
  if (error) throw error
  return data as UsuarioSupabase
}

export async function actualizarUsuario(
  id: string,
  datos: {
    nombre?: string
    email?: string
    password?: string
    edad?: number
    altura_cm?: number
    sexo?: 'hombre' | 'mujer'
    es_admin?: boolean
    puede_peso_corporal?: boolean
  },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {}
  if (datos.nombre !== undefined)              update.nombre              = datos.nombre
  if (datos.email !== undefined)               update.email               = datos.email || null
  if (datos.edad !== undefined)                update.edad                = datos.edad || null
  if (datos.altura_cm !== undefined)           update.altura_cm           = datos.altura_cm || null
  if (datos.sexo !== undefined)                update.sexo                = datos.sexo || null
  if (datos.es_admin !== undefined)            update.es_admin            = datos.es_admin
  if (datos.puede_peso_corporal !== undefined) update.puede_peso_corporal = datos.puede_peso_corporal
  if (datos.password)                          update.password_hash       = await hashPassword(datos.password)

  const { error } = await supabase.from('usuarios').update(update).eq('id', id)
  if (error) throw error
}

/** Devuelve true si el usuario no tiene contraseña establecida (primer acceso). */
export async function tienePasswordVacio(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('password_hash')
    .eq('id', userId)
    .single()
  if (error) return false
  return !data?.password_hash
}

/** Establece la contraseña de un usuario (usado en el primer acceso). */
export async function establecerPassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password)
  const { error } = await supabase
    .from('usuarios')
    .update({ password_hash: hash })
    .eq('id', userId)
  if (error) throw error
}

export async function eliminarUsuario(id: string): Promise<void> {
  const { error } = await supabase.from('usuarios').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Sincronización de entrenos
// ---------------------------------------------------------------------------

/**
 * Sincroniza la sesión completa al terminar.
 * Idempotente: elimina filas previas del sesion_id antes de insertar.
 */
export async function sincronizarEntrenoSupabase(
  usuarioId: string,
  sesion: Sesion,
): Promise<void> {
  // Borrar primero para evitar duplicados (idempotente)
  const { error: errDel } = await supabase
    .from('entrenos')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('sesion_id', sesion.id)
  if (errDel) {
    console.error('[Supabase] sincronizarEntrenoSupabase DELETE:', errDel)
    // Continuar de todas formas — el INSERT podría seguir funcionando
  }

  const rows = sesion.ejercicios.flatMap((ej) =>
    ej.series.map((serie) => ({
      usuario_id: usuarioId,
      sesion_id: sesion.id,
      fecha: sesion.fecha,
      dia: String(sesion.dia),
      ejercicio: ej.nombreSustituido ?? ej.nombreSnapshot,
      serie: serie.numero,
      reps: serie.reps !== '' ? serie.reps : null,
      peso_kg: serie.pesoKg !== '' ? serie.pesoKg : null,
      etiqueta: serie.etiqueta ?? null,
      nota: ej.notaSesion || null,
      ayuda_fede: ej.ayudaFede ?? false,
    })),
  )
  if (rows.length === 0) return
  const { error } = await supabase.from('entrenos').insert(rows)
  if (error) {
    console.error('[Supabase] sincronizarEntrenoSupabase INSERT:', error)
    throw error
  }
}

/**
 * Sincroniza un único ejercicio al pulsar "Guardar y siguiente" (fire-and-forget).
 * Idempotente: borra filas previas del ejercicio en esa sesión antes de insertar.
 */
export async function sincronizarEjercicioSupabase(
  usuarioId: string,
  sesion: Pick<Sesion, 'id' | 'fecha' | 'dia'>,
  ejercicio: SesionEjercicio,
): Promise<void> {
  const nombreEj = ejercicio.nombreSustituido ?? ejercicio.nombreSnapshot

  await supabase
    .from('entrenos')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('sesion_id', sesion.id)
    .eq('ejercicio', nombreEj)

  const rows = ejercicio.series.map((serie) => ({
    usuario_id: usuarioId,
    sesion_id: sesion.id,
    fecha: sesion.fecha,
    dia: String(sesion.dia),
    ejercicio: nombreEj,
    serie: serie.numero,
    reps: serie.reps !== '' ? serie.reps : null,
    peso_kg: serie.pesoKg !== '' ? serie.pesoKg : null,
    etiqueta: serie.etiqueta ?? null,
    nota: ejercicio.notaSesion || null,
    ayuda_fede: ejercicio.ayudaFede ?? false,
  }))
  if (rows.length === 0) return
  const { error } = await supabase.from('entrenos').insert(rows)
  if (error) {
    console.error('[Supabase] sincronizarEjercicioSupabase INSERT:', error)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Sincronización de peso (solo para usuarios no-Rubén)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Carga de datos de un usuario desde Supabase (para mostrar al hacer login)
// ---------------------------------------------------------------------------

export interface DatosUsuarioCargados {
  sesiones: Sesion[]
  registrosPeso: RegistroPeso[]
}

export async function cargarDatosUsuario(usuarioId: string): Promise<DatosUsuarioCargados> {
  const [{ data: entrenos, error: errEntrenos }, { data: pesos, error: errPesos }] =
    await Promise.all([
      supabase
        .from('entrenos')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('fecha', { ascending: false }),
      supabase
        .from('registros_peso')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('fecha', { ascending: false }),
    ])

  if (errEntrenos) throw errEntrenos
  if (errPesos) throw errPesos

  // ── Reconstruir Sesion[] agrupando filas por sesion_id ───────────────────
  type SesionAccum = {
    fecha: string
    dia: string
    ejercicios: Map<string, { rows: Record<string, unknown>[] }>
  }
  const sesionMap = new Map<string, SesionAccum>()

  for (const row of entrenos ?? []) {
    if (!sesionMap.has(row.sesion_id)) {
      sesionMap.set(row.sesion_id, { fecha: row.fecha, dia: row.dia, ejercicios: new Map() })
    }
    const s = sesionMap.get(row.sesion_id)!
    if (!s.ejercicios.has(row.ejercicio)) {
      s.ejercicios.set(row.ejercicio, { rows: [] })
    }
    s.ejercicios.get(row.ejercicio)!.rows.push(row)
  }

  const sesiones: Sesion[] = []
  for (const [sesionId, datos] of sesionMap) {
    const diaRaw = datos.dia
    const dia: Sesion['dia'] =
      diaRaw === 'parcial' ? 'parcial' :
      diaRaw === 'extra'   ? 'extra'   :
      (Number(diaRaw) as DiaId)
    const tipo: TipoSesion =
      dia === 'parcial' ? 'parcial' : dia === 'extra' ? 'extra' : 'normal'

    const ejercicios: SesionEjercicio[] = []
    for (const [ejercNombre, { rows }] of datos.ejercicios) {
      const primera = rows[0] as Record<string, unknown>
      const series: Serie[] = (rows as Record<string, unknown>[])
        .sort((a, b) => (a.serie as number) - (b.serie as number))
        .map((r) => ({
          numero: r.serie as number,
          reps: r.reps !== null ? (r.reps as number) : ('' as const),
          pesoKg: r.peso_kg !== null ? (r.peso_kg as number) : ('' as const),
          ...(r.etiqueta ? { etiqueta: r.etiqueta as EtiquetaSerie } : {}),
        }))

      ejercicios.push({
        ejercicioId: `${sesionId}-${ejercNombre}`,
        nombreSnapshot: ejercNombre,
        series,
        notaSesion: (primera.nota as string | null) ?? '',
        completado: true,
        ...(primera.ayuda_fede ? { ayudaFede: true } : {}),
        ...(primera.descanso_segundos != null
          ? { descansoSegundos: primera.descanso_segundos as number }
          : {}),
      })
    }

    sesiones.push({ id: sesionId, fecha: datos.fecha, dia, tipo, ejercicios, sincronizado: true })
  }

  sesiones.sort((a, b) => b.fecha.localeCompare(a.fecha))

  // ── Reconstruir RegistroPeso[] ────────────────────────────────────────────
  const registrosPeso: RegistroPeso[] = (pesos ?? []).map((r) => ({
    id: r.id as string,
    fecha: r.fecha as string,
    pesoKg: r.peso_kg as number,
    sincronizado: true,
  }))

  return { sesiones, registrosPeso }
}

// ---------------------------------------------------------------------------
// Ejercicios por usuario (tabla ejercicios_usuario en Supabase)
// ---------------------------------------------------------------------------

/** Carga los ejercicios de un amigo desde Supabase. Devuelve null si no tiene ninguno. */
export async function obtenerEjerciciosUsuario(usuarioId: string): Promise<Ejercicio[] | null> {
  const { data, error } = await supabase
    .from('ejercicios_usuario')
    .select('*')
    .eq('usuario_id', usuarioId)
    .order('dia', { ascending: true })
    .order('orden', { ascending: true })
  if (error) throw error
  if (!data || data.length === 0) return null
  return data.map((r) => ({
    id: r.id as string,
    nombre: r.nombre as string,
    dia: r.dia as DiaId,
    orden: r.orden as number,
    seriesPorDefecto: ((r.series_por_defecto ?? 3) as 3 | 4),
    notasFijas: (r.notas_fijas ?? '') as string,
  }))
}

/**
 * Reemplaza todos los ejercicios del usuario en Supabase con el array actual.
 * Estrategia delete+insert para mantener simplicidad.
 */
export async function sincronizarEjerciciosUsuario(
  usuarioId: string,
  ejercicios: Ejercicio[],
): Promise<void> {
  const { error: errDel } = await supabase
    .from('ejercicios_usuario')
    .delete()
    .eq('usuario_id', usuarioId)
  if (errDel) throw errDel

  if (ejercicios.length === 0) return

  const rows = ejercicios.map((e) => ({
    id: e.id,
    usuario_id: usuarioId,
    nombre: e.nombre,
    dia: e.dia,
    orden: e.orden,
    series_por_defecto: e.seriesPorDefecto,
    notas_fijas: e.notasFijas || '',
  }))
  const { error: errIns } = await supabase.from('ejercicios_usuario').insert(rows)
  if (errIns) throw errIns
}

/**
 * Crea los ejercicios de un usuario nuevo copiando la plantilla base desde Supabase.
 * Si la tabla plantilla_ejercicios está vacía, usa los ejercicios por defecto del código.
 * Devuelve los Ejercicio[] ya guardados.
 */
export async function crearEjerciciosDesdeTemplate(
  usuarioId: string,
): Promise<Ejercicio[]> {
  const { data: plantilla, error } = await supabase
    .from('plantilla_ejercicios')
    .select('*')
    .order('dia', { ascending: true })
    .order('orden', { ascending: true })
  if (error) throw error

  let ejercicios: Ejercicio[]

  if (plantilla && plantilla.length > 0) {
    ejercicios = plantilla.map((p) => ({
      id: `u-${usuarioId.slice(0, 8)}-d${p.dia}-${p.orden}`,
      nombre: p.nombre as string,
      dia: p.dia as DiaId,
      orden: p.orden as number,
      seriesPorDefecto: ((p.series_por_defecto ?? 3) as 3 | 4),
      notasFijas: (p.notas_fijas ?? '') as string,
    }))
  } else {
    // Fallback: usar DEFAULT_EJERCICIOS del código con IDs renombrados para este usuario
    ejercicios = DEFAULT_EJERCICIOS.map((e) => ({
      ...e,
      id: `u-${usuarioId.slice(0, 8)}-${e.id}`,
    }))
  }

  await sincronizarEjerciciosUsuario(usuarioId, ejercicios)
  return ejercicios
}

export async function sincronizarPesoSupabase(
  usuarioId: string,
  registro: Pick<RegistroPeso, 'fecha' | 'pesoKg'>,
): Promise<void> {
  const { error } = await supabase.from('registros_peso').insert({
    usuario_id: usuarioId,
    fecha: registro.fecha,
    peso_kg: registro.pesoKg,
  })
  if (error) {
    console.error('[Supabase] sincronizarPesoSupabase INSERT:', error)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Forzar sincronización de todos los registros pendientes
// ---------------------------------------------------------------------------

export interface ResultadoSync {
  sesiones: number
  pesos: number
  errores: string[]
}

/**
 * Sube a Supabase todas las sesiones y pesos con sincronizado=false.
 * Tras cada subida exitosa marca el registro como sincronizado en el store.
 */
export async function forzarSincronizacionPendientes(
  usuarioId: string,
): Promise<ResultadoSync> {
  const store = useFitLogStore.getState()
  const sesionesPendientes = store.historialSesiones.filter((s) => !s.sincronizado)
  const pesosPendientes    = store.registrosPeso.filter((r) => !r.sincronizado)

  let sesiones = 0
  let pesos    = 0
  const errores: string[] = []

  for (const sesion of sesionesPendientes) {
    try {
      await sincronizarEntrenoSupabase(usuarioId, sesion)
      useFitLogStore.getState().marcarSesionSincronizada(sesion.id)
      sesiones++
      console.log(`[Supabase] forzarSync: sesión ${sesion.fecha} ✓`)
    } catch (err) {
      const msg = `Sesión ${sesion.fecha}: ${(err as Error)?.message ?? 'error'}`
      console.error('[Supabase] forzarSync:', msg)
      errores.push(msg)
    }
  }

  for (const peso of pesosPendientes) {
    try {
      await sincronizarPesoSupabase(usuarioId, peso)
      useFitLogStore.getState().marcarPesoSincronizado(peso.id)
      pesos++
      console.log(`[Supabase] forzarSync: peso ${peso.fecha} ✓`)
    } catch (err) {
      const msg = `Peso ${peso.fecha}: ${(err as Error)?.message ?? 'error'}`
      console.error('[Supabase] forzarSync:', msg)
      errores.push(msg)
    }
  }

  return { sesiones, pesos, errores }
}
