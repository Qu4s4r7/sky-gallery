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

  const viewer = useViewerParam()
  const index = viewer.id ? photos.findIndex((p) => p.id === viewer.id) : -1

  const more = useCallback(async () => {
    if (busy.current || done || emptying) return

    busy.current = true
    try {
      const page = await api.photos(count.current, PAGE, trash)
      count.current += page.length
      setPhotos((p) => [...p, ...page])
      if (page.length < PAGE) setDone(true)
    } catch (e) {
      setError((e as Error).message)
      setDone(true)
    } finally {
      busy.current = false
    }
  }, [done, trash, emptying])

  useEffect(() => {
    if (index >= 0 && index >= photos.length - 5) void more()
  }, [index, photos.length, more])

  async function act(id: number) {
    await (trash ? api.restore(id) : api.remove(id))

    const i = photos.findIndex((p) => p.id === id)
    const neighbour = i === -1 ? undefined : (photos[i + 1] ?? photos[i - 1])
    const next = photos.filter((p) => p.id !== id)

    count.current = next.length
    setPhotos(next)

    if (neighbour) viewer.show(neighbour.id)
    else viewer.close()
  }

  async function emptyTrash() {
    if (!trash || emptying || photos.length === 0) return

    const confirmed = window.confirm(
      `¿Vaciar la papelera? Esta acción eliminará permanentemente las ${photos.length} fotografías cargadas en esta vista y no se podrán recuperar.`
    )

    if (!confirmed) return

    setEmptying(true)
    setError('')
    setNotice('Vaciando papelera…')

    try {
      // La API elimina todas las fotos en papelera del usuario,
      // no solamente las que están cargadas en la vista.
      const result = await api.emptyTrash()

      setPhotos([])
      count.current = 0
      setDone(true)
      viewer.close()

      if (result.cleanupFailures > 0) {
        setNotice(
          `Se eliminaron ${result.deleted} registros, pero no se pudieron borrar ${result.cleanupFailures} archivos físicos. Revisa los registros del servidor.`
        )
      } else {
        setNotice(
          result.deleted === 0
            ? 'La papelera ya estaba vacía.'
            : `Papelera vaciada. Se eliminaron ${result.deleted} fotografías permanentemente.`
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
        {trash && (
          <button
            type="button"
            className="sg-empty-trash-button"
            onClick={() => void emptyTrash()}
            disabled={emptying}
          >
            {emptying ? 'Vaciando…' : 'Reintentar vaciar papelera'}
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
              Las fotografías eliminadas se borran definitivamente al vaciarla.
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
            : 'Aún no hay fotos. Usa “Subir fotos”.'}
        </p>
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
          onPrev={index > 0 ? () => viewer.show(photos[index - 1].id) : undefined}
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

// ---------- línea de tiempo justificada, agrupada por día ----------

type Item =
  | { kind: 'header'; key: string; size: number; label: string }
  | {
      kind: 'row'
      key: string
      size: number
      height: number
      tiles: { photo: Photo; w: number }[]
    }

const ratio = (p: Photo) =>
  p.width && p.height ? Math.min(Math.max(p.width / p.height, 0.5), 3) : 1.5

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

function buildItems(photos: Photo[], width: number, target: number): Item[] {
  const items: Item[] = []
  if (width <= 0) return items

  let i = 0

  while (i < photos.length) {
    const key = dayKey(photos[i].taken_at)
    let j = i

    while (j < photos.length && dayKey(photos[j].taken_at) === key) j++

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
        tiles: row.map((p) => ({ photo: p, w: ratio(p) * height })),
      })

      row = []
      sum = 0
    }

    for (const p of group) {
      row.push(p)
      sum += ratio(p)

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
    if (last >= items.length - 3) onNearEnd()
  }, [last, items.length, onNearEnd])

  return (
    <div ref={scrollRef} className="grid-scroll">
      <div className="timeline" style={{ height: virt.getTotalSize() + 24 }}>
        {visible.map((v) => {
          const it = items[v.index]
          const place = {
            transform: `translateY(${v.start}px)`,
            paddingLeft: pad,
          }

          if (it.kind === 'header') {
            return (
              <h2
                key={v.key}
                className="day-header"
                style={{ ...place, height: it.size }}
              >
                {it.label}
              </h2>
            )
          }

          return (
            <div
              key={v.key}
              className="photo-row"
              style={{ ...place, height: it.height }}
            >
              {it.tiles.map(({ photo, w }) => (
                <button
                  key={photo.id}
                  className="tile"
                  style={{ width: w, height: it.height }}
                  onClick={() => onOpen(photo.id)}
                  aria-label={photo.original_name}
                >
                  <img src={api.thumb(photo.id)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
