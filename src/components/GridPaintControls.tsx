import { Button } from "@/components/ui/button"
import { useState } from "react"
import { useStore } from "@nanostores/react"
import {
  RefreshCcw,
  Download,
  HelpCircle,
  Plus,
  Minus,
  Circle,
  CircleDot,
  Home,
  Eye,
  EyeOff,
} from "lucide-react"
import { showActiveLayerOutline, toggleActiveLayerOutline } from "@/stores/ui"
import { ModeToggle } from "@/components/ModeToggle"

interface GridPaintControlsProps {
  onReset: () => void
  onDownload: () => void
  onGridSizeChange: (operation: "+" | "-") => void
  onBorderWidthChange: (width: number) => void
  onMmPerUnitChange: (mmPerUnit: number) => void
  /** Current drawing title */
  name: string
  /** Callback when title is edited */
  onNameChange: (name: string) => void
  /** Navigate back to home/gallery */
  onHome: () => void
  /** Current mm per unit value */
  mmPerUnit: number
  /** Callback when measuring bars should be shown */
  onShowMeasuringBars: (show: boolean) => void
}

export const GridPaintControls = ({
  onReset,
  onDownload,
  onGridSizeChange,
  onBorderWidthChange,
  onMmPerUnitChange,
  name,
  onNameChange,
  onHome,
  mmPerUnit,
  onShowMeasuringBars,
}: GridPaintControlsProps) => {
  const $showActiveLayerOutline = useStore(showActiveLayerOutline)
  const [borderWidth, setBorderWidth] = useState(2)

  const handleBorderWidthChange = (delta: number) => {
    const newWidth = Math.max(0, Math.min(10, borderWidth + delta))
    setBorderWidth(newWidth)
    onBorderWidthChange(newWidth)
  }

  return (
    <>
      {/* Top right controls with title and navigation */}
      <div className='fixed top-5 right-5 flex items-center gap-2'>
        <input
          type='text'
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className='bg-muted/50 text-muted-foreground placeholder-muted-foreground rounded px-2 py-1 backdrop-blur-sm'
        />
        <Button
          size='icon'
          variant='ghost'
          onClick={onHome}
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          <Home className='w-4 h-4' />
        </Button>

        <ModeToggle />

        {false && (
          <Button
            size='icon'
            variant='ghost'
            onClick={onReset}
            className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
          >
            <RefreshCcw className='w-4 h-4' />
          </Button>
        )}

        <Button
          size='icon'
          variant='ghost'
          onClick={onDownload}
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          <Download className='w-4 h-4' />
        </Button>

        <Button
          size='icon'
          variant='ghost'
          onClick={toggleActiveLayerOutline}
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          {$showActiveLayerOutline ? (
            <Eye className='w-4 h-4' />
          ) : (
            <EyeOff className='w-4 h-4' />
          )}
        </Button>
      </div>

      {/* Bottom right controls */}
      <div className='fixed bottom-5 right-5 flex flex-col gap-2'>
        {/* Grid size controls */}
        <Button
          size='icon'
          variant='ghost'
          onClick={() => onGridSizeChange("+")}
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          <Plus className='w-4 h-4' />
        </Button>

        <Button
          size='icon'
          variant='ghost'
          onClick={() => onGridSizeChange("-")}
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          <Minus className='w-4 h-4' />
        </Button>

        {/* Physical size control */}
        <div className='bg-white/10 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1'>
          <input
            type='number'
            value={mmPerUnit}
            onChange={(e) =>
              onMmPerUnitChange(parseFloat(e.target.value) || 1.0)
            }
            onFocus={() => onShowMeasuringBars(true)}
            onBlur={() => onShowMeasuringBars(false)}
            className='w-12 bg-muted/50 text-xs text-muted-foreground placeholder-muted border-none outline-none'
            min='0.1'
            max='100'
            step='0.1'
            title='mm per grid unit'
          />
          <span className='text-xs text-muted-foreground'>mm</span>
        </div>
      </div>
    </>
  )
}
