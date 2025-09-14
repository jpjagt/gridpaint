import { useStore } from "@nanostores/react"
import { $canvasView } from "@/stores/drawingStores"

interface MeasuringBarsProps {
  show: boolean
}

export const MeasuringBars = ({ show }: MeasuringBarsProps) => {
  const canvasView = useStore($canvasView)

  if (!show) return null

  // Calculate the visible viewport bounds in grid coordinates
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Calculate how many grid units fit in the current viewport
  const viewportGridWidth = viewportWidth / (canvasView.gridSize * canvasView.zoom)
  const viewportGridHeight = viewportHeight / (canvasView.gridSize * canvasView.zoom)

  // Physical dimensions of the viewport in mm
  const physicalWidth = viewportGridWidth * canvasView.mmPerUnit
  const physicalHeight = viewportGridHeight * canvasView.mmPerUnit

  // Create ruler marks every 10mm or every 50mm depending on scale
  const getMarks = (physicalSize: number, gridSize: number) => {
    const marks = []
    const mmPerGridUnit = canvasView.mmPerUnit

    // Choose appropriate spacing
    let spacing = 10 // 10mm marks
    if (physicalSize / spacing > 20) {
      spacing = 50 // 50mm marks if too crowded
    }
    if (physicalSize / spacing > 20) {
      spacing = 100 // 100mm marks if still too crowded
    }

    const gridSpacing = spacing / mmPerGridUnit
    const pixelSpacing = gridSpacing * canvasView.gridSize * canvasView.zoom

    for (let i = 0; i * spacing < physicalSize; i++) {
      marks.push({
        position: i * pixelSpacing,
        label: `${i * spacing}mm`,
        isMajor: i % 5 === 0, // Every 5th mark is major
      })
    }

    return marks
  }

  const horizontalMarks = getMarks(physicalWidth, canvasView.gridSize)
  const verticalMarks = getMarks(physicalHeight, canvasView.gridSize)

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Horizontal ruler (top) */}
      <div className="absolute top-0 left-0 right-0 h-8 bg-black/50 backdrop-blur-sm border-b border-white/20">
        <div className="relative w-full h-full">
          {horizontalMarks.map((mark, i) => (
            <div
              key={i}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${mark.position}px` }}
            >
              <div
                className={`w-px ${mark.isMajor ? 'h-4 bg-white' : 'h-2 bg-white/70'}`}
              />
              {mark.isMajor && (
                <span className="text-xs text-white font-mono mt-1">
                  {mark.label}
                </span>
              )}
            </div>
          ))}
          <div className="absolute top-1 right-2 text-xs text-white/70 font-mono">
            Width: {physicalWidth.toFixed(1)}mm
          </div>
        </div>
      </div>

      {/* Vertical ruler (left) */}
      <div className="absolute top-0 left-0 bottom-0 w-16 bg-black/50 backdrop-blur-sm border-r border-white/20">
        <div className="relative w-full h-full">
          {verticalMarks.map((mark, i) => (
            <div
              key={i}
              className="absolute left-0 flex items-center"
              style={{ top: `${mark.position}px` }}
            >
              <div
                className={`h-px ${mark.isMajor ? 'w-4 bg-white' : 'w-2 bg-white/70'}`}
              />
              {mark.isMajor && (
                <span className="text-xs text-white font-mono ml-1 transform -rotate-90 origin-left whitespace-nowrap">
                  {mark.label}
                </span>
              )}
            </div>
          ))}
          <div className="absolute bottom-2 left-1 text-xs text-white/70 font-mono transform -rotate-90 origin-left whitespace-nowrap">
            Height: {physicalHeight.toFixed(1)}mm
          </div>
        </div>
      </div>

      {/* Corner info */}
      <div className="absolute top-0 left-0 w-16 h-8 bg-black/60 backdrop-blur-sm border-r border-b border-white/20 flex items-center justify-center">
        <span className="text-xs text-white/70 font-mono">
          {canvasView.mmPerUnit}mm/u
        </span>
      </div>
    </div>
  )
}