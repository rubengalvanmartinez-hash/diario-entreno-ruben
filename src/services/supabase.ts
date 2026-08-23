import { createClient } from '@supabase/supabase-js'
import type {
  Sesion,
  RegistroPeso,
  SesionEjercicio,
  Serie,
  EtiquetaSerie,
  DiaId,
  GimnasioId,
  TipoSesion,
  Ejercicio,
  RegistroComposicion,
  RegistroMedidas,
  PerfilCorporal,
  CategoriaImc,
} from '../types/models'
import { serieConDatos } from '../types/models'
import { DEFAULT_EJERCICIOS, esConfigPorDefecto } from '../store/defaultData'
import { useFitLogStore } from '../store/useFitLogStore'

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://fxhkzstvxljlohrlgyyc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4aGt6c3R2eGxqbG9ocmxneXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzA1OTMsImV4cCI6MjA5MTQwNjU5M30.BHoDE8V0ZLclkvSBdrFkAeqCQAkHW1j3IxzwchJh9B8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ---------------------------------------------------------------------------
// Helper de paginación — Supabase limita a 1000 filas por defecto
// ---------------------------------------------------------------------------

/**
 * Trae TODAS las filas de una consulta usando .range() en bloques de 1000.
 * queryFn recibe (from, to) y debe devolver la misma consulta base con .range() aplicado.
 * Lanza el error de Supabase si alguna página falla.
 */
async function fetchAllPages<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  label = 'fetchAllPages',
): Promise<T[]> {
  const PAGE_SIZE = 1000
  const result: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    result.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  console.log(`[Supabase] ${label}: ${result.length} filas totales cargadas`)
  return result
}

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
  /** true si el usuario ya tiene contraseña establecida (derivado de password_hash, nunca se expone el hash) */
  tiene_password?: boolean
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

/** UUID fijo de Rubén en Supabase — nunca cambia, nunca se genera uno nuevo. */
export const RUBEN_UUID = '392a4716-66d9-40b3-bb26-131c8988e05a'

/** Devuelve siempre el UUID fijo de Rubén y lo persiste en localStorage. */
export function getRubenUUID(): string {
  localStorage.setItem('fitlog-ruben-uuid', RUBEN_UUID)
  return RUBEN_UUID
}

/**
 * Garantiza que Rubén tiene una fila en la tabla `usuarios` de Supabase.
 * Es necesario porque `entrenos` y `registros_peso` tienen FK → `usuarios.id`.
 * Usa upsert con ignoreDuplicates para que sea idempotente (seguro llamarlo
 * varias veces sin crear duplicados).
 */
/**
 * Verifica que Rubén tiene fila en la tabla usuarios (FK constraint).
 * Usa ignoreDuplicates: true — si ya existe NO actualiza nada (no toca password_hash).
 * Siempre usa RUBEN_UUID, ignorando el parámetro uuid para evitar inserts con UUID aleatorio.
 */
