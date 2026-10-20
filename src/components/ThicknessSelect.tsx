/**
 * ThicknessSelect - compact dropdown for the drawing-wide metal thickness:
 * presets plus "custom…", which reveals a number input.
 */

import { useEffect, useState } from "react"
import { LAYER_THICKNESS_PRESETS } from "@/lib/constants"

interface ThicknessSelectProps {
  value: number
  onChange: (thickness: number) => void
}

const CUSTOM = "custom"

export function ThicknessSelect({ value, onChange }: ThicknessSelectProps) {
  const isPreset = LAYER_THICKNESS_PRESETS.includes(value)
  const [custom, setCustom] = useState(!isPreset)
  const [text, setText] = useState(String(value))

  // Follow changes made elsewhere (e.g. the export panel)
  useEffect(() => {
    setText(String(value))
    if (!LAYER_THICKNESS_PRESETS.includes(value)) setCustom(true)
  }, [value])

  return (
    <label
      className='flex items-center gap-1 text-xs text-muted-foreground'
      title='Metal thickness per layer'
    >
      <select
        value={custom ? CUSTOM : String(value)}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange(parseFloat(e.target.value))
        }}
        className='bg-muted/50 text-xs text-muted-foreground border-none outline-none rounded px-1 py-0.5 cursor-pointer'
      >
        {LAYER_THICKNESS_PRESETS.map((t) => (
          <option key={t} value={String(t)}>
            {t}
          </option>
        ))}
        <option value={CUSTOM}>custom…</option>
      </select>
      {custom && (
        <input
          type='number'
          min={0.1}
          step={0.1}
          value={text}
          // Focus when switching from a preset to custom, not on load
          autoFocus={isPreset}
          onChange={(e) => {
            setText(e.target.value)
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v) && v > 0) onChange(v)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className='w-12 bg-muted/50 text-xs text-muted-foreground border-none outline-none rounded px-1 py-0.5'
        />
      )}
      mm thick
    </label>
  )
}
