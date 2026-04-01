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
}

export function ModelViewerModal({
  isOpen,
  onClose,
  exportRect,
  layers,
  canvasView,
}: ModelViewerModalProps) {
  const [layerThickness, setLayerThickness] = useState<LayerThickness>(1)
  const [reverseLayers, setReverseLayers] = useState(true)

  const visibleLayers = layers.filter((l) => l.isVisible)

  const rectLabel = exportRect?.name || `Rect ${exportRect?.id.slice(0, 6) ?? ""}`

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
          <DialogTitle className='font-mono text-sm'>
            3D Preview: {rectLabel}
          </DialogTitle>
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
              onThicknessChange={setLayerThickness}
              reverseLayers={reverseLayers}
              onReverseLayersChange={setReverseLayers}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
