import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { nanoid } from './nanoid'
import { DEFAULT_EJERCICIOS } from './defaultData'
import {
  type DiaId,
  type Ejercicio,
  type SesionEjercicio,
  type Sesion,
  type RegistroPeso,
  type RegistroComposicion,
  type PerfilCorporal,
  type Serie,
  crearSesionEjercicio,
  crearSeriesVacias,
  fechaHoy,
} from '../types/models'

// ---------------------------------------------------------------------------
// Tipos del store
// ---------------------------------------------------------------------------

export interface FitLogState {
  // ── Configuración ──────────────────────────────────────────────────────
  ejercicios: Ejercicio[]
  seriesGlobalesPorDefecto: 3 | 4

  // ── Sesión activa ──────────────────────────────────────────────────────
  /** null cuando no hay entrenamiento en curso */
  sesionActiva: Sesion | null
  /** Índice del ejercicio que se está mostrando ahora mismo */
  indiceEjercicioActual: number

  // ── Historial ──────────────────────────────────────────────────────────
  historialSesiones: Sesion[]
  registrosPeso: RegistroPeso[]
  historialComposicion: RegistroComposicion[]

  // ── Perfil corporal ────────────────────────────────────────────────────
  perfilCorporal: PerfilCorporal | null

  // ── Objetivos próximo entreno ──────────────────────────────────────────
  /** ejercicioNombre → 'subir' | 'bajar' */
  objetivosEntreno: Record<string, 'subir' | 'bajar'>
  /** ejercicioNombre → peso objetivo en kg */
  objetivosPesoEntreno: Record<string, number>

  // ── Google Sheets ──────────────────────────────────────────────────────
  googleConfig: {
    accessToken: string
    refreshToken: string
    email: string
    spreadsheetId: string
    spreadsheetName: string
  }
  isAuthenticated: boolean

  // ── Sync ───────────────────────────────────────────────────────────────
  /** Timestamp del último pull exitoso de Supabase. Cambiar fuerza re-render de suscriptores. */
  ultimaSyncTimestamp: number
}

export interface FitLogActions {
  // ── Sesión ─────────────────────────────────────────────────────────────
  iniciarSesion: (dia: DiaId) => void
  /** Inicia una sesión parcial con ejercicios elegidos de cualquier día */
  iniciarSesionParcial: (ejercicioIds: string[]) => void
  /** Inicia una sesión extra con un ejercicio personalizado */
  iniciarSesionExtra: (nombre: string) => void
  /**
   * Actualiza los datos del ejercicio en la posición `indice` de la sesión activa.
   * Se llama cada vez que el usuario edita una serie o la nota.
   */
  actualizarEjercicioActivo: (indice: number, datos: Partial<SesionEjercicio>) => void
  /** Marca el ejercicio actual como completado y avanza al siguiente */
  guardarEjercicio: (indice: number, datos: SesionEjercicio) => void
  /** Cambia el índice del ejercicio visible (menú lateral / salto) */
  irAEjercicio: (indice: number) => void
  /** Sustituye el nombre del ejercicio activo por uno alternativo */
  sustituirEjercicio: (indice: number, nombreNuevo: string) => void
  /** Cierra la sesión y la mueve al historial */
  completarSesion: () => void
  /** Descarta la sesión activa sin guardar */
  cancelarSesion: () => void
  /** Marca el ejercicio como saltado (no se sincroniza) y avanza al siguiente */
  saltarEjercicio: (indice: number) => void

  // ── Series dentro de un ejercicio activo ───────────────────────────────
  actualizarSerie: (ejercicioIndice: number, serieIndex: number, cambio: Partial<Serie>) => void
  agregarSerie: (ejercicioIndice: number) => void
  eliminarUltimaSerie: (ejercicioIndice: number) => void

  // ── Peso diario ────────────────────────────────────────────────────────
  registrarPeso: (pesoKg: number) => void

  // ── Composición corporal ───────────────────────────────────────────────
  setPerfilCorporal: (perfil: Partial<PerfilCorporal>) => void
  registrarComposicion: (datos: Omit<RegistroComposicion, 'id'>) => void

  // ── Configuración de ejercicios ────────────────────────────────────────
  agregarEjercicio: (datos: Omit<Ejercicio, 'id' | 'orden'>) => void
  actualizarEjercicio: (id: string, cambios: Partial<Omit<Ejercicio, 'id'>>) => void
  eliminarEjercicio: (id: string) => void
  moverEjercicio: (id: string, nuevoDia: DiaId) => void
  reordenarEjercicios: (dia: DiaId, ordenIds: string[]) => void
  setSeriesGlobalesPorDefecto: (n: 3 | 4) => void

  // ── Google ─────────────────────────────────────────────────────────────
  setGoogleConfig: (cfg: Partial<FitLogState['googleConfig']>) => void
  setAuthenticated: (v: boolean) => void
  marcarSesionSincronizada: (id: string) => void
  desmarcarSesionSincronizada: (id: string) => void
  marcarPesoSincronizado: (id: string) => void
  /** Reemplaza historial local con datos importados desde Sheets (sin tocar la sesión activa) */
  importarHistorial: (sesiones: Sesion[], registrosPeso: RegistroPeso[]) => void
  /** Reemplaza completamente el historial con datos de Supabase. Supabase es la fuente de verdad. */
  importarHistorialCompleto: (sesiones: Sesion[], registrosPeso: RegistroPeso[]) => void
  /** Reemplaza la lista de ejercicios con los cargados desde Supabase (modo amigo) */
  importarEjercicios: (ejercicios: Ejercicio[]) => void
  /**
   * Actualiza historialSesiones con datos remotos de Supabase.
   * Fusiona: conserva sesiones locales pendientes (sincronizado=false) que no están en el remoto.
   */
  actualizarHistorialRemoto: (sesiones: Sesion[]) => void
  /**
   * Actualiza registrosPeso con datos remotos de Supabase.
   * Fusiona: conserva pesos locales pendientes (sincronizado=false) que no están en el remoto.
   */
  actualizarPesosRemoto: (registrosPeso: RegistroPeso[]) => void
  /** Actualiza el timestamp del último sync para forzar re-render en suscriptores. */
  setUltimaSync: (ts: number) => void

  // ── Objetivos de entreno ───────────────────────────────────────────────
  /** Guarda (o borra si null) el objetivo de subir/bajar peso para un ejercicio */
  setObjetivoEntreno: (ejercicioNombre: string, obj: 'subir' | 'bajar' | null) => void
  /** Guarda (o borra si null) el peso objetivo en kg para un ejercicio */
  setObjetivoPesoEntreno: (ejercicioNombre: string, kg: number | null) => void
}

type FitLogStore = FitLogState & FitLogActions

// ---------------------------------------------------------------------------
// Almacenamiento por usuario (evita que amigos vean datos de Rubén)
// ---------------------------------------------------------------------------

function getStoreKey(): string {
  try {
    const raw = localStorage.getItem('fitlog_usuario_activo')
    if (!raw) return 'fitlog-store-ruben'
    const u = JSON.parse(raw) as { esRuben?: boolean; id?: string }
    return u.esRuben ? 'fitlog-store-ruben' : `fitlog-store-${u.id}`
  } catch {
    return 'fitlog-store-ruben'
  }
}

// Estado vacío serializado que se devuelve a usuarios sin datos previos
const EMPTY_PERSIST = JSON.stringify({
  state: {
    historialSesiones: [],
    registrosPeso: [],
    historialComposicion: [],
    sesionActiva: null,
    indiceEjercicioActual: 0,
    perfilCorporal: null,
  },
  version: 0,
})

const perUserStorage = {
  getItem(_name: string): string | null {
    const key = getStoreKey()
    const val = localStorage.getItem(key)
    if (val === null) {
      // Migración: datos de Rubén guardados con la clave antigua
      if (key === 'fitlog-store-ruben') return localStorage.getItem('fitlog-store')
      // Usuario nuevo sin datos previos → estado vacío
      return EMPTY_PERSIST
    }
    return val
  },
  setItem(_name: string, value: string): void {
    localStorage.setItem(getStoreKey(), value)
  },
  removeItem(_name: string): void {
    localStorage.removeItem(getStoreKey())
  },
}

// ---------------------------------------------------------------------------
// Migración: copiar 'fitlog-store' → 'fitlog-store-ruben' si no existe aún
// Se ejecuta de forma síncrona al importar el módulo, ANTES de create().
// ---------------------------------------------------------------------------

;(function migrarDatosRuben() {
  try {
    const NUEVA_CLAVE  = 'fitlog-store-ruben'
    const CLAVE_LEGACY = 'fitlog-store'
    if (!localStorage.getItem(NUEVA_CLAVE)) {
      const legacy = localStorage.getItem(CLAVE_LEGACY)
      if (legacy) {
        localStorage.setItem(NUEVA_CLAVE, legacy)
      }
    }
  } catch {
    // Safari en modo privado puede lanzar excepciones al acceder a localStorage
  }
})()

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

