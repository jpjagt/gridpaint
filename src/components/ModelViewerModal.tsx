/**
 * ModelViewerModal - Modal dialog for 3D model preview.
 */

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ModelViewerCanvas } from "@/components/ModelViewerCanvas"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type { LayerThickness } from "@/lib/threejs"

interface ModelViewerModalProps {
  isOpen: boolean
  onClose: () => void
  exportRect: ExportRect | null
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

export function ModelViewerModal({
  isOpen,
  onClose,
  exportRect,
  layers,
  canvasView,
  drawingName,
  layerThickness: layerThicknessProp,
  onLayerThicknessChange,
  reverseLayers: reverseLayersProp,
  onReverseLayersChange,
  includeCutouts = true,
}: ModelViewerModalProps) {
  const [layerThicknessInternal, setLayerThicknessInternal] =
    useState<LayerThickness>(1)
  const [reverseLayersInternal, setReverseLayersInternal] = useState(false)

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

  const rectLabel =
    exportRect?.name || `Rect ${exportRect?.id.slice(0, 6) ?? ""}`

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className='p-0 overflow-hidden flex flex-col'
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
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-mono text-sm'>
              3D Preview: {rectLabel}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className='flex-1 overflow-hidden' style={{ minHeight: 0 }}>
          {!exportRect ? (
            <div className='flex items-center justify-center h-full text-sm text-muted-foreground font-mono'>
              Export rect not found.
            </div>
          ) : visibleLayers.length === 0 ? (
            <div className='flex items-center justify-center h-full text-sm text-muted-foreground font-mono'>
              No visible layers in this rect.
            </div>
          ) : (
            <ModelViewerCanvas
              layers={visibleLayers}
              exportRect={exportRect}
              canvasView={canvasView}
              layerThickness={layerThickness}
              onThicknessChange={isControlled ? undefined : setLayerThickness}
              reverseLayers={reverseLayers}
              onReverseLayersChange={
                isControlled ? undefined : setReverseLayers
              }
              includeCutouts={includeCutouts}
              hideControls={isControlled}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