export async function asegurarUsuarioRuben(_uuid?: string): Promise<void> {
  const { error } = await supabase
    .from('usuarios')
    .upsert(
      { id: RUBEN_UUID, nombre: 'Rubén', es_admin: true, puede_peso_corporal: true },
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
    .select('id, nombre, email, edad, altura_cm, sexo, es_admin, puede_peso_corporal, created_at, password_hash')
    .order('created_at', { ascending: true })
  if (error) throw error
  // Exponer solo si tiene contraseña, nunca el hash
  return (data ?? []).map(({ password_hash, ...u }) => ({
    ...(u as UsuarioSupabase),
    tiene_password: !!password_hash,
  }))
}

/**
 * Restablece la contraseña de un usuario: deja password_hash a NULL, de modo
 * que en su siguiente acceso la app le pide crear una contraseña nueva
 * (flujo de "primer acceso"). La app no guarda contraseñas ni envía emails.
 */
export async function restablecerPassword(userId: string): Promise<void> {
  const { error } = await supabase
    .from('usuarios')
    .update({ password_hash: null })
    .eq('id', userId)
  if (error) throw error
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
/**
 * INSERT en entrenos con tolerancia a que la columna gimnasio aún no exista
 * (hasta que el admin ejecute el SQL de v2.5.0): reintenta sin ella.
 */
async function insertarEntrenos(rows: Record<string, unknown>[], origen: string): Promise<void> {
  const { error } = await supabase.from('entrenos').insert(rows)
  if (!error) return
  const msg = String(error.message ?? '')
  if (error.code === 'PGRST204' || /gimnasio/i.test(msg)) {
    console.warn(`[Supabase] ${origen}: la columna gimnasio no existe aún — reintentando sin ella (pendiente ejecutar el SQL de v2.5.0)`)
    const sinGimnasio = rows.map((r) => { const copia = { ...r }; delete copia.gimnasio; return copia })
    const { error: error2 } = await supabase.from('entrenos').insert(sinGimnasio)
    if (!error2) return
    console.error(`[Supabase] ${origen} INSERT:`, error2)
    throw error2
  }
  console.error(`[Supabase] ${origen} INSERT:`, error)
  throw error
}

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

  // No subir ejercicios saltados ni guardados sin ningún dato real (series vacías):
  // generaban filas con reps/peso null que ensuciaban el "último entreno"
  const rows = sesion.ejercicios
    .filter((ej) => ej.completado && !ej.saltado && ej.series.some(serieConDatos))
    .flatMap((ej) =>
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
      gimnasio: sesion.gimnasio ?? null,
    })),
  )
  if (rows.length === 0) return
  await insertarEntrenos(rows, 'sincronizarEntrenoSupabase')
}

/**
 * Sincroniza un único ejercicio al pulsar "Guardar y siguiente" (fire-and-forget).
 * Idempotente: borra filas previas del ejercicio en esa sesión antes de insertar.
 */
