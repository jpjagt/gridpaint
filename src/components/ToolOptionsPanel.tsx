import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import {
  $currentTool,
  $cutoutToolSettings,
  $overrideToolSettings,
  $selectionState,
} from "@/stores/ui"
import type { CutoutAnchor, QuadrantState } from "@/types/gridpaint"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ToolOptionsPanelProps {
  mmPerUnit: number
}

// 3×3 grid layout: rows top→bottom, cols left→right
const ANCHOR_GRID: { id: CutoutAnchor; label: string }[][] = [
  [{ id: "nw", label: "NW" }, { id: "n", label: "N" }, { id: "ne", label: "NE" }],
  [{ id: "w",  label: "W"  }, { id: "center", label: "Center" }, { id: "e", label: "E" }],
  [{ id: "sw", label: "SW" }, { id: "s", label: "S" }, { id: "se", label: "SE" }],
]

const SHAPE_OPTIONS: { id: QuadrantState; label: string; renderIcon: () => JSX.Element; shortcut: string }[] = [
  { id: "full", label: "Full", renderIcon: () => <span>■</span>, shortcut: "F" },
  { id: "empty", label: "Empty", renderIcon: () => <span>□</span>, shortcut: "R" },
  { 
    id: "convex-se", 
    label: "Convex SE", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Convex SE</title>
        <path d="M 1 0.5 C 1 0.776 0.776 1 0.5 1 L 0.5 0.5 L 1 0.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "T"
  },
  { 
    id: "convex-sw", 
    label: "Convex SW", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Convex SW</title>
        <path d="M 0 0.5 C 0 0.776 0.224 1 0.5 1 L 0.5 0.5 L 0 0.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "G"
  },
  { 
    id: "convex-nw", 
    label: "Convex NW", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Convex NW</title>
        <path d="M 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0.5 0.5 L 0.5 0 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "B"
  },
  { 
    id: "convex-ne", 
    label: "Convex NE", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Convex NE</title>
        <path d="M 0.5 0 C 0.776 0 1 0.224 1 0.5 L 0.5 0.5 L 0.5 0 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "Y"
  },
  { 
    id: "concave-se", 
    label: "Concave SE", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Concave SE</title>
        <path d="M 0.5 1 C 0.776 1 1 0.776 1 0.5 L 1 1 L 0.5 1 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "H"
  },
  { 
    id: "concave-sw", 
    label: "Concave SW", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Concave SW</title>
        <path d="M 0.5 1 C 0.224 1 0 0.776 0 0.5 L 0 1 L 0.5 1 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "N"
  },
  { 
    id: "concave-nw", 
    label: "Concave NW", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Concave NW</title>
        <path d="M 0.5 0 C 0.224 0 0 0.224 0 0.5 L 0 0 L 0.5 0 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "U"
  },
  { 
    id: "concave-ne", 
    label: "Concave NE", 
    renderIcon: () => (
      <svg width="16" height="16" viewBox="0 0 1 1" className="inline-block">
        <title>Concave NE</title>
        <path d="M 0.5 0 C 0.776 0 1 0.224 1 0.5 L 1 0 L 0.5 0 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.04" />
      </svg>
    ),
    shortcut: "J"
  },
]

export const ToolOptionsPanel = ({ mmPerUnit }: ToolOptionsPanelProps) => {
  const currentTool = useStore($currentTool)
  const cutoutSettings = useStore($cutoutToolSettings)
  const overrideSettings = useStore($overrideToolSettings)
  const selectionState = useStore($selectionState)

  const hasFloatingPaste = !!selectionState.floatingPaste

  if (currentTool !== "cutout" && currentTool !== "override" && !hasFloatingPaste) {
    return null
  }

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-10">
      {hasFloatingPaste && (
        <FloatingPasteHint />
      )}
      {!hasFloatingPaste && currentTool === "cutout" && (
        <CutoutOptions
          settings={cutoutSettings}
          mmPerUnit={mmPerUnit}
        />
      )}
      {!hasFloatingPaste && currentTool === "override" && (
        <OverrideOptions settings={overrideSettings} />
      )}
    </div>
  )
}

