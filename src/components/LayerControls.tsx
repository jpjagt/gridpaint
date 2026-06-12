import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Grid3X3, Square } from "lucide-react"
import { useEffect } from "react"
import { useStore } from "@nanostores/react"
import {
  $layersState,
  $canvasView,
  addGroupToActiveLayer,
  collapseEmptyTrailingGroups,
  toggleGroupOffsetPhase,
  setLayerScale,
  type Layer,
} from "@/stores/drawingStores"
import { layerRangeIds } from "@/types/layers"
import {
  $activeGroupIndex,
  setActiveGroupIndex,
  $currentTool,
  setCurrentTool,
  prevGroup,
  nextGroup,
  type Tool,
  $showCenterOfGravity,
} from "@/stores/ui"
import { undo, redo } from "@/stores/historyStore"

// Scale options: label → scale value (undefined = 1×)
const SCALE_OPTIONS: { label: string; value: Layer["scale"] }[] = [
  { label: "⅓", value: { num: 1, den: 3 } },
  { label: "½", value: { num: 1, den: 2 } },
  { label: "1×", value: undefined },
  { label: "2×", value: { num: 2, den: 1 } },
  { label: "3×", value: { num: 3, den: 1 } },
]

function scaleToOptionValue(scale: Layer["scale"]): string {
  if (!scale) return "1"
  return `${scale.num}/${scale.den}`
}

function optionValueToScale(val: string): Layer["scale"] {
  if (val === "1") return undefined
  const [num, den] = val.split("/").map(Number)
  return { num, den }
}

interface LayerControlsProps {
  onLayerSelect: (layerId: number | null) => void
  onLayerVisibilityToggle: (layerId: number) => void
  onCreateLayer: () => void
  onLayerRenderStyleToggle: (layerId: number) => void
  onCreateOrActivateLayer: (layerId: number) => void
}

export const LayerControls = ({
  onLayerSelect,
  onLayerVisibilityToggle,
  onCreateLayer,
  onLayerRenderStyleToggle,
  onCreateOrActivateLayer,
}: LayerControlsProps) => {
  const layersState = useStore($layersState)
  const layers = layersState.layers
  const activeLayerId = layersState.activeLayerId
  const activeGroupIndex = useStore($activeGroupIndex)
  const canvasView = useStore($canvasView)
  const layerIds = layerRangeIds(canvasView.layerRange)

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

      const key = e.key.toLowerCase()

      // Show CoG while 'g' is held (only if select tool is active)
      if (key === "g" && $currentTool.get() === "select") {
        $showCenterOfGravity.set(true)
      }

      // Number keys 1-9: switch layer by slot position within the range
      const isNumberKey =
        /^[1-9]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey
      if (isNumberKey) {
        const slotIndex = parseInt(key) - 1
        const ids = layerRangeIds($canvasView.get().layerRange)
        if (slotIndex >= ids.length) return // no such slot
        e.preventDefault()
        const layerId = ids[slotIndex]
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g") {
        $showCenterOfGravity.set(false)
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyPress)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [activeLayerId, activeLayer, onLayerSelect, onCreateOrActivateLayer])

  return (
    <div className='fixed top-5 left-5 flex flex-col gap-2'>
      {/* Layer buttons (configurable range) with group subindex */}
      <div className='flex gap-1 max-w-[90vw] overflow-x-auto pb-1'>
        {layerIds.map((layerId) => {
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

                  {/* Half-offset toggle: operates on the active group when layer is active,
                      otherwise the first group */}
                  {(() => {
                    const groupIdx = isActive ? activeGroupIndex : 0
                    const group = layer?.groups[groupIdx]
                    if (!group) return null
                    const isHalf = group.offsetPhase === "half"
                    return (
                      <Button
                        size='icon'
                        variant={isHalf ? "default" : "ghost"}
                        onClick={() => toggleGroupOffsetPhase(layerId, group.id)}
                        className='size-5 text-xs font-mono'
                        title='Half-grid offset'
                      >
                        ½
                      </Button>
                    )
                  })()}

                  {/* Per-layer scale select */}
                  <select
                    value={scaleToOptionValue(layer?.scale)}
                    onChange={(e) =>
                      setLayerScale(layerId, optionValueToScale(e.target.value))
                    }
                    title='Layer scale'
                    className='h-5 w-full rounded text-xs font-mono bg-background border border-input text-foreground px-0.5 cursor-pointer'
                  >
                    {SCALE_OPTIONS.map((opt) => (
                      <option
                        key={scaleToOptionValue(opt.value)}
                        value={scaleToOptionValue(opt.value)}
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
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
