import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Shuffle, Dumbbell, X, Check } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useFitLogStore, selectEjerciciosPorDia } from '../store/useFitLogStore'
import type { DiaId, Ejercicio } from '../types/models'

const DIAS: { id: DiaId; label: string }[] = [
  { id: 1, label: 'Día 1' },
  { id: 2, label: 'Día 2' },
  { id: 3, label: 'Día 3' },
]

export default function RutinaPage() {
  const navigate             = useNavigate()
  const sesionActiva         = useFitLogStore(useShallow((s) => s.sesionActiva))
  const [showParcial, setShowParcial] = useState(false)
  const [showExtra,   setShowExtra]   = useState(false)

  return (
    <div className="px-5 pt-10 pb-6">
      <h2 className="text-2xl font-black text-white">¿Qué día toca?</h2>
      <p className="mt-1 mb-7 text-sm text-zinc-400">Elige el día para empezar</p>

      <div className="flex flex-col gap-4">
        {DIAS.map(({ id, label }) => (
          <DiaCard
            key={id}
            dia={id}
            label={label}
            isActive={sesionActiva?.dia === id}
            onClick={() => navigate(`/rutina/${id}`)}
          />
        ))}

        {/* Entrenamiento parcial */}
        <button
          onClick={() => setShowParcial(true)}
          className={[
            'relative flex items-center gap-4 rounded-2xl border px-5 py-5 text-left w-full',
            'active:scale-[0.98] transition-transform',
            sesionActiva?.dia === 'parcial'
              ? 'bg-purple-500/10 border-purple-500/40'
              : 'bg-zinc-900 border-zinc-800',
          ].join(' ')}
        >
          <div className="size-10 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
            <Shuffle size={20} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={[
                'text-base font-black',
                sesionActiva?.dia === 'parcial' ? 'text-purple-400' : 'text-white',
              ].join(' ')}>
                Entrenamiento parcial
              </span>
              {sesionActiva?.dia === 'parcial' && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 rounded-full px-2 py-0.5">
                  En curso
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">Elige ejercicios sueltos de cualquier día</p>
          </div>
          <ChevronRight size={18} className={sesionActiva?.dia === 'parcial' ? 'text-purple-400' : 'text-zinc-600'} />
        </button>

        {/* Ejercicio extra */}
        <button
          onClick={() => setShowExtra(true)}
          className={[
            'relative flex items-center gap-4 rounded-2xl border px-5 py-5 text-left w-full',
            'active:scale-[0.98] transition-transform',
            sesionActiva?.dia === 'extra'
              ? 'bg-orange-500/10 border-orange-500/40'
              : 'bg-zinc-900 border-zinc-800',
          ].join(' ')}
        >
          <div className="size-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
            <Dumbbell size={20} className="text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={[
                'text-base font-black',
                sesionActiva?.dia === 'extra' ? 'text-orange-400' : 'text-white',
              ].join(' ')}>
                Ejercicio extra
              </span>
              {sesionActiva?.dia === 'extra' && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400 rounded-full px-2 py-0.5">
                  En curso
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">Añade un ejercicio puntual fuera del programa</p>
          </div>
          <ChevronRight size={18} className={sesionActiva?.dia === 'extra' ? 'text-orange-400' : 'text-zinc-600'} />
        </button>
      </div>

      {showParcial && (
        <ParcialModal
          onClose={() => setShowParcial(false)}
          onStart={() => { setShowParcial(false); navigate('/rutina/parcial') }}
        />
      )}

      {showExtra && (
        <ExtraModal
          onClose={() => setShowExtra(false)}
          onStart={() => { setShowExtra(false); navigate('/rutina/extra') }}
        />
      )}
    </div>
  )
}

// ── DiaCard ───────────────────────────────────────────────────────────────────

