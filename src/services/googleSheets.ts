/**
 * Servicio de integración con Google Sheets.
 * Usa Google Identity Services (GIS) para OAuth 2.0 implícito
 * y la Sheets REST API v4 para leer/escribir datos.
 */
import type { Sesion, RegistroPeso, SesionEjercicio, Serie, EtiquetaSerie, DiaId } from '../types/models'

// ── Tipos GIS (declaración mínima; no necesitamos @types/google-one-tap) ──────

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: GisTokenConfig): GisTokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

interface GisTokenConfig {
  client_id: string
  scope: string
  callback: (resp: GisTokenResponse) => void
  error_callback?: (err: { type: string }) => void
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
  callback: (resp: GisTokenResponse) => void
  error_callback?: (err: { type: string }) => void
}
interface GisTokenResponse {
  access_token: string
  expires_in: number
  error?: string
  error_description?: string
}

// ── Constantes ────────────────────────────────────────────────────────────────

const GIS_SRC    = 'https://accounts.google.com/gsi/client'
const SCOPE      = 'https://www.googleapis.com/auth/spreadsheets'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

// ── Carga del script GIS (singleton) ─────────────────────────────────────────

let gisReady = false
let gisLoadPromise: Promise<void> | null = null

function cargarGIS(): Promise<void> {
  if (gisReady) return Promise.resolve()
  if (gisLoadPromise) return gisLoadPromise

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      // Script ya en el DOM pero aún cargando
      const wait = () => {
        if (window.google?.accounts?.oauth2) { gisReady = true; resolve() }
        else setTimeout(wait, 50)
      }
      wait()
      return
    }
    const el = document.createElement('script')
    el.src   = GIS_SRC
    el.async = true
    el.defer = true
    el.onload  = () => { gisReady = true; resolve() }
    el.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'))
    document.head.appendChild(el)
  })

  return gisLoadPromise
}

// ── Token client (singleton por sesión) ──────────────────────────────────────

let tokenClient: GisTokenClient | null = null

async function obtenerTokenClient(clientId: string): Promise<GisTokenClient> {
  await cargarGIS()
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope:     SCOPE,
      callback:  () => { /* se sobreescribe en cada llamada */ },
    })
  }
  return tokenClient
}

// ── Funciones públicas de autenticación ───────────────────────────────────────

export interface GoogleSession {
  accessToken: string
  email:       string
}

/**
 * Abre el popup de Google OAuth y devuelve {accessToken, email}.
 * Lanza un error si el usuario cancela o hay algún fallo.
 */
