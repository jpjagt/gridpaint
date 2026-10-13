/**
 * ModelViewerModal - Modal dialog for 3D model preview.
 *
 * Renders up to MAX_PREVIEW_RECTS export rects side by side, each in its own
 * canvas so camera controls stay independent per rect.
 */

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ModelViewerCanvas } from "@/components/ModelViewerCanvas"
import { CameraSyncGroup } from "@/lib/threejs"
import { cn } from "@/lib/utils"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type { LayerThickness } from "@/lib/threejs"

const MAX_PREVIEW_RECTS = 3

interface ModelViewerModalProps {
  isOpen: boolean
  onClose: () => void
  /** Rects to preview. Only the first MAX_PREVIEW_RECTS are shown. */
  exportRects: ExportRect[]
  layers: Layer[]
  canvasView: CanvasViewState
  drawingName?: string
  /** Controlled layer thickness. When provided, the in-modal thickness picker is hidden. */
  layerThickness?: LayerThickness
  onLayerThicknessChange?: (t: LayerThickness) => void
  /** Controlled mirror/reverse-layers. When provided, the in-modal checkbox is hidden. */
  reverseLayers?: boolean
  onReverseLayersChange?: (v: boolean) => void
  /** When false, cutout holes are omitted from the 3D geometry. Defaults to true. */
  includeCutouts?: boolean
}

function rectLabel(rect: ExportRect): string {
  return rect.name || `Rect ${rect.id.slice(0, 6)}`
}

export function ModelViewerModal({
  isOpen,
  onClose,
  exportRects,
  layers,
  canvasView,
  layerThickness: layerThicknessProp,
  onLayerThicknessChange,
  reverseLayers: reverseLayersProp,
  onReverseLayersChange,
  includeCutouts = true,
}: ModelViewerModalProps) {
  const [layerThicknessInternal, setLayerThicknessInternal] =
    useState<LayerThickness>(1)
  const [reverseLayersInternal, setReverseLayersInternal] = useState(false)
  const [syncCameras, setSyncCameras] = useState(false)
  const [cameraSyncGroup] = useState(() => new CameraSyncGroup())

  const isControlled =
    layerThicknessProp !== undefined || reverseLayersProp !== undefined
  const layerThickness = layerThicknessProp ?? layerThicknessInternal
  const reverseLayers = reverseLayersProp ?? reverseLayersInternal

  const setLayerThickness = (t: LayerThickness) => {
    setLayerThicknessInternal(t)
    onLayerThicknessChange?.(t)
  }
  const setReverseLayers = (v: boolean) => {
    setReverseLayersInternal(v)
    onReverseLayersChange?.(v)
  }

  const visibleLayers = layers.filter((l) => l.isVisible)

  const shownRects = exportRects.slice(0, MAX_PREVIEW_RECTS)
  const hiddenCount = exportRects.length - shownRects.length
  const isMulti = shownRects.length > 1

  const title =
    shownRects.length === 0
      ? "3D Preview"
      : `3D Preview: ${shownRects.map(rectLabel).join(" · ")}`

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className='p-0 overflow-hidden flex flex-col gap-0'
        style={{
          width: "calc(100vw - 60px)",
          height: "calc(100vh - 60px)",
          maxWidth: "calc(100vw - 60px)",
          maxHeight: "calc(100vh - 60px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        <DialogHeader className='px-6 py-4 border-b border-border shrink-0'>
          <div className='flex items-center gap-4 mr-8'>
            <DialogTitle
              className='font-mono text-sm truncate min-w-0 flex-1'
              title={title}
            >
              {title}
              {hiddenCount > 0 && (
                <span className='text-muted-foreground'>
                  {" "}
                  (+{hiddenCount} more not shown)
                </span>
              )}
            </DialogTitle>
            {isMulti && (
              <label className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none shrink-0'>
                <input
                  type='checkbox'
                  checked={syncCameras}
                  onChange={(e) => setSyncCameras(e.target.checked)}
                  className='w-3 h-3'
                />
                Sync position
              </label>
            )}
          </div>
        </DialogHeader>

        <div className='flex-1 overflow-hidden flex' style={{ minHeight: 0 }}>
          {shownRects.length === 0 ? (
            <div className='flex items-center justify-center h-full w-full text-sm text-muted-foreground font-mono'>
              Export rect not found.
            </div>
          ) : visibleLayers.length === 0 ? (
            <div className='flex items-center justify-center h-full w-full text-sm text-muted-foreground font-mono'>
              No visible layers in this rect.
            </div>
          ) : (
            shownRects.map((rect, i) => (
              <div
                key={rect.id}
                className={cn(
                  "flex-1 min-w-0 flex flex-col",
                  i > 0 && "border-l border-border",
                )}
              >
                {isMulti && (
                  <div className='px-3 py-1.5 text-xs font-mono text-muted-foreground border-b border-border shrink-0'>
                    {rectLabel(rect)}
                  </div>
                )}
                <div className='flex-1 min-h-0'>
                  <ModelViewerCanvas
                    layers={visibleLayers}
                    exportRect={rect}
                    canvasView={canvasView}
                    layerThickness={layerThickness}
                    onThicknessChange={
                      isControlled ? undefined : setLayerThickness
                    }
                    reverseLayers={reverseLayers}
                    onReverseLayersChange={
                      isControlled ? undefined : setReverseLayers
                    }
                    includeCutouts={includeCutouts}
                    hideControls={isControlled || isMulti}
                    cameraSync={syncCameras ? cameraSyncGroup : null}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
