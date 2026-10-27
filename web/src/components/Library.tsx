import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api, type Photo } from '../api'
import { useViewerParam } from '../hooks/useViewerParam'
import Viewer from './Viewer'
import Scrubber, { type Bucket } from './Scrubber'

const PAGE = 200
const JUMP_PAGE = 500   // al saltar a una fecha lejana se carga en trozos grandes
const GAP = 4
const HEADER_H = 52

export default function Library({ trash }: { trash: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [emptying, setEmptying] = useState(false)
  const [notice, setNotice] = useState('')
  const [timeline, setTimeline] = useState<{ buckets: Bucket[]; total: number } | null>(null)

  const count = useRef(0)
  const finished = useRef(false)                    // espejo de `done`, legible desde bucles async
  const inflight = useRef<Promise<void> | null>(null)
  const requestVersion = useRef(0)

  const viewer = useViewerParam()
  const index = viewer.id
    ? photos.findIndex((p) => p.id === viewer.id)
    : -1

  // Una sola petición a la vez; si ya hay una en curso, se espera a esa.
  const loadPage = useCallback((limit = PAGE): Promise<void> => {
    if (finished.current || emptying) return Promise.resolve()
    if (inflight.current) return inflight.current

    const version = requestVersion.current

    const p = (async () => {
      try {
        const page = await api.photos(count.current, limit, trash)

        // Ignora respuestas de una biblioteca anterior.
        if (version !== requestVersion.current) return

        count.current += page.length
        setPhotos((current) => [...current, ...page])

        if (page.length < limit) {
          finished.current = true
          setDone(true)
        }
      } catch (e) {
        if (version !== requestVersion.current) return

        setError((e as Error).message || 'No se pudieron cargar los archivos')
        finished.current = true
        setDone(true)
      } finally {
        if (version === requestVersion.current) {
          inflight.current = null
        }
      }
    })()

    inflight.current = p
    return p
  }, [trash, emptying])

  const more = useCallback(() => { void loadPage() }, [loadPage])

  // Carga hasta cubrir la posición pedida; devuelve cuántos archivos hay cargados.
  const loadTo = useCallback(async (idx: number) => {
    while (!finished.current && count.current <= idx) {
      const before = count.current
      await loadPage(JUMP_PAGE)
      if (count.current === before && !finished.current) break   // sin progreso: no se queda en bucle
    }
    return count.current
  }, [loadPage])

  // Resumen por mes para el scrubber; si falla, la galería funciona igual sin él.
  const loadTimeline = useCallback(() => {
    const version = requestVersion.current

    api.timeline(trash)
      .then((rows) => {
        if (version !== requestVersion.current) return

        let acc = 0
        const buckets = rows.map((r) => {
          const b = { ...r, start: acc }
          acc += r.n
          return b
        })
        setTimeline({ buckets, total: acc })
      })
      .catch(() => {})
  }, [trash])

  // Reinicia al cambiar entre biblioteca y papelera.
  useEffect(() => {
    requestVersion.current += 1
    count.current = 0
    finished.current = false
    inflight.current = null

    setPhotos([])
    setDone(false)
    setError('')
    setNotice('')
    setTimeline(null)

    return () => {
      requestVersion.current += 1
    }
  }, [trash])

  // Debe ir después del reinicio: así toma la versión ya incrementada.
  useEffect(() => { loadTimeline() }, [loadTimeline])

  // Carga inicial. Espera a que el estado de reinicio se aplique.
  useEffect(() => {
    if (photos.length === 0 && !done && !error) {
      more()
    }
  }, [photos.length, done, error, more])

  // Si el visor se acerca al final de lo cargado, pide la siguiente página.
  useEffect(() => {
    if (index >= 0 && index >= photos.length - 5) more()
  }, [index, photos.length, more])

  async function act(id: number) {
    try {
      await (trash ? api.restore(id) : api.remove(id))

      const i = photos.findIndex((p) => p.id === id)
      const neighbour =
        i === -1 ? undefined : photos[i + 1] ?? photos[i - 1]

      const next = photos.filter((p) => p.id !== id)

      count.current = next.length
      setPhotos(next)
      loadTimeline()

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
      finished.current = true
      setDone(true)
      setTimeline(null)
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
            finished.current = false
            inflight.current = null
            setPhotos([])
            setError('')
            setDone(false)
            loadTimeline()
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
          timeline={timeline}
          onOpen={viewer.open}
          onNearEnd={more}
          onLoadTo={loadTo}
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

// `first` = posición (en toda la lista) del primer archivo que cubre ese elemento
type Item =
  | {
      kind: 'header'
      key: string
      size: number
      first: number
      label: string
    }
  | {
      kind: 'row'
      key: string
      size: number
      first: number
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
    const groupStart = i
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
      first: groupStart,
      label: dayLabel(group[0].taken_at),
    })

    let row: Photo[] = []
    let sum = 0
    let consumed = 0   // archivos del día ya colocados

    const flush = (last: boolean) => {
      if (row.length === 0) return

      const fit = (width - GAP * (row.length - 1)) / sum
      const height = last ? Math.min(fit, target) : fit

      items.push({
        kind: 'row',
        key: `r-${row[0].id}`,
        size: height + GAP,
        first: groupStart + consumed,
        height,
        tiles: row.map((photo) => ({
          photo,
          w: ratio(photo) * height,
        })),
      })

      consumed += row.length
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
  timeline,
  onOpen,
  onNearEnd,
  onLoadTo,
}: {
  photos: Photo[]
  timeline: { buckets: Bucket[]; total: number } | null
  onOpen: (id: number) => void
  onNearEnd: () => void
  onLoadTo: (idx: number) => Promise<number>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const idle = useRef<number | undefined>(undefined)
  const [box, setBox] = useState(0)
  const [top, setTop] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const [jump, setJump] = useState<number | null>(null)   // posición a la que se quiere llegar

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      setBox(el.clientWidth)
    })

    ro.observe(el)
    setBox(el.clientWidth)

    return () => ro.disconnect()
  }, [])

  useEffect(() => () => window.clearTimeout(idle.current), [])

  // A la derecha queda sitio para la regla del scrubber.
  const compact = box < 700
  const pad = compact ? 8 : 24
  const padRight = compact ? 44 : 60
  const target = compact ? 120 : box < 1100 ? 180 : 230

  const items = useMemo(
    () => buildItems(photos, box - pad - padRight, target),
    [photos, box, pad, padRight, target],
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

  // Primer archivo visible: el scrubber lo usa para saber en qué fecha estás.
  const topItem = visible.find((v) => v.start + v.size > top) ?? visible[0]
  const firstIndex = topItem ? (items[topItem.index]?.first ?? 0) : 0

  function onScroll(e: UIEvent<HTMLDivElement>) {
    setTop(e.currentTarget.scrollTop)
    setScrolling(true)
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setScrolling(false), 900)
  }

  // Salto pedido desde el scrubber: espera a que esa posición esté cargada y entonces hace scroll.
  useEffect(() => {
    if (jump === null || items.length === 0 || photos.length <= jump) return

    let i = 0
    for (let k = 0; k < items.length; k++) {
      if (items[k].first <= jump) i = k
      else break
    }
    if (i > 0 && items[i - 1].kind === 'header') i--   // incluye el encabezado del día

    virt.scrollToIndex(i, { align: 'start' })
    setJump(null)
  }, [jump, items, photos.length, virt])

  function seek(idx: number, final: boolean) {
    if (idx < photos.length) {
      setJump(idx)                // ya cargada: salto inmediato, incluso mientras se arrastra
    } else if (final) {
      setJump(idx)                // sin cargar: al soltar se carga y se salta
      onLoadTo(idx).then((n) => setJump(Math.max(0, Math.min(idx, n - 1))))
    }
  }

  const showScrubber = Boolean(
    timeline &&
    timeline.total > 0 &&
    timeline.buckets.length > 0
  )

  return (
    <div className="timeline-wrap">
      <div ref={scrollRef} className="grid-scroll" onScroll={onScroll}>
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
              paddingRight: padRight,
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
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onClick={() => onOpen(photo.id)}
                      aria-label={
                        isVideo
                          ? `Reproducir vídeo: ${photo.original_name}`
                          : photo.original_name
                      }
                      title={photo.original_name}
                    >
                      <img
                        src={api.thumb(photo.id)}
                        alt=""
                        loading="lazy"
                      />

                      {isVideo && (
                        <>
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
                          <span className="tile-video-label" aria-hidden="true">
                            VIDEO{photo.duration ? ` · ${Math.floor(photo.duration / 60)}:${String(Math.floor(photo.duration % 60)).padStart(2, '0')}` : ''}
                          </span>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {timeline && showScrubber && (
        <Scrubber
          buckets={timeline.buckets}
          total={timeline.total}
          firstIndex={firstIndex}
          scrolling={scrolling}
          loading={jump !== null}
          compact={compact}
          onSeek={seek}
          onWheel={(dy) => scrollRef.current?.scrollBy({ top: dy })}
        />
      )}
    </div>
  )
}
