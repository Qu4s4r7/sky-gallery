import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { api, type Album, type Photo } from '../api'
import { useViewerParam } from '../hooks/useViewerParam'
import Viewer from './Viewer'

const PAGE_SIZE = 200

export default function AlbumView() {
  const albumId = Number(useParams().id) || 0
  const navigate = useNavigate()
  const location = useLocation()
  const viewer = useViewerParam()

  const uploadInput = useRef<HTMLInputElement>(null)

  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [allPhotos, setAllPhotos] = useState<Photo[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<string>(
    () =>
      (location.state as { notice?: string } | null)?.notice ?? '',
  )

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const index = viewer.id
    ? photos.findIndex((photo) => photo.id === viewer.id)
    : -1

  const load = useCallback(async () => {
    const result = await api.albumPhotos(albumId)

    setAlbum(result.album)
    setPhotos(result.photos)
    setName(result.album.name)
    setDescription(result.album.description)
  }, [albumId])

  useEffect(() => {
    setLoaded(false)
    setError('')

    load()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoaded(true))
  }, [load])

  // Limpiar el aviso recibido mediante la navegación.
  useEffect(() => {
    if (notice) {
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      })
    }
    // Solo se procesa el aviso inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveAlbum(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const updated = await api.updateAlbum(albumId, {
        name: name.trim(),
        description: description.trim(),
      })

      setAlbum(updated)
      setEditing(false)
      setNotice('Álbum actualizado.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteAlbum() {
    if (
      !window.confirm(
        `¿Eliminar el álbum "${album?.name}"? Las fotos originales se conservarán.`,
      )
    ) {
      return
    }

    setError('')
    setBusy(true)

    try {
      await api.deleteAlbum(albumId)

      navigate('/albumes', {
        state: {
          notice:
            'Álbum eliminado. Las fotografías originales se conservaron.',
        },
      })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  // Abrir el selector de archivos del sistema.
  function openUploadPicker() {
    setError('')
    setNotice('')
    uploadInput.current?.click()
  }

  // Subir archivos y vincular los que se hayan subido correctamente
  // directamente al álbum actual.
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])

    // Permite volver a seleccionar los mismos archivos.
    input.value = ''

    if (files.length === 0) return

    setError('')
    setNotice('')
    setBusy(true)
    setUploading(true)
    setUploadStatus(`Subiendo ${files.length} archivo(s)…`)

    try {
      const results = await api.upload(files)

      const successfulResults = results.filter(
        (result) =>
          typeof result.id === 'number' && !result.error,
      )

      const failedResults = results.filter(
        (result) =>
          typeof result.id !== 'number' || Boolean(result.error),
      )

      const uploadedIds = successfulResults
        .map((result) => result.id!)
        .filter((id) => Number.isFinite(id))

      let addedCount = 0

      if (uploadedIds.length > 0) {
        setUploadStatus(
          `Añadiendo ${uploadedIds.length} archivo(s) al álbum…`,
        )

        const result = await api.addPhotosToAlbum(
          albumId,
          uploadedIds,
        )

        addedCount = result.added

        // Actualizar la galería con el contenido real del álbum.
        await load()
      }

      if (failedResults.length > 0) {
        const details = failedResults
          .map(
            (result) =>
              `${result.name}: ${result.error || 'No se recibió el identificador del archivo'}`,
          )
          .join('\n')

        setError(
          `${failedResults.length} archivo(s) no se pudieron subir:\n${details}`,
        )
      }

      if (addedCount > 0) {
        setNotice(
          `${addedCount} archivo(s) añadido(s) al álbum "${album?.name ?? 'actual'}".`,
        )
      } else if (uploadedIds.length === 0 && failedResults.length === 0) {
        setNotice('No se recibieron archivos para añadir.')
      } else if (uploadedIds.length > 0) {
        setNotice(
          'La subida terminó, pero no se añadieron fotografías al álbum.',
        )
      }
    } catch (err) {
      setError(
        `No se pudo completar la subida: ${(err as Error).message}`,
      )
    } finally {
      setBusy(false)
      setUploading(false)
      setUploadStatus('')
    }
  }

  async function startPickingPhotos() {
    setError('')
    setNotice('')
    setBusy(true)

    try {
      const result: Photo[] = []
      let offset = 0

      while (true) {
        const page = await api.photos(offset, PAGE_SIZE, false)

        result.push(...page)
        offset += page.length

        if (page.length < PAGE_SIZE) break
      }

      setAllPhotos(result)
      setSelectedIds([])
      setPicking(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function togglePhoto(id: number) {
    setSelectedIds((ids) =>
      ids.includes(id)
        ? ids.filter((value) => value !== id)
        : [...ids, id],
    )
  }

  async function addSelectedPhotos() {
    if (selectedIds.length === 0) return

    setError('')
    setBusy(true)

    try {
      await api.addPhotosToAlbum(albumId, selectedIds)
      await load()

      setPicking(false)
      setSelectedIds([])
      setNotice('Fotografías añadidas al álbum.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Quitar del álbum no elimina el original.
  async function removeFromAlbum(id: number) {
    await api.removePhotoFromAlbum(albumId, id)

    const i = photos.findIndex((photo) => photo.id === id)
    const neighbour =
      viewer.id === id && i !== -1
        ? photos[i + 1] ?? photos[i - 1]
        : undefined

    setPhotos((items) => items.filter((photo) => photo.id !== id))
    setNotice('Fotografía retirada del álbum; el original sigue guardado.')

    if (viewer.id === id) {
      if (neighbour) {
        viewer.show(neighbour.id)
      } else {
        viewer.close()
      }
    }
  }

  if (!loaded) {
    return <p className="center muted">Cargando…</p>
  }

  if (!album) {
    return (
      <section className="albums">
        <p className="error">{error || 'El álbum no existe'}</p>
        <Link className="btn" to="/albumes">
          ← Álbumes
        </Link>
      </section>
    )
  }

  return (
    <section className="albums">
      <div className="album-toolbar">
        <Link className="btn" to="/albumes">
          ← Álbumes
        </Link>

        <div className="album-heading">
          <h2>{album.name}</h2>
          {album.description && (
            <p className="muted">{album.description}</p>
          )}
        </div>

        <span className="spacer" />

        {/* Selector oculto para subir directamente al álbum. */}
        <input
          ref={uploadInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          disabled={busy}
          onChange={handleUpload}
        />

        <button
          type="button"
          disabled={busy}
          onClick={openUploadPicker}
        >
          {uploading ? 'Subiendo…' : 'Subir fotos'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={startPickingPhotos}
        >
          Añadir existentes
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setName(album.name)
            setDescription(album.description)
            setEditing(!editing)
            setError('')
          }}
        >
          Editar
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={deleteAlbum}
        >
          Eliminar álbum
        </button>
      </div>

      {uploadStatus && (
        <p className="muted" role="status">
          {uploadStatus}
        </p>
      )}

      {error && (
        <p className="error" role="alert" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </p>
      )}

      {notice && <p className="muted" role="status">{notice}</p>}

      {editing && (
        <form className="card album-form" onSubmit={saveAlbum}>
          <h3>Editar álbum</h3>

          <input
            placeholder="Nombre del álbum"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            required
          />

          <textarea
            placeholder="Descripción (opcional)"
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />

          <button disabled={busy || !name.trim()}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      )}

      {!editing &&
        (photos.length === 0 ? (
          <div className="center muted">
            <p>Este álbum está vacío.</p>
            <p>
              Pulsa «Subir fotos» para cargar archivos nuevos o
              «Añadir existentes» para elegir fotografías de tu biblioteca.
            </p>
          </div>
        ) : (
          <div className="album-photo-grid">
            {photos.map((photo) => (
              <div
                className="album-photo"
                key={photo.id}
                style={{ position: 'relative' }}
              >
                <img
                  src={api.thumb(photo.id)}
                  alt={photo.original_name}
                  loading="lazy"
                  onClick={() => viewer.open(photo.id)}
                  style={{ cursor: 'pointer' }}
                />

                {photo.media_type === 'video' && (
                  <span
                    className="tile-video-play"
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      pointerEvents: 'none',
                    }}
                  >
                    ▶
                  </span>
                )}

                <button
                  type="button"
                  className="album-photo-remove"
                  title="Quitar del álbum"
                  aria-label={`Quitar ${photo.original_name} del álbum`}
                  onClick={() =>
                    removeFromAlbum(photo.id).catch((err) =>
                      setError((err as Error).message),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}

      {viewer.id && index >= 0 && (
        <Viewer
          id={viewer.id}
          photo={photos[index]}
          onPrev={
            index > 0
              ? () => viewer.show(photos[index - 1].id)
              : undefined
          }
          onNext={
            index < photos.length - 1
              ? () => viewer.show(photos[index + 1].id)
              : undefined
          }
          onClose={viewer.close}
          action={{
            label: 'Quitar del álbum',
            run: () => removeFromAlbum(viewer.id!),
          }}
        />
      )}

      {picking && (
        <div className="overlay" onClick={() => setPicking(false)}>
          <div
            className="card wide album-picker"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Añadir fotografías existentes</h2>

            <p className="muted">
              Seleccionadas: {selectedIds.length}. Las fotografías no se
              mueven ni duplican.
            </p>

            {allPhotos.length === 0 ? (
              <p className="muted">
                No hay fotografías disponibles.
              </p>
            ) : (
              <div className="album-picker-grid">
                {allPhotos.map((photo) => {
                  const checked = selectedIds.includes(photo.id)
                  const alreadyInAlbum = photos.some(
                    (item) => item.id === photo.id,
                  )

                  return (
                    <label
                      className={`album-picker-item${checked ? ' selected' : ''}`}
                      key={photo.id}
                      style={{ position: 'relative' }}
                    >
                      <img
                        src={api.thumb(photo.id)}
                        alt={photo.original_name}
                        loading="lazy"
                      />

                      {photo.media_type === 'video' && (
                        <span
                          className="tile-video-play"
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: '28%',
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'none',
                          }}
                        >
                          ▶
                        </span>
                      )}

                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={alreadyInAlbum}
                        onChange={() => togglePhoto(photo.id)}
                      />

                      <span title={photo.original_name}>
                        {alreadyInAlbum
                          ? 'Ya está en el álbum'
                          : photo.original_name}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="album-picker-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicking(false)}
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={busy || selectedIds.length === 0}
                onClick={addSelectedPhotos}
              >
                {busy
                  ? 'Añadiendo…'
                  : `Añadir ${selectedIds.length} fotos`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
