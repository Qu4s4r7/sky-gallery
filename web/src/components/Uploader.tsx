
import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api'

const BATCH = 5

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i

function isSupportedImage(file: File): boolean {
  return (
    ACCEPTED_TYPES.has(file.type.toLowerCase()) ||
    ACCEPTED_EXTENSIONS.test(file.name)
  )
}

export default function Uploader({ onDone }: { onDone: () => void }) {
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [progress, setProgress] = useState(0)

  async function send(selectedFiles: File[]) {
    if (busy || selectedFiles.length === 0) return

    setProgress(0)
    setBusy(true)
    setErrors([])
    setStatus('Preparando archivos…')

    const files = selectedFiles.filter(isSupportedImage)
    const skipped = selectedFiles.length - files.length
    const bad: string[] = []

    let ok = 0
    let processed = 0

    if (skipped > 0) {
      bad.push(
        `${skipped} archivo${skipped === 1 ? '' : 's'} omitido${skipped === 1 ? '' : 's'} por no ser una imagen compatible.`,
      )
    }

    if (files.length === 0) {
      setStatus('No se encontraron imágenes compatibles.')
      setErrors(bad)
      setBusy(false)
      return
    }

    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH)

        setStatus(`Subiendo ${processed + batch.length} de ${files.length}…`)
        processed += batch.length
        setProgress(Math.round((processed / files.length) * 100))

        try {
          const results = await api.upload(batch)

          for (const result of results) {
            if (result.error) {
              bad.push(`${result.name}: ${result.error}`)
            } else {
              ok++
            }
          }

          processed += batch.length
        } catch (error) {
          bad.push(
            `Error al subir el lote: ${(error as Error).message}`,
          )

          // Continuar con los siguientes lotes para no perder
          // las oportunidades de subir los archivos restantes.
          processed += batch.length
        }
      }
    } finally {
      setStatus(
        `${ok} imagen${ok === 1 ? '' : 'es'} subida${ok === 1 ? '' : 's'}` +
          (bad.length > 0 ? ` · ${bad.length} incidencia${bad.length === 1 ? '' : 's'}` : ''),
      )
      setErrors(bad)
      setBusy(false)

      if (ok > 0) onDone()
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])

    // Permite volver a seleccionar la misma carpeta o archivo.
    event.currentTarget.value = ''

    if (files.length > 0) {
      void send(files)
    }
  }

  return (
    <div className="sg-upload">
      <input
        ref={filesInput}
        className="sg-hidden-input"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleChange}
        disabled={busy}
        tabIndex={-1}
        aria-hidden="true"
      />

      <input
        ref={(node) => {
          folderInput.current = node

          // React/TypeScript no siempre tipa webkitdirectory,
          // así que lo configuramos mediante el atributo HTML.
          node?.setAttribute('webkitdirectory', '')
          node?.setAttribute('directory', '')
        }}
        className="sg-hidden-input"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleChange}
        disabled={busy}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="sg-upload-actions">
        <button
          type="button"
          className="sg-upload-button"
          onClick={() => filesInput.current?.click()}
          disabled={busy}
        >
          {busy && (
            <div className="sg-upload-progress" role="status"
              aria-label={`Progreso de subida: ${progress}%`}>
              <div className="sg-upload-progress-track">
                <div
                  className="sg-upload-progress-value"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span>{progress}%</span>
            </div>
          )}
        </button>

        <button
          type="button"
          className="sg-folder-upload-button"
          onClick={() => folderInput.current?.click()}
          disabled={busy}
          title="Seleccionar una carpeta de fotografías"
        >
          <span aria-hidden="true">▰</span>
          <span>Subir carpeta</span>
        </button>
      </div>

      {!busy && status && (
        <span className="sg-upload-status" role="status">
          {status}
        </span>
      )}

      {errors.length > 0 && (
        <div
          className="toast sg-upload-errors"
          role="alert"
          onClick={() => setErrors([])}
          title="Haz clic para cerrar"
        >
          <strong>
            {errors.length} incidencia{errors.length === 1 ? '' : 's'} en la carga
          </strong>

          {errors.slice(0, 8).map((message, index) => (
            <div key={`${index}-${message}`}>{message}</div>
          ))}

          {errors.length > 8 && (
            <div>… y {errors.length - 8} más</div>
          )}

          <small>Clic para cerrar</small>
        </div>
      )}
    </div>
  )
}
