import { useStore } from "@nanostores/react"
import { useEffect, useState } from "react"
import {
  $currentTool,
  $cutoutToolSettings,
  $overrideToolSettings,
  $selectionState,
} from "@/stores/ui"
import {
  $exportRects,
  $exportMode,
  type ExportMode,
  getFilteredExportRects,
  selectAllExportRects,
  deselectAllExportRects,
} from "@/stores/drawingStores"
import type { CutoutAnchor, ExportRect, QuadrantState } from "@/types/gridpaint"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { exportExportRectsSvg } from "@/lib/export/exportRectsSvg"
import { exportSeparateZip } from "@/lib/export/exportZip"
import { exportCombinedDxf } from "@/lib/export/exportRectsDxf"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import { Clipboard } from "lucide-react"
import { ExportPreviewModal } from "@/components/ExportPreviewModal"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

interface ToolOptionsPanelProps {
  mmPerUnit: number
  layers?: Layer[]
  canvasView?: CanvasViewState
  drawingName?: string
}

// 3×3 grid layout: rows top→bottom, cols left→right
const ANCHOR_GRID: { id: CutoutAnchor; label: string }[][] = [
  [
    { id: "nw", label: "NW" },
    { id: "n", label: "N" },
    { id: "ne", label: "NE" },
  ],
  [
    { id: "w", label: "W" },
    { id: "center", label: "Center" },
    { id: "e", label: "E" },
  ],
  [
    { id: "sw", label: "SW" },
    { id: "s", label: "S" },
    { id: "se", label: "SE" },
  ],
]

const SHAPE_OPTIONS: {
  id: QuadrantState
  label: string
  renderIcon: () => JSX.Element
  shortcut: string
}[] = [
  {
    id: "full",
    label: "Full",
    renderIcon: () => <span>■</span>,
    shortcut: "F",
  },
  {
    id: "empty",
    label: "Empty",
    renderIcon: () => <span>□</span>,
    shortcut: "R",
  },
  {
    id: "convex-se",
    label: "Convex SE",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Convex SE</title>
        <path
          d='M 1 0.5 C 1 0.776 0.776 1 0.5 1 L 0.5 0.5 L 1 0.5 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "T",
  },
  {
    id: "convex-sw",
    label: "Convex SW",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Convex SW</title>
        <path
          d='M 0 0.5 C 0 0.776 0.224 1 0.5 1 L 0.5 0.5 L 0 0.5 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "G",
  },
  {
    id: "convex-nw",
    label: "Convex NW",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Convex NW</title>
        <path
          d='M 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0.5 0.5 L 0.5 0 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "B",
  },
  {
    id: "convex-ne",
    label: "Convex NE",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Convex NE</title>
        <path
          d='M 0.5 0 C 0.776 0 1 0.224 1 0.5 L 0.5 0.5 L 0.5 0 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "Y",
  },
  {
    id: "concave-se",
    label: "Concave SE",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Concave SE</title>
        <path
          d='M 0.5 1 C 0.776 1 1 0.776 1 0.5 L 1 1 L 0.5 1 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "H",
  },
  {
    id: "concave-sw",
    label: "Concave SW",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Concave SW</title>
        <path
          d='M 0.5 1 C 0.224 1 0 0.776 0 0.5 L 0 1 L 0.5 1 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "N",
  },
  {
    id: "concave-nw",
    label: "Concave NW",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Concave NW</title>
        <path
          d='M 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0 0 L 0.5 0 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "U",
  },
  {
    id: "concave-ne",
    label: "Concave NE",
    renderIcon: () => (
      <svg width='16' height='16' viewBox='0 0 1 1' className='inline-block'>
        <title>Concave NE</title>
        <path
          d='M 0.5 0 C 0.776 0 1 0.224 1 0.5 L 1 0 L 0.5 0 Z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='0.04'
        />
      </svg>
    ),
    shortcut: "J",
  },
]

