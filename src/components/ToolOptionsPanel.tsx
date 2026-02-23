import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import {
  $currentTool,
  $cutoutToolSettings,
  $overrideToolSettings,
} from "@/stores/ui"
import type { CutoutAnchor, QuadrantState } from "@/types/gridpaint"
import { Button } from "@/components/ui/button"

interface ToolOptionsPanelProps {
  mmPerUnit: number
}

const ANCHOR_OPTIONS: { id: CutoutAnchor; label: string; symbol: string; shortcut: string }[] = [
  { id: "center", label: "Center", symbol: "+", shortcut: "Q" },
  { id: "quadrant-se", label: "SE", symbol: "◣", shortcut: "X" },
  { id: "quadrant-sw", label: "SW", symbol: "◢", shortcut: "Z" },
  { id: "quadrant-nw", label: "NW", symbol: "◥", shortcut: "A" },
  { id: "quadrant-ne", label: "NE", symbol: "◤", shortcut: "W" },
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

  if (currentTool !== "cutout" && currentTool !== "override") {
    return null
  }

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-10">
      {currentTool === "cutout" && (
        <CutoutOptions
          settings={cutoutSettings}
          mmPerUnit={mmPerUnit}
        />
      )}
      {currentTool === "override" && (
        <OverrideOptions settings={overrideSettings} />
      )}
    </div>
  )
}

function CutoutOptions({
  settings,
  mmPerUnit,
}: {
  settings: { anchor: CutoutAnchor; radiusMm: number }
  mmPerUnit: number
}) {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement) return
      
      const key = e.key.toUpperCase()
      const option = ANCHOR_OPTIONS.find(opt => opt.shortcut === key)
      if (option) {
        e.preventDefault()
        $cutoutToolSettings.setKey("anchor", option.id)
      }
    }
    
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="flex items-center gap-3">
      {/* Anchor selection */}
      <div className="flex gap-1">
        {ANCHOR_OPTIONS.map(({ id, label, symbol, shortcut }) => (
          <Button
            key={id}
            type="button"
            size="icon"
            variant={settings.anchor === id ? "default" : "ghost"}
            onClick={() => $cutoutToolSettings.setKey("anchor", id)}
            className="w-8 h-8 font-mono"
            title={label}
            kbShortcut={shortcut}
          >
            {symbol}
          </Button>
        ))}
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Radius input */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono">r:</span>
        <input
          type="number"
          value={settings.radiusMm}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            if (!isNaN(val) && val > 0) {
              $cutoutToolSettings.setKey("radiusMm", val)
            }
          }}
          className="w-16 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-1 font-mono"
          min="0.1"
          step="0.1"
        />
        <span className="text-xs text-muted-foreground font-mono">mm</span>
        <span className="text-xs text-muted-foreground/60 font-mono">
          ({(settings.radiusMm / mmPerUnit).toFixed(2)} gu)
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
