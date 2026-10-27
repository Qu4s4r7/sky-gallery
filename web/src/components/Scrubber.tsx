import { useEffect, useRef, useState, type PointerEvent } from 'react'

export type Bucket = {
  start: number
  n: number
  ym: string
}

type ScrubberProps = {
  buckets: Bucket[]
  total: number
  firstIndex: number
  scrolling: boolean
  loading: boolean
  compact?: boolean
  onSeek: (index: number, final: boolean) => void
  onWheel: (deltaY: number) => void
}

const MONTHS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

const MONTHS_FULL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max))

function parseYM(ym: string): { y: number; m: number } {
  const match = ym.match(/^(\d{4})[-/](\d{1,2})/)

  if (!match) {
    return { y: new Date().getFullYear(), m: 1 }
  }

  return {
    y: Number(match[1]),
    m: clamp(Number(match[2]), 1, 12),
  }
}

export default function Scrubber({
  buckets,
  total,
  firstIndex,
  scrolling,
  loading,
  compact = false,
  onSeek,
  onWheel,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const [height, setHeight] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  const denominator = Math.max(total - 1, 1)

  const indexOf = (fraction: number) =>
    clamp(Math.round(fraction * denominator), 0, Math.max(total - 1, 0))

  const fractionOf = (event: PointerEvent<HTMLDivElement>) => {
    const element = track.current

    if (!element) return 0

    const rect = element.getBoundingClientRect()

    if (rect.height <= 0) return 0

    return clamp((event.clientY - rect.top) / rect.height, 0, 1)
  }

  useEffect(() => {
    const element = track.current

    if (!element) return

    const updateHeight = () => {
      setHeight(element.getBoundingClientRect().height)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const bucketAt = (index: number): Bucket | null => {
    if (buckets.length === 0) return null

    return (
      buckets.find(
        (bucket) =>
          index >= bucket.start &&
          index < bucket.start + bucket.n,
      ) ?? buckets[buckets.length - 1]
    )
  }

  const pointerIsSupported = (event: PointerEvent<HTMLDivElement>) =>
    event.pointerType === 'mouse' || event.pointerType === 'pen'

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (total <= 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    dragging.current = true

    const fraction = fractionOf(event)

    setDrag(fraction)
    setHover(null)
    onSeek(indexOf(fraction), false)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const fraction = fractionOf(event)

    if (dragging.current) {
      setDrag(fraction)
      onSeek(indexOf(fraction), false)
      return
    }

    if (pointerIsSupported(event)) {
      setHover(fraction)
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return

    const fraction = fractionOf(event)

    dragging.current = false
    setDrag(null)

    onSeek(indexOf(fraction), true)
  }

  function handlePointerCancel() {
    dragging.current = false
    setDrag(null)
  }

  const pointing = drag !== null || hover !== null
  const fraction = drag ?? hover ?? firstIndex / denominator
  const markerY = clamp(fraction * height, 0, height)
  const selectedIndex = pointing ? indexOf(fraction) : firstIndex
  const selectedBucket = bucketAt(selectedIndex)

  const date = selectedBucket ? parseYM(selectedBucket.ym) : null

  const readoutY = clamp(
    markerY,
    Math.min(26, height / 2),
    Math.max(height - 26, height / 2),
  )

  const percentage = Math.round(fraction * 100)

  const active = pointing || scrolling || loading

  // Render a tick for each month bucket, and label the first
  // month of every year.
  const ticks = buckets.map((bucket, index) => {
    const date = parseYM(bucket.ym)
    const position = (bucket.start / denominator) * height

    const previousDate =
      index > 0 ? parseYM(buckets[index - 1].ym) : null

    const showYear =
      previousDate === null || previousDate.y !== date.y

    return {
      key: `${bucket.ym}-${bucket.start}`,
      position: clamp(position, 0, height),
      month: date.m,
      year: date.y,
      showYear,
    }
  })

  return (
    <div
      ref={track}
      className={`scrubber${compact ? ' compact' : ''}${active ? ' active' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={(event) => {
        if (pointerIsSupported(event)) {
          setHover(fractionOf(event))
        }
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null)
      }}
      onWheel={(event) => onWheel(event.deltaY)}
      role="slider"
      aria-label="Navegar por fechas de la biblioteca"
      aria-valuemin={0}
      aria-valuemax={Math.max(total - 1, 0)}
      aria-valuenow={selectedIndex}
      aria-valuetext={
        date ? `${MONTHS_FULL[date.m - 1]} ${date.y}` : 'Sin fechas'
      }
      tabIndex={0}
    >
      <div className="ruler">
        {ticks.map((tick) => (
          <div
            className="ruler-tick"
            key={tick.key}
            style={{ top: tick.position }}
          >
            <span className="ruler-line" />

            {tick.showYear && (
              <span className="ruler-year">{tick.year}</span>
            )}
          </div>
        ))}
      </div>

      <div
        className="marker"
        style={{ top: markerY }}
      />

      <div
        className="readout"
        style={{ top: readoutY }}
      >
        <strong>
          {loading
            ? 'Cargando…'
            : date
              ? `${MONTHS[date.m - 1]} ${date.y}`
              : 'Sin fechas'}
        </strong>

        <span>{percentage} %</span>
      </div>

      <div
        className="scrubber-vertical"
        aria-hidden="true"
      >
        {date
          ? `${MONTHS_FULL[date.m - 1]} ${date.y}`
          : 'Sin fechas'}
      </div>
    </div>
  )
}
