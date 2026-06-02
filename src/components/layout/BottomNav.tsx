import { Link, useLocation } from 'react-router-dom'
import { Home, Dumbbell, Scale, BarChart2, Settings } from 'lucide-react'
import { getUsuarioActivo } from '../../services/supabase'

const NAV_ITEMS_RUBEN = [
  { to: '/',           icon: Home,      label: 'Inicio'     },
  { to: '/rutina',     icon: Dumbbell,  label: 'Rutina'     },
  { to: '/peso',       icon: Scale,     label: 'Peso'       },
  { to: '/tendencias', icon: BarChart2, label: 'Tendencias' },
  { to: '/ajustes',    icon: Settings,  label: 'Ajustes'    },
]

const NAV_ITEMS_AMIGO = [
  { to: '/',           icon: Home,      label: 'Inicio'     },
  { to: '/rutina',     icon: Dumbbell,  label: 'Rutina'     },
  { to: '/tendencias', icon: BarChart2, label: 'Tendencias' },
  { to: '/ajustes',    icon: Settings,  label: 'Ajustes'    },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  const usuario = getUsuarioActivo()
  const navItems = usuario?.esRuben ? NAV_ITEMS_RUBEN : NAV_ITEMS_AMIGO

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to)

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-800 safe-area-inset-bottom">
      <div className="flex h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-1 transition-colors',
              isActive(to) ? 'text-blue-400' : 'text-zinc-500 active:text-zinc-300',
            ].join(' ')}
          >
            <Icon size={22} strokeWidth={isActive(to) ? 2.5 : 1.8} />
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
