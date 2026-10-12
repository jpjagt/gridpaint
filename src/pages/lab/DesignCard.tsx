import { memo } from "react"
import { DesignCanvas } from "@/pages/lab/DesignCanvas"
import { cn } from "@/lib/utils"
import type { LabDesign, LabPalette } from "@/types/lab"

interface DesignCardProps {
  design: LabDesign
  palette: LabPalette
  thumbPx: number
  selected: boolean
  itemKey: string
  onSelect: (key: string) => void
}

function DesignCardImpl({ design, palette, thumbPx, selected, itemKey, onSelect }: DesignCardProps) {
  const layerCount = design.layers.length
  return (
    <button
      type='button'
      onClick={() => onSelect(itemKey)}
      className={cn(
        "group flex flex-col text-left outline-none",
        "rounded-[3px] ring-1 ring-transparent focus-visible:ring-slate-500",
        selected && "ring-slate-400",
      )}
      style={{ width: thumbPx }}
      title={design.notes || design.title}
    >
      <div className='overflow-hidden rounded-[3px] ring-1 ring-white/[0.06] transition group-hover:ring-white/20'>
        <DesignCanvas
          design={design}
          palette={palette}
          fit={{ width: thumbPx, height: thumbPx }}
          padding={Math.round(thumbPx * 0.06)}
          lazy
        />
      </div>
      <div className='mt-1.5 px-0.5 font-mono text-[10.5px] leading-[1.35]'>
        <div className='truncate text-slate-300'>{design.title}</div>
        <div className='flex gap-1.5 truncate text-slate-500'>
          <span className='truncate'>{design.recipe}</span>
          {design.seed !== null && design.seed !== undefined && <span>s{design.seed}</span>}
          <span className='ml-auto shrink-0 tabular-nums'>
            {design.width}×{design.height}
            {layerCount > 1 ? ` ·${layerCount}L` : ""}
            {design.frames?.length ? " ·t" : ""}
          </span>
        </div>
        {design.tags.length > 0 && (
          <div className='truncate text-slate-600'>{design.tags.join(" ")}</div>
        )}
      </div>
    </button>
  )
}

export const DesignCard = memo(DesignCardImpl)
