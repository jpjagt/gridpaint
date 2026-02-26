import { useStore } from "@nanostores/react"
import { $measureState } from "@/stores/ui"
import { $canvasView } from "@/stores/drawingStores"

/** Length in screen pixels of the vertical end-cap tick marks */
const TICK_HALF_HEIGHT = 8

export const MeasuringTapeOverlay = () => {
  const measureState = useStore($measureState)
  const canvasView = useStore($canvasView)

  const { start, end } = measureState

  if (!start || !end) return null

  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthPx = Math.sqrt(dx * dx + dy * dy)

  if (lengthPx < 1) return null

  // Convert screen pixel distance to mm using the same formula as MeasuringBars.
  // gridSize * zoom = pixels per grid unit; mmPerUnit = mm per grid unit
  // => pixelsPerMm = (gridSize * zoom) / mmPerUnit
  const pixelsPerMm =
    (canvasView.gridSize * canvasView.zoom) / canvasView.mmPerUnit
  const distanceMm = lengthPx / pixelsPerMm

  // Format nicely: round to 1 decimal if >= 10mm, else 2 decimals
  const label =
    distanceMm >= 10
      ? `${distanceMm.toFixed(1)} mm`
      : `${distanceMm.toFixed(2)} mm`

  // Unit vector along the line
  const ux = dx / lengthPx
  const uy = dy / lengthPx

  // Perpendicular unit vector (for end-cap ticks)
  const px = -uy
  const py = ux

  // Tick endpoints for start cap
  const s1x = start.x + px * TICK_HALF_HEIGHT
  const s1y = start.y + py * TICK_HALF_HEIGHT
  const s2x = start.x - px * TICK_HALF_HEIGHT
  const s2y = start.y - py * TICK_HALF_HEIGHT

  // Tick endpoints for end cap
  const e1x = end.x + px * TICK_HALF_HEIGHT
  const e1y = end.y + py * TICK_HALF_HEIGHT
  const e2x = end.x - px * TICK_HALF_HEIGHT
  const e2y = end.y - py * TICK_HALF_HEIGHT

  // Label position: centre of the line, offset slightly perpendicular
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  // Offset the label 14px in the perpendicular direction
  const labelX = midX + px * 14
  const labelY = midY + py * 14

  // Text anchor: use dx/dy to decide whether to use 'middle' (horizontal-ish) or rotate
  // We'll always use middle + a transform rotation aligned with the line direction,
  // but keep the text horizontal for readability.
  // Compute rotation angle in degrees
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI)
  // Normalise to -90..90 so text doesn't appear upside-down
  const textAngle =
    angleDeg > 90 ? angleDeg - 180 : angleDeg < -90 ? angleDeg + 180 : angleDeg

  return (
    <svg
      className='pointer-events-none fixed inset-0 z-50 overflow-visible'
      style={{ width: "100vw", height: "100vh" }}
      aria-label={`Measurement: ${label}`}
      role='img'
    >
      {/* Main line */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke='hsl(var(--highlighted))'
        strokeWidth={2}
        strokeLinecap='round'
      />

      {/* Start cap tick */}
      <line
        x1={s1x}
        y1={s1y}
        x2={s2x}
        y2={s2y}
        stroke='hsl(var(--highlighted))'
        strokeWidth={2}
        strokeLinecap='round'
      />

      {/* End cap tick */}
      <line
        x1={e1x}
        y1={e1y}
        x2={e2x}
        y2={e2y}
        stroke='hsl(var(--highlighted))'
        strokeWidth={2}
        strokeLinecap='round'
      />

      {/* Label background */}
      <text
        x={labelX}
        y={labelY}
        textAnchor='middle'
        dominantBaseline='middle'
        fontSize={12}
        fontFamily='monospace'
        fontWeight='600'
        transform={`rotate(${textAngle}, ${labelX}, ${labelY})`}
        stroke='hsl(var(--background))'
        strokeWidth={4}
        strokeLinejoin='round'
        paintOrder='stroke'
        fill='hsl(var(--highlighted))'
      >
        {label}
      </text>
    </svg>
  )
}