const INITIAL_STATE: FitLogState = {
  ejercicios: DEFAULT_EJERCICIOS,
  seriesGlobalesPorDefecto: 3,
  sesionActiva: null,
  indiceEjercicioActual: 0,
  historialSesiones: [],
  registrosPeso: [],
  historialComposicion: [],
  perfilCorporal: null,
  objetivosEntreno: {},
  objetivosPesoEntreno: {},
  googleConfig: {
    accessToken: '',
    refreshToken: '',
    email: '',
    spreadsheetId: '',
    spreadsheetName: 'FitLog',
  },
  isAuthenticated: false,
  ultimaSyncTimestamp: 0,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFitLogStore = create<FitLogStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      // ── Sesión ────────────────────────────────────────────────────────

      iniciarSesion(dia) {
        const { ejercicios } = get()
        const ejerciciosDia = ejercicios
          .filter((e) => e.dia === dia)
          .sort((a, b) => a.orden - b.orden)

        const sesionEjercicios: SesionEjercicio[] = ejerciciosDia.map(crearSesionEjercicio)

        const sesion: Sesion = {
          id: nanoid(),
          fecha: fechaHoy(),
          dia,
          tipo: 'normal',
          ejercicios: sesionEjercicios,
          sincronizado: false,
        }
        set({ sesionActiva: sesion, indiceEjercicioActual: 0 })
      },

      iniciarSesionParcial(ejercicioIds) {
        const { ejercicios } = get()
        const seleccionados = ejercicioIds
          .map((id) => ejercicios.find((e) => e.id === id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined)
          .map(crearSesionEjercicio)

        const sesion: Sesion = {
          id: nanoid(),
          fecha: fechaHoy(),
          dia: 'parcial',
          tipo: 'parcial',
          ejercicios: seleccionados,
          sincronizado: false,
        }
        set({ sesionActiva: sesion, indiceEjercicioActual: 0 })
      },

      iniciarSesionExtra(nombre) {
        const ejercicioExtra: SesionEjercicio = {
          ejercicioId: nanoid(),
          nombreSnapshot: nombre,
          series: crearSeriesVacias(3),
          notaSesion: '',
          completado: false,
        }
        const sesion: Sesion = {
          id: nanoid(),
          fecha: fechaHoy(),
          dia: 'extra',
          tipo: 'extra',
          ejercicios: [ejercicioExtra],
          sincronizado: false,
        }
        set({ sesionActiva: sesion, indiceEjercicioActual: 0 })
      },

      actualizarEjercicioActivo(indice, datos) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          ejercicios[indice] = { ...ejercicios[indice], ...datos }
          return { sesionActiva: { ...s.sesionActiva, ejercicios } }
        })
      },

      guardarEjercicio(indice, datos) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          ejercicios[indice] = { ...datos, completado: true }

          // Avanza al primer ejercicio incompleto (que no sea el actual)
          const siguiente = ejercicios.findIndex(
            (e, i) => i !== indice && !e.completado,
          )
          const nuevoIndice = siguiente !== -1 ? siguiente : indice

          return {
            sesionActiva: { ...s.sesionActiva, ejercicios },
            indiceEjercicioActual: nuevoIndice,
          }
        })
      },

      irAEjercicio(indice) {
        set({ indiceEjercicioActual: indice })
      },

      sustituirEjercicio(indice, nombreNuevo) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          ejercicios[indice] = {
            ...ejercicios[indice],
            nombreSustituido: nombreNuevo,
          }
          return { sesionActiva: { ...s.sesionActiva, ejercicios } }
        })
      },

      completarSesion() {
        const { sesionActiva, historialSesiones, objetivosPesoEntreno } = get()
        if (!sesionActiva) return
        // Resetear objetivoPeso para ejercicios que alcanzaron o superaron el objetivo
        const nuevosObjetivosPeso = { ...objetivosPesoEntreno }
        for (const ej of sesionActiva.ejercicios) {
          if (!ej.completado || ej.saltado) continue
          const nombre = ej.nombreSustituido ?? ej.nombreSnapshot
          const pesoObj = nuevosObjetivosPeso[nombre]
          if (pesoObj === undefined) continue
          const vals = ej.series
            .map((s) => Number(s.pesoKg))
            .filter((v) => v > 0 && isFinite(v))
          if (vals.length > 0 && Math.max(...vals) >= pesoObj) {
            delete nuevosObjetivosPeso[nombre]
          }
        }
        set({
          historialSesiones: [sesionActiva, ...historialSesiones],
          sesionActiva: null,
          indiceEjercicioActual: 0,
          objetivosPesoEntreno: nuevosObjetivosPeso,
        })
      },

      cancelarSesion() {
        set({ sesionActiva: null, indiceEjercicioActual: 0 })
      },

      saltarEjercicio(indice) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          ejercicios[indice] = { ...ejercicios[indice], completado: true, saltado: true }
          const siguiente = ejercicios.findIndex((e, i) => i !== indice && !e.completado)
          const nuevoIndice = siguiente !== -1 ? siguiente : indice
          return {
            sesionActiva: { ...s.sesionActiva, ejercicios },
            indiceEjercicioActual: nuevoIndice,
          }
        })
      },

      // ── Series ────────────────────────────────────────────────────────

      actualizarSerie(ejercicioIndice, serieIndex, cambio) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          const series = [...ejercicios[ejercicioIndice].series]
          series[serieIndex] = { ...series[serieIndex], ...cambio }
          ejercicios[ejercicioIndice] = { ...ejercicios[ejercicioIndice], series }
          return { sesionActiva: { ...s.sesionActiva, ejercicios } }
        })
      },

      agregarSerie(ejercicioIndice) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          const series = [...ejercicios[ejercicioIndice].series]
          series.push({ numero: series.length + 1, reps: '', pesoKg: '' })
          ejercicios[ejercicioIndice] = { ...ejercicios[ejercicioIndice], series }
          return { sesionActiva: { ...s.sesionActiva, ejercicios } }
        })
      },

      eliminarUltimaSerie(ejercicioIndice) {
        set((s) => {
          if (!s.sesionActiva) return s
          const ejercicios = [...s.sesionActiva.ejercicios]
          const series = [...ejercicios[ejercicioIndice].series]
          if (series.length <= 1) return s
          series.pop()
          ejercicios[ejercicioIndice] = { ...ejercicios[ejercicioIndice], series }
          return { sesionActiva: { ...s.sesionActiva, ejercicios } }
        })
      },

      // ── Peso diario ───────────────────────────────────────────────────

      registrarPeso(pesoKg) {
        const entrada: RegistroPeso = {
          id: nanoid(),
          fecha: fechaHoy(),
          pesoKg,
          sincronizado: false,
        }
        set((s) => ({ registrosPeso: [entrada, ...s.registrosPeso] }))
      },

      // ── Composición corporal ──────────────────────────────────────────

      setPerfilCorporal(perfil) {
        set((s) => ({
          perfilCorporal: s.perfilCorporal
            ? { ...s.perfilCorporal, ...perfil }
            : (perfil as PerfilCorporal),
        }))
      },

      registrarComposicion(datos) {
        const registro: RegistroComposicion = { id: nanoid(), ...datos }
        set((s) => ({ historialComposicion: [registro, ...s.historialComposicion] }))
      },

      // ── Ejercicios (configuración) ─────────────────────────────────────

      agregarEjercicio(datos) {
        const { ejercicios } = get()
        const ordenMax = Math.max(
          -1,
          ...ejercicios.filter((e) => e.dia === datos.dia).map((e) => e.orden),
        )
        const nuevo: Ejercicio = { id: nanoid(), orden: ordenMax + 1, ...datos }
        set((s) => ({ ejercicios: [...s.ejercicios, nuevo] }))
      },

      actualizarEjercicio(id, cambios) {
        set((s) => ({
          ejercicios: s.ejercicios.map((e) =>
            e.id === id ? { ...e, ...cambios } : e,
          ),
        }))
      },

      eliminarEjercicio(id) {
        set((s) => ({ ejercicios: s.ejercicios.filter((e) => e.id !== id) }))
      },

      moverEjercicio(id, nuevoDia) {
        set((s) => {
          const ordenMax = Math.max(
            -1,
            ...s.ejercicios.filter((e) => e.dia === nuevoDia).map((e) => e.orden),
          )
          return {
            ejercicios: s.ejercicios.map((e) =>
              e.id === id ? { ...e, dia: nuevoDia, orden: ordenMax + 1 } : e,
            ),
          }
        })
      },

      reordenarEjercicios(dia, ordenIds) {
        set((s) => ({
          ejercicios: s.ejercicios.map((e) => {
            if (e.dia !== dia) return e
            const nuevoOrden = ordenIds.indexOf(e.id)
            return nuevoOrden === -1 ? e : { ...e, orden: nuevoOrden }
          }),
        }))
      },

      setSeriesGlobalesPorDefecto(n) {
        set({ seriesGlobalesPorDefecto: n })
      },

      // ── Google ────────────────────────────────────────────────────────

      setGoogleConfig(cfg) {
        set((s) => ({ googleConfig: { ...s.googleConfig, ...cfg } }))
      },

      setAuthenticated(v) {
        set({ isAuthenticated: v })
      },

      marcarSesionSincronizada(id) {
        set((s) => ({
          historialSesiones: s.historialSesiones.map((ses) =>
            ses.id === id ? { ...ses, sincronizado: true } : ses,
          ),
        }))
      },

      desmarcarSesionSincronizada(id) {
        set((s) => ({
          historialSesiones: s.historialSesiones.map((ses) =>
            ses.id === id ? { ...ses, sincronizado: false } : ses,
          ),
        }))
      },

      marcarPesoSincronizado(id) {
        set((s) => ({
          registrosPeso: s.registrosPeso.map((r) =>
            r.id === id ? { ...r, sincronizado: true } : r,
          ),
        }))
      },

      importarHistorialCompleto(sesiones, registrosPeso) {
        // REEMPLAZA completamente — Supabase es la fuente de verdad para todos
        set({ historialSesiones: sesiones, registrosPeso })
      },

      importarHistorial(sesiones, registrosPeso) {
        // MERGE: conservar registros locales pendientes que no estén en el remoto
        set((s) => {
          const remoteSessionIds = new Set(sesiones.map((ses) => ses.id))
          const localPending = s.historialSesiones.filter(
            (ses) => !ses.sincronizado && !remoteSessionIds.has(ses.id),
          )
          const remotePesoIds = new Set(registrosPeso.map((r) => r.id))
          const localPesosPending = s.registrosPeso.filter(
            (r) => !r.sincronizado && !remotePesoIds.has(r.id),
          )
          return {
            historialSesiones: [...localPending, ...sesiones],
            registrosPeso: [...localPesosPending, ...registrosPeso],
          }
        })
      },

      importarEjercicios(ejercicios) {
        set({ ejercicios })
      },

      actualizarHistorialRemoto(sesiones) {
        // Fusión segura: preserva sesiones locales pendientes que Supabase aún no conoce
        set((s) => {
          const remoteIds = new Set(sesiones.map((ses) => ses.id))
          const localPending = s.historialSesiones.filter(
            (ses) => !ses.sincronizado && !remoteIds.has(ses.id),
          )
          const merged = [...localPending, ...sesiones]
          console.log(`[Store] actualizarHistorialRemoto: local=${s.historialSesiones.length} remoto=${sesiones.length} resultado=${merged.length}`)
          return { historialSesiones: merged }
        })
      },

      actualizarPesosRemoto(registrosPeso) {
        set((s) => {
          const remoteIds = new Set(registrosPeso.map((r) => r.id))
          const localPending = s.registrosPeso.filter(
            (r) => !r.sincronizado && !remoteIds.has(r.id),
          )
          return { registrosPeso: [...localPending, ...registrosPeso] }
        })
      },

      setUltimaSync(ts) {
        set({ ultimaSyncTimestamp: ts })
      },

      // ── Objetivos de entreno ──────────────────────────────────────────

      setObjetivoEntreno(ejercicioNombre, obj) {
        set((s) => {
          const next = { ...s.objetivosEntreno }
          if (obj === null) delete next[ejercicioNombre]
          else next[ejercicioNombre] = obj
          return { objetivosEntreno: next }
        })
      },

      setObjetivoPesoEntreno(ejercicioNombre, kg) {
        set((s) => {
          const next = { ...s.objetivosPesoEntreno }
          if (kg === null) delete next[ejercicioNombre]
          else next[ejercicioNombre] = kg
          return { objetivosPesoEntreno: next }
        })
      },
    }),

    {
      name: 'fitlog-store',
      storage: createJSONStorage(() => perUserStorage),
    },
  ),
)

// ---------------------------------------------------------------------------
// Selectores derivados (evitan recalcular en cada componente)
// ---------------------------------------------------------------------------

export const selectEjerciciosPorDia = (dia: DiaId) => (s: FitLogStore) =>
  s.ejercicios
    .filter((e) => e.dia === dia)
    .sort((a, b) => a.orden - b.orden)

export const selectEjercicioActivoActual = (s: FitLogStore): SesionEjercicio | null =>
  s.sesionActiva?.ejercicios[s.indiceEjercicioActual] ?? null

// Devuelven primitivos (number) → Object.is estable, sin bucle de re-renders.
export const selectProgresoTotal = (s: FitLogStore): number =>
  s.sesionActiva?.ejercicios.length ?? 0

export const selectProgresoCompletados = (s: FitLogStore): number =>
  s.sesionActiva?.ejercicios.filter((e) => e.completado).length ?? 0

export const selectTotalPendientes = (s: FitLogStore): number =>
  s.historialSesiones.filter((ses) => !ses.sincronizado).length +
  s.registrosPeso.filter((r) => !r.sincronizado).length