function FloatingPasteHint() {
  return (
    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-foreground">↑↓←→</kbd>
        <span>move</span>
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-foreground">Shift</kbd>
        <span>+ arrows = ×10</span>
      </span>
      <span className="w-px self-stretch bg-border" />
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-foreground">Enter</kbd>
        <span>place</span>
      </span>
      <span className="flex items-center gap-1">
        <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-foreground">Esc</kbd>
        <span>cancel</span>
      </span>
    </div>
  )
}

function CutoutOptions({
  settings,
  mmPerUnit,
}: {
  settings: { anchor: CutoutAnchor; diameterMm: number; customOffset: { x: number; y: number } }
  mmPerUnit: number
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Anchor 3×3 grid + custom */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground font-mono leading-none mb-0.5">anchor</span>
        <div className="grid grid-cols-3 gap-0.5">
          {ANCHOR_GRID.flat().map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => $cutoutToolSettings.setKey("anchor", id)}
              title={label}
              className={cn(
                "w-6 h-6 border rounded-sm transition-colors",
                settings.anchor === id
                  ? "bg-foreground border-foreground"
                  : "bg-transparent border-border hover:border-foreground/50"
              )}
            />
          ))}
        </div>
        {/* Custom option */}
        <button
          type="button"
          onClick={() => $cutoutToolSettings.setKey("anchor", "custom")}
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 border rounded-sm transition-colors text-left",
            settings.anchor === "custom"
              ? "bg-foreground text-background border-foreground"
              : "bg-transparent text-muted-foreground border-border hover:border-foreground/50"
          )}
        >
          custom
        </button>
        {/* Custom x/y inputs */}
        {settings.anchor === "custom" && (
          <div className="flex flex-col gap-1 mt-0.5">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground font-mono w-3">{axis}:</span>
                <input
                  type="number"
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
                  className="w-14 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono"
                  step="0.05"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-px self-stretch bg-border" />

      {/* Diameter input */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground font-mono leading-none mb-0.5">diameter</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={settings.diameterMm}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val) && val > 0) {
                $cutoutToolSettings.setKey("diameterMm", val)
              }
            }}
            className="w-16 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-1 font-mono"
            min="0.1"
            step="0.1"
          />
          <span className="text-xs text-muted-foreground font-mono">mm</span>
        </div>
        <span className="text-xs text-muted-foreground/60 font-mono">
          {(settings.diameterMm / mmPerUnit).toFixed(2)} gu
        </span>
      </div>
    </div>
  )
}

function OverrideOptions({
  settings,
}: {
  settings: { shape: QuadrantState }
}) {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement) return
      
      const key = e.key.toUpperCase()
      const option = SHAPE_OPTIONS.find(opt => opt.shortcut === key)
      if (option) {
        e.preventDefault()
        $overrideToolSettings.setKey("shape", option.id)
      }
    }
    
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="flex items-center gap-3">
      {/* Full/Empty group */}
      <div className="flex gap-1">
        {SHAPE_OPTIONS.slice(0, 2).map(({ id, label, renderIcon, shortcut }) => (
          <Button
            key={id}
            type="button"
            size="icon"
            variant={settings.shape === id ? "default" : "ghost"}
            onClick={() => $overrideToolSettings.setKey("shape", id)}
            className="w-8 h-8 font-mono"
            title={label}
            kbShortcut={shortcut}
          >
            {renderIcon()}
          </Button>
        ))}
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Convex group */}
      <div className="flex gap-1">
        {SHAPE_OPTIONS.slice(2, 6).map(({ id, label, renderIcon, shortcut }) => (
          <Button
            key={id}
            type="button"
            size="icon"
            variant={settings.shape === id ? "default" : "ghost"}
            onClick={() => $overrideToolSettings.setKey("shape", id)}
            className="w-8 h-8 font-mono"
            title={label}
            kbShortcut={shortcut}
          >
            {renderIcon()}
          </Button>
        ))}
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Concave group */}
      <div className="flex gap-1">
        {SHAPE_OPTIONS.slice(6).map(({ id, label, renderIcon, shortcut }) => (
          <Button
            key={id}
            type="button"
            size="icon"
            variant={settings.shape === id ? "default" : "ghost"}
            onClick={() => $overrideToolSettings.setKey("shape", id)}
            className="w-8 h-8 font-mono"
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
