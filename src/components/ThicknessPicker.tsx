/**
 * ThicknessPicker - preset buttons (0.5 / 1 / 1.5 / 2 mm) plus a custom
 * input. With `defaultLabel`, an extra first button clears the value
 * (undefined = fall back to the drawing-wide thickness).
 */

import { LAYER_THICKNESS_PRESETS } from "@/lib/constants"
import { CustomThicknessInput } from "@/components/CustomThicknessInput"
import { cn } from "@/lib/utils"

interface ThicknessPickerProps {
  value: number | undefined
  onChange: (thickness: number | undefined) => void
  /** Show a "use default" button with this label */
  defaultLabel?: string
  className?: string
}

export function ThicknessPicker({
  value,
  onChange,
  defaultLabel,
  className,
}: ThicknessPickerProps) {
  const chip = (active: boolean) =>
    cn(
      "text-xs font-mono px-1.5 py-0.5 rounded transition-colors",
      active
        ? "bg-foreground text-background"
        : "bg-transparent text-muted-foreground hover:text-foreground",
    )

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {defaultLabel && (
        <button
          type='button'
          onClick={() => onChange(undefined)}
          className={chip(value === undefined)}
        >
          {defaultLabel}
        </button>
      )}
      {LAYER_THICKNESS_PRESETS.map((t) => (
        <button
          key={t}
          type='button'
          onClick={() => onChange(t)}
          className={chip(value === t)}
        >
          {t}
        </button>
      ))}
      <CustomThicknessInput
        thickness={value ?? LAYER_THICKNESS_PRESETS[1]}
        onThicknessChange={onChange}
      />
    </div>
  )
}
