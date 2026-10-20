import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"
import {
  $currentTool,
  $cutoutToolSettings,
  $overrideToolSettings,
  $selectionState,
  $shapeToolSettings,
  activeShapeExponent,
} from "@/stores/ui"
import { rebuildShapeFloatState } from "@/lib/gridpaint/rasterizeShape"
import type { ShapeKind, ShapeStyle, ShapeMeta } from "@/types/gridpaint"
import type { FloatingPaste } from "@/stores/ui"
import {
  $exportRects,
  $exportMode,
  $exportFormat,
  $canvasView,
  $layersState,
  $drawingMeta,
  $selectedExportRectIds,
  type ExportMode,
  type ExportFormat,
  selectAllExportRects,
  deselectAllExportRects,
} from "@/stores/drawingStores"
import type { CutoutAnchor, CutoutToolSettings, ExportRect, QuadrantState } from "@/types/gridpaint"
import { Button } from "@/components/ui/button"
import {
  FULL_KEY,
  TOOL_KEYS,
  cutoutAnchorForKey,
  cutoutAnchorKeyLabel,
  isIgnorableKeyEvent,
  overrideKeyLabel,
  overrideShapeForKey,
} from "@/lib/keymap"
import { cn } from "@/lib/utils"
import { exportExportRectsSvg } from "@/lib/export/exportRectsSvg"
import { exportSeparateZip } from "@/lib/export/exportZip"
import { exportCombinedDxf } from "@/lib/export/exportRectsDxf"
import { exportStl } from "@/lib/export/exportStl"
import type { Layer, CanvasViewState } from "@/stores/drawingStores"
import { Clipboard } from "lucide-react"
import { ExportPreviewModal } from "@/components/ExportPreviewModal"
import { ModelViewerModal } from "@/components/ModelViewerModal"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { resolveRectThickness } from "@/lib/export/rectSettings"
import { ThicknessPicker } from "@/components/ThicknessPicker"

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

// Corner shapes are ordered like their keys (I O K L); see keymap.ts
const SHAPE_OPTIONS: {
  id: QuadrantState
  label: string
  renderIcon: () => JSX.Element
}[] = [
  {
    id: "full",
    label: "Full",
    renderIcon: () => <span>■</span>,
  },
  {
    id: "empty",
    label: "Empty",
    renderIcon: () => <span>□</span>,
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
  },
]

