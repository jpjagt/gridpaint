import { useStore } from "@nanostores/react"
import { $canvasView } from "@/stores/drawingStores"

interface MeasuringBarsProps {
  show: boolean
}

export const MeasuringBars = ({ show }: MeasuringBarsProps) => {
  const canvasView = useStore($canvasView)

  if (!show) return null

  // Calculate grid lines for metric measurements
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Calculate the current viewport bounds in grid coordinates
  const viewportLeft = -canvasView.panOffset.x / (canvasView.gridSize * canvasView.zoom)
  const viewportTop = -canvasView.panOffset.y / (canvasView.gridSize * canvasView.zoom)
  const viewportRight = viewportLeft + viewportWidth / (canvasView.gridSize * canvasView.zoom)
  const viewportBottom = viewportTop + viewportHeight / (canvasView.gridSize * canvasView.zoom)

  // Calculate metric spacing
  const mmPerGridUnit = canvasView.mmPerUnit
  const gridUnitsPerCm = 10 / mmPerGridUnit  // 10mm = 1cm
  const gridUnitsPerHalfCm = 5 / mmPerGridUnit  // 5mm = 0.5cm
  const gridUnitsPerMm = 1 / mmPerGridUnit  // 1mm

  // Calculate screen pixel spacing
  const pixelsPerCm = gridUnitsPerCm * canvasView.gridSize * canvasView.zoom
  const pixelsPerHalfCm = gridUnitsPerHalfCm * canvasView.gridSize * canvasView.zoom
  const pixelsPerMm = gridUnitsPerMm * canvasView.gridSize * canvasView.zoom

  // Show mm divisions when 1cm takes up more than 25% of the smaller screen dimension
  const showMmDividers = pixelsPerCm > 0.25 * Math.min(viewportWidth, viewportHeight)

  // Generate vertical lines (every 5mm/1mm and 10mm)
  const verticalLines = []

  // Find the starting cm position
  const startCm = Math.floor(viewportLeft * mmPerGridUnit / 10) // Start cm position
  const endCm = Math.ceil(viewportRight * mmPerGridUnit / 10) // End cm position

  for (let cm = startCm; cm <= endCm; cm++) {
    const gridPos = (cm * 10) / mmPerGridUnit // Grid position for this cm
    const screenX = (gridPos - viewportLeft) * canvasView.gridSize * canvasView.zoom

    // cm line — only render if on screen
    if (screenX >= -10 && screenX <= viewportWidth + 10) {
      verticalLines.push({
        x: screenX,
        type: 'cm' as const,
        label: `${cm}cm`
      })
    }

    // Subdivisions are emitted regardless of whether the parent cm line is visible,
    // so that the region between an off-screen cm mark and the next visible one is
    // still subdivided correctly.

    // Half cm line (dotted) - only if there's enough space
    if (pixelsPerHalfCm > 10) {
      const halfCmGridPos = gridPos + gridUnitsPerHalfCm
      const halfCmScreenX = (halfCmGridPos - viewportLeft) * canvasView.gridSize * canvasView.zoom

      if (halfCmScreenX >= -10 && halfCmScreenX <= viewportWidth + 10) {
        verticalLines.push({
          x: halfCmScreenX,
          type: 'halfCm' as const,
          label: `${cm}.5cm`
        })
      }
    }

    // 1mm divisions (skipping 5mm position which is already a halfCm line)
    if (showMmDividers && pixelsPerMm > 4) {
      for (let mm = 1; mm <= 9; mm++) {
        if (mm === 5) continue // already covered by halfCm
        const mmGridPos = gridPos + mm * gridUnitsPerMm
        const mmScreenX = (mmGridPos - viewportLeft) * canvasView.gridSize * canvasView.zoom
        if (mmScreenX >= -10 && mmScreenX <= viewportWidth + 10) {
          verticalLines.push({
            x: mmScreenX,
            type: 'mm' as const,
            label: `${cm * 10 + mm}mm`
          })
        }
      }
    }
  }

  // Generate horizontal lines (every 5mm/1mm and 10mm)
  const horizontalLines = []

  const startCmY = Math.floor(viewportTop * mmPerGridUnit / 10)
  const endCmY = Math.ceil(viewportBottom * mmPerGridUnit / 10)

  for (let cm = startCmY; cm <= endCmY; cm++) {
    const gridPos = (cm * 10) / mmPerGridUnit
    const screenY = (gridPos - viewportTop) * canvasView.gridSize * canvasView.zoom

    // cm line — only render if on screen
    if (screenY >= -10 && screenY <= viewportHeight + 10) {
      horizontalLines.push({
        y: screenY,
        type: 'cm' as const,
        label: `${cm}cm`
      })
    }

    // Subdivisions emitted regardless of whether the parent cm line is visible.

    // Half cm line (dotted)
    if (pixelsPerHalfCm > 10) {
      const halfCmGridPos = gridPos + gridUnitsPerHalfCm
      const halfCmScreenY = (halfCmGridPos - viewportTop) * canvasView.gridSize * canvasView.zoom

      if (halfCmScreenY >= -10 && halfCmScreenY <= viewportHeight + 10) {
        horizontalLines.push({
          y: halfCmScreenY,
          type: 'halfCm' as const,
          label: `${cm}.5cm`
        })
      }
    }

    // 1mm divisions
    if (showMmDividers && pixelsPerMm > 4) {
      for (let mm = 1; mm <= 9; mm++) {
        if (mm === 5) continue
        const mmGridPos = gridPos + mm * gridUnitsPerMm
        const mmScreenY = (mmGridPos - viewportTop) * canvasView.gridSize * canvasView.zoom
        if (mmScreenY >= -10 && mmScreenY <= viewportHeight + 10) {
          horizontalLines.push({
            y: mmScreenY,
            type: 'mm' as const,
            label: `${cm * 10 + mm}mm`
          })
        }
      }
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* Vertical lines */}
      {verticalLines.map((line) => (
        <div key={`v-${line.type}-${line.x.toFixed(2)}`}>
          {/* Line */}
          <div
            className={
              line.type === 'cm'
                ? "absolute top-0 bottom-0 w-px bg-red-500/70"
                : line.type === 'halfCm'
                  ? "absolute top-0 bottom-0 w-px border-l border-dashed border-red-400/60"
                  : "absolute top-0 bottom-0 w-px border-l border-dotted border-red-300/40"
            }
            style={{
              left: `${line.x}px`,
            }}
          />
          {/* Label for cm lines */}
          {line.type === 'cm' && pixelsPerCm > 30 && (
            <div
              className="absolute top-2 text-xs text-red-500 font-mono bg-black/50 px-1 rounded"
              style={{ left: `${line.x + 2}px` }}
            >
              {line.label}
            </div>
          )}
        </div>
      ))}

      {/* Horizontal lines */}
      {horizontalLines.map((line) => (
        <div key={`h-${line.type}-${line.y.toFixed(2)}`}>
          {/* Line */}
          <div
            className={
              line.type === 'cm'
                ? "absolute left-0 right-0 h-px bg-red-500/70"
                : line.type === 'halfCm'
                  ? "absolute left-0 right-0 h-px border-t border-dashed border-red-400/60"
                  : "absolute left-0 right-0 h-px border-t border-dotted border-red-300/40"
            }
            style={{
              top: `${line.y}px`,
            }}
          />
          {/* Label for cm lines */}
          {line.type === 'cm' && pixelsPerCm > 30 && (
            <div
              className="absolute left-2 text-xs text-red-500 font-mono bg-black/50 px-1 rounded"
              style={{ top: `${line.y + 2}px` }}
            >
              {line.label}
            </div>
          )}
        </div>
      ))}

      {/* Info overlay */}
      <div className="absolute top-4 right-4 bg-black/70 text-white text-xs font-mono px-2 py-1 rounded">
        {canvasView.mmPerUnit}mm/unit | Grid: {showMmDividers ? '1mm' : pixelsPerCm > 30 ? '1cm' : '0.5cm'} spacing
      </div>
    </div>
  )
}
