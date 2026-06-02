import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import Layout              from './components/layout/Layout'
import HomePage            from './pages/HomePage'
import RutinaPage          from './pages/RutinaPage'
import SesionPage          from './pages/SesionPage'
import PesoPage            from './pages/PesoPage'
import AjustesPage         from './pages/AjustesPage'
import TendenciasPage      from './pages/TendenciasPage'
import LoginPage           from './pages/LoginPage'
import AdminUsuariosPage   from './pages/AdminUsuariosPage'
import DebugSupabasePage   from './pages/DebugSupabasePage'
import { getUsuarioActivo } from './services/supabase'

// ---------------------------------------------------------------------------
// RESCATE DE DATOS DE RUBÉN
// Si fitlog-store-ruben está vacío pero fitlog-store (clave legacy) tiene datos,
// restaurar antes de que el store se hidrate.
// ---------------------------------------------------------------------------

;(function rescatarDatosRuben() {
  try {
    const rawNuevo  = localStorage.getItem('fitlog-store-ruben')
    const rawLegacy = localStorage.getItem('fitlog-store')
    if (!rawNuevo || !rawLegacy) return

    const parsed   = JSON.parse(rawNuevo)
    const sesiones = parsed?.state?.historialSesiones ?? []

    if (sesiones.length === 0) {
      const legacy         = JSON.parse(rawLegacy)
      const sesionesLegacy = legacy?.state?.historialSesiones ?? []
      const pesosLegacy    = legacy?.state?.registrosPeso      ?? []

      if (sesionesLegacy.length > 0) {
        parsed.state.historialSesiones = sesionesLegacy
        parsed.state.registrosPeso     = pesosLegacy
        localStorage.setItem('fitlog-store-ruben', JSON.stringify(parsed))
        console.warn('[Rescate] Datos de Rubén restaurados desde fitlog-store:',
          sesionesLegacy.length, 'sesiones,', pesosLegacy.length, 'pesos')
      }
    }
  } catch (e) {
    console.error('[Rescate] Error al rescatar datos de Rubén:', e)
  }
})()

// ---------------------------------------------------------------------------
// Guarda de rutas privadas
// ---------------------------------------------------------------------------

function ProtectedLayout() {
  const usuario = getUsuarioActivo()
  if (!usuario) return <Navigate to="/login" replace />
  return <Layout />
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = createBrowserRouter([
  { path: '/login',            element: <LoginPage /> },
  { path: '/admin/usuarios',   element: <AdminUsuariosPage /> },
  { path: '/debug-supabase',   element: <DebugSupabasePage /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true,          element: <HomePage />       },
      { path: 'rutina',       element: <RutinaPage />     },
      { path: 'rutina/:dia',  element: <SesionPage />     },
      { path: 'peso',         element: <PesoPage />       },
      { path: 'tendencias',   element: <TendenciasPage /> },
      { path: 'ajustes',      element: <AjustesPage />    },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