export const ToolOptionsPanel = () => {
  const drawingMeta = useStore($drawingMeta)
  const drawingName = drawingMeta.name

  const canvasView = useStore($canvasView)
  const mmPerUnit = canvasView.mmPerUnit

  const layersState = useStore($layersState)
  const layers = layersState.layers

  const currentTool = useStore($currentTool)
  const cutoutSettings = useStore($cutoutToolSettings)
  const overrideSettings = useStore($overrideToolSettings)
  const selectionState = useStore($selectionState)
  const hasFloatingPaste = !!selectionState.floatingPaste
  const exportRects = useStore($exportRects)

  if (
    currentTool !== "cutout" &&
    currentTool !== "override" &&
    currentTool !== "export" &&
    currentTool !== "shape" &&
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
      {!hasFloatingPaste && currentTool === "shape" && (
        <ShapeOptions floatingPaste={null} />
      )}
      {hasFloatingPaste && selectionState.floatingPaste?.shape && (
        <ShapeOptions floatingPaste={selectionState.floatingPaste} />
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
  const format = useStore($exportFormat)
  const selectedExportRectIds = useStore($selectedExportRectIds)
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [model3dOpen, setModel3dOpen] = useState(false)

  // 3D export options
  // Thickness is the drawing-wide setting; rects may override it
  const layerThickness = canvasView.layerThickness
  const setLayerThickness = (t: number) =>
    $canvasView.setKey("layerThickness", t)
  const [reverseLayers, setReverseLayers] = useState(false)
  const [includeCutouts, setIncludeCutouts] = useState(true)

  const hasRects = exportRects.length > 0
  const filteredRects =
    selectedExportRectIds.size === 0
      ? exportRects
      : exportRects.filter((r) => !selectedExportRectIds.has(r.id))
  const selectedCount = filteredRects.length
  const hasSelection = selectedCount > 0

  const is3d = mode === "3d"
  const isFormatDisabled = mode === "separate" || is3d

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
    if (is3d) {
      const rect = filteredRects[0]
      if (!rect) return
      const visibleLayers = layers.filter((l) => l.isVisible)
      const nameParts = [drawingName, rect.name].filter(Boolean)
      const fileName = nameParts.length > 0 ? nameParts.join("-") : "model"
      exportStl({
        layers: visibleLayers,
        exportRect: rect,
        canvasView,
        layerThickness: resolveRectThickness(rect, layerThickness),
        reverseLayers,
        includeCutouts,
        fileName,
      })
      return
    }
    if (mode === "separate") {
      exportSeparateZip(filteredRects, layers, canvasView, drawingName ?? "")
    } else if (format === "dxf") {
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
        mode as "separate" | "combined" | "holder",
      )
    }
  }

  const handlePreview = () => {
    if (is3d) {
      setModel3dOpen(true)
    } else {
      setPreviewOpen(true)
    }
  }

  const formatRectSummary = (rect: ExportRect) => {
    const parts: string[] = []
    parts.push(`${rect.quantity}×`)
    parts.push(rect.name || "unnamed shape")
    if (rect.customMmPerUnit && rect.customMmPerUnit > 0) {
      parts.push(`@${rect.customMmPerUnit}mm`)
    }
    if (rect.customThickness && rect.customThickness > 0) {
      parts.push(`${rect.customThickness}mm thick`)
    }
    return parts.join(" ")
  }

  return (
    <>
      <div className='flex items-center gap-3 pb-2.5 mb-2.5 border-b border-border/60'>
        {/* 3D export options — shown above the main row with a separator when mode is 3d */}
        {is3d && (
          <>
            <span className='text-xs text-muted-foreground font-mono'>
              Thickness:
            </span>
            <ThicknessPicker
              value={layerThickness}
              onChange={(t) => t && setLayerThickness(t)}
            />

            <div className='w-px h-4 bg-border' />

            <label className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={reverseLayers}
                onChange={(e) => setReverseLayers(e.target.checked)}
                className='w-3 h-3'
              />
              Mirror
            </label>

            <div className='w-px h-4 bg-border' />

            <label className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={includeCutouts}
                onChange={(e) => setIncludeCutouts(e.target.checked)}
                className='w-3 h-3'
              />
              Include cutouts
            </label>
          </>
        )}

        {/* SVG/DXF format tabs - disabled for separate and 3d modes */}
        {!is3d && (
          <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
            {(
              [
                ["svg", "SVG"],
                ["dxf", "DXF"],
              ] as [ExportFormat, string][]
            ).map(([f, label]) => (
              <button
                key={f}
                type='button'
                onClick={() => $exportFormat.set(f)}
                disabled={isFormatDisabled}
                className={cn(
                  "text-xs font-mono px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isFormatDisabled && "opacity-30 cursor-not-allowed",
                  !isFormatDisabled && format === f
                    ? "bg-foreground text-background"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
      </div>

      <div className='flex items-center gap-3'>
        {/* Mode toggle */}
        <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
          {(
            [
              ["separate", "separate"],
              ["combined", "combined"],
              ["holder", "holder"],
              ["3d", "3D"],
            ] as [ExportMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type='button'
              onClick={() => $exportMode.set(m)}
              className={cn(
                "text-xs font-mono px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
          onClick={handlePreview}
          className='h-7 text-xs font-mono'
        >
          Preview
        </Button>

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
              {is3d ? (
                "Download STL"
              ) : (
                <>
                  Export
                  {hasSelection
                    ? ` (${selectedCount}${hasRects && selectedCount !== exportRects.length ? `/${exportRects.length}` : ""})`
                    : ""}
                </>
              )}
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
                filteredRects.map((rect) => (
                  <p key={rect.id}>{formatRectSummary(rect)}</p>
                ))
              )}
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>

      {!is3d && (
        <ExportPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          exportRects={filteredRects}
          layers={layers}
          canvasView={canvasView}
          drawingName={drawingName}
          mode={mode as "separate" | "combined" | "holder"}
          format={format}
        />
      )}

      {is3d && (
        <ModelViewerModal
          isOpen={model3dOpen}
          onClose={() => setModel3dOpen(false)}
          exportRects={filteredRects}
          layers={layers}
          canvasView={canvasView}
          drawingName={drawingName}
          reverseLayers={reverseLayers}
          onReverseLayersChange={setReverseLayers}
          includeCutouts={includeCutouts}
        />
      )}
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
  settings: CutoutToolSettings
  mmPerUnit: number
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isIgnorableKeyEvent(e)) return
      const anchor = cutoutAnchorForKey(e)
      if (anchor) {
        e.preventDefault()
        $cutoutToolSettings.setKey("anchor", anchor)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const sizeKey = settings.sizeUnit === "grid" ? "diameterGrid" : "diameterMm"
  const diameter = settings[sizeKey]
  const minimum = settings.sizeUnit === "grid" ? 0.01 : 0.1
  return (
    <div className='flex flex-wrap items-start gap-3 max-w-[calc(100vw-2rem)]'>
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>shape</span>
        <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
          {(["circle", "pill"] as const).map(shape => (
            <button
              key={shape}
              type='button'
              aria-pressed={settings.shape === shape}
              onClick={() => $cutoutToolSettings.setKey("shape", shape)}
              className={cn(
                "text-xs font-mono px-2 min-h-10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                settings.shape === shape
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {shape}
            </button>
          ))}
        </div>
        <span className='text-xs text-muted-foreground font-mono max-w-36'>
          {settings.shape === "pill" ? "Click first center, then second. Esc cancels." : "Click to place a circle."}
        </span>
      </div>
      <div className='w-px self-stretch bg-border' />

      {/* Anchor 3×3 grid + custom */}
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
          anchor
        </span>
        <div className='grid grid-cols-3 gap-0.5'>
          {ANCHOR_GRID.flat().map(({ id, label }) => {
            const keyLabel = cutoutAnchorKeyLabel(id)
            return (
              <button
                key={id}
                type='button'
                onClick={() => $cutoutToolSettings.setKey("anchor", id)}
                title={keyLabel ? `${label} (${keyLabel})` : label}
                aria-label={label}
                aria-pressed={settings.anchor === id}
                className={cn(
                  "w-6 h-6 border rounded-sm transition-colors text-[8px] font-mono leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  settings.anchor === id
                    ? "bg-foreground border-foreground text-background"
                    : "bg-transparent border-border hover:border-foreground/50 text-muted-foreground",
                )}
              >
                {keyLabel}
              </button>
            )
          })}
        </div>
        {/* Custom option */}
        <button
          type='button'
          onClick={() => $cutoutToolSettings.setKey("anchor", "custom")}
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 border rounded-sm transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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

      {/* Each sizing mode keeps its own last-used value. */}
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground font-mono leading-none mb-0.5'>
          {settings.shape === "pill" ? "diameter / width" : "diameter"}
        </span>
        <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
          {(["mm", "grid"] as const).map(unit => (
            <button
              key={unit}
              type='button'
              aria-pressed={settings.sizeUnit === unit}
              onClick={() => $cutoutToolSettings.setKey("sizeUnit", unit)}
              className={cn(
                "text-xs font-mono px-2 min-h-10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                settings.sizeUnit === unit
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {unit === "grid" ? "grid units" : "mm"}
            </button>
          ))}
        </div>
        <input
          key={sizeKey}
          aria-label={settings.sizeUnit === "grid" ? "Diameter in grid units" : "Diameter in millimeters"}
          type='number'
          value={diameter}
          min={minimum}
          onChange={e => {
            const value = parseFloat(e.target.value)
            if (Number.isFinite(value) && value > 0) $cutoutToolSettings.setKey(sizeKey, value)
          }}
          onBlur={() => $cutoutToolSettings.setKey(sizeKey, Math.max(minimum, diameter))}
          className='w-24 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-1 font-mono tabular-nums'
          step={settings.sizeUnit === "grid" ? 0.05 : 0.1}
        />
        <span className='text-xs text-muted-foreground/60 font-mono tabular-nums'>
          {settings.sizeUnit === "grid"
            ? `${(diameter * mmPerUnit).toFixed(2)} mm at canvas scale`
            : `${(diameter / mmPerUnit).toFixed(2)} grid units`}
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
                "text-xs font-mono px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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

function ShapeOptions({ floatingPaste }: { floatingPaste: FloatingPaste | null }) {
  const settings = useStore($shapeToolSettings)

  // When a shape float is live, controls reflect the shape being edited;
  // otherwise they reflect the persisted tool settings.
  const kind = floatingPaste?.shape?.kind ?? settings.shape
  const style = floatingPaste?.shape?.style ?? settings.style
  const exponent =
    floatingPaste?.shape?.exponent ?? activeShapeExponent(settings)

  // Rectangle max = SHARP_RECT_EXPONENT (16): rightmost = true sharp corners.
  const sliderRange = kind === "rectangle" ? { min: 3, max: 16 } : { min: 1, max: 6 }
  const sliderLabel = kind === "rectangle" ? "corners" : "squircle"

  /** Rewrite the live float (if any) after a param change. No-op without a float. */
  const rebuild = (patch: Partial<ShapeMeta>) => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return
    const next = rebuildShapeFloatState(fp, patch)
    if (next) $selectionState.setKey("floatingPaste", next)
  }

  const setKind = (k: ShapeKind) => {
    $shapeToolSettings.setKey("shape", k)
    const exp = k === "rectangle" ? settings.rectExponent : settings.ellipseExponent
    rebuild({ kind: k, exponent: exp })
  }
  const setStyle = (s: ShapeStyle) => {
    $shapeToolSettings.setKey("style", s)
    rebuild({ style: s })
  }
  const setExponent = (n: number) => {
    $shapeToolSettings.setKey(kind === "rectangle" ? "rectExponent" : "ellipseExponent", n)
    rebuild({ exponent: n })
  }

  // R (the tool key) again cycles rect/ellipse; F toggles fill/edge.
  // Capture phase: runs before the global tool handler, so the R press that
  // switches *into* the shape tool doesn't also toggle the kind.
  const keyState = useRef({ kind, style, setKind, setStyle })
  keyState.current = { kind, style, setKind, setStyle }
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isIgnorableKeyEvent(e) || e.shiftKey) return
      const key = e.key.toUpperCase()
      const k = keyState.current
      if (key === TOOL_KEYS.shape && $currentTool.get() === "shape") {
        k.setKind(k.kind === "rectangle" ? "ellipse" : "rectangle")
      } else if (key === FULL_KEY) {
        e.preventDefault()
        k.setStyle(k.style === "fill" ? "edge" : "fill")
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [])

  const seg = (active: boolean) =>
    cn(
      "text-xs font-mono px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      active ? "bg-foreground text-background" : "bg-transparent text-muted-foreground hover:text-foreground",
    )

  return (
    <div className='flex items-center gap-3'>
      <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
        {(["rectangle", "ellipse"] as ShapeKind[]).map((k) => (
          <button key={k} type='button' onClick={() => setKind(k)} className={seg(kind === k)}>
            {k === "rectangle" ? "Rect" : "Ellipse"}
          </button>
        ))}
      </div>

      <div className='w-px h-5 bg-border' />

      <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
        {(["fill", "edge"] as ShapeStyle[]).map((s) => (
          <button key={s} type='button' onClick={() => setStyle(s)} className={seg(style === s)}>
            {s}
          </button>
        ))}
      </div>

      <div className='w-px h-5 bg-border' />

      <label className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground select-none'>
        {sliderLabel}
        <input
          type='range'
          min={sliderRange.min}
          max={sliderRange.max}
          step={0.1}
          value={exponent}
          onChange={(e) => setExponent(parseFloat(e.target.value))}
          className='w-24 accent-foreground'
        />
      </label>

      {floatingPaste?.shape && (
        <>
          <div className='w-px h-5 bg-border' />
          <div className='flex items-center gap-2'>
            {(["width", "height"] as const).map((dim) => (
              <label key={dim} className='flex items-center gap-1 text-xs font-mono text-muted-foreground'>
                {dim === "width" ? "W" : "H"}
                <input
                  type='number'
                  min={1}
                  value={floatingPaste.shape![dim]}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) rebuild({ [dim]: Math.max(1, v) })
                  }}
                  className='w-14 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono'
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function OverrideOptions({ settings }: { settings: { shape: QuadrantState } }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift is part of the override keymap, so only check the other modifiers
      if (isIgnorableKeyEvent(e)) return
      const shape = overrideShapeForKey(e)
      if (shape) {
        e.preventDefault()
        $overrideToolSettings.setKey("shape", shape)
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
          ({ id, label, renderIcon }) => (
            <Button
              key={id}
              type='button'
              size='icon'
              variant={settings.shape === id ? "default" : "ghost"}
              onClick={() => $overrideToolSettings.setKey("shape", id)}
              className='w-8 h-8 font-mono'
              title={`${label} (${overrideKeyLabel(id)})`}
              kbShortcut={overrideKeyLabel(id)}
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
          ({ id, label, renderIcon }) => (
            <Button
              key={id}
              type='button'
              size='icon'
              variant={settings.shape === id ? "default" : "ghost"}
              onClick={() => $overrideToolSettings.setKey("shape", id)}
              className='w-8 h-8 font-mono'
              title={`${label} (${overrideKeyLabel(id)})`}
              kbShortcut={overrideKeyLabel(id)}
            >
              {renderIcon()}
            </Button>
          ),
        )}
      </div>

      <div className='w-px h-6 bg-border' />

      {/* Concave group */}
      <div className='flex gap-1'>
        {SHAPE_OPTIONS.slice(6).map(({ id, label, renderIcon }) => (
          <Button
            key={id}
            type='button'
            size='icon'
            variant={settings.shape === id ? "default" : "ghost"}
            onClick={() => $overrideToolSettings.setKey("shape", id)}
            className='w-8 h-8 font-mono'
            title={`${label} (${overrideKeyLabel(id)})`}
            kbShortcut={overrideKeyLabel(id)}
          >
            {renderIcon()}
          </Button>
        ))}
      </div>
    </div>
  )
}
