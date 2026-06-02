import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { useSupabaseSync, useSyncCountdown, usePullStatus } from '../../hooks/useSupabaseSync'
import { getUsuarioActivo } from '../../services/supabase'

export default function Layout() {
  useSupabaseSync()

  const usuario    = getUsuarioActivo()
  const countdown  = useSyncCountdown()
  const pullStatus = usePullStatus()
  const esInvitado = !!usuario && !usuario.esRuben

  return (
    <div className="flex flex-col min-h-svh bg-zinc-950 text-zinc-50">
      {/* Indicador de sync: countdown + resultado del último pull */}
      {esInvitado && (
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