export async function iniciarSesionGoogle(clientId: string): Promise<GoogleSession> {
  const client = await obtenerTokenClient(clientId)

  return new Promise<GoogleSession>((resolve, reject) => {
    client.callback = async (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description ?? resp.error))
        return
      }
      // Obtener email con la API userinfo
      try {
        const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${resp.access_token}` },
        }).then((r) => r.json())
        resolve({ accessToken: resp.access_token, email: info.email ?? '' })
      } catch {
        resolve({ accessToken: resp.access_token, email: '' })
      }
    }
    client.error_callback = (err) => {
      // 'popup_closed' significa que el usuario cerró el popup
      if (err.type === 'popup_closed') reject(new Error('Login cancelado'))
      else reject(new Error(`Error GIS: ${err.type}`))
    }
    client.requestAccessToken({ prompt: '' })
  })
}

/**
 * Revoca el token y cierra la sesión local.
 */
export function cerrarSesionGoogle(token: string): Promise<void> {
  return new Promise<void>(async (resolve) => {
    await cargarGIS().catch(() => { /* si GIS no cargó, ignorar */ })
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => resolve())
    } else {
      resolve()
    }
  })
}

// ── Helper de llamadas REST ───────────────────────────────────────────────────

export class ErrorTokenExpirado extends Error {
  constructor() { super('Token expirado. Vuelve a conectar tu cuenta de Google.') }
}

async function apiRequest<T = unknown>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) throw new ErrorTokenExpirado()

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = (errBody as any)?.error?.message ?? `HTTP ${res.status}`
    throw new Error(msg)
  }

  return res.json() as Promise<T>
}

// ── Gestión de hojas ──────────────────────────────────────────────────────────

// Cache de hojas existentes por spreadsheetId (se limpia al iniciar cada sync)
const hojasCache = new Map<string, Set<string>>()

async function asegurarHoja(
  token:         string,
  spreadsheetId: string,
  titulo:        string,
  cabeceras:     string[],
): Promise<void> {
  // Llenar caché si aún no está
  if (!hojasCache.has(spreadsheetId)) {
    const data = await apiRequest<{ sheets: { properties: { title: string } }[] }>(
      'GET',
      `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`,
      token,
    )
    hojasCache.set(
      spreadsheetId,
      new Set((data.sheets ?? []).map((s) => s.properties.title)),
    )
  }

  const existentes = hojasCache.get(spreadsheetId)!
  if (existentes.has(titulo)) return

  // Crear la hoja
  await apiRequest(
    'POST',
    `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
    token,
    { requests: [{ addSheet: { properties: { title: titulo } } }] },
  )

  // Añadir fila de cabeceras
  await apiRequest(
    'POST',
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(titulo)}:append?valueInputOption=RAW`,
    token,
    { values: [cabeceras] },
  )

  existentes.add(titulo)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte una fecha ISO (YYYY-MM-DD) a formato español DD/MM/AAAA. */
function formatFechaES(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-')
  return `${dia}/${mes}/${anio}`
}

/** Convierte una fecha DD/MM/AAAA a formato ISO YYYY-MM-DD. */
function parseFechaES(fechaES: string): string {
  const parts = fechaES.split('/')
  if (parts.length === 3) {
    const [dia, mes, anio] = parts
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }
  return fechaES.slice(0, 10)
}

function parseNumOpt(s: string | undefined): number | '' {
  if (!s || s.trim() === '') return ''
  const n = parseFloat(s)
  return isNaN(n) ? '' : n
}

// ── Sincronización de sesiones ────────────────────────────────────────────────

const CABECERAS_ENTRENOS = ['Fecha', 'Día', 'Ejercicio', 'Serie', 'Reps', 'Peso_kg', 'Etiqueta', 'Nota']
const ETIQUETA_TEXTO: Record<string, string> = { fallo: 'Fallo', rir0: 'RIR 0', rir1: 'RIR 1' }

/**
 * Añade todas las series de una sesión a la hoja "Entrenos".
 * Crea la hoja con cabeceras si no existe.
 */
export async function sincronizarSesion(
  token:         string,
  spreadsheetId: string,
  sesion:        Sesion,
): Promise<void> {
  await asegurarHoja(token, spreadsheetId, 'Entrenos', CABECERAS_ENTRENOS)

  const filas: string[][] = []

  for (const ej of sesion.ejercicios) {
    if (!ej.completado || ej.saltado) continue
    const nombre = ej.nombreSustituido ?? ej.nombreSnapshot

    for (const serie of ej.series) {
      filas.push([
        formatFechaES(sesion.fecha),
        String(sesion.dia),
        nombre,
        String(serie.numero),
        typeof serie.reps   === 'number' ? String(serie.reps)   : '',
        typeof serie.pesoKg === 'number' ? String(serie.pesoKg) : '',
        serie.etiqueta ? (ETIQUETA_TEXTO[serie.etiqueta] ?? '') : '',
        ej.notaSesion ?? '',
      ])
    }
  }

  if (filas.length === 0) return

  await apiRequest(
    'POST',
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Entrenos')}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: filas },
  )
}

// ── Sincronización de peso ────────────────────────────────────────────────────

const CABECERAS_PESO = ['Fecha', 'Peso_kg']

/**
 * Añade un registro de peso a la hoja "Peso".
 * Crea la hoja con cabeceras si no existe.
 */
export async function sincronizarPeso(
  token:         string,
  spreadsheetId: string,
  registro:      RegistroPeso,
): Promise<void> {
  await asegurarHoja(token, spreadsheetId, 'Peso', CABECERAS_PESO)

  await apiRequest(
    'POST',
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Peso')}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: [[formatFechaES(registro.fecha), String(registro.pesoKg)]] },
  )
}

// ── Importación de historial desde Sheets ─────────────────────────────────────

const ETIQUETA_DESDE_TEXTO: Record<string, EtiquetaSerie> = {
  'Fallo': 'fallo',
  'RIR 0': 'rir0',
  'RIR 1': 'rir1',
}

async function leerHoja(token: string, spreadsheetId: string, hoja: string): Promise<string[][]> {
  try {
    const data = await apiRequest<{ values?: string[][] }>(
      'GET',
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(hoja)}?majorDimension=ROWS`,
      token,
    )
    return (data.values ?? []).slice(1) // omitir fila de cabeceras
  } catch (err) {
    if (err instanceof ErrorTokenExpirado) throw err
    return [] // la hoja no existe o está vacía
  }
}

export interface ImportResult {
  sesiones:      Sesion[]
  registrosPeso: RegistroPeso[]
}

/**
 * Lee "Entrenos" y "Peso" desde el spreadsheet y reconstruye
 * las sesiones y registros de peso para importar al store.
 */
