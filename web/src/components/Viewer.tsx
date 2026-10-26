import { useEffect } from 'react'
import { api, type Photo } from '../api'

type Props = {
  id: number
  photo?: Photo                 // puede faltar si se entró por enlace directo y la lista aún no cargó
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  action?: { label: string; run: () => Promise<void> }
}

export default function Viewer({ id, photo, onPrev, onNext, onClose, action }: Props) {
  async function runAction() {
    try {
      await action?.run()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  // sin lista de dependencias: siempre usa los manejadores actuales
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <div className="overlay" onClick={onClose}>
      <img src={api.file(id)} alt={photo?.original_name ?? ''} onClick={(e) => e.stopPropagation()} />
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span>{photo ? `${photo.original_name} · ${new Date(photo.taken_at).toLocaleDateString()}` : ''}</span>
        <span className="spacer" />
        <button onClick={onPrev} disabled={!onPrev}>←</button>
        <button onClick={onNext} disabled={!onNext}>→</button>
        {action && <button onClick={runAction}>{action.label}</button>}
        <button onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}
