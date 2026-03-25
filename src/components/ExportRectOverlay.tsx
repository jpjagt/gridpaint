import { useStore } from "@nanostores/react"
import { $exportRects } from "@/stores/drawingStores"
import type { CanvasViewState } from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ExportRectOverlayProps {
  canvasView: CanvasViewState
  onQuantityChange: (id: string, quantity: number) => void
  onNameChange: (id: string, name: string) => void
  onDelete: (id: string) => void
  onCustomMmPerUnitChange: (id: string, value: number | undefined) => void
  onToggleSelection: (id: string) => void
  selectedIds: Set<string>
  visible: boolean
}

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
  onCustomMmPerUnitChange,
  onToggleSelection,
  isSelected,
}: {
  rect: ExportRect
  canvasView: CanvasViewState
  onQuantityChange: (id: string, quantity: number) => void
  onNameChange: (id: string, name: string) => void
  onDelete: (id: string) => void
  onCustomMmPerUnitChange: (id: string, value: number | undefined) => void
  onToggleSelection: (id: string) => void
  isSelected: boolean
}) {
  const bottomRight = gridToScreen(rect.maxX + 1, rect.maxY + 1, canvasView)
  const topLeft = gridToScreen(rect.minX, rect.minY, canvasView)

  const offsetPx = 4
  const totalWidth = 16 + 16 + 28 + 16 + 112 + 20 + 16

  return (
    <>
      <div
        style={{
          position: "fixed",
          left: topLeft.x - offsetPx,
          top: topLeft.y - offsetPx,
          pointerEvents: "auto",
          zIndex: 20,
        }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelection(rect.id)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title={isSelected ? "Included in export" : "Excluded from export"}
        />
      </div>
      <div
        style={{
          position: "fixed",
          left: bottomRight.x - totalWidth - offsetPx,
          top: bottomRight.y - 24 - offsetPx,
          pointerEvents: "auto",
          zIndex: 20,
        }}
      >
        <div className={`flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border rounded px-1 py-0.5 ${isSelected ? "border-blue-400/60" : "border-muted opacity-50"}`}>
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
          min={1}
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
          className='w-7 bg-transparent text-xs text-foreground font-mono outline-none text-right'
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
          className='w-28 bg-transparent text-xs text-foreground font-mono outline-none placeholder:text-muted-foreground/40'
        />
        {rect.customMmPerUnit && rect.customMmPerUnit > 0 && (
          <span className='text-[10px] text-muted-foreground/60 font-mono'>
            @{rect.customMmPerUnit}mm
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className='text-xs text-muted-foreground hover:text-foreground leading-none w-5 text-center select-none transition-colors'
              tabIndex={-1}
            >
              ⋮
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-[140px]'>
            <DropdownMenuItem
              className='text-xs text-red-400 focus:text-red-400 focus:bg-red-400/10'
              onSelect={() => onDelete(rect.id)}
            >
              Delete
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className='px-2 py-1.5'>
              <div className='text-[10px] text-muted-foreground font-mono mb-1'>
                Custom mm/unit
              </div>
              <div className='flex items-center gap-1'>
                <input
                  type='number'
                  min={0}
                  step={0.5}
                  value={rect.customMmPerUnit ?? ""}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    if (e.target.value === "" || isNaN(val) || val <= 0) {
                      onCustomMmPerUnitChange(rect.id, undefined)
                    } else {
                      onCustomMmPerUnitChange(rect.id, val)
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder='default'
                  className='w-16 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono outline-none'
                />
                <span className='text-[10px] text-muted-foreground font-mono'>mm</span>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
    </>
  )
}

export function ExportRectOverlay({
  canvasView,
  onQuantityChange,
  onNameChange,
  onDelete,
  onCustomMmPerUnitChange,
  onToggleSelection,
  selectedIds,
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
            onCustomMmPerUnitChange={onCustomMmPerUnitChange}
            onToggleSelection={onToggleSelection}
            isSelected={!selectedIds.has(rect.id)}
          />
        </div>
      ))}
    </>
  )
}
