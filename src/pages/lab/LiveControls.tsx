import { useEffect, useState } from "react"
import { randomSeed, runRecipe, runVariants } from "@/lib/lab/labApi"
import { cn } from "@/lib/utils"
import type { LabDesign, LabParamSpec, LabRecipe } from "@/types/lab"

interface LiveControlsProps {
  design: LabDesign
  recipes: LabRecipe[] | null
  onResult: (design: LabDesign) => void
  onVariants: (designs: LabDesign[]) => void
}

const btn =
  "h-7 rounded-[3px] border border-white/10 px-2.5 font-mono text-[11px] text-slate-300 hover:border-white/25 hover:text-slate-100 disabled:opacity-40"

function initialParams(spec: Record<string, LabParamSpec>, params: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(spec)) out[k] = k in params ? params[k] : s.default
  return out
}

function isNumeric(s: LabParamSpec): boolean {
  return (
    s.type === "int" ||
    s.type === "float" ||
    s.type === "number" ||
    (s.type === undefined && typeof s.default === "number")
  )
}

/** Param form + re-roll / variants against the python lab server. */
export function LiveControls({ design, recipes, onResult, onVariants }: LiveControlsProps) {
  const recipe = recipes?.find((r) => r.name === design.recipe) ?? null
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [seed, setSeed] = useState<number>(design.seed ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the form whenever the shown design changes (variant click, nav).
  useEffect(() => {
    if (recipe) setParams(initialParams(recipe.params, design.params ?? {}))
    setSeed(design.seed ?? 0)
  }, [design, recipe])

  if (recipes === null) {
    return (
      <p className='font-mono text-[11px] text-slate-500'>
        live mode off — start the server with{" "}
        <code className='text-slate-400'>lab/bin/gl serve</code> and reload.
      </p>
    )
  }
  if (!recipe) {
    return (
      <p className='font-mono text-[11px] text-slate-500'>
        recipe <span className='text-slate-400'>{design.recipe}</span> is not available live.
      </p>
    )
  }

  const run = async (s: number) => {
    setBusy(true)
    setError(null)
    try {
      onResult(await runRecipe(recipe.name, params, s))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const variants = async () => {
    setBusy(true)
    setError(null)
    try {
      const seeds = Array.from({ length: 6 }, randomSeed)
      onVariants(await runVariants(recipe.name, params, seeds))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const set = (k: string, v: unknown) => setParams((p) => ({ ...p, [k]: v }))

  return (
    <div className='space-y-2'>
      {recipe.description && (
        <p className='font-mono text-[11px] text-slate-500'>{recipe.description}</p>
      )}
      <div className='grid grid-cols-[minmax(90px,auto)_1fr] items-center gap-x-3 gap-y-1.5 font-mono text-[11px]'>
        {Object.entries(recipe.params).map(([k, s]) => {
          const v = params[k]
          let control
          if (s.choices && s.choices.length > 0) {
            control = (
              <select
                value={String(v)}
                onChange={(e) => {
                  const choice = s.choices!.find((c) => String(c) === e.target.value)
                  set(k, choice)
                }}
                className='h-6 rounded-[3px] border border-white/10 bg-transparent px-1 text-slate-300'
              >
                {s.choices.map((c) => (
                  <option key={String(c)} value={String(c)} className='bg-slate-900'>
                    {String(c)}
                  </option>
                ))}
              </select>
            )
          } else if (s.type === "bool" || typeof s.default === "boolean") {
            control = (
              <input
                type='checkbox'
                checked={Boolean(v)}
                onChange={(e) => set(k, e.target.checked)}
                className='h-3.5 w-3.5 accent-slate-400'
              />
            )
          } else if (isNumeric(s)) {
            const isInt = s.type === "int" || (Number.isInteger(s.default) && s.type !== "float")
            const step = s.step ?? (isInt ? 1 : 0.01)
            const num = typeof v === "number" ? v : Number(v)
            const hasRange = s.min !== undefined && s.max !== undefined
            control = (
              <div className='flex items-center gap-2'>
                {hasRange && (
                  <input
                    type='range'
                    min={s.min}
                    max={s.max}
                    step={step}
                    value={num}
                    onChange={(e) => set(k, Number(e.target.value))}
                    className='h-1 flex-1 accent-slate-400'
                  />
                )}
                <input
                  type='number'
                  value={Number.isFinite(num) ? num : ""}
                  step={step}
                  min={s.min}
                  max={s.max}
                  onChange={(e) => set(k, isInt ? parseInt(e.target.value, 10) : Number(e.target.value))}
                  className={cn(
                    "h-6 rounded-[3px] border border-white/10 bg-transparent px-1 text-right tabular-nums text-slate-300",
                    hasRange ? "w-16" : "w-24",
                  )}
                />
              </div>
            )
          } else {
            control = (
              <input
                type='text'
                value={v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v)}
                onChange={(e) => {
                  const raw = e.target.value
                  if (typeof s.default === "string") return set(k, raw)
                  try {
                    set(k, JSON.parse(raw))
                  } catch {
                    set(k, raw)
                  }
                }}
                className='h-6 rounded-[3px] border border-white/10 bg-transparent px-1 text-slate-300'
              />
            )
          }
          return (
            <label key={k} className='contents'>
              <span className='truncate text-slate-500' title={k}>
                {k}
              </span>
              {control}
            </label>
          )
        })}
        <span className='text-slate-500'>seed</span>
        <input
          type='number'
          value={seed}
          onChange={(e) => setSeed(parseInt(e.target.value, 10) || 0)}
          className='h-6 w-24 rounded-[3px] border border-white/10 bg-transparent px-1 text-right tabular-nums text-slate-300'
        />
      </div>
      <div className='flex flex-wrap gap-1.5 pt-1'>
        <button type='button' className={btn} disabled={busy} onClick={() => run(seed)}>
          run
        </button>
        <button
          type='button'
          className={btn}
          disabled={busy}
          onClick={() => {
            const s = randomSeed()
            setSeed(s)
            run(s)
          }}
        >
          re-roll
        </button>
        <button type='button' className={btn} disabled={busy} onClick={variants}>
          6 variants
        </button>
        {busy && <span className='self-center font-mono text-[11px] text-slate-500'>running…</span>}
      </div>
      {error && <p className='font-mono text-[11px] text-red-400/80'>{error}</p>}
    </div>
  )
}