export async function importarHistorialDesdeSheets(
  token:         string,
  spreadsheetId: string,
): Promise<ImportResult> {
  const [filasEntrenos, filasPeso] = await Promise.all([
    leerHoja(token, spreadsheetId, 'Entrenos'),
    leerHoja(token, spreadsheetId, 'Peso'),
  ])

  // Columnas Entrenos: [Fecha, Día, Ejercicio, Serie, Reps, Peso_kg, Etiqueta, Nota]
  // Agrupar por (fecha, dia) → Map de ejercicio → series
  type EjData = { series: Serie[]; nota: string }
  const sesionesMap = new Map<string, { fecha: string; dia: string; ejercicios: Map<string, EjData> }>()

  for (const fila of filasEntrenos) {
    const [fechaES, dia, ejercicio, serieNum, reps, pesoKg, etiqueta, nota] = fila
    if (!fechaES || !dia || !ejercicio) continue

    const fecha = parseFechaES(fechaES)
    const key   = `${fecha}|${dia}`

    if (!sesionesMap.has(key)) {
      sesionesMap.set(key, { fecha, dia, ejercicios: new Map() })
    }
    const sesionData = sesionesMap.get(key)!

    if (!sesionData.ejercicios.has(ejercicio)) {
      sesionData.ejercicios.set(ejercicio, { series: [], nota: '' })
    }
    const ejData = sesionData.ejercicios.get(ejercicio)!

    const serie: Serie = {
      numero: parseInt(serieNum ?? '1', 10) || 1,
      reps:   parseNumOpt(reps),
      pesoKg: parseNumOpt(pesoKg),
      ...(etiqueta && ETIQUETA_DESDE_TEXTO[etiqueta]
        ? { etiqueta: ETIQUETA_DESDE_TEXTO[etiqueta] }
        : {}),
    }
    ejData.series.push(serie)
    if (nota) ejData.nota = nota
  }

  const sesiones: Sesion[] = Array.from(sesionesMap.values()).map((s) => {
    const ejercicios: SesionEjercicio[] = Array.from(s.ejercicios.entries()).map(
      ([nombre, ejData]) => ({
        ejercicioId:    '',
        nombreSnapshot: nombre,
        series:         ejData.series,
        notaSesion:     ejData.nota,
        completado:     true,
      }),
    )
    return {
      id:           crypto.randomUUID(),
      fecha:        s.fecha,
      dia:          (parseInt(s.dia, 10) as DiaId),
      ejercicios,
      sincronizado: true,
    }
  })

  // Columnas Peso: [Fecha, Peso_kg]
  const registrosPeso: RegistroPeso[] = filasPeso
    .filter((fila) => fila[0] && fila[1])
    .map((fila) => ({
      id:           crypto.randomUUID(),
      fecha:        parseFechaES(fila[0]),
      pesoKg:       parseFloat(fila[1]),
      sincronizado: true,
    }))
    .filter((r) => !isNaN(r.pesoKg))

  return { sesiones, registrosPeso }
}

// ── Sincronización masiva de pendientes ───────────────────────────────────────

export interface SyncParams {
  sesiones:                  Sesion[]
  registrosPeso:             RegistroPeso[]
  marcarSesionSincronizada:  (id: string) => void
  marcarPesoSincronizado:    (id: string) => void
}

export interface SyncResult {
  sesiones: number
  pesos:    number
  errores:  string[]
}

/**
 * Sincroniza todos los registros con `sincronizado === false`.
 * Llama a los callbacks del store para marcarlos como sincronizados.
 * Limpia la caché de hojas antes de empezar.
 */
export async function sincronizarPendientes(
  token:         string,
  spreadsheetId: string,
  params:        SyncParams,
): Promise<SyncResult> {
  // Limpiar caché para esta operación de sync
  hojasCache.delete(spreadsheetId)

  const { sesiones, registrosPeso, marcarSesionSincronizada, marcarPesoSincronizado } = params
  const errores: string[] = []
  let sesSinc = 0
  let pesoSinc = 0

  // Sesiones pendientes (más reciente primero → invertir para insertar cronológicamente)
  const sesionesPendientes = sesiones
    .filter((s) => !s.sincronizado)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  for (const sesion of sesionesPendientes) {
    try {
      await sincronizarSesion(token, spreadsheetId, sesion)
      marcarSesionSincronizada(sesion.id)
      sesSinc++
    } catch (err) {
      if (err instanceof ErrorTokenExpirado) throw err  // propagar al caller
      errores.push(`Sesión ${sesion.fecha}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Registros de peso pendientes
  const pesosPendientes = registrosPeso
    .filter((r) => !r.sincronizado)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  for (const registro of pesosPendientes) {
    try {
      await sincronizarPeso(token, spreadsheetId, registro)
      marcarPesoSincronizado(registro.id)
      pesoSinc++
    } catch (err) {
      if (err instanceof ErrorTokenExpirado) throw err
      errores.push(`Peso ${registro.fecha}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { sesiones: sesSinc, pesos: pesoSinc, errores }
}
