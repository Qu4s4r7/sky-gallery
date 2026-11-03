
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api, type Photo } from '../api'
import { useViewerParam } from '../hooks/useViewerParam'
import Viewer from './Viewer'
import Scrubber, { type Bucket } from './Scrubber'

const PAGE = 200
const JUMP_PAGE = 500
const GAP = 4
const DEFAULT_COLS = 7

export default function Library({ trash }: { trash: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [emptying, setEmptying] = useState(false)
  const [notice, setNotice] = useState('')
  const [timeline, setTimeline] = useState<{ buckets: Bucket[]; total: number } | null>(null)

  const count = useRef(0)
  const finished = useRef(false)
  const inflight = useRef<Promise<void> | null>(null)
  const requestVersion = useRef(0)

  const viewer = useViewerParam()
  const index = viewer.id
    ? photos.findIndex((p) => p.id === viewer.id)
    : -1

  // Una sola petición a la vez.
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

        // Solo termina cuando el servidor devuelve una página vacía.
        if (page.length === 0) {
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

  const more = useCallback(() => {
    void loadPage()
  }, [loadPage])

  // Carga hasta cubrir la posición pedida.
  const loadTo = useCallback(async (idx: number) => {
    while (!finished.current && count.current <= idx) {
      const before = count.current
      await loadPage(JUMP_PAGE)

      if (count.current === before && !finished.current) break
    }

    return count.current
  }, [loadPage])

  // Resumen por mes para el scrubber.
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

  // Carga el resumen temporal.
  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  // Carga inicial.
  useEffect(() => {
    if (photos.length === 0 && !done && !error) {
      more()
    }
  }, [photos.length, done, error, more])

  // Si el visor se acerca al final, pide la siguiente página.
  useEffect(() => {
    if (index >= 0 && index >= photos.length - 5) {
      more()
    }
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

// `first` = posición del primer archivo que cubre ese elemento.
type Item = {
  kind: 'row'
  key: string
  size: number
  first: number
  height: number
  tiles: { photo: Photo; w: number }[]
}

// Lee --photo-cols del CSS.
function readCols(): number {
  const v = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--photo-cols'),
    10,
  )

  return v > 0 ? v : DEFAULT_COLS
}

function buildItems(
  photos: Photo[],
  width: number,
  cols: number,
): Item[] {
  const items: Item[] = []

  if (width <= 0) return items

  const size = Math.max(1, (width - GAP * (cols - 1)) / cols)

  for (let k = 0; k < photos.length; k += cols) {
    const chunk = photos.slice(k, k + cols)

    items.push({
      kind: 'row',
      key: `r-${chunk[0].id}`,
      size: size + GAP,
      first: k,
      height: size,
      tiles: chunk.map((photo) => ({ photo, w: size })),
    })
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
  const [cols, setCols] = useState(DEFAULT_COLS)
  const [top, setTop] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const [jump, setJump] = useState<number | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const read = () => {
      setBox(el.clientWidth)
      setCols(readCols())
    }

    const ro = new ResizeObserver(read)

    ro.observe(el)
    read()

    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    return () => window.clearTimeout(idle.current)
  }, [])

  // A la derecha queda sitio para la regla del scrubber.
  const compact = box < 700

  const items = useMemo(
    () => buildItems(photos, box, cols),
    [photos, box, cols],
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
  const last = visible.length
    ? visible[visible.length - 1].index
    : -1

  useEffect(() => {
    if (items.length > 0 && last >= items.length - 3) {
      onNearEnd()
    }
  }, [last, items.length, onNearEnd])

  // Primer archivo visible para el scrubber.
  const topItem = visible.find((v) => v.start + v.size > top) ?? visible[0]
  const firstIndex = topItem
    ? (items[topItem.index]?.first ?? 0)
    : 0

  function onScroll(e: UIEvent<HTMLDivElement>) {
    setTop(e.currentTarget.scrollTop)
    setScrolling(true)

    window.clearTimeout(idle.current)

    idle.current = window.setTimeout(() => {
      setScrolling(false)
    }, 900)
  }

  // Salto solicitado desde el scrubber.
  useEffect(() => {
    if (jump === null || items.length === 0 || photos.length <= jump) {
      return
    }

    let i = 0

    for (let k = 0; k < items.length; k++) {
      if (items[k].first <= jump) {
        i = k
      } else {
        break
      }
    }

    virt.scrollToIndex(i, { align: 'start' })
    setJump(null)
  }, [jump, items, photos.length, virt])

  function seek(idx: number, final: boolean) {
    if (idx < photos.length) {
      setJump(idx)
    } else if (final) {
      setJump(idx)

      onLoadTo(idx).then((n) => {
        setJump(Math.max(0, Math.min(idx, n - 1)))
      })
    }
  }

  const showScrubber = Boolean(
    timeline &&
    timeline.total > 0 &&
    timeline.buckets.length > 0,
  )

  return (
    <div className="timeline-wrap">
      <div
        ref={scrollRef}
        className="grid-scroll"
        onScroll={onScroll}
      >
        <div
          className="timeline"
          style={{
            height: virt.getTotalSize() + 24,
            position: 'relative',
          }}
        >
          {/* Desplaza todas las filas visibles como un solo bloque. */}
          <div
            style={{
              transform: `translateY(${visible[0]?.start ?? 0}px)`,
            }}
          >
            {visible.map((v) => {
              const item = items[v.index]

              return (
                <div
                  key={v.key}
                  className="photo-row"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: item.height,
                    display: 'flex',
                    gap: GAP,
                    marginBottom: GAP,
                  }}
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

                            <span
                              className="tile-video-label"
                              aria-hidden="true"
                            >
                              VIDEO
                              {photo.duration
                                ? ` · ${Math.floor(photo.duration / 60)}:${String(
                                    Math.floor(photo.duration % 60),
                                  ).padStart(2, '0')}`
                                : ''}
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
          onWheel={(dy) => {
            scrollRef.current?.scrollBy({ top: dy })
          }}
        />
      )}
    </div>
  )
}
