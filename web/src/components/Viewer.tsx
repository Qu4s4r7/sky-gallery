import Icon from './Icon'
import { useEffect } from 'react'
import { api, type Photo } from '../api'

type Props = {
  id: number
  photo?: Photo
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  action?: {
    label: string
    run: () => Promise<void>
  }
}

export default function Viewer({
  id,
  photo,
  onPrev,
  onNext,
  onClose,
  action,
}: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrev?.()
      if (event.key === 'ArrowRight') onNext?.()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, onPrev, onNext])

  async function runAction() {
    try {
      await action?.run()
    } catch (error) {
      alert((error as Error).message)
    }
  }

  const isVideo = photo?.media_type === 'video'

  return (
    <div className="overlay">
      {isVideo ? (
        <video
          key={id}
          className="viewer-media viewer-video"
          src={api.file(id)}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onClick={(event) => event.stopPropagation()}
          aria-label={photo?.original_name ?? 'Vídeo'}
        >
          Tu navegador no admite la reproducción de vídeo.
        </video>
      ) : (
        <img
          key={id}
          className="viewer-media"
          src={api.file(id)}
          alt={photo?.original_name ?? ''}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <div className='viewer-bar-2'>
        <button className='close' type="button" onClick={onClose}>
          <Icon name="back" />
        </button>
        <div>
          <span>{photo?.original_name ?? ''}</span>
          <button onClick={onClose}>
            <Icon name="share" />
          </button>
          <button onClick={onClose}>
            <Icon name="share" />
          </button>
          {action && (
            <button type="button" onClick={() => void runAction()}>
              <Icon name={action.label === "Restaurar" ? "restore" : "trash"} />
            </button>
          )}
        </div>
      </div>
      <div className="viewer-change">
        <button
          type="button"
          className="viewer-nav viewer-prev"
          aria-label="Anterior"
          onClick={(event) => {
            event.stopPropagation()
            onPrev?.()
          }}
          disabled={!onPrev}
        >
          <Icon name="previous" />
        </button>

        <button
          type="button"
          className="viewer-nav viewer-next"
          aria-label="Siguiente"
          onClick={(event) => {
            event.stopPropagation()
            onNext?.()
          }}
          disabled={!onNext}
        >
          <Icon name="next" />
        </button>
      </div>
    </div>
  )
}