export async function sincronizarEjercicioSupabase(
  usuarioId: string,
  sesion: Pick<Sesion, 'id' | 'fecha' | 'dia' | 'gimnasio'>,
  ejercicio: SesionEjercicio,
): Promise<void> {
  const nombreEj = ejercicio.nombreSustituido ?? ejercicio.nombreSnapshot

  await supabase
    .from('entrenos')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('sesion_id', sesion.id)
    .eq('ejercicio', nombreEj)

  // No subir el ejercicio si está saltado o no tiene ningún dato real
  // (el DELETE previo ya limpia filas antiguas de este ejercicio en la sesión)
  const sinDatos = ejercicio.saltado || !ejercicio.series.some(serieConDatos)
  const rows = sinDatos ? [] : ejercicio.series.map((serie) => ({
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
    gimnasio: sesion.gimnasio ?? null,
  }))
  if (rows.length === 0) return
  await insertarEntrenos(rows, 'sincronizarEjercicioSupabase')
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
  const [entrenos, pesos] = await Promise.all([
    fetchAllPages(
      (from, to) =>
        supabase
          .from('entrenos')
          .select('*')
          .eq('usuario_id', usuarioId)
          .order('fecha', { ascending: true })
          .range(from, to),
      `entrenos(${usuarioId.slice(0, 8)})`,
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from('registros_peso')
          .select('*')
          .eq('usuario_id', usuarioId)
          .order('fecha', { ascending: true })
          .range(from, to),
      `registros_peso(${usuarioId.slice(0, 8)})`,
    ),
  ])

  // ── Reconstruir Sesion[] agrupando filas por sesion_id ───────────────────
  type SesionAccum = {
    fecha: string
    dia: string
    gimnasio: GimnasioId | undefined
    ejercicios: Map<string, { rows: Record<string, unknown>[] }>
  }
  const sesionMap = new Map<string, SesionAccum>()

  for (const row of entrenos) {
    if (!sesionMap.has(row.sesion_id)) {
      sesionMap.set(row.sesion_id, {
        fecha: row.fecha, dia: row.dia,
        gimnasio: row.gimnasio === 'fitnesspark' ? 'fitnesspark' : undefined,
        ejercicios: new Map(),
      })
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

    sesiones.push({
      id: sesionId, fecha: datos.fecha, dia, tipo, ejercicios, sincronizado: true,
      ...(datos.gimnasio ? { gimnasio: datos.gimnasio } : {}),
    })
  }

  sesiones.sort((a, b) => b.fecha.localeCompare(a.fecha))

  // ── Reconstruir RegistroPeso[] ────────────────────────────────────────────
  // La query los trae ascendentes por fecha; el store asume "más reciente
  // primero" (registrarPeso hace prepend), así que se ordenan descendentes
  const registrosPeso: RegistroPeso[] = pesos
    .map((r) => ({
      id: String(r.id ?? ''),
      fecha: String(r.fecha ?? ''),
      pesoKg: Number(r.peso_kg),
      sincronizado: true,
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))

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
 * Respalda en Supabase la configuración local de ejercicios si la tabla
 * ejercicios_usuario está vacía para el usuario activo (config que solo
 * existía en localStorage). Nunca sobreescribe una config remota existente
 * y no hace nada si un admin está viendo el perfil de otro usuario.
 */
export async function respaldarConfigEjerciciosSiFalta(): Promise<void> {
  const usuario = getUsuarioActivo()
  if (!usuario) return
  if (getPerfilVisto()) return // el store contiene los ejercicios del perfil visto, no los propios
  const ejerciciosLocales = useFitLogStore.getState().ejercicios
  if (ejerciciosLocales.length === 0) return
  // Config semilla sin personalizar (dispositivo nuevo): no es la config real
  // del usuario — subirla machacaría la buena en el siguiente login
  if (esConfigPorDefecto(ejerciciosLocales)) return

  const uid = usuario.esRuben ? getRubenUUID() : usuario.id
  const remotos = await obtenerEjerciciosUsuario(uid)
  if (remotos !== null) return // ya hay config remota — no tocar

  if (usuario.esRuben) await asegurarUsuarioRuben() // FK entrenos/ejercicios → usuarios.id
  await sincronizarEjerciciosUsuario(uid, ejerciciosLocales)
  console.log(`[Supabase] Config de ejercicios respaldada en ejercicios_usuario (${ejerciciosLocales.length} ejercicios)`)
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

// ---------------------------------------------------------------------------
// Composición corporal
// ---------------------------------------------------------------------------

/** Guarda (insert o reemplaza por fecha) un registro de composición corporal. */
export async function guardarComposicion(
  usuarioId: string,
  registro: Omit<RegistroComposicion, 'id'>,
): Promise<void> {
  // Borrar el registro del mismo día si existe (idempotente)
  await supabase
    .from('composicion_corporal')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('fecha', registro.fecha)

  const masaGrasaKg = registro.pesoKg * (registro.pctGrasa / 100)
  const { error } = await supabase.from('composicion_corporal').insert({
    usuario_id:         usuarioId,
    fecha:              registro.fecha,
    peso_kg:            registro.pesoKg,
    imc:                registro.imc,
    categoria_imc:      registro.categoriaImc,
    porcentaje_grasa:   registro.pctGrasa,
    porcentaje_musculo: registro.pctMusculo,
    masa_grasa_kg:      +masaGrasaKg.toFixed(2),
    masa_libre_kg:      +(registro.pesoKg - masaGrasaKg).toFixed(2),
  })
  if (error) throw error
}

/** Carga el historial de composición corporal de un usuario desde Supabase. */
export async function cargarComposicion(
  usuarioId: string,
): Promise<RegistroComposicion[]> {
  const data = await fetchAllPages(
    (from, to) =>
      supabase
        .from('composicion_corporal')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('fecha', { ascending: true })
        .range(from, to),
    `composicion_corporal(${usuarioId.slice(0, 8)})`,
  )
  return data.map((r) => ({
    id:           String(r.id),
    fecha:        String(r.fecha),
    pesoKg:       Number(r.peso_kg),
    imc:          Number(r.imc),
    categoriaImc: String(r.categoria_imc) as CategoriaImc,
    pctGrasa:     Number(r.porcentaje_grasa),
    pctMusculo:   Number(r.porcentaje_musculo),
  }))
}

/** Guarda (upsert) el perfil corporal del usuario (altura, edad, sexo, medidas). */
export async function guardarPerfilCorporal(
  usuarioId: string,
  perfil: PerfilCorporal,
): Promise<void> {
  const { error } = await supabase.from('perfil_corporal').upsert(
    {
      usuario_id: usuarioId,
      altura_cm:  perfil.alturaCm,
      edad:       perfil.edad,
      sexo:       perfil.sexo,
      cintura_cm: perfil.cinturaCm,
      cuello_cm:  perfil.cuelloCm,
      cadera_cm:  perfil.caderaCm ?? null,
    },
    { onConflict: 'usuario_id' },
  )
  if (error) throw error
}

/** Carga el perfil corporal del usuario desde Supabase. Devuelve null si no existe. */
export async function cargarPerfilCorporal(
  usuarioId: string,
): Promise<PerfilCorporal | null> {
  const { data, error } = await supabase
    .from('perfil_corporal')
    .select('*')
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    alturaCm:  Number(data.altura_cm),
    edad:      Number(data.edad),
    sexo:      String(data.sexo) as 'hombre' | 'mujer',
    cinturaCm: Number(data.cintura_cm),
    cuelloCm:  Number(data.cuello_cm),
    caderaCm:  data.cadera_cm != null ? Number(data.cadera_cm) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Medidas corporales (perímetros)
// ---------------------------------------------------------------------------

/** Guarda (o reemplaza) las medidas corporales del día en Supabase. */
export async function guardarMedidas(
  usuarioId: string,
  registro: Omit<RegistroMedidas, 'id'>,
): Promise<void> {
  // Idempotente: borrar el registro del mismo día si existe
  await supabase
    .from('medidas_corporales')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('fecha', registro.fecha)

  const { error } = await supabase.from('medidas_corporales').insert({
    usuario_id:      usuarioId,
    fecha:           registro.fecha,
    cuello:          registro.cuello ?? null,
    hombro:          registro.hombro ?? null,
    pecho:           registro.pecho ?? null,
    biceps_izq:      registro.bicepsIzq ?? null,
    biceps_der:      registro.bicepsDer ?? null,
    cintura_alta:    registro.cinturaAlta ?? null,
    cintura_baja:    registro.cinturaBaja ?? null,
    cadera:          registro.cadera ?? null,
    muslo_izq:       registro.musloIzq ?? null,
    muslo_der:       registro.musloDer ?? null,
    pantorrilla_izq: registro.pantorrillaIzq ?? null,
    pantorrilla_der: registro.pantorrillaDer ?? null,
    abdomen:         registro.abdomen ?? null,
  })
  if (error) throw error
}

/** Elimina un registro de medidas por su id. */
export async function eliminarMedidasSupabase(
  usuarioId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('medidas_corporales')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('id', id)
  if (error) throw error
}

/**
 * Elimina el registro de medidas de una fecha. La fecha es única por usuario
 * (guardarMedidas borra la del mismo día antes de insertar), y borrar por fecha
 * es robusto aunque el id local (nanoid) no coincida con el remoto (uuid).
 */
export async function eliminarMedidasPorFecha(
  usuarioId: string,
  fecha: string,
): Promise<void> {
  const { error } = await supabase
    .from('medidas_corporales')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('fecha', fecha)
  if (error) throw error
}

/** Carga el historial de medidas corporales de un usuario desde Supabase. */
export async function cargarMedidas(
  usuarioId: string,
): Promise<RegistroMedidas[]> {
  const { data, error } = await supabase
    .from('medidas_corporales')
    .select('*')
    .eq('usuario_id', usuarioId)
    .order('fecha', { ascending: false })
  if (error) throw error
  if (!data) return []
  return data.map((r) => ({
    id:             String(r.id),
    fecha:          String(r.fecha),
    cuello:          r.cuello         != null ? Number(r.cuello)          : undefined,
    hombro:          r.hombro         != null ? Number(r.hombro)          : undefined,
    pecho:           r.pecho          != null ? Number(r.pecho)           : undefined,
    bicepsIzq:       r.biceps_izq     != null ? Number(r.biceps_izq)      : undefined,
    bicepsDer:       r.biceps_der     != null ? Number(r.biceps_der)      : undefined,
    cinturaAlta:     r.cintura_alta   != null ? Number(r.cintura_alta)    : undefined,
    cinturaBaja:     r.cintura_baja   != null ? Number(r.cintura_baja)    : undefined,
    cadera:          r.cadera         != null ? Number(r.cadera)          : undefined,
    musloIzq:        r.muslo_izq      != null ? Number(r.muslo_izq)       : undefined,
    musloDer:        r.muslo_der      != null ? Number(r.muslo_der)       : undefined,
    pantorrillaIzq:  r.pantorrilla_izq != null ? Number(r.pantorrilla_izq) : undefined,
    pantorrillaDer:  r.pantorrilla_der != null ? Number(r.pantorrilla_der) : undefined,
    abdomen:         r.abdomen        != null ? Number(r.abdomen)         : undefined,
  }))
}

// ---------------------------------------------------------------------------
// Equivalencias entre gimnasios (tabla equivalencias_gimnasio)
// ---------------------------------------------------------------------------

/** Carga las equivalencias Fitness Park → Entrena-T del usuario: nombreCanonico → factor. */
export async function cargarEquivalencias(usuarioId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('equivalencias_gimnasio')
    .select('ejercicio, gimnasio, factor')
    .eq('usuario_id', usuarioId)
    .eq('gimnasio', 'fitnesspark')
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of data ?? []) {
    const f = Number(r.factor)
    if (isFinite(f) && f > 0) out[String(r.ejercicio)] = f
  }
  return out
}

/** Guarda (upsert) el factor de un ejercicio en Fitness Park. */
export async function guardarEquivalencia(usuarioId: string, clave: string, factor: number): Promise<void> {
  const { error } = await supabase
    .from('equivalencias_gimnasio')
    .upsert({ usuario_id: usuarioId, ejercicio: clave, gimnasio: 'fitnesspark', factor, updated_at: new Date().toISOString() }, { onConflict: 'usuario_id,ejercicio,gimnasio' })
  if (error) throw error
}

/** Elimina la equivalencia de un ejercicio en Fitness Park. */
export async function eliminarEquivalencia(usuarioId: string, clave: string): Promise<void> {
  const { error } = await supabase
    .from('equivalencias_gimnasio')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('ejercicio', clave)
    .eq('gimnasio', 'fitnesspark')
  if (error) throw error
}

/** Carga las equivalencias del perfil activo en el store (silencioso si la tabla aún no existe). */
export async function cargarEquivalenciasEnStore(): Promise<void> {
  const id = getIdActivo()
  if (!id) return
  try {
    const eq = await cargarEquivalencias(id)
    const local = useFitLogStore.getState().equivalencias
    if (Object.keys(eq).length === 0 && Object.keys(local).length > 0) {
      // Remoto vacío pero hay locales (p. ej. definidas antes de existir la tabla): respaldarlas
      for (const [clave, factor] of Object.entries(local)) await guardarEquivalencia(id, clave, factor)
      console.log(`[Supabase] ${Object.keys(local).length} equivalencias locales respaldadas`)
      return
    }
    useFitLogStore.getState().importarEquivalencias(eq)
  } catch (e) {
    console.warn('[Supabase] equivalencias no cargadas (¿falta el SQL de v2.5.0?):', e)
  }
}

/** Fija o borra una equivalencia en el store y la sincroniza a Supabase (fire-and-forget). */
export function setEquivalenciaSync(clave: string, factor: number | null): void {
  useFitLogStore.getState().setEquivalencia(clave, factor)
  const id = getIdActivo()
  if (!id) return
  const p = factor === null ? eliminarEquivalencia(id, clave) : guardarEquivalencia(id, clave, factor)
  p.catch((e) => console.warn('[Supabase] equivalencia no sincronizada (¿falta el SQL de v2.5.0?):', e))
}

// ---------------------------------------------------------------------------
// Edición de series en historial
// ---------------------------------------------------------------------------

/**
 * Actualiza el valor de reps o peso_kg de una serie en el historial.
 * La clave compuesta (usuario_id, sesion_id, ejercicio, serie) identifica la fila.
 *
 * v1.8.4 — diagnóstico completo: SELECT previo, comprobación de 0 filas,
 * error explícito si RLS bloquea o WHERE no coincide.
 */
export async function actualizarSerieSupabase(
  usuarioId: string,
  sesionId: string,
  ejercicioNombre: string,
  serieNum: number,
  campo: 'reps' | 'peso_kg',
  valor: number,
): Promise<void> {
  const serieInt = Math.round(serieNum)

  console.log('[actualizarSerie] ── INICIO ──────────────────────────────')
  console.log('[actualizarSerie] usuarioId  :', usuarioId)
  console.log('[actualizarSerie] sesionId   :', sesionId)
  console.log('[actualizarSerie] ejercicio  :', JSON.stringify(ejercicioNombre))
  console.log('[actualizarSerie] serieInt   :', serieInt, '(original:', serieNum, ')')
  console.log('[actualizarSerie] campo      :', campo)
  console.log('[actualizarSerie] valor nuevo:', valor)

  // ── 1. SELECT diagnóstico: ¿existe la fila con estos criterios? ─────────────
  const { data: filasSelect, error: errSelect } = await supabase
    .from('entrenos')
    .select('usuario_id, sesion_id, ejercicio, serie, reps, peso_kg')
    .eq('usuario_id', usuarioId)
    .eq('sesion_id', sesionId)
    .eq('ejercicio', ejercicioNombre)
    .eq('serie', serieInt)

  if (errSelect) {
    console.error('[actualizarSerie] Error en SELECT:', errSelect)
    throw new Error(`SELECT falló: ${errSelect.message}`)
  }

  const nFilas = filasSelect?.length ?? 0
  console.log('[actualizarSerie] SELECT — filas encontradas:', nFilas)
  if (nFilas > 0) {
    console.log('[actualizarSerie] SELECT — primera fila encontrada:', filasSelect![0])
  } else {
    // Sin coincidencia: diagnóstico ampliado — buscar por sesion_id solo para ver qué hay
    const { data: sesionRows } = await supabase
      .from('entrenos')
      .select('ejercicio, serie, reps, peso_kg')
      .eq('usuario_id', usuarioId)
      .eq('sesion_id', sesionId)
    console.warn('[actualizarSerie] 0 filas con ese ejercicio+serie. Todas las filas de esa sesión:', sesionRows)
  }

  if (nFilas === 0) {
    const detalle = `0 filas encontradas — sesion_id="${sesionId}" ejercicio="${ejercicioNombre}" serie=${serieInt}`
    console.error('[actualizarSerie]', detalle)
    throw new Error(detalle)
  }

  // ── 2. UPDATE ────────────────────────────────────────────────────────────────
  const { data: filasUpdate, error: errUpdate } = await supabase
    .from('entrenos')
    .update({ [campo]: valor })
    .eq('usuario_id', usuarioId)
    .eq('sesion_id', sesionId)
    .eq('ejercicio', ejercicioNombre)
    .eq('serie', serieInt)
    .select('serie, reps, peso_kg')   // devuelve las filas actualizadas

  if (errUpdate) {
    console.error('[actualizarSerie] Error en UPDATE:', {
      message: errUpdate.message,
      details: (errUpdate as { details?: string }).details,
      hint:    (errUpdate as { hint?: string }).hint,
      code:    (errUpdate as { code?: string }).code,
    })
    throw new Error(
      `[${(errUpdate as { code?: string }).code ?? '?'}] ${errUpdate.message}` +
      ((errUpdate as { hint?: string }).hint ? ` — ${(errUpdate as { hint?: string }).hint}` : ''),
    )
  }

  const nActualizadas = filasUpdate?.length ?? 0
  console.log('[actualizarSerie] UPDATE — filas actualizadas:', nActualizadas, filasUpdate)

  if (nActualizadas === 0) {
    // Supabase no devolvió error pero tampoco actualizó — casi siempre es RLS sin política UPDATE
    const detalle = `UPDATE afectó 0 filas — probable bloqueo por RLS (falta política UPDATE en tabla entrenos)`
    console.error('[actualizarSerie]', detalle)
    throw new Error(detalle)
  }

  console.log('[actualizarSerie] ── OK ─────────────────────────────────')
}