function DiaCard({
  dia, label, isActive, onClick,
}: {
  dia: DiaId
  label: string
  isActive: boolean
  onClick: () => void
}) {
  const ejercicios = useFitLogStore(useShallow(selectEjerciciosPorDia(dia)))

  return (
    <button
      onClick={onClick}
      className={[
        'relative flex flex-col gap-3 rounded-2xl border px-5 py-5 text-left w-full',
        'active:scale-[0.98] transition-transform',
        isActive
          ? 'bg-blue-500/10 border-blue-500/40'
          : 'bg-zinc-900 border-zinc-800',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={['text-xl font-black', isActive ? 'text-blue-400' : 'text-white'].join(' ')}>
            {label}
          </span>
          {isActive && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 rounded-full px-2 py-0.5">
              En curso
            </span>
          )}
        </div>
        <ChevronRight size={20} className={isActive ? 'text-blue-400' : 'text-zinc-600'} />
      </div>

      <div className="flex flex-col gap-1">
        {ejercicios.map((ej) => (
          <p key={ej.id} className="text-sm text-zinc-400 leading-snug">· {ej.nombre}</p>
        ))}
      </div>

      <p className={['text-xs font-medium', isActive ? 'text-blue-400/70' : 'text-zinc-600'].join(' ')}>
        {ejercicios.length} ejercicio{ejercicios.length !== 1 ? 's' : ''}
      </p>
    </button>
  )
}

// ── ParcialModal ──────────────────────────────────────────────────────────────

function ParcialModal({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const ejercicios          = useFitLogStore(useShallow((s) => s.ejercicios))
  const iniciarSesionParcial = useFitLogStore((s) => s.iniciarSesionParcial)
  const sesionActiva         = useFitLogStore(useShallow((s) => s.sesionActiva))

  // Si hay una sesión parcial en curso, ir directamente
  if (sesionActiva?.dia === 'parcial') {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed bottom-16 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-3xl
                        max-h-[80svh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
          <div className="sticky top-0 bg-zinc-900 flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <h3 className="font-bold text-white text-base">Sesión parcial en curso</h3>
            <button onClick={onClose} className="text-zinc-400 active:text-white"><X size={20} /></button>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <p className="text-sm text-zinc-400">Ya tienes una sesión parcial activa. ¿Quieres retomar?</p>
            <button
              onClick={onStart}
              className="w-full rounded-2xl bg-purple-600 py-4 font-bold text-white active:bg-purple-700"
            >
              Retomar sesión
            </button>
          </div>
        </div>
      </>
    )
  }

  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setSeleccionados((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleEmpezar = () => {
    if (seleccionados.size === 0) return
    iniciarSesionParcial([...seleccionados])
    onStart()
  }

  // Agrupar por día
  const grupos = ([1, 2, 3] as DiaId[]).map((dia) => ({
    dia,
    label: `Día ${dia}`,
    ejercicios: ejercicios
      .filter((e) => e.dia === dia)
      .sort((a, b) => a.orden - b.orden),
  }))

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-16 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-3xl
                      max-h-[80svh] flex flex-col animate-in slide-in-from-bottom duration-200">
        <div className="sticky top-0 bg-zinc-900 flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white text-base">Entrenamiento parcial</h3>
          <button onClick={onClose} className="text-zinc-400 active:text-white"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {grupos.map(({ dia, label, ejercicios: ejsGrupo }) => (
            <div key={dia}>
              <p className="px-5 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
              {ejsGrupo.map((ej) => (
                <EjercicioCheckRow
                  key={ej.id}
                  ejercicio={ej}
                  checked={seleccionados.has(ej.id)}
                  onToggle={() => toggle(ej.id)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800 p-5">
          <button
            onClick={handleEmpezar}
            disabled={seleccionados.size === 0}
            className={[
              'w-full rounded-2xl py-4 font-bold text-base transition-colors',
              seleccionados.size > 0
                ? 'bg-purple-600 text-white active:bg-purple-700'
                : 'bg-zinc-800 text-zinc-600',
            ].join(' ')}
          >
            {seleccionados.size === 0
              ? 'Selecciona ejercicios'
              : `Empezar con ${seleccionados.size} ejercicio${seleccionados.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </>
  )
}

function EjercicioCheckRow({
  ejercicio, checked, onToggle,
}: {
  ejercicio: Ejercicio
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-4 px-5 py-3 text-left active:bg-zinc-800"
    >
      <span className={[
        'size-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
        checked ? 'bg-purple-500 border-purple-500' : 'border-zinc-700',
      ].join(' ')}>
        {checked && <Check size={14} strokeWidth={3} className="text-white" />}
      </span>
      <span className={['text-sm font-medium', checked ? 'text-white' : 'text-zinc-400'].join(' ')}>
        {ejercicio.nombre}
      </span>
    </button>
  )
}

// ── ExtraModal ────────────────────────────────────────────────────────────────

function ExtraModal({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const iniciarSesionExtra = useFitLogStore((s) => s.iniciarSesionExtra)
  const sesionActiva       = useFitLogStore(useShallow((s) => s.sesionActiva))
  const [nombre, setNombre] = useState('')

  if (sesionActiva?.dia === 'extra') {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed bottom-16 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-3xl
                        animate-in slide-in-from-bottom duration-200">
          <div className="sticky top-0 bg-zinc-900 flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <h3 className="font-bold text-white text-base">Ejercicio extra en curso</h3>
            <button onClick={onClose} className="text-zinc-400 active:text-white"><X size={20} /></button>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <p className="text-sm text-zinc-400">Ya tienes un ejercicio extra activo. ¿Quieres retomar?</p>
            <button
              onClick={onStart}
              className="w-full rounded-2xl bg-orange-600 py-4 font-bold text-white active:bg-orange-700"
            >
              Retomar ejercicio
            </button>
          </div>
        </div>
      </>
    )
  }

  const handleEmpezar = () => {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) return
    iniciarSesionExtra(nombreLimpio)
    onStart()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-16 inset-x-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-3xl
                      animate-in slide-in-from-bottom duration-200">
        <div className="sticky top-0 bg-zinc-900 flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white text-base">Ejercicio extra</h3>
          <button onClick={onClose} className="text-zinc-400 active:text-white"><X size={20} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">
              Nombre del ejercicio
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEmpezar()}
              placeholder="Ej: Curl de concentración"
              autoFocus
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white
                         placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button
            onClick={handleEmpezar}
            disabled={!nombre.trim()}
            className={[
              'w-full rounded-2xl py-4 font-bold text-base transition-colors',
              nombre.trim()
                ? 'bg-orange-600 text-white active:bg-orange-700'
                : 'bg-zinc-800 text-zinc-600',
            ].join(' ')}
          >
            Empezar
          </button>
        </div>
      </div>
    </>
  )
}
