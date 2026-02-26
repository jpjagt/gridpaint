import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Grid3X3, Square } from "lucide-react"
import { useEffect } from "react"
import { useStore } from "@nanostores/react"
import type { Layer } from "@/stores/drawingStores"
import { addGroupToActiveLayer, collapseEmptyTrailingGroups } from "@/stores/drawingStores"
import {
  $activeGroupIndex,
  setActiveGroupIndex,
  setCurrentTool,
  prevGroup,
  nextGroup,
  type Tool,
} from "@/stores/ui"
import { undo, redo } from "@/stores/historyStore"

interface LayerControlsProps {
  layers: Layer[]
  activeLayerId: number | null
  onLayerSelect: (layerId: number | null) => void
  onLayerVisibilityToggle: (layerId: number) => void
  onCreateLayer: () => void
  onLayerRenderStyleToggle: (layerId: number) => void
  onCreateOrActivateLayer: (layerId: number) => void
  maxLayers?: number
}

export const LayerControls = ({
  layers,
  activeLayerId,
  onLayerSelect,
  onLayerVisibilityToggle,
  onCreateLayer,
  onLayerRenderStyleToggle,
  onCreateOrActivateLayer,
  maxLayers = 6,
}: LayerControlsProps) => {
  const activeGroupIndex = useStore($activeGroupIndex)

  const activeLayer = activeLayerId !== null
    ? layers.find((l) => l.id === activeLayerId)
    : null
  const groupCount = activeLayer ? activeLayer.groups.length : 0

  const handleLayerClick = (layerId: number) => {
    // If clicking the active layer, deactivate it (view-only mode)
    if (activeLayerId === layerId) {
      onLayerSelect(null)
    } else {
      onCreateOrActivateLayer(layerId)
      // Reset group index when switching layers
      setActiveGroupIndex(0)
    }
  }

  // Keyboard shortcuts for layer switching and group cycling
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore when an input/textarea is focused
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const key = e.key

      // Number keys 1-6: switch layer
      const isNumberKey =
        /^[1-6]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey
      if (isNumberKey) {
        e.preventDefault()
        const layerId = parseInt(key)
        if (activeLayerId === layerId) {
          onLayerSelect(null) // Deactivate if already active
        } else {
          onCreateOrActivateLayer(layerId)
          setActiveGroupIndex(0) // Reset group on layer switch
        }
        return
      }

      // [ : previous group (collapse empty trailing groups first)
      if (key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        if (activeLayerId !== null) {
          const currentIdx = $activeGroupIndex.get()
          // Collapse empty groups beyond where we're navigating to
          if (currentIdx > 0) {
            collapseEmptyTrailingGroups(currentIdx - 1)
          }
          prevGroup()
        }
        return
      }

      // ] : next group; creates new group only if current is non-empty.
      // Stops at an empty last group (don't create another empty one).
      if (key === "]" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        if (activeLayerId !== null && activeLayer) {
          const currentIdx = $activeGroupIndex.get()
          const currentGroup = activeLayer.groups[currentIdx]
          const hasNextGroup = currentIdx < activeLayer.groups.length - 1

          // If current group is empty and there's no next group to navigate to, don't advance
          if (currentGroup && currentGroup.points.size === 0 && !hasNextGroup) {
            return
          }

          // If we're at the last existing group (which is non-empty), create a new one
          if (currentIdx === activeLayer.groups.length - 1) {
            addGroupToActiveLayer()
          }

          nextGroup(activeLayer.groups.length)
        }
        return
      }

      // Undo: Cmd+Z / Ctrl+Z
      if (key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }

      // Redo: Cmd+Shift+Z / Ctrl+Shift+Z
      if (key === "z" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        redo()
        return
      }

      // Tool shortcuts: D, E, P, S, O, V, T, X
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolMap: Record<string, Tool> = {
          d: "draw", e: "erase", p: "pan", s: "select",
          o: "cutout", v: "override", t: "measure", x: "export",
        }
        const lowerKey = key.toLowerCase()
        if (lowerKey in toolMap) {
          e.preventDefault()
          setCurrentTool(toolMap[lowerKey])
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [activeLayerId, activeLayer, onLayerSelect, onCreateOrActivateLayer])

  return (
    <div className='fixed top-5 left-5 flex flex-col gap-2'>
      {/* Layer buttons (1-6) with group subindex */}
      <div className='flex gap-1'>
        {Array.from({ length: maxLayers }, (_, index) => {
          const layerId = index + 1
          const layer = layers.find((l) => l.id === layerId)
          const isActive = activeLayerId === layerId
          const exists = !!layer

          // Determine display label: "1" for single-group, "1.2" for multi-group
          const showGroupSuffix = isActive && layer && layer.groups.length > 1
          const displayLabel = showGroupSuffix
            ? `${layerId}.${activeGroupIndex + 1}`
            : `${layerId}`

          return (
            <div key={layerId} className='flex flex-col items-center gap-1'>
              <Button
                size='icon'
                variant={isActive ? "default" : "ghost"}
                onClick={() => handleLayerClick(layerId)}
                className='h-5 min-w-5 px-1 text-xs font-mono'
              >
                {displayLabel}
              </Button>

              {/* Controls below each layer button */}
              {exists && (
                <div className='flex flex-col gap-1'>
                  {/* Visibility toggle */}
                  <Button
                    size='icon'
                    variant='ghost'
                    onClick={() => onLayerVisibilityToggle(layerId)}
                    className='size-5 text-muted-foreground'
                  >
                    {layer?.isVisible ? (
                      <Eye className='w-3 h-3' />
                    ) : (
                      <EyeOff className='w-3 h-3' />
                    )}
                  </Button>

                  {/* Render style toggle */}
                  <Button
                    size='icon'
                    variant='ghost'
                    onClick={() => onLayerRenderStyleToggle(layerId)}
                    className='size-5 text-muted-foreground'
                  >
                    {layer?.renderStyle === "tiles" ? (
                      <Grid3X3 className='w-3 h-3' />
                    ) : (
                      <Square className='w-3 h-3' />
                    )}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Active layer/group indicator */}
      {activeLayerId && activeLayer && (
        <div className='text-xs text-muted-foreground font-mono text-center'>
          Layer {activeLayerId}
          {activeLayer.groups.length > 1 && (
            <span> &middot; G{activeGroupIndex + 1}/{activeLayer.groups.length}</span>
          )}
        </div>
      )}
      {activeLayerId === null && (
        <div className='text-xs text-muted-foreground/70 font-mono text-center'>
          View Only
        </div>
      )}
    </div>
  )
}
