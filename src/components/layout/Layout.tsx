import { useState, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useSupabaseSync, useSyncCountdown, usePullStatus } from '../../hooks/useSupabaseSync'
import { getUsuarioActivo, getPerfilVisto, clearPerfilVisto, cargarDatosUsuario } from '../../services/supabase'
import { useFitLogStore } from '../../store/useFitLogStore'
import { RefreshCw } from 'lucide-react'
import { conectarSesionRealtime } from '../../services/sesionRealtime'

export default function Layout() {
  useSupabaseSync()

  const navigate   = useNavigate()
  const usuario    = getUsuarioActivo()
  const countdown  = useSyncCountdown()
  const pullStatus = usePullStatus()
  const esInvitado = !!usuario && !usuario.esRuben

  const [perfilVisto,     setPerfilVisto_]     = useState(getPerfilVisto)
  const [volviendo,       setVolviendo]        = useState(false)

  // Canal de sesión en vivo (se reconecta si cambia el perfil visto)
  useEffect(() => { conectarSesionRealtime() }, [perfilVisto])

  // Sincronizar el estado del banner cuando cambia perfilVisto en localStorage
  useEffect(() => {
    const onStorage = () => { setPerfilVisto_(getPerfilVisto()); conectarSesionRealtime() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const handleVolverMiPerfil = async () => {
    setVolviendo(true)
    clearPerfilVisto()
    setPerfilVisto_(null)
    // Recargar los datos propios del admin (Rubén → desde localStorage ya hidratado)
    if (usuario?.esRuben) {
      await useFitLogStore.persist.rehydrate()
    } else if (usuario?.id) {
      try {
        const { sesiones, registrosPeso } = await cargarDatosUsuario(usuario.id)
        useFitLogStore.getState().importarHistorialCompleto(sesiones, registrosPeso)
      } catch { /* offline: usar caché local */ }
    }
    setVolviendo(false)
    navigate('/', { replace: true })
  }

  return (
    <div className="flex flex-col min-h-svh bg-zinc-950 text-zinc-50">

      {/* Banner perfil visto */}
      {perfilVisto && (
        <div className="sticky top-0 z-50 bg-amber-900/90 backdrop-blur border-b border-amber-700/50 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-amber-200 truncate">
            Viendo perfil de <strong>{perfilVisto.nombre}</strong>
          </p>
          <button
            onClick={handleVolverMiPerfil}
            disabled={volviendo}
            className="flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-300 px-3 py-1.5 rounded-xl shrink-0 active:bg-amber-200 disabled:opacity-60"
          >
            {volviendo && <RefreshCw size={11} className="animate-spin" />}
            Volver a mi perfil
          </button>
        </div>
      )}

      {/* Indicador de sync: countdown + resultado del último pull */}
      {esInvitado && !perfilVisto && (
        <div className="fixed top-1 right-2 z-50 flex items-center gap-1 pointer-events-none select-none">
          <span className={[
            'text-[9px] font-bold',
            pullStatus === 'ok'  ? 'text-green-600' :
            pullStatus === 'err' ? 'text-red-600'   : 'text-zinc-700',
          ].join(' ')}>
            {pullStatus === 'ok' ? '✓' : pullStatus === 'err' ? '✗' : '·'}
          </span>
          <span className="text-[9px] text-zinc-700 tabular-nums">↻{countdown}s</span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
