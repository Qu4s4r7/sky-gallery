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
  async function share() {
    if (!photo) return

    try {
      const res = await fetch(api.file(id))
      if (!res.ok) throw new Error('No se pudo leer el archivo')

      const blob = await res.blob()
      const file = new File([blob], photo.original_name, {
        type: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: photo.original_name })
        return
      }

      // Respaldo: descargar el archivo
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = photo.original_name
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      // Cerrar el menú de compartir sin elegir lanza AbortError: no es un fallo
      if ((error as Error).name !== 'AbortError') {
        alert((error as Error).message)
      }
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
      
      <div className='viewer-bar'>
        <button className='close' type="button" onClick={onClose}>
          <span className="material-symbols-outlined">
          arrow_back
          </span>
        </button>
        <div>
          <span>{photo?.original_name ?? ''}</span>
          <button type="button" onClick={() => void share()} disabled={!photo} aria-label="Compartir">
            <span className="material-symbols-outlined"> 
              share
            </span>
          </button>
          {action && (
            <button type="button" onClick={() => void runAction()}>
              <span className="material-symbols-outlined">
                delete
              </span>
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
