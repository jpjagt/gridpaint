import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Pause, Play, X } from "lucide-react"
import { DesignCanvas } from "@/pages/lab/DesignCanvas"
import { LiveControls } from "@/pages/lab/LiveControls"
import { ModelViewerModal } from "@/components/ModelViewerModal"
import { drawingStore } from "@/lib/storage/store"
import {
  buildDrawingDocument,
  countPoints,
  designExportRect,
  designLayerIds,
  designLayerRange,
  designToSelection,
  designToStoreLayers,
} from "@/lib/lab/designConvert"
import { downloadJson } from "@/lib/lab/labApi"
import { DEFAULT_MM_PER_UNIT } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { CanvasViewState } from "@/stores/drawingStores"
import type { LabBoardItem, LabDesign, LabPalette, LabRecipe } from "@/types/lab"

interface DesignDetailProps {
  item: LabBoardItem
  palette: LabPalette
  recipes: LabRecipe[] | null
  position: string
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  isPinned: (design: LabDesign) => boolean
  onTogglePin: (design: LabDesign) => void
}

const btn =
  "h-7 rounded-[3px] border border-white/10 px-2.5 font-mono text-[11px] text-slate-300 hover:border-white/25 hover:text-slate-100 disabled:opacity-40"
const chip = (on: boolean) =>
  cn(
    "h-6 rounded-[3px] px-2 font-mono text-[11px] tabular-nums",
    on ? "bg-white/10 text-slate-200" : "text-slate-500 hover:text-slate-300",
  )

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
  )
}

