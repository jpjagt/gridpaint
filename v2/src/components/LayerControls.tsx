import { Button } from "@/components/ui/button"
import { Plus, Eye, EyeOff } from "lucide-react"

interface Layer {
  id: number
  points: Set<string>
  visible: boolean
}

interface LayerControlsProps {
  layers: Layer[]
  activeLayerId: number | null
  onLayerSelect: (layerId: number | null) => void
  onLayerVisibilityToggle: (layerId: number) => void
  onCreateLayer: () => void
  maxLayers?: number
}

export const LayerControls = ({
  layers,
  activeLayerId,
  onLayerSelect,
  onLayerVisibilityToggle,
  onCreateLayer,
  maxLayers = 6,
}: LayerControlsProps) => {
  const handleLayerClick = (layerId: number) => {
    // If clicking the active layer, deactivate it (view-only mode)
    if (activeLayerId === layerId) {
      onLayerSelect(null)
    } else {
      onLayerSelect(layerId)
    }
  }

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
                onClick={() => exists && handleLayerClick(layerId)}
                disabled={!exists}
                className='size-5'
              >
                {layerId}
              </Button>

              {/* Visibility toggle below each layer button */}
              {exists && (
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={() => onLayerVisibilityToggle(layerId)}
                  className='size-5 text-muted-foreground'
                >
                  {layer?.visible ? (
                    <Eye className='w-3 h-3' />
                  ) : (
                    <EyeOff className='w-3 h-3' />
                  )}
                </Button>
              )}
            </div>
          )
        })}

        {/* Add new layer button */}
        {layers.length < maxLayers && (
          <Button
            size='icon'
            variant='ghost'
            onClick={onCreateLayer}
            className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white'
          >
            <Plus className='w-4 h-4' />
          </Button>
        )}
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
