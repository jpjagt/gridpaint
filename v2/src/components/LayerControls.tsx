import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Grid3X3, Square } from "lucide-react"
import { useEffect } from "react"
import type { Layer } from "@/stores/drawingStores"

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
  const handleLayerClick = (layerId: number) => {
    // If clicking the active layer, deactivate it (view-only mode)
    if (activeLayerId === layerId) {
      onLayerSelect(null)
    } else {
      onCreateOrActivateLayer(layerId)
    }
  }

  // Keyboard shortcuts for layer switching
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const key = e.key
      if (key >= "1" && key <= "6") {
        e.preventDefault()
        const layerId = parseInt(key)
        if (activeLayerId === layerId) {
          onLayerSelect(null) // Deactivate if already active
        } else {
          onCreateOrActivateLayer(layerId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [activeLayerId, onLayerSelect, onCreateOrActivateLayer])

  return (
    <div className='fixed top-5 left-5 flex flex-col gap-2'>
      {/* Layer buttons (1-6) */}
      <div className='flex gap-1'>
        {Array.from({ length: maxLayers }, (_, index) => {
          const layerId = index + 1
          const layer = layers.find((l) => l.id === layerId)
          const isActive = activeLayerId === layerId
          const exists = !!layer

          return (
            <div key={layerId} className='flex flex-col items-center gap-1'>
              <Button
                size='icon'
                variant={isActive ? "default" : "ghost"}
                onClick={() => handleLayerClick(layerId)}
                className='size-5'
              >
                {layerId}
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

      {/* Active layer indicator */}
      {activeLayerId && (
        <div className='text-xs text-white/70 font-mono text-center'>
          Layer {activeLayerId}
        </div>
      )}
      {activeLayerId === null && (
        <div className='text-xs text-white/50 font-mono text-center'>
          View Only
        </div>
      )}
    </div>
  )
}