export const ToolOptionsPanel = ({
  mmPerUnit,
  layers,
  canvasView,
  drawingName,
}: ToolOptionsPanelProps) => {
  const currentTool = useStore($currentTool)
  const cutoutSettings = useStore($cutoutToolSettings)
  const overrideSettings = useStore($overrideToolSettings)
  const selectionState = useStore($selectionState)
  const exportRects = useStore($exportRects)

  const hasFloatingPaste = !!selectionState.floatingPaste

  if (
    currentTool !== "cutout" &&
    currentTool !== "override" &&
    currentTool !== "export" &&
    !hasFloatingPaste
  ) {
    return null
  }

  return (
    <div className='fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-10'>
      {hasFloatingPaste && <FloatingPasteHint />}
      {!hasFloatingPaste && currentTool === "cutout" && (
        <CutoutOptions settings={cutoutSettings} mmPerUnit={mmPerUnit} />
      )}
      {!hasFloatingPaste && currentTool === "override" && (
        <OverrideOptions settings={overrideSettings} />
      )}
      {!hasFloatingPaste &&
        currentTool === "export" &&
        layers &&
        canvasView && (
          <ExportOptions
            exportRects={exportRects}
            layers={layers}
            canvasView={canvasView}
            drawingName={drawingName ?? "gridpaint"}
          />
        )}
    </div>
  )
}

