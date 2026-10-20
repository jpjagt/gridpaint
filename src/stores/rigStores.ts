/**
 * Assembly rig tool state: print setup (per browser), tool settings, and
 * the live analysis of the rig being edited.
 */

import { atom, map } from "nanostores"
import {
  $canvasView,
  $exportRects,
  $glueSpots,
  $layersState,
} from "@/stores/drawingStores"
import type { ExportRect } from "@/types/gridpaint"
import type {
  ExportRectRig,
  GlueSpot,
  PrintSetup,
  RigAnalysis,
  RigToolSettings,
} from "@/types/rig"
import { analyzeRig } from "@/lib/rig/analyze"
import {
  resolveRectMmPerUnit,
  resolveRectThickness,
} from "@/lib/export/rectSettings"

const PRINT_SETUP_KEY = "gridpaint:printSetup"

export const DEFAULT_PRINT_SETUP: PrintSetup = {
  clearance: 0.2,
  basePlateThickness: 1.2,
  minWall: 1,
  stencilThickness: 0.6,
  glueDiameter: 1.5,
  glueMargin: 0.5,
  glueMarkers: true,
}

function loadPrintSetup(): PrintSetup {
  try {
    const raw = localStorage.getItem(PRINT_SETUP_KEY)
    if (raw) return { ...DEFAULT_PRINT_SETUP, ...JSON.parse(raw) }
  } catch {
    // Unavailable storage or bad JSON: fall back to defaults
  }
  return { ...DEFAULT_PRINT_SETUP }
}

/** Printer settings shared by every drawing in this browser */
export const $printSetup = map<PrintSetup>(loadPrintSetup())

$printSetup.listen((setup) => {
  try {
    localStorage.setItem(PRINT_SETUP_KEY, JSON.stringify(setup))
  } catch {
    // Ignore: settings just won't persist
  }
})

export const $rigToolSettings = map<RigToolSettings>({
  mode: "pillars",
  rectId: null,
})

/** Rect the rig tool edits: the chosen one, else the first rect. */
export function rigRect(
  rects: ExportRect[],
  rectId: string | null,
): ExportRect | null {
  return rects.find((r) => r.id === rectId) ?? rects[0] ?? null
}

export function getRig(rect: ExportRect): ExportRectRig {
  return rect.rig ?? { pillars: [] }
}

export function updateRig(
  rectId: string,
  update: (rig: ExportRectRig) => ExportRectRig,
): void {
  $exportRects.set(
    $exportRects
      .get()
      .map((r) => (r.id === rectId ? { ...r, rig: update(getRig(r)) } : r)),
  )
}

export function togglePillar(rectId: string, x: number, y: number): void {
  updateRig(rectId, (rig) => {
    const exists = rig.pillars.some((p) => p.x === x && p.y === y)
    return {
      ...rig,
      pillars: exists
        ? rig.pillars.filter((p) => p.x !== x || p.y !== y)
        : [...rig.pillars, { x, y }],
    }
  })
}

export function addGlueSpots(spots: GlueSpot[]): void {
  const current = $glueSpots.get()
  const fresh = spots.filter(
    (s) =>
      !current.some(
        (c) => c.layerId === s.layerId && c.x === s.x && c.y === s.y,
      ),
  )
  if (fresh.length > 0) $glueSpots.set([...current, ...fresh])
}

export function removeGlueSpot(spot: GlueSpot): void {
  $glueSpots.set(
    $glueSpots
      .get()
      .filter(
        (s) => s.layerId !== spot.layerId || s.x !== spot.x || s.y !== spot.y,
      ),
  )
}

/** Live analysis of the rig being edited; null when there is nothing to show */
export const $rigAnalysis = atom<RigAnalysis | null>(null)
/** True while a recompute is pending */
export const $rigAnalyzing = atom(false)

/**
 * Keep $rigAnalysis up to date while the rig tool is open. Recomputes
 * (debounced) whenever an input changes; returns a stop function.
 */
export function startRigAnalysis(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastKey = ""
  let requestId = 0
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL("../lib/rig/worker.ts", import.meta.url), {
      type: "module",
    })
    worker.onmessage = (
      event: MessageEvent<{ id: number; analysis?: RigAnalysis; error?: string }>,
    ) => {
      if (event.data.id !== requestId) return
      if (event.data.error) console.error("[rig] analysis failed:", event.data.error)
      $rigAnalysis.set(event.data.analysis ?? null)
      $rigAnalyzing.set(false)
    }
  } catch {
    worker = null // No workers (tests): analyze on the main thread
  }

  const run = () => {
    timer = undefined
    const rect = rigRect($exportRects.get(), $rigToolSettings.get().rectId)
    if (!rect) {
      $rigAnalysis.set(null)
      $rigAnalyzing.set(false)
      return
    }
    const view = $canvasView.get()
    const rig = getRig(rect)
    const inputs = {
      rect,
      layers: $layersState.get().layers,
      gridSize: view.gridSize,
      borderWidth: view.borderWidth,
      mmPerUnit: resolveRectMmPerUnit(rect, view.mmPerUnit),
      thickness: resolveRectThickness(rect, view.layerThickness),
      pillars: rig.pillars,
      reverse: rig.reverse ?? false,
      glueSpots: $glueSpots.get(),
      setup: $printSetup.get(),
    }
    requestId++
    if (worker) {
      worker.postMessage({ id: requestId, inputs })
      return
    }
    try {
      $rigAnalysis.set(analyzeRig(inputs))
    } catch (error) {
      console.error("[rig] analysis failed:", error)
      $rigAnalysis.set(null)
    }
    $rigAnalyzing.set(false)
  }

  const schedule = () => {
    $rigAnalyzing.set(true)
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, 150)
  }

  // Pan/zoom also change $canvasView; only react to physical settings
  const viewKey = () => {
    const view = $canvasView.get()
    return [view.borderWidth, view.mmPerUnit, view.layerThickness].join("|")
  }
  const onView = () => {
    const key = viewKey()
    if (key === lastKey) return
    lastKey = key
    schedule()
  }

  const unsubs = [
    $exportRects.listen(schedule),
    $layersState.listen(schedule),
    $glueSpots.listen(schedule),
    $printSetup.listen(schedule),
    $rigToolSettings.listen(schedule),
    $canvasView.listen(onView),
  ]
  lastKey = viewKey()
  run()

  return () => {
    if (timer) clearTimeout(timer)
    unsubs.forEach((u) => u())
    worker?.terminate()
    $rigAnalysis.set(null)
  }
}