/** Right-side drawer with a large render, layers, timeline, params and actions. */
export function DesignDetail({
  item,
  palette,
  recipes,
  position,
  onClose,
  onPrev,
  onNext,
  isPinned,
  onTogglePin,
}: DesignDetailProps) {
  const navigate = useNavigate()
  const [design, setDesign] = useState<LabDesign>(item.design)
  const [variants, setVariants] = useState<LabDesign[]>([])
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [split, setSplit] = useState(false)
  const frameCount = design.frames?.length ?? 0
  const [frame, setFrame] = useState(Math.max(0, frameCount - 1))
  const [playing, setPlaying] = useState(false)
  const [show3d, setShow3d] = useState(false)
  // Ref (not state) so the Esc that closes the 3D dialog doesn't also close the
  // drawer: React may re-subscribe our listener before the event reaches window.
  const modalOpenRef = useRef(false)
  const open3d = () => {
    modalOpenRef.current = true
    setShow3d(true)
  }
  const close3d = () => {
    setShow3d(false)
    setTimeout(() => (modalOpenRef.current = false), 0)
  }
  const [bodyRef, bodyWidth] = useElementWidth<HTMLDivElement>()

  // New design shown → reset view state.
  useEffect(() => {
    setHidden(new Set())
    setFrame(Math.max(0, (design.frames?.length ?? 0) - 1))
    setPlaying(false)
  }, [design])

  // Playback through frames.
  useEffect(() => {
    if (!playing || frameCount === 0) return
    const id = window.setInterval(() => {
      setFrame((f) => {
        if (f >= frameCount - 1) {
          setPlaying(false)
          return f
        }
        return f + 1
      })
    }, 350)
    return () => window.clearInterval(id)
  }, [playing, frameCount])

  // Keyboard: Esc closes, ←/→ navigates; space toggles play.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpenRef.current || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        onPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        onNext()
      } else if (e.key === " " && frameCount > 0) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const layerIds = useMemo(() => designLayerIds(design), [design])
  const visibleIds = layerIds.filter((id) => !hidden.has(id))
  const frameIndex = frameCount > 0 ? frame : undefined

  const togglePlay = () => {
    if (playing) return setPlaying(false)
    if (frame >= frameCount - 1) setFrame(0)
    setPlaying(true)
  }

  const copySelection = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(designToSelection(design)))
      toast.success(`Copied ${countPoints(design)} cells — paste with ⌘V in the editor`)
    } catch {
      toast.error("Clipboard write failed")
    }
  }

  const openInEditor = async () => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)
    const doc = buildDrawingDocument(design, {
      id,
      now: Date.now(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    try {
      await drawingStore.save(doc)
      navigate(`/grids/${id}`)
    } catch (e) {
      console.error(e)
      toast.error("Could not save drawing")
    }
  }

  const canvasView: CanvasViewState = useMemo(
    () => ({
      gridSize: 75,
      borderWidth: 0,
      panOffset: { x: 0, y: 0 },
      zoom: 1,
      mmPerUnit: DEFAULT_MM_PER_UNIT,
      layerRange: designLayerRange(design),
    }),
    [design],
  )
  const storeLayers = useMemo(
    () => designToStoreLayers(design).filter((l) => !hidden.has(l.id)),
    [design, hidden],
  )
  const exportRect = useMemo(() => designExportRect(design), [design])

  const big = Math.max(200, bodyWidth)
  const bigH = Math.min(big, Math.max(260, window.innerHeight * 0.55))
  const splitW = layerIds.length > 0 ? Math.floor((big - 8 * (layerIds.length - 1)) / Math.min(layerIds.length, 3)) : big
  const pinned = isPinned(design)

  return (
    <aside className='fixed inset-y-0 right-0 z-40 flex w-[min(760px,100vw)] flex-col border-l border-white/[0.07] bg-[#050b1c]/[0.97] shadow-2xl backdrop-blur'>
      <header className='flex items-start gap-3 border-b border-white/[0.07] px-5 py-3'>
        <div className='min-w-0 flex-1 font-mono'>
          <div className='truncate text-[13px] text-slate-200'>{design.title}</div>
          <div className='truncate text-[11px] text-slate-500'>
            {design.recipe}
            {design.seed !== null && design.seed !== undefined && ` · seed ${design.seed}`} · {design.width}×
            {design.height} · {countPoints(design)} cells · {design.id}
          </div>
        </div>
        <span className='pt-0.5 font-mono text-[11px] text-slate-600'>{position}</span>
        <button type='button' onClick={onPrev} className={chip(false)} title='previous (←)'>
          ←
        </button>
        <button type='button' onClick={onNext} className={chip(false)} title='next (→)'>
          →
        </button>
        <button type='button' onClick={onClose} className='text-slate-500 hover:text-slate-200' title='close (Esc)'>
          <X className='h-4 w-4' />
        </button>
      </header>

      <div className='flex-1 overflow-y-auto px-5 py-4'>
        <div ref={bodyRef} className='w-full'>
          {split ? (
            <div className='flex flex-wrap gap-2'>
              {layerIds.map((id) => (
                <div key={id}>
                  <DesignCanvas
                    design={design}
                    palette={palette}
                    fit={{ width: splitW, height: splitW }}
                    padding={10}
                    layerIds={[id]}
                    frameIndex={frameIndex}
                  />
                  <div className='mt-1 font-mono text-[10.5px] text-slate-500'>layer {id}</div>
                </div>
              ))}
            </div>
          ) : (
            <DesignCanvas
              design={design}
              palette={palette}
              fit={{ width: big, height: bigH }}
              padding={16}
              layerIds={visibleIds}
              frameIndex={frameIndex}
              className='rounded-[3px]'
            />
          )}
        </div>

        {/* layers */}
        <div className='mt-3 flex flex-wrap items-center gap-1 font-mono text-[11px]'>
          <span className='mr-1 text-slate-600'>layers</span>
          {layerIds.map((id) => (
            <button
              key={id}
              type='button'
              className={chip(!hidden.has(id))}
              onClick={() =>
                setHidden((h) => {
                  const n = new Set(h)
                  if (n.has(id)) n.delete(id)
                  else n.add(id)
                  return n
                })
              }
            >
              {id}
            </button>
          ))}
          <span className='mx-1 text-slate-700'>|</span>
          <button type='button' className={chip(split)} onClick={() => setSplit((s) => !s)}>
            side by side
          </button>
        </div>

        {/* timeline */}
        {frameCount > 0 && (
          <div className='mt-3 flex items-center gap-3 font-mono text-[11px]'>
            <button type='button' onClick={togglePlay} className='text-slate-400 hover:text-slate-100' title='play (space)'>
              {playing ? <Pause className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
            </button>
            <input
              type='range'
              min={0}
              max={frameCount - 1}
              value={frame}
              onChange={(e) => {
                setPlaying(false)
                setFrame(Number(e.target.value))
              }}
              className='h-1 flex-1 accent-slate-400'
            />
            <span className='w-28 truncate text-right tabular-nums text-slate-400'>
              {design.frames![frame]?.label ?? frame} · {frame + 1}/{frameCount}
            </span>
          </div>
        )}

        {/* actions */}
        <div className='mt-4 flex flex-wrap gap-1.5'>
          <button type='button' className={btn} onClick={copySelection}>
            copy as gridpaint selection
          </button>
          <button type='button' className={btn} onClick={openInEditor}>
            open in editor
          </button>
          <button type='button' className={btn} onClick={open3d}>
            3d preview
          </button>
          <button type='button' className={btn} onClick={() => downloadJson(`${design.id}.json`, design)}>
            download json
          </button>
          <button type='button' className={cn(btn, pinned && "border-slate-400/40 text-slate-100")} onClick={() => onTogglePin(design)}>
            {pinned ? "unpin" : "pin"}
          </button>
        </div>

        {/* live */}
        <section className='mt-5 border-t border-white/[0.06] pt-4'>
          <h3 className='mb-2 font-mono text-[10.5px] uppercase tracking-wider text-slate-600'>live</h3>
          <LiveControls
            design={design}
            recipes={recipes}
            onResult={(d) => setDesign(d)}
            onVariants={(ds) => setVariants(ds)}
          />
          {variants.length > 0 && (
            <div className='mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6'>
              {variants.map((v, i) => (
                <button
                  key={`${v.id}-${i}`}
                  type='button'
                  onClick={() => setDesign(v)}
                  className={cn(
                    "overflow-hidden rounded-[3px] ring-1",
                    v === design ? "ring-slate-400" : "ring-white/[0.06] hover:ring-white/25",
                  )}
                  title={`seed ${v.seed}`}
                >
                  <DesignCanvas design={v} palette={palette} fit={{ width: 104, height: 104 }} padding={6} />
                  <div className='py-0.5 font-mono text-[10px] text-slate-500'>s{v.seed}</div>
                </button>
              ))}
            </div>
          )}
          {design !== item.design && (
            <button type='button' className={cn(btn, "mt-2")} onClick={() => setDesign(item.design)}>
              back to original
            </button>
          )}
        </section>

        {/* params & notes */}
        <section className='mt-5 border-t border-white/[0.06] pt-4 font-mono text-[11px]'>
          {design.notes && <p className='mb-3 whitespace-pre-wrap leading-relaxed text-slate-400'>{design.notes}</p>}
          {design.tags.length > 0 && <p className='mb-3 text-slate-500'>{design.tags.join("  ")}</p>}
          <pre className='overflow-x-auto rounded-[3px] bg-black/30 p-3 text-[10.5px] leading-relaxed text-slate-400'>
            {JSON.stringify(design.params, null, 2)}
          </pre>
        </section>
      </div>

      {show3d && (
        <ModelViewerModal
          isOpen={show3d}
          onClose={close3d}
          exportRect={exportRect}
          layers={storeLayers}
          canvasView={canvasView}
          drawingName={design.title}
        />
      )}
    </aside>
  )
}
