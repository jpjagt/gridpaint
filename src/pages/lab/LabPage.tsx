import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { DesignCard } from "@/pages/lab/DesignCard"
import { DesignDetail } from "@/pages/lab/DesignDetail"
import { parseLabInput } from "@/lib/lab/designConvert"
import { resolvePalette } from "@/lib/lab/renderDesign"
import { fetchGallery, fetchRecipes, loadPinned, savePinned } from "@/lib/lab/labApi"
import { cn } from "@/lib/utils"
import type {
  LabBoardItem,
  LabDesign,
  LabGallery,
  LabPaletteMode,
  LabRecipe,
  LabSection,
  LabThumbSize,
} from "@/types/lab"

const THUMB_PX: Record<LabThumbSize, number> = { S: 132, M: 200, L: 300 }
const PREFS_KEY = "gridlab-prefs-v1"

function loadPrefs(): { size: LabThumbSize; palette: LabPaletteMode } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, string>
    return {
      size: p.size === "S" || p.size === "L" ? p.size : "M",
      palette: p.palette === "theme" ? "theme" : "jewel",
    }
  } catch {
    return { size: "M", palette: "jewel" }
  }
}

function matches(d: LabDesign, q: string): boolean {
  if (!q) return true
  const hay = `${d.title} ${d.recipe} ${d.tags.join(" ")} ${d.id}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

/** Group consecutive items into [before, after] pairs (a trailing odd item stands alone). */
function chunkPairs<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2))
  return out
}

const seg = (on: boolean) =>
  cn(
    "h-6 px-2 font-mono text-[11px]",
    on ? "bg-white/10 text-slate-200" : "text-slate-500 hover:text-slate-300",
  )

/** /#/lab — contact sheet of generated designs. */
export default function LabPage() {
  const [gallery, setGallery] = useState<LabGallery | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recipes, setRecipes] = useState<LabRecipe[] | null>(null)
  const [pinned, setPinned] = useState<LabDesign[]>(loadPinned)
  const [pasted, setPasted] = useState<LabDesign[]>([])
  const [filter, setFilter] = useState("")
  const [prefs, setPrefs] = useState(loadPrefs)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    fetchGallery()
      .then(setGallery)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    fetchRecipes().then(setRecipes)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // ignore
    }
  }, [prefs])

  // The page is always dark; theme palette reads the app's CSS vars.
  const palette = useMemo(() => resolvePalette(prefs.palette), [prefs.palette])
  const thumbPx = THUMB_PX[prefs.size]

  const sections: LabSection[] = useMemo(() => {
    const out: LabSection[] = []
    if (pasted.length)
      out.push({ id: "pasted", title: "Pasted", description: "Dropped or pasted JSON (this session only).", designs: pasted })
    if (pinned.length)
      out.push({ id: "pinned", title: "Pinned", description: "Kept in this browser (localStorage).", designs: pinned })
    return [...out, ...(gallery?.sections ?? [])]
  }, [gallery, pinned, pasted])

  const filtered = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          items: s.designs
            .filter((d) => matches(d, filter))
            .map((d, i): LabBoardItem => ({ key: `${s.id}/${d.id}/${i}`, sectionId: s.id, design: d })),
        }))
        .filter((s) => s.items.length > 0),
    [sections, filter],
  )
  const flat = useMemo(() => filtered.flatMap((s) => s.items), [filtered])
  const selectedIndex = selectedKey ? flat.findIndex((i) => i.key === selectedKey) : -1
  const selected = selectedIndex >= 0 ? flat[selectedIndex] : null

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return
      const i = selectedIndex < 0 ? 0 : (selectedIndex + delta + flat.length) % flat.length
      setSelectedKey(flat[i].key)
      document.getElementById(`card-${flat[i].key}`)?.scrollIntoView({ block: "nearest" })
    },
    [flat, selectedIndex],
  )

  const addPasted = useCallback((text: string) => {
    const designs = parseLabInput(text, `pasted-${Date.now().toString(36)}`)
    if (designs.length === 0) {
      toast.error("Not a gridlab-design / gridpaint-selection JSON")
      return
    }
    setPasted((p) => [...designs, ...p])
    toast.success(`Added ${designs.length} pasted design${designs.length > 1 ? "s" : ""}`)
    document.getElementById("section-pasted")?.scrollIntoView({ behavior: "smooth" })
  }, [])

  // Cmd+V on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
      const text = e.clipboardData?.getData("text/plain")
      if (text) {
        e.preventDefault()
        addPasted(text)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [addPasted])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length) {
      for (const f of files) addPasted(await f.text())
      return
    }
    const text = e.dataTransfer.getData("text/plain")
    if (text) addPasted(text)
  }

  const isPinned = useCallback((d: LabDesign) => pinned.some((p) => p.id === d.id && p.seed === d.seed), [pinned])
  const togglePin = useCallback((d: LabDesign) => {
    setPinned((prev) => {
      const exists = prev.some((p) => p.id === d.id && p.seed === d.seed)
      const next = exists ? prev.filter((p) => !(p.id === d.id && p.seed === d.seed)) : [d, ...prev]
      savePinned(next)
      return next
    })
  }, [])

  const total = sections.reduce((n, s) => n + s.designs.length, 0)

  return (
    <div
      className='flex min-h-screen bg-[#020817] text-slate-300 [color-scheme:dark]'
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {/* sidebar */}
      <nav className='sticky top-0 hidden h-screen w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/[0.06] px-4 py-5 font-mono text-[11px] md:flex'>
        <div>
          <Link to='/' className='text-slate-600 hover:text-slate-300'>
            ← grids
          </Link>
          <h1 className='mt-2 text-[13px] text-slate-200'>gridlab</h1>
          <p className='text-slate-600'>
            {total} designs{gallery?.generatedAt ? ` · ${gallery.generatedAt.slice(0, 16).replace("T", " ")}` : ""}
          </p>
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='filter title / recipe / tag'
          className='h-7 w-full rounded-[3px] border border-white/10 bg-transparent px-2 text-slate-300 placeholder:text-slate-600 focus:border-white/25 focus:outline-none'
        />

        <div className='space-y-1.5'>
          <div className='flex items-center justify-between'>
            <span className='text-slate-600'>size</span>
            <div className='flex overflow-hidden rounded-[3px] border border-white/10'>
              {(["S", "M", "L"] as const).map((s) => (
                <button key={s} type='button' className={seg(prefs.size === s)} onClick={() => setPrefs((p) => ({ ...p, size: s }))}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-slate-600'>palette</span>
            <div className='flex overflow-hidden rounded-[3px] border border-white/10'>
              <button type='button' className={seg(prefs.palette === "jewel")} onClick={() => setPrefs((p) => ({ ...p, palette: "jewel" }))} title='ranked blue-grey'>
                jewel
              </button>
              <button type='button' className={seg(prefs.palette === "theme")} onClick={() => setPrefs((p) => ({ ...p, palette: "theme" }))} title='app theme (getLayerFillColor)'>
                theme
              </button>
            </div>
          </div>
        </div>

        <ul className='space-y-0.5'>
          {filtered.map((s) => (
            <li key={s.id}>
              <a
                href={`#section-${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth" })
                }}
                className='flex justify-between gap-2 rounded-[3px] px-1.5 py-0.5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
              >
                <span className='truncate'>{s.title}</span>
                <span className='tabular-nums text-slate-600'>{s.items.length}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className='mt-auto space-y-1 text-[10.5px] leading-snug text-slate-600'>
          <p>
            <span className={recipes ? "text-emerald-400/70" : "text-slate-500"}>●</span>{" "}
            {recipes ? `live · ${recipes.length} recipes` : "static (no server)"}
          </p>
          {!recipes && (
            <p>
              run <code className='text-slate-500'>lab/bin/gl serve</code> for re-rolls
            </p>
          )}
          <p>⌘V / drop JSON to compare</p>
          <p>click a card · ←/→ · esc</p>
        </div>
      </nav>

      {/* board */}
      <main className={cn("min-w-0 flex-1 px-6 pb-24 pt-5", selected && "md:pr-[min(760px,100vw)]")}>
        <div className='mb-4 flex gap-2 md:hidden'>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder='filter'
            className='h-7 flex-1 rounded-[3px] border border-white/10 bg-transparent px-2 font-mono text-[11px]'
          />
        </div>
        {error && <p className='font-mono text-[12px] text-red-400/80'>Could not load gallery: {error}</p>}
        {!gallery && !error && <p className='font-mono text-[12px] text-slate-600'>loading…</p>}
        {filtered.map((s) => (
          <section key={s.id} id={`section-${s.id}`} className='mb-10 scroll-mt-4'>
            <header className='mb-3 border-b border-white/[0.06] pb-2 font-mono'>
              <div className='flex items-baseline gap-3'>
                <h2 className='whitespace-nowrap text-[12px] uppercase tracking-wider text-slate-300'>{s.title}</h2>
                <span className='text-[11px] tabular-nums text-slate-600'>{s.items.length}</span>
              </div>
              {s.description && (
                <p className='mt-1 max-w-[110ch] text-[11px] leading-relaxed text-slate-500'>{s.description}</p>
              )}
            </header>
            {s.layout === "pairs" && !filter ? (
              <div
                className='grid gap-x-8 gap-y-5'
                style={{ gridTemplateColumns: `repeat(auto-fill, ${2 * thumbPx + 28}px)` }}
              >
                {chunkPairs(s.items).map((pair) => (
                  <div key={pair[0].key} className='flex items-start gap-1'>
                    {pair.map((it, j) => (
                      <div key={it.key} className='contents'>
                        {j === 1 && (
                          <span className='w-5 shrink-0 text-center font-mono text-[12px] text-slate-600' style={{ marginTop: thumbPx / 2 - 8 }}>
                            →
                          </span>
                        )}
                        <div id={`card-${it.key}`}>
                          <DesignCard
                            design={it.design}
                            palette={palette}
                            thumbPx={thumbPx}
                            selected={it.key === selectedKey}
                            itemKey={it.key}
                            onSelect={setSelectedKey}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className='grid gap-x-3 gap-y-4'
                style={{ gridTemplateColumns: `repeat(auto-fill, ${thumbPx}px)` }}
              >
                {s.items.map((it) => (
                  <div key={it.key} id={`card-${it.key}`}>
                    <DesignCard
                      design={it.design}
                      palette={palette}
                      thumbPx={thumbPx}
                      selected={it.key === selectedKey}
                      itemKey={it.key}
                      onSelect={setSelectedKey}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
        {gallery && filtered.length === 0 && (
          <p className='font-mono text-[12px] text-slate-600'>nothing matches “{filter}”.</p>
        )}
      </main>

      {selected && (
        // keyed wrapper (twin's JSX augmentation rejects `key` on components) resets drawer state per design
        <div key={selected.key} className='contents'>
        <DesignDetail
          item={selected}
          palette={palette}
          recipes={recipes}
          recipeInfo={gallery?.recipes?.[selected.design.recipe]}
          position={`${selectedIndex + 1}/${flat.length}`}
          onClose={() => setSelectedKey(null)}
          onPrev={() => move(-1)}
          onNext={() => move(1)}
          isPinned={isPinned}
          onTogglePin={togglePin}
        />
        </div>
      )}

      {dragOver && (
        <div className='pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-md border border-dashed border-slate-500/60 bg-[#020817]/70 font-mono text-[12px] text-slate-400'>
          drop gridlab-design / gridpaint-selection JSON
        </div>
      )}
    </div>
  )
}
