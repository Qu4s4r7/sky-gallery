import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api, type Photo } from '../api'
import { useViewerParam } from '../hooks/useViewerParam'
import Viewer from './Viewer'

const PAGE = 200
const GAP = 4
const HEADER_H = 52

export default function Library({ trash }: { trash: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [emptying, setEmptying] = useState(false)
  const [notice, setNotice] = useState('')

  const count = useRef(0)
  const busy = useRef(false)
  const requestVersion = useRef(0)

  const viewer = useViewerParam()
  const index = viewer.id
    ? photos.findIndex((p) => p.id === viewer.id)
    : -1

  const more = useCallback(async () => {
    if (busy.current || done || emptying) return

    busy.current = true
    const version = requestVersion.current

    try {
      const page = await api.photos(count.current, PAGE, trash)

      // Ignora respuestas de una biblioteca anterior.
      if (version !== requestVersion.current) return

      count.current += page.length
      setPhotos((current) => [...current, ...page])

      if (page.length < PAGE) setDone(true)
    } catch (e) {
      if (version !== requestVersion.current) return

      setError((e as Error).message || 'No se pudieron cargar los archivos')
      setDone(true)
    } finally {
      if (version === requestVersion.current) {
        busy.current = false
      }
    }
  }, [done, trash, emptying])

  // Reinicia y carga la lista al cambiar entre biblioteca y papelera.
  useEffect(() => {
    requestVersion.current += 1
    count.current = 0
    busy.current = false

    setPhotos([])
    setDone(false)
    setError('')
    setNotice('')

    return () => {
      requestVersion.current += 1
    }
  }, [trash])

  // Carga inicial. Espera a que el estado de reinicio se aplique.
  useEffect(() => {
    if (photos.length === 0 && !done && !error) {
      void more()
    }
  }, [photos.length, done, error, more])

  async function act(id: number) {
    try {
      await (trash ? api.restore(id) : api.remove(id))

      const i = photos.findIndex((p) => p.id === id)
      const neighbour =
        i === -1 ? undefined : photos[i + 1] ?? photos[i - 1]

      const next = photos.filter((p) => p.id !== id)

      count.current = next.length
      setPhotos(next)

      if (neighbour) viewer.show(neighbour.id)
      else viewer.close()
    } catch (e) {
      setError((e as Error).message || 'No se pudo modificar el archivo')
    }
  }

  async function emptyTrash() {
    if (!trash || emptying || photos.length === 0) return

    const confirmed = window.confirm(
      '¿Vaciar la papelera? Esta acción eliminará permanentemente los archivos que estén en la papelera y no se podrán recuperar.',
    )

    if (!confirmed) return

    setEmptying(true)
    setError('')
    setNotice('Vaciando papelera…')

    try {
      const result = await api.emptyTrash()

      setPhotos([])
      count.current = 0
      setDone(true)
      viewer.close()

      if (result.cleanupFailures > 0) {
        setNotice(
          `Se eliminaron ${result.deleted} registros, pero no se pudieron borrar ${result.cleanupFailures} archivos físicos. Revisa los registros del servidor.`,
        )
      } else {
        setNotice(
          result.deleted === 0
            ? 'La papelera ya estaba vacía.'
            : `Papelera vaciada. Se eliminaron ${result.deleted} archivos permanentemente.`,
        )
      }
    } catch (e) {
      setError(`No se pudo vaciar la papelera: ${(e as Error).message}`)
      setNotice('')
    } finally {
      setEmptying(false)
    }
  }

  if (error && photos.length === 0) {
    return (
      <div className="library-message">
        <p className="center error">{error}</p>

        <button
          type="button"
          onClick={() => {
            requestVersion.current += 1
            count.current = 0
            busy.current = false
            setPhotos([])
            setError('')
            setDone(false)
          }}
        >
          Reintentar
        </button>

        {trash && (
          <button
            type="button"
            className="sg-empty-trash-button"
            onClick={() => void emptyTrash()}
            disabled={emptying}
          >
            {emptying ? 'Vaciando…' : 'Vaciar papelera'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="library">
      {trash && (
        <div className="sg-trash-toolbar">
          <div className="sg-trash-info">
            <strong>Papelera</strong>
            <span>
              Las fotos y los vídeos eliminados se borran definitivamente al
              vaciarla.
            </span>
          </div>

          <button
            type="button"
            className="sg-empty-trash-button"
            onClick={() => void emptyTrash()}
            disabled={emptying || photos.length === 0}
          >
            {emptying ? 'Vaciando…' : 'Vaciar papelera'}
          </button>
        </div>
      )}

      {notice && (
        <p className="sg-trash-notice" role="status">
          {notice}
        </p>
      )}

      {photos.length === 0 && done ? (
        <p className="center muted">
          {trash
            ? 'La papelera está vacía'
            : 'Aún no hay fotos ni vídeos. Usa “Subir fotos y vídeos”.'}
        </p>
      ) : photos.length === 0 ? (
        <p className="center muted">Cargando archivos…</p>
      ) : (
        <Timeline
          photos={photos}
          onOpen={viewer.open}
          onNearEnd={() => void more()}
        />
      )}

      {viewer.id && (
        <Viewer
          id={viewer.id}
          photo={index >= 0 ? photos[index] : undefined}
          onPrev={
            index > 0
              ? () => viewer.show(photos[index - 1].id)
              : undefined
          }
          onNext={
            index >= 0 && index < photos.length - 1
              ? () => viewer.show(photos[index + 1].id)
              : undefined
          }
          onClose={viewer.close}
          action={{
            label: trash ? 'Restaurar' : 'Mover a papelera',
            run: () => act(viewer.id!),
          }}
        />
      )}
    </div>
  )
}

type Item =
  | {
      kind: 'header'
      key: string
      size: number
      label: string
    }
  | {
      kind: 'row'
      key: string
      size: number
      height: number
      tiles: { photo: Photo; w: number }[]
    }

const ratio = (p: Photo) =>
  p.width && p.height
    ? Math.min(Math.max(p.width / p.height, 0.5), 3)
    : 1.5

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const dayLabel = (t: number) => {
  const d = new Date(t)
  const thisYear = d.getFullYear() === new Date().getFullYear()

  return d.toLocaleDateString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
  })
}

function buildItems(
  photos: Photo[],
  width: number,
  target: number,
): Item[] {
  const items: Item[] = []

  if (width <= 0) return items

  let i = 0

  while (i < photos.length) {
    const key = dayKey(photos[i].taken_at)
    let j = i

    while (j < photos.length && dayKey(photos[j].taken_at) === key) {
      j++
    }

    const group = photos.slice(i, j)
    i = j

    items.push({
      kind: 'header',
      key: `h-${key}`,
      size: HEADER_H,
      label: dayLabel(group[0].taken_at),
    })

    let row: Photo[] = []
    let sum = 0

    const flush = (last: boolean) => {
      if (row.length === 0) return

      const fit = (width - GAP * (row.length - 1)) / sum
      const height = last ? Math.min(fit, target) : fit

      items.push({
        kind: 'row',
        key: `r-${row[0].id}`,
        size: height + GAP,
        height,
        tiles: row.map((photo) => ({
          photo,
          w: ratio(photo) * height,
        })),
      })

      row = []
      sum = 0
    }

    for (const photo of group) {
      row.push(photo)
      sum += ratio(photo)

      if ((width - GAP * (row.length - 1)) / sum <= target) {
        flush(false)
      }
    }

    flush(true)
  }

  return items
}

function Timeline({
  photos,
  onOpen,
  onNearEnd,
}: {
  photos: Photo[]
  onOpen: (id: number) => void
  onNearEnd: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const ro = new ResizeObserver(() => setBox(el.clientWidth))

    ro.observe(el)
    setBox(el.clientWidth)

    return () => ro.disconnect()
  }, [])

  const pad = box < 700 ? 8 : 24
  const target = box < 700 ? 120 : box < 1100 ? 180 : 230

  const items = useMemo(
    () => buildItems(photos, box - pad * 2, target),
    [photos, box, pad, target],
  )

  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => items[i].size,
    getItemKey: (i) => items[i].key,
    overscan: 6,
  })

  useEffect(() => {
    virt.measure()
  }, [items, virt])

  const visible = virt.getVirtualItems()
  const last = visible.length ? visible[visible.length - 1].index : -1

  useEffect(() => {
    if (items.length > 0 && last >= items.length - 3) {
      onNearEnd()
    }
  }, [last, items.length, onNearEnd])

  return (
    <div ref={scrollRef} className="grid-scroll">
      <div
        className="timeline"
        style={{ height: virt.getTotalSize() + 24, position: 'relative' }}
      >
        {visible.map((v) => {
          const item = items[v.index]

          const place = {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${v.start}px)`,
            paddingLeft: pad,
            paddingRight: pad,
            boxSizing: 'border-box' as const,
          }

          if (item.kind === 'header') {
            return (
              <h2
                key={v.key}
                className="day-header"
                style={{ ...place, height: item.size, margin: 0 }}
              >
                {item.label}
              </h2>
            )
          }

          return (
            <div
              key={v.key}
              className="photo-row"
              style={{ ...place, height: item.height, display: 'flex', gap: GAP }}
            >
              {item.tiles.map(({ photo, w }) => {
                const isVideo = photo.media_type === 'video'

                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={`tile${isVideo ? ' tile-video' : ''}`}
                    style={{
                      width: w,
                      height: item.height,
                      flex: '0 0 auto',
                    }}
                    onClick={() => onOpen(photo.id)}
                    aria-label={
                      isVideo
                        ? `Reproducir vídeo: ${photo.original_name}`
                        : photo.original_name
                    }
                    title={photo.original_name}
                  >
                    {isVideo ? (
                      <span className="tile-video-placeholder" aria-hidden="true">
                        <span className="tile-video-play">▶</span>
                      </span>
                    ) : (
                      <img
                        src={api.thumb(photo.id)}
                        alt=""
                        loading="lazy"
                      />
                    )}

                    {isVideo && (
                      <span className="tile-video-label" aria-hidden="true">
                        VIDEO
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
