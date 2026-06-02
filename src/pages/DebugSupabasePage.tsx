import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { supabase, getRubenUUID, getUsuarioActivo } from '../services/supabase'
import { useFitLogStore } from '../store/useFitLogStore'

// ── Constantes visibles ───────────────────────────────────────────────────────

const SUPABASE_URL = 'https://fxhkzstvxljlohrlgyyc.supabase.co'
const SUPABASE_KEY_RAW = 'sb_publishable_ze6CKfP42nDVwDMuF_D11Q_1yGS7EYA'
const KEY_DISPLAY = SUPABASE_KEY_RAW.slice(0, 20) + '…' + SUPABASE_KEY_RAW.slice(-6)

// ── Tipos internos ────────────────────────────────────────────────────────────

interface LogEntry {
  ts: string
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  ok: boolean
}

function nowTs(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function DebugSupabasePage() {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const historialSesiones = useFitLogStore(useShallow((s) => s.historialSesiones))
  const registrosPeso     = useFitLogStore(useShallow((s) => s.registrosPeso))

  const pendientesSesiones = historialSesiones.filter((s) => !s.sincronizado)
  const pendientesPesos    = registrosPeso.filter((r) => !r.sincronizado)

  const usuario = getUsuarioActivo()
  const uid = usuario?.esRuben
    ? getRubenUUID()
    : (usuario?.id ?? '(sin usuario)')

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addLog = (label: string, data: any, ok: boolean) =>
    setLogs((prev) => [{ ts: nowTs(), label, data, ok }, ...prev])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleTestConexion = async () => {
    addLog('🔌 TEST CONEXIÓN — iniciando SELECT count(*)', null, true)
    try {
      const { count, error, status, statusText } = await supabase
        .from('entrenos')
        .select('*', { count: 'exact', head: true })

      if (error) {
        addLog('🔌 TEST CONEXIÓN — ❌ ERROR', { error, status, statusText }, false)
      } else {
        addLog('🔌 TEST CONEXIÓN — ✅ OK', { count, status, statusText }, true)
      }
    } catch (err) {
      addLog('🔌 TEST CONEXIÓN — ❌ EXCEPCIÓN', String(err), false)
    }
  }

  const handleTestInsert = async () => {
    const testId = crypto.randomUUID()
    const payload = {
      usuario_id: uid,
      sesion_id:  testId,
      fecha:      new Date().toISOString().slice(0, 10),
      dia:        'extra',
      ejercicio:  '__debug_test__',
      serie:      0,
      reps:       null,
      peso_kg:    null,
    }
    addLog('📤 TEST INSERT — payload', { uid, key_prefix: KEY_DISPLAY, payload }, true)

    try {
      const result = await supabase
        .from('entrenos')
        .insert(payload)
        .select()

      if (result.error) {
        addLog('📤 TEST INSERT — ❌ ERROR', {
          message:    result.error.message,
          code:       result.error.code,
          details:    result.error.details,
          hint:       result.error.hint,
          status:     result.status,
          statusText: result.statusText,
        }, false)
      } else {
        addLog('📤 TEST INSERT — ✅ OK', {
          data:       result.data,
          status:     result.status,
          statusText: result.statusText,
        }, true)

        // Limpiar la fila de prueba
        const delResult = await supabase
          .from('entrenos')
          .delete()
          .eq('sesion_id', testId)
        addLog('📤 TEST INSERT — limpieza DELETE', {
          error:  delResult.error,
          status: delResult.status,
        }, !delResult.error)
      }
    } catch (err) {
      addLog('📤 TEST INSERT — ❌ EXCEPCIÓN', String(err), false)
    }
  }

  const handleVerPendientes = () => {
    addLog('👀 VER PENDIENTES — sesiones', {
      total: pendientesSesiones.length,
      items: pendientesSesiones.map((s) => ({
        id:        s.id,
        fecha:     s.fecha,
        dia:       s.dia,
        ejercicios: s.ejercicios.length,
      })),
    }, pendientesSesiones.length === 0)

    addLog('👀 VER PENDIENTES — pesos', {
      total: pendientesPesos.length,
      items: pendientesPesos.map((r) => ({
        id:     r.id,
        fecha:  r.fecha,
        pesoKg: r.pesoKg,
      })),
    }, pendientesPesos.length === 0)

    addLog('👀 VER PENDIENTES — usuario activo', {
      usuario,
      uid,
    }, !!usuario)
  }

  const handleSubirUnoPendiente = async () => {
    if (!usuario) {
      addLog('⬆️ SUBIR PENDIENTE — ❌ Sin usuario activo', null, false)
      return
    }

    const sesion = pendientesSesiones[0]
    const peso   = pendientesPesos[0]

    if (!sesion && !peso) {
      addLog('⬆️ SUBIR PENDIENTE — ✅ No hay nada pendiente', null, true)
      return
    }

    if (sesion) {
      addLog('⬆️ SUBIR SESIÓN — sesión elegida', {
        id:    sesion.id,
        fecha: sesion.fecha,
        dia:   sesion.dia,
        ejercicios: sesion.ejercicios.length,
      }, true)

      const rows = sesion.ejercicios.flatMap((ej) =>
        ej.series.map((serie) => ({
          usuario_id: uid,
          sesion_id:  sesion.id,
          fecha:      sesion.fecha,
          dia:        String(sesion.dia),
          ejercicio:  ej.nombreSustituido ?? ej.nombreSnapshot,
          serie:      serie.numero,
          reps:       serie.reps    !== '' ? serie.reps    : null,
          peso_kg:    serie.pesoKg  !== '' ? serie.pesoKg  : null,
          etiqueta:   serie.etiqueta ?? null,
          nota:       ej.notaSesion  || null,
          ayuda_fede: ej.ayudaFede  ?? false,
        })),
      )
      addLog('⬆️ SUBIR SESIÓN — rows a insertar', rows, true)

      try {
        // DELETE idempotente previo
        const delRes = await supabase
          .from('entrenos')
          .delete()
          .eq('usuario_id', uid)
          .eq('sesion_id', sesion.id)
        addLog('⬆️ SUBIR SESIÓN — DELETE previo', {
          error:  delRes.error,
          status: delRes.status,
        }, !delRes.error)

        // INSERT real
        const insRes = await supabase
          .from('entrenos')
          .insert(rows)
          .select()
        addLog('⬆️ SUBIR SESIÓN — INSERT resultado', {
          data:       insRes.data,
          error:      insRes.error
            ? {
                message: insRes.error.message,
                code:    insRes.error.code,
                details: insRes.error.details,
                hint:    insRes.error.hint,
              }
            : null,
          status:     insRes.status,
          statusText: insRes.statusText,
          count:      insRes.count,
        }, !insRes.error)

        if (!insRes.error) {
          useFitLogStore.getState().marcarSesionSincronizada(sesion.id)
          addLog('⬆️ SUBIR SESIÓN — ✅ marcado sincronizado', sesion.id, true)
        }
      } catch (err) {
        addLog('⬆️ SUBIR SESIÓN — ❌ EXCEPCIÓN', String(err), false)
      }

    } else if (peso) {
      addLog('⬆️ SUBIR PESO — peso elegido', {
        id:     peso.id,
        fecha:  peso.fecha,
        pesoKg: peso.pesoKg,
      }, true)

      try {
        const result = await supabase
          .from('registros_peso')
          .insert({ usuario_id: uid, fecha: peso.fecha, peso_kg: peso.pesoKg })
          .select()

        addLog('⬆️ SUBIR PESO — INSERT resultado', {
          data:       result.data,
          error:      result.error
            ? {
                message: result.error.message,
                code:    result.error.code,
                details: result.error.details,
                hint:    result.error.hint,
              }
            : null,
          status:     result.status,
          statusText: result.statusText,
        }, !result.error)

        if (!result.error) {
          useFitLogStore.getState().marcarPesoSincronizado(peso.id)
          addLog('⬆️ SUBIR PESO — ✅ marcado sincronizado', peso.id, true)
        }
      } catch (err) {
        addLog('⬆️ SUBIR PESO — ❌ EXCEPCIÓN', String(err), false)
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-4 py-6 pb-16">

      {/* Cabecera */}
      <h1 className="text-xl font-black mb-1">🔧 Debug Supabase</h1>
      <div className="bg-zinc-900 rounded-xl px-3 py-2.5 mb-4 font-mono text-[10px] text-zinc-400 space-y-0.5">
        <p><span className="text-zinc-600">URL:</span> {SUPABASE_URL}</p>
        <p><span className="text-zinc-600">KEY:</span> {KEY_DISPLAY}</p>
        <p><span className="text-zinc-600">UID:</span> {uid}</p>
        <p><span className="text-zinc-600">Usuario:</span> {usuario ? `${usuario.nombre} (${usuario.esRuben ? 'Rubén' : 'amigo'})` : '⚠️ sin sesión'}</p>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-zinc-900 rounded-xl px-3 py-2 text-center">
          <p className="text-[10px] text-zinc-500 mb-0.5">Sesiones pendientes</p>
          <p className={[
            'text-2xl font-black',
            pendientesSesiones.length > 0 ? 'text-amber-400' : 'text-green-400',
          ].join(' ')}>
            {pendientesSesiones.length}
          </p>
        </div>
        <div className="bg-zinc-900 rounded-xl px-3 py-2 text-center">
          <p className="text-[10px] text-zinc-500 mb-0.5">Pesos pendientes</p>
          <p className={[
            'text-2xl font-black',
            pendientesPesos.length > 0 ? 'text-amber-400' : 'text-green-400',
          ].join(' ')}>
            {pendientesPesos.length}
          </p>
        </div>
      </div>

      {/* Botones de diagnóstico */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={handleTestConexion}
          className="rounded-xl bg-blue-700 py-3.5 text-sm font-bold active:bg-blue-800"
        >
          🔌 Test conexión
        </button>
        <button
          onClick={handleTestInsert}
          className="rounded-xl bg-violet-700 py-3.5 text-sm font-bold active:bg-violet-800"
        >
          📤 Test insert
        </button>
        <button
          onClick={handleVerPendientes}
          className="rounded-xl bg-zinc-700 py-3.5 text-sm font-bold active:bg-zinc-600"
        >
          👀 Ver pendientes
        </button>
        <button
          onClick={handleSubirUnoPendiente}
          className="rounded-xl bg-emerald-700 py-3.5 text-sm font-bold active:bg-emerald-800"
        >
          ⬆️ Subir 1 pendiente
        </button>
      </div>

      {/* Limpiar */}
      {logs.length > 0 && (
        <button
          onClick={() => setLogs([])}
          className="w-full mb-3 py-2 rounded-xl bg-zinc-800 text-xs text-zinc-500 active:bg-zinc-700"
        >
          Limpiar logs ({logs.length})
        </button>
      )}

      {/* Logs */}
      <div className="flex flex-col gap-2">
        {logs.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-10">
            Pulsa un botón para ver el diagnóstico
          </p>
        )}
        {logs.map((entry, i) => (
          <div
            key={i}
            className={[
              'rounded-xl border p-3',
              entry.ok
                ? 'bg-green-950/30 border-green-800/40'
                : 'bg-red-950/40 border-red-700/60',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <p className={[
                'text-xs font-bold',
                entry.ok ? 'text-green-400' : 'text-red-400',
              ].join(' ')}>
                {entry.label}
              </p>
              <p className="text-[10px] text-zinc-600 font-mono shrink-0">{entry.ts}</p>
            </div>
            {entry.data !== null && (
              <pre className={[
                'text-[10px] whitespace-pre-wrap break-all leading-relaxed font-mono',
                'bg-zinc-900/70 rounded-lg p-2 max-h-72 overflow-y-auto',
                entry.ok ? 'text-zinc-300' : 'text-red-300',
              ].join(' ')}>
                {JSON.stringify(entry.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
