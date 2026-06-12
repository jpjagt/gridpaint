import { useEffect, useState } from "react"
import { useStore } from "@nanostores/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  $canvasView,
  $layersState,
  getLayerPoints,
  setLayerRange,
} from "@/stores/drawingStores"
import { drawingStore } from "@/lib/storage/store"
import {
  isValidLayerRange,
  clampRangeToContent,
  type LayerRange,
} from "@/types/layers"
import { toast } from "sonner"

interface DrawingSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  drawingId: string
  drawingName: string
  onDeleted: () => void
}

export function DrawingSettingsModal({
  isOpen,
  onClose,
  drawingId,
  drawingName,
  onDeleted,
}: DrawingSettingsModalProps) {
  const canvasView = useStore($canvasView)
  const layersState = useStore($layersState)

  const [min, setMin] = useState(String(canvasView.layerRange.min))
  const [max, setMax] = useState(String(canvasView.layerRange.max))

  // Re-seed local inputs whenever the modal opens or the stored range changes.
  useEffect(() => {
    if (isOpen) {
      setMin(String(canvasView.layerRange.min))
      setMax(String(canvasView.layerRange.max))
    }
  }, [isOpen, canvasView.layerRange.min, canvasView.layerRange.max])

  const commitRange = () => {
    const parsed: LayerRange = { min: parseInt(min, 10), max: parseInt(max, 10) }
    if (!isValidLayerRange(parsed)) {
      toast.error("Invalid range: min must be ≤ max (whole numbers).")
      // reset inputs to current stored values
      setMin(String(canvasView.layerRange.min))
      setMax(String(canvasView.layerRange.max))
      return
    }
    // Don't allow shrinking to orphan drawn layers — widen to cover content.
    const drawnIds = layersState.layers
      .filter((l) => getLayerPoints(l).size > 0)
      .map((l) => l.id)
    const safe = clampRangeToContent(parsed, drawnIds)
    if (safe.min !== parsed.min || safe.max !== parsed.max) {
      toast.info(
        `Range widened to ${safe.min}..${safe.max} to keep existing layers.`,
      )
      setMin(String(safe.min))
      setMax(String(safe.max))
    }
    setLayerRange(safe)
  }

  const handleDelete = async () => {
    await drawingStore.delete(drawingId)
    onDeleted()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grid settings</DialogTitle>
          <DialogDescription>
            Configure the selectable layer range and manage this grid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-2">Layer range</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">min</label>
              <input
                type="number"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                onBlur={commitRange}
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
              />
              <label className="text-xs text-muted-foreground">max</label>
              <input
                type="number"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                onBlur={commitRange}
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Layers render bottom-to-top by number; colors scale
              lightest→darkest.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete grid</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete grid</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{drawingName}"? This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
