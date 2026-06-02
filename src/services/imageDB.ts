import { openDB, type IDBPDatabase } from 'idb'

// ---------------------------------------------------------------------------
// Esquema de la base de datos
// ---------------------------------------------------------------------------

const DB_NAME    = 'fitlog-images'
const DB_VERSION = 1
const STORE_NAME = 'ejercicio-imagenes'

interface ImageDBSchema {
  [STORE_NAME]: {
    key: string          // ejercicioId
    value: {
      ejercicioId: string
      base64: string
      updatedAt: number  // timestamp, útil para futuras migraciones
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton de conexión (se abre una sola vez y se reutiliza)
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<ImageDBSchema>> | null = null

function getDB(): Promise<IDBPDatabase<ImageDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ImageDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'ejercicioId' })
        }
      },
    })
  }
  return dbPromise
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Guarda (o sobreescribe) la imagen de un ejercicio en IndexedDB.
 * @param ejercicioId  ID del ejercicio al que pertenece la imagen.
 * @param base64       Cadena base64 completa, incluyendo el prefijo data URI
 *                     (ej. `"data:image/jpeg;base64,/9j/4AA..."`)
 */
export async function guardarImagen(ejercicioId: string, base64: string): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, {
    ejercicioId,
    base64,
    updatedAt: Date.now(),
  })
}

/**
 * Recupera la imagen de un ejercicio.
 * @returns La cadena base64 si existe, o `null` si no hay imagen guardada.
 */
export async function obtenerImagen(ejercicioId: string): Promise<string | null> {
  const db = await getDB()
  const record = await db.get(STORE_NAME, ejercicioId)
  return record?.base64 ?? null
}

/**
 * Elimina la imagen de un ejercicio.
 * No lanza error si no existía.
 */
export async function eliminarImagen(ejercicioId: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, ejercicioId)
}

/**
 * Elimina las imágenes de todos los IDs que ya no existan en la lista
 * proporcionada. Útil para limpiar huérfanos cuando se borra un ejercicio.
 */
export async function limpiarImagenesHuerfanas(idsActivos: string[]): Promise<void> {
  const db = await getDB()
  const activos = new Set(idsActivos)
  const tx = db.transaction(STORE_NAME, 'readwrite')
  let cursor = await tx.store.openCursor()

  while (cursor) {
    if (!activos.has(cursor.key as string)) {
      await cursor.delete()
    }
    cursor = await cursor.continue()
  }

  await tx.done
}
