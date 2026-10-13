/**
 * CustomThicknessInput - number input for a layer thickness (mm) outside the
 * preset options. Sits next to the preset buttons in the 3D panels.
 */

import { useState, useEffect } from "react"
import { LAYER_THICKNESS_OPTIONS, type LayerThickness } from "@/lib/threejs"
import { cn } from "@/lib/utils"

interface CustomThicknessInputProps {
  thickness: LayerThickness
  onThicknessChange?: (t: LayerThickness) => void
}

export function CustomThicknessInput({
  thickness,
  onThicknessChange,
}: CustomThicknessInputProps) {
  const isCustom = !LAYER_THICKNESS_OPTIONS.includes(thickness)
  const [text, setText] = useState(isCustom ? String(thickness) : "")

  // Sync when the thickness changes elsewhere: clear the field when a preset
  // is picked, show the value when a custom thickness arrives.
  useEffect(() => {
    setText(isCustom ? String(thickness) : "")
  }, [thickness, isCustom])

  const handleChange = (value: string) => {
    setText(value)
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      onThicknessChange?.(parsed)
    }
  }

  return (
    <label className='flex items-center gap-1 text-xs font-mono text-muted-foreground'>
      <input
        type='number'
        min={0.1}
        step={0.1}
        value={text}
        placeholder='custom'
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setText(isCustom ? String(thickness) : "")}
        className={cn(
          "w-16 px-2 py-1 rounded border bg-transparent text-xs font-mono outline-none",
          isCustom
            ? "border-foreground text-foreground"
            : "border-border text-muted-foreground focus:border-foreground/50",
        )}
      />
      mm
    </label>
  )
}
