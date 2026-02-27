/**
 * HTML overlay component that renders quantity inputs for each export rect.
 * Inputs are positioned absolutely over the canvas using screen-space coordinates
 * derived from the grid position + current pan/zoom.
 */

import { useStore } from "@nanostores/react"
import { $exportRects } from "@/stores/drawingStores"
import type { CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"

interface ExportRectOverlayProps {
  canvasView: CanvasViewState
  onQuantityChange: (id: string, quantity: number) => void
  onNameChange: (id: string, name: string) => void
  onDelete: (id: string) => void
  visible: boolean
}

/** Convert grid coordinates to screen (CSS pixel) position */
function gridToScreen(
  gridX: number,
  gridY: number,
  canvasView: CanvasViewState,
): { x: number; y: number } {
  return {
    x: gridX * canvasView.gridSize * canvasView.zoom + canvasView.panOffset.x,
    y: gridY * canvasView.gridSize * canvasView.zoom + canvasView.panOffset.y,
  }
}

function QuantityInput({
  rect,
  canvasView,
  onQuantityChange,
  onNameChange,
  onDelete,
}: {
  rect: ExportRect
  canvasView: CanvasViewState
  onQuantityChange: (id: string, quantity: number) => void
  onNameChange: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  // Position at the bottom-right corner of the rect (just inside)
  const bottomRight = gridToScreen(rect.maxX + 1, rect.maxY + 1, canvasView)

  // Offset inward so it stays visually inside the rect
  const offsetPx = 4
  const quantityInputWidth = 44
  // rough width: delete(16) + decrement(16) + quantity(36) + increment(16) + name(~80) + gaps
  const totalWidth = 16 + 16 + 36 + 16 + 84 + 16

  return (
    <div
      style={{
        position: "fixed",
        left: bottomRight.x - totalWidth - offsetPx,
        top: bottomRight.y - 24 - offsetPx,
        pointerEvents: "auto",
        zIndex: 20,
      }}
    >
      <div className='flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-blue-400/60 rounded px-1 py-0.5'>
        <button
          type='button'
          onClick={(e) => { e.stopPropagation(); onDelete(rect.id) }}
          onMouseDown={(e) => e.stopPropagation()}
          className='text-red-400/60 hover:text-red-400 leading-none w-4 text-center select-none transition-colors'
          tabIndex={-1}
          title='Delete rect (or alt+click on canvas)'
        >
          ✕
        </button>
        <button
          type='button'
          onClick={(e) => { e.stopPropagation(); if (rect.quantity > 1) onQuantityChange(rect.id, rect.quantity - 1) }}
          onMouseDown={(e) => e.stopPropagation()}
          className='text-xs text-blue-400/70 hover:text-blue-400 leading-none w-4 text-center select-none transition-colors'
          tabIndex={-1}
        >
          −
        </button>
        <input
          type='number'
          min={0}
          max={99}
          value={rect.quantity}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (!isNaN(val) && val >= 1) {
              onQuantityChange(rect.id, val)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className='w-9 bg-transparent text-xs text-foreground font-mono outline-none text-right'
          style={{ colorScheme: "light dark" }}
        />
        <button
          type='button'
          onClick={(e) => { e.stopPropagation(); onQuantityChange(rect.id, rect.quantity + 1) }}
          onMouseDown={(e) => e.stopPropagation()}
          className='text-xs text-blue-400/70 hover:text-blue-400 leading-none w-4 text-center select-none transition-colors'
          tabIndex={-1}
        >
          +
        </button>
        <div className='w-px self-stretch bg-blue-400/30 mx-0.5' />
        <input
          type='text'
          placeholder='name'
          value={rect.name ?? ""}
          onChange={(e) => onNameChange(rect.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className='w-20 bg-transparent text-xs text-foreground font-mono outline-none placeholder:text-muted-foreground/40'
        />
      </div>
    </div>
  )
}

export function ExportRectOverlay({
  canvasView,
  onQuantityChange,
  onNameChange,
  onDelete,
  visible,
}: ExportRectOverlayProps) {
  const exportRects = useStore($exportRects)

  if (!visible || exportRects.length === 0) return null

  return (
    <>
      {exportRects.map((rect) => (
        <div key={rect.id}>
          <QuantityInput
            rect={rect}
            canvasView={canvasView}
            onQuantityChange={onQuantityChange}
            onNameChange={onNameChange}
            onDelete={onDelete}
          />
        </div>
      ))}
    </>
  )
}