function ExportOptions({
  exportRects,
  layers,
  canvasView,
  drawingName,
}: {
  exportRects: ExportRect[]
  layers: Layer[]
  canvasView: CanvasViewState
  drawingName: string
}) {
  const mode = useStore($exportMode)
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const hasRects = exportRects.length > 0
  const filteredRects = getFilteredExportRects()
  const selectedCount = filteredRects.length
  const hasSelection = selectedCount > 0

  const handleCopyBom = () => {
    const text = filteredRects
      .filter((r) => r.name)
      .map((r) => `- ${r.name}: x${r.quantity}`)
      .join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleExport = () => {
    if (mode === "separate") {
      exportSeparateZip(filteredRects, layers, canvasView, drawingName ?? "")
    } else if (mode === "combined-dxf") {
      exportCombinedDxf(
        filteredRects,
        layers,
        canvasView.gridSize,
        canvasView.borderWidth,
        drawingName ?? "",
        canvasView.mmPerUnit,
      )
    } else {
      exportExportRectsSvg(
        filteredRects,
        layers,
        canvasView.gridSize,
        canvasView.borderWidth,
        drawingName,
        canvasView.mmPerUnit,
        mode,
      )
    }
  }

  const formatRectSummary = (rect: ExportRect) => {
    const parts: string[] = []
    parts.push(`${rect.quantity}×`)
    parts.push(rect.name || "unnamed shape")
    if (rect.customMmPerUnit && rect.customMmPerUnit > 0) {
      parts.push(`@${rect.customMmPerUnit}mm`)
    }
    return parts.join(" ")
  }

  return (
    <>
      <div className='flex items-center gap-3'>
        {/* Mode toggle */}
        <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
          {(
            [
              ["separate", "separate"],
              ["combined", "single svg"],
              ["combined-dxf", "single DXF"],
            ] as [ExportMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type='button'
              onClick={() => $exportMode.set(m)}
              className={cn(
                "text-xs font-mono px-2 py-1 transition-colors",
                mode === m
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className='w-px h-5 bg-border' />

        {/* Select all/none */}
        {hasRects && (
          <div className='flex gap-0.5'>
            <button
              type='button'
              onClick={selectAllExportRects}
              className='text-xs font-mono px-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors'
            >
              all
            </button>
            <span className='text-xs text-muted-foreground/50'>·</span>
            <button
              type='button'
              onClick={deselectAllExportRects}
              className='text-xs font-mono px-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors'
            >
              none
            </button>
          </div>
        )}

        <div className='w-px h-5 bg-border' />

        {/* Preview button */}
        <Button
          size='sm'
          variant='outline'
          disabled={!hasSelection}
          onClick={() => setPreviewOpen(true)}
          className='h-7 text-xs font-mono'
        >
          Preview
        </Button>

        {/* Copy BOM to clipboard */}
        {filteredRects.filter((r) => r.name).length > 0 && (
          <Button
            size='icon'
            variant='ghost'
            onClick={handleCopyBom}
            className='h-7 w-7'
            title='Copy bill of materials to clipboard'
          >
            <Clipboard
              className={cn("w-3.5 h-3.5", copied && "text-green-500")}
            />
          </Button>
        )}

        {/* Export button with hover card */}
        <HoverCard openDelay={50}>
          <HoverCardTrigger asChild>
            <Button
              size='sm'
              variant='default'
              disabled={!hasSelection}
              onClick={handleExport}
              className='h-7 text-xs font-mono'
            >
              Export
              {hasSelection
                ? ` (${selectedCount}${hasRects && selectedCount !== exportRects.length ? `/${exportRects.length}` : ""})`
                : ""}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent
            side='top'
            align='center'
            className='min-w-60 w-auto p-2'
          >
            <div className='text-xs font-mono space-y-1'>
              {filteredRects.length === 0 ? (
                <p className='text-muted-foreground'>No shapes selected</p>
              ) : (
                filteredRects.map((rect, i) => (
                  <p key={rect.id}>{formatRectSummary(rect)}</p>
                ))
              )}
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>

      <ExportPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        exportRects={filteredRects}
        layers={layers}
        canvasView={canvasView}
        drawingName={drawingName}
      />
    </>
  )
}

function FloatingPasteHint() {
  return (
    <div className='flex items-center gap-3 text-xs font-mono text-muted-foreground'>
      <span className='flex items-center gap-1'>
        <kbd className='px-1 py-0.5 bg-muted border border-border rounded text-foreground'>
          ↑↓←→
        </kbd>
        <span>move</span>
      </span>
      <span className='flex items-center gap-1'>
        <kbd className='px-1 py-0.5 bg-muted border border-border rounded text-foreground'>
          Shift
        </kbd>
        <span>+ arrows = ×10</span>
      </span>
      <span className='w-px self-stretch bg-border' />
      <span className='flex items-center gap-1'>
        <kbd className='px-1 py-0.5 bg-muted border border-border rounded text-foreground'>
          Enter
        </kbd>
        <span>place</span>
      </span>
      <span className='flex items-center gap-1'>
        <kbd className='px-1 py-0.5 bg-muted border border-border rounded text-foreground'>
          Esc
        </kbd>
        <span>cancel</span>
      </span>
    </div>
  )
}

function CutoutOptions({
  settings,
  mmPerUnit,
}: {
  settings: {
    anchor: CutoutAnchor
    diameterMm: number
    customOffset: { x: number; y: number }
    mode: "single" | "rivet"
    rivetScalePercent: number
  }
  mmPerUnit: number
}) {
  return (
    <div className='flex items-start gap-3'>
      {/* Anchor 3×3 grid + custom */}
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
          anchor
        </span>
        <div className='grid grid-cols-3 gap-0.5'>
          {ANCHOR_GRID.flat().map(({ id, label }) => (
            <button
              key={id}
              type='button'
              onClick={() => $cutoutToolSettings.setKey("anchor", id)}
              title={label}
              className={cn(
                "w-6 h-6 border rounded-sm transition-colors",
                settings.anchor === id
                  ? "bg-foreground border-foreground"
                  : "bg-transparent border-border hover:border-foreground/50",
              )}
            />
          ))}
        </div>
        {/* Custom option */}
        <button
          type='button'
          onClick={() => $cutoutToolSettings.setKey("anchor", "custom")}
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 border rounded-sm transition-colors text-left",
            settings.anchor === "custom"
              ? "bg-foreground text-background border-foreground"
              : "bg-transparent text-muted-foreground border-border hover:border-foreground/50",
          )}
        >
          custom
        </button>
        {/* Custom x/y inputs */}
        {settings.anchor === "custom" && (
          <div className='flex flex-col gap-1 mt-0.5'>
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className='flex items-center gap-1'>
                <span className='text-xs text-muted-foreground font-mono w-3'>
                  {axis}:
                </span>
                <input
                  type='number'
                  value={settings.customOffset[axis]}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    if (!isNaN(val)) {
                      $cutoutToolSettings.setKey("customOffset", {
                        ...settings.customOffset,
                        [axis]: val,
                      })
                    }
                  }}
                  className='w-14 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono'
                  step='0.05'
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='w-px self-stretch bg-border' />

      {/* Diameter input */}
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
          diameter
        </span>
        <div className='flex items-center gap-1'>
          <input
            type='number'
            value={settings.diameterMm}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val)) {
                $cutoutToolSettings.setKey("diameterMm", val)
              }
            }}
            onBlur={(e) => {
              const val = parseFloat(e.target.value)
              const clamped = Math.max(0.1, isNaN(val) ? 1 : val)
              $cutoutToolSettings.setKey("diameterMm", clamped)
            }}
            className='w-16 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-1 font-mono'
            step='0.1'
          />
          <span className='text-xs text-muted-foreground font-mono'>mm</span>
        </div>
        <span className='text-xs text-muted-foreground/60 font-mono'>
          {(settings.diameterMm / mmPerUnit).toFixed(2)} gu
        </span>
      </div>

      <div className='w-px self-stretch bg-border' />

      {/* Mode toggle */}
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
          mode
        </span>
        <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
          {(["single", "rivet"] as const).map((m) => (
            <button
              key={m}
              type='button'
              onClick={() => $cutoutToolSettings.setKey("mode", m)}
              className={cn(
                "text-xs font-mono px-2 py-1 transition-colors",
                settings.mode === m
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Rivet scale - only show when mode === "rivet" */}
      {settings.mode === "rivet" && (
        <>
          <div className='w-px self-stretch bg-border' />

          <div className='flex flex-col gap-1'>
            <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
              top/bottom scale
            </span>
            <div className='flex items-center gap-1'>
              <input
                type='number'
                value={settings.rivetScalePercent}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) {
                    $cutoutToolSettings.setKey("rivetScalePercent", val)
                  }
                }}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value)
                  const clamped = Math.max(100, isNaN(val) ? 100 : val)
                  $cutoutToolSettings.setKey("rivetScalePercent", clamped)
                }}
                className='w-14 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-1 font-mono'
                step='5'
              />
              <span className='text-xs text-muted-foreground font-mono'>%</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function OverrideOptions({ settings }: { settings: { shape: QuadrantState } }) {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement) return

      const key = e.key.toUpperCase()
      const option = SHAPE_OPTIONS.find((opt) => opt.shortcut === key)
      if (option) {
        e.preventDefault()
        $overrideToolSettings.setKey("shape", option.id)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className='flex items-center gap-3'>
      {/* Full/Empty group */}
      <div className='flex gap-1'>
        {SHAPE_OPTIONS.slice(0, 2).map(
          ({ id, label, renderIcon, shortcut }) => (
            <Button
              key={id}
              type='button'
              size='icon'
              variant={settings.shape === id ? "default" : "ghost"}
              onClick={() => $overrideToolSettings.setKey("shape", id)}
              className='w-8 h-8 font-mono'
              title={label}
              kbShortcut={shortcut}
            >
              {renderIcon()}
            </Button>
          ),
        )}
      </div>

      <div className='w-px h-6 bg-border' />

      {/* Convex group */}
      <div className='flex gap-1'>
        {SHAPE_OPTIONS.slice(2, 6).map(
          ({ id, label, renderIcon, shortcut }) => (
            <Button
              key={id}
              type='button'
              size='icon'
              variant={settings.shape === id ? "default" : "ghost"}
              onClick={() => $overrideToolSettings.setKey("shape", id)}
              className='w-8 h-8 font-mono'
              title={label}
              kbShortcut={shortcut}
            >
              {renderIcon()}
            </Button>
          ),
        )}
      </div>

      <div className='w-px h-6 bg-border' />

      {/* Concave group */}
      <div className='flex gap-1'>
        {SHAPE_OPTIONS.slice(6).map(({ id, label, renderIcon, shortcut }) => (
          <Button
            key={id}
            type='button'
            size='icon'
            variant={settings.shape === id ? "default" : "ghost"}
            onClick={() => $overrideToolSettings.setKey("shape", id)}
            className='w-8 h-8 font-mono'
            title={label}
            kbShortcut={shortcut}
          >
            {renderIcon()}
          </Button>
        ))}
      </div>
    </div>
  )
}
