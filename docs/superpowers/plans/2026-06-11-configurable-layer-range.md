# Configurable Layer Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each drawing configure an arbitrary layer-index range (e.g. -3..10) instead of the fixed 1..6, with fill colors interpolated across the range, plus a settings modal (gear button) that replaces the toolbar Download and hosts range editing and grid deletion.

**Architecture:** Add a per-drawing `layerRange {min,max}` persisted on the `DrawingDocument` and held in the `$canvasView` store. Replace fixed `--canvas-layer-1..6` fill lookups with a runtime HSL interpolation helper between two anchor tokens. Generalize render order (`6 - id` → `-id`) and the LayerControls slot rendering / number-key mapping to iterate the range. Add a `DrawingSettingsModal` built on shadcn `Dialog`, with deletion confirmed via shadcn `AlertDialog`.

**Tech Stack:** React 18 + TypeScript, Nanostores, Vitest (jsdom), shadcn/ui (Radix), Tailwind.

---

## File Structure

- `src/types/layers.ts` — **new.** `LayerRange` type + `DEFAULT_LAYER_RANGE` + range helpers (slot list, validation, clamp-to-content).
- `src/lib/gridpaint/layerColors.ts` — **new.** `getLayerFillColor(id, range)` HSL interpolation + a small `parseHslTriple` helper. Pure, unit-tested.
- `src/lib/storage/types.ts` — add `layerRange?` to `DrawingDocument`.
- `src/stores/drawingStores.ts` — add `layerRange` to `CanvasViewState`; load/save defaults; `setLayerRange`; generalize `createDefaultLayer`/render-order-agnostic helpers.
- `src/globals.css` — add `--canvas-layer-lightest` / `--canvas-layer-darkest` anchor tokens.
- `src/components/GridPaintCanvas.tsx` — fills via `getLayerFillColor`, render order `-id`, layer-cap logic uses range.
- `src/lib/blob-engine/BlobEngine.ts` — render order `-id`.
- `src/components/ImageImportOverlay.tsx` — preview fill color via `getLayerFillColor`.
- `src/hooks/useSelectionRenderer.ts` — fill color via `getLayerFillColor`.
- `src/components/LayerControls.tsx` — iterate range for slots; number-key maps by slot position.
- `src/components/GridPaintControls.tsx` — remove Download button; add gear (Settings) button.
- `src/components/DrawingSettingsModal.tsx` — **new.** Range inputs + delete (AlertDialog confirm).
- `src/components/ui/alert-dialog.tsx` — **new** (via shadcn CLI).
- `src/App.tsx` — wire `DrawingSettingsModal`, drop download wiring, pass range to `LayerControls`.

**Out of scope:** `ImageImportOverlay`'s `for (id=1; id<=6)` commit loop (image import always targets the canonical 6 preview buckets) — only its *color* lookup is updated, not its loop bounds.

---

## Task 1: LayerRange type + helpers

**Files:**
- Create: `src/types/layers.ts`
- Test: `src/types/__tests__/layers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/types/__tests__/layers.test.ts
import { describe, it, expect } from "vitest"
import {
  DEFAULT_LAYER_RANGE,
  layerRangeIds,
  isValidLayerRange,
  clampRangeToContent,
} from "@/types/layers"

describe("layerRange helpers", () => {
  it("default range is 1..6", () => {
    expect(DEFAULT_LAYER_RANGE).toEqual({ min: 1, max: 6 })
  })

  it("layerRangeIds lists every id inclusive, including negatives", () => {
    expect(layerRangeIds({ min: -2, max: 1 })).toEqual([-2, -1, 0, 1])
  })

  it("isValidLayerRange requires min <= max", () => {
    expect(isValidLayerRange({ min: 1, max: 6 })).toBe(true)
    expect(isValidLayerRange({ min: 6, max: 1 })).toBe(false)
    expect(isValidLayerRange({ min: 0.5, max: 6 })).toBe(false) // integers only
  })

  it("clampRangeToContent widens the range to cover drawn layer ids", () => {
    // user wants 1..3 but layers -1 and 5 have content → widen to cover them
    expect(clampRangeToContent({ min: 1, max: 3 }, [-1, 2, 5])).toEqual({
      min: -1,
      max: 5,
    })
  })

  it("clampRangeToContent leaves range untouched when it already covers content", () => {
    expect(clampRangeToContent({ min: -3, max: 10 }, [0, 4])).toEqual({
      min: -3,
      max: 10,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/types/__tests__/layers.test.ts`
Expected: FAIL — cannot find module `@/types/layers`.

- [ ] **Step 3: Write the implementation**

```ts
// src/types/layers.ts

/** Inclusive index range of selectable layers for a drawing. */
export interface LayerRange {
  min: number
  max: number
}

export const DEFAULT_LAYER_RANGE: LayerRange = { min: 1, max: 6 }

/** Hard bounds to keep ranges sane. */
export const LAYER_RANGE_LIMIT = { min: -50, max: 50 }

/** All integer ids in [min, max], ascending. */
export function layerRangeIds(range: LayerRange): number[] {
  const ids: number[] = []
  for (let id = range.min; id <= range.max; id++) ids.push(id)
  return ids
}

/** Valid iff both ends are integers within limits and min <= max. */
export function isValidLayerRange(range: LayerRange): boolean {
  const { min, max } = range
  if (!Number.isInteger(min) || !Number.isInteger(max)) return false
  if (min > max) return false
  if (min < LAYER_RANGE_LIMIT.min || max > LAYER_RANGE_LIMIT.max) return false
  return true
}

/** Widen `range` so it includes every id in `contentIds`. */
export function clampRangeToContent(
  range: LayerRange,
  contentIds: number[],
): LayerRange {
  if (contentIds.length === 0) return range
  return {
    min: Math.min(range.min, ...contentIds),
    max: Math.max(range.max, ...contentIds),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/types/__tests__/layers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/layers.ts src/types/__tests__/layers.test.ts
git commit -m "feat: add LayerRange type and helpers"
```

---

## Task 2: Layer fill color interpolation

**Files:**
- Create: `src/lib/gridpaint/layerColors.ts`
- Test: `src/lib/gridpaint/__tests__/layerColors.test.ts`
- Modify: `src/globals.css`

- [ ] **Step 1: Add anchor tokens to CSS**

In `src/globals.css`, inside the `:root` block right after the `--canvas-layer-6` line (around line 47), add:

```css
    --canvas-layer-lightest: 214.3 31.8% 91.4%; /* matches --canvas-layer-1 */
    --canvas-layer-darkest: 215.3 25% 26.7%; /* matches --canvas-layer-6 */
```

(These intentionally duplicate the layer-1 and layer-6 HSL values. Greys are identical in light/dark per the theming convention, so no dark-mode override is needed.)

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/gridpaint/__tests__/layerColors.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { getLayerFillColor, interpolateHsl } from "@/lib/gridpaint/layerColors"

describe("layerColors", () => {
  beforeEach(() => {
    // jsdom doesn't load globals.css; set the anchor tokens manually.
    document.documentElement.style.setProperty(
      "--canvas-layer-lightest",
      "0 0% 90%",
    )
    document.documentElement.style.setProperty(
      "--canvas-layer-darkest",
      "0 0% 30%",
    )
  })

  it("interpolateHsl blends triples linearly", () => {
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 0)).toBe("hsl(0 0% 90%)")
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 1)).toBe("hsl(0 0% 30%)")
    expect(interpolateHsl([0, 0, 90], [0, 0, 30], 0.5)).toBe("hsl(0 0% 60%)")
  })

  it("min id is lightest, max id is darkest", () => {
    const range = { min: 1, max: 6 }
    expect(getLayerFillColor(1, range)).toBe("hsl(0 0% 90%)")
    expect(getLayerFillColor(6, range)).toBe("hsl(0 0% 30%)")
  })

  it("interpolates across negative ranges", () => {
    const range = { min: -2, max: 2 }
    // id 0 is the midpoint of -2..2 → 60% lightness
    expect(getLayerFillColor(0, range)).toBe("hsl(0 0% 60%)")
  })

  it("single-element range returns the lightest anchor", () => {
    expect(getLayerFillColor(3, { min: 3, max: 3 })).toBe("hsl(0 0% 90%)")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/layerColors.test.ts`
Expected: FAIL — cannot find module `@/lib/gridpaint/layerColors`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/gridpaint/layerColors.ts
import type { LayerRange } from "@/types/layers"

type Hsl = [h: number, s: number, l: number]

/** Read a `--token` whose value is an HSL triple like "214 32% 91%". */
function readHslToken(varName: string): Hsl {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
  return parseHslTriple(raw)
}

export function parseHslTriple(raw: string): Hsl {
  // "214.3 31.8% 91.4%" → [214.3, 31.8, 91.4]
  const parts = raw.replace(/%/g, "").split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return [0, 0, 0]
  return [parts[0], parts[1], parts[2]]
}

export function interpolateHsl(a: Hsl, b: Hsl, t: number): string {
  const h = a[0] + (b[0] - a[0]) * t
  const s = a[1] + (b[1] - a[1]) * t
  const l = a[2] + (b[2] - a[2]) * t
  const fmt = (n: number) => {
    const r = Math.round(n * 100) / 100
    return Number.isInteger(r) ? String(r) : String(r)
  }
  return `hsl(${fmt(h)} ${fmt(s)}% ${fmt(l)}%)`
}

/** Fill color for a layer id, interpolated across the configured range. */
export function getLayerFillColor(id: number, range: LayerRange): string {
  const lightest = readHslToken("--canvas-layer-lightest")
  const darkest = readHslToken("--canvas-layer-darkest")
  const span = range.max - range.min
  const t = span === 0 ? 0 : (id - range.min) / span
  return interpolateHsl(lightest, darkest, Math.max(0, Math.min(1, t)))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/layerColors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/globals.css src/lib/gridpaint/layerColors.ts src/lib/gridpaint/__tests__/layerColors.test.ts
git commit -m "feat: add interpolated layer fill colors with anchor tokens"
```

---

## Task 3: Persist layerRange in store + document

**Files:**
- Modify: `src/lib/storage/types.ts:66-91` (`DrawingDocument`)
- Modify: `src/stores/drawingStores.ts` (`CanvasViewState`, load/save, `setLayerRange`)
- Test: `src/stores/__tests__/layerRange.test.ts`

- [ ] **Step 1: Add the field to the document type**

In `src/lib/storage/types.ts`, add an import and a field. At the top imports add `LayerRange`:

```ts
import type { Layer, ExportMode, ExportFormat } from "@/stores/drawingStores"
import type { LayerRange } from "@/types/layers"
```

Inside `DrawingDocument` (after `mmPerUnit`, before `layers`):

```ts
  /** Configurable inclusive range of selectable layer ids. Absent ⇒ default 1..6. */
  layerRange?: LayerRange
```

- [ ] **Step 2: Add layerRange to CanvasViewState and defaults**

In `src/stores/drawingStores.ts`:

Add import near the top (after the existing type imports):

```ts
import { DEFAULT_LAYER_RANGE, type LayerRange } from "@/types/layers"
```

Add to the `CanvasViewState` interface (after `mmPerUnit`):

```ts
  layerRange: LayerRange
```

Add to the `$canvasView` initial `map(...)` value (after `mmPerUnit: DEFAULT_MM_PER_UNIT,`):

```ts
  layerRange: DEFAULT_LAYER_RANGE,
```

In `initializeDrawingState`, the **stored** branch `$canvasView.set({...})` — add after `mmPerUnit: stored.mmPerUnit || DEFAULT_MM_PER_UNIT,`:

```ts
        layerRange: stored.layerRange ?? DEFAULT_LAYER_RANGE,
```

In the **new drawing** branch `$canvasView.set({...})` — add after `mmPerUnit: DEFAULT_MM_PER_UNIT,`:

```ts
        layerRange: DEFAULT_LAYER_RANGE,
```

In `resetDrawing`, the `$canvasView.set({...})` — add after `mmPerUnit: DEFAULT_MM_PER_UNIT,`:

```ts
    layerRange: DEFAULT_LAYER_RANGE,
```

In `saveDrawingState`, the `document` object spreads `...canvasView`, so `layerRange` is persisted automatically — no change needed there.

- [ ] **Step 3: Add the setter**

In `src/stores/drawingStores.ts`, add near the other layer functions (e.g. after `setLayerScale`):

```ts
/** Update the drawing's selectable layer range. */
export function setLayerRange(range: LayerRange): void {
  $canvasView.setKey("layerRange", range)
}
```

- [ ] **Step 4: Write the test**

```ts
// src/stores/__tests__/layerRange.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { $canvasView, setLayerRange } from "@/stores/drawingStores"
import { DEFAULT_LAYER_RANGE } from "@/types/layers"

describe("layerRange store", () => {
  beforeEach(() => {
    $canvasView.setKey("layerRange", DEFAULT_LAYER_RANGE)
  })

  it("defaults to 1..6", () => {
    expect($canvasView.get().layerRange).toEqual({ min: 1, max: 6 })
  })

  it("setLayerRange updates the store", () => {
    setLayerRange({ min: -3, max: 10 })
    expect($canvasView.get().layerRange).toEqual({ min: -3, max: 10 })
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/stores/__tests__/layerRange.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify the project still type-checks**

Run: `pnpm build`
Expected: TypeScript compilation succeeds (no errors from the new field). If pre-existing scratch-test errors appear, ignore those unrelated files.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/types.ts src/stores/drawingStores.ts src/stores/__tests__/layerRange.test.ts
git commit -m "feat: persist per-drawing layerRange in canvas view store"
```

---

## Task 4: Generalize render order to support any id

**Files:**
- Modify: `src/lib/blob-engine/BlobEngine.ts:130`
- Modify: `src/components/GridPaintCanvas.tsx:343`
- Test: `src/lib/blob-engine/__tests__/renderOrder.test.ts`

The current `renderOrder: 6 - layer.id` makes higher ids render on top **only** within 1..6. For an arbitrary range, `-layer.id` preserves "higher id on top" for any integer (sorting ascending by renderOrder draws most-negative-renderOrder first = highest id last = on top).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/blob-engine/__tests__/renderOrder.test.ts
import { describe, it, expect } from "vitest"

// renderOrder = -id; ascending sort means highest id ends up last (on top).
function renderOrder(id: number): number {
  return -id
}

describe("layer render order", () => {
  it("higher id renders on top across negative ids", () => {
    const ids = [3, -2, 0, 10, -5]
    const sorted = [...ids].sort((a, b) => renderOrder(a) - renderOrder(b))
    // last element drawn is on top → should be the max id
    expect(sorted[sorted.length - 1]).toBe(10)
    expect(sorted[0]).toBe(-5) // most-background = lowest id
  })

  it("matches legacy ordering for the default 1..6 range", () => {
    const ids = [1, 2, 3, 4, 5, 6]
    const sorted = [...ids].sort((a, b) => renderOrder(a) - renderOrder(b))
    expect(sorted).toEqual([6, 5, 4, 3, 2, 1].reverse()) // [1..6], 6 on top
  })
})
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially)**

Run: `pnpm vitest run src/lib/blob-engine/__tests__/renderOrder.test.ts`
Expected: PASS — this test pins the intended formula. (It documents the contract the source changes must match.)

- [ ] **Step 3: Update the two source sites**

In `src/lib/blob-engine/BlobEngine.ts:130`, change:

```ts
          renderOrder: 6 - layer.id, // Higher layer IDs render on top
```
to:
```ts
          renderOrder: -layer.id, // Higher layer IDs render on top (any integer id)
```

In `src/components/GridPaintCanvas.tsx:343`, change:

```ts
        renderOrder: 6 - layer.id, // Higher layer IDs render on top
```
to:
```ts
        renderOrder: -layer.id, // Higher layer IDs render on top (any integer id)
```

- [ ] **Step 4: Run the blob-engine tests to confirm nothing regressed**

Run: `pnpm vitest run src/lib/blob-engine`
Expected: PASS (all existing blob-engine tests still pass — ordering within 1..6 is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/blob-engine/BlobEngine.ts src/components/GridPaintCanvas.tsx src/lib/blob-engine/__tests__/renderOrder.test.ts
git commit -m "feat: generalize layer render order to any integer id"
```

---

## Task 5: Switch fill colors to interpolation at call sites

**Files:**
- Modify: `src/components/GridPaintCanvas.tsx:849`
- Modify: `src/hooks/useSelectionRenderer.ts:73`
- Modify: `src/components/ImageImportOverlay.tsx:102`

These are runtime canvas-rendering changes (hard to unit-test without a canvas), so this task has no new test; verification is the existing render tests still passing + a manual smoke check at the end.

- [ ] **Step 1: GridPaintCanvas fill**

In `src/components/GridPaintCanvas.tsx`, add the import near the other `@/lib` imports at the top:

```ts
import { getLayerFillColor } from "@/lib/gridpaint/layerColors"
```

In `getLayerStyle` (around line 849), replace:

```ts
        fillColor: getCanvasColor(`--canvas-layer-${layerId}`),
```
with:
```ts
        fillColor: getLayerFillColor(layerId, canvasView.layerRange),
```

`canvasView` is already in scope in `render` (it reads `canvasView.zoom` etc.).

- [ ] **Step 2: useSelectionRenderer fill**

In `src/hooks/useSelectionRenderer.ts`, add import:

```ts
import { getLayerFillColor } from "@/lib/gridpaint/layerColors"
```

Replace line 73:

```ts
      const layerColor = getCanvasColor(`--canvas-layer-${layerId}`)
```
with:
```ts
      const layerColor = getLayerFillColor(layerId, canvasView.layerRange)
```

`canvasView` is already read in this hook (it uses `canvasView.panOffset`, `canvasView.zoom`, `canvasView.gridSize`). Confirm it is the `$canvasView` value; if the hook only destructures specific fields, ensure `layerRange` is accessible via the same `canvasView` object.

- [ ] **Step 3: ImageImportOverlay fill**

In `src/components/ImageImportOverlay.tsx`, add import:

```ts
import { getLayerFillColor } from "@/lib/gridpaint/layerColors"
```

Find the fill line (around line 102):

```ts
        fillColor: getCanvasColor(`--canvas-layer-${layerId}`),
```
and replace with:
```ts
        fillColor: getLayerFillColor(layerId, $canvasView.get().layerRange),
```

(Use `$canvasView.get()` since this overlay reads the store directly; if it already has a `canvasView` via `useStore`, use that instead.)

- [ ] **Step 4: Type-check**

Run: `pnpm build`
Expected: compiles. Fix any "layerRange does not exist" by ensuring the relevant `canvasView` is the `$canvasView` map value.

- [ ] **Step 5: Commit**

```bash
git add src/components/GridPaintCanvas.tsx src/hooks/useSelectionRenderer.ts src/components/ImageImportOverlay.tsx
git commit -m "feat: render layer fills via interpolated range colors"
```

---

## Task 6: LayerControls iterate range + slot-based key mapping

**Files:**
- Modify: `src/components/LayerControls.tsx`
- Modify: `src/App.tsx:82-88` (pass range / drop `maxLayers`)

- [ ] **Step 1: Read the range in the component**

In `src/components/LayerControls.tsx`, add imports:

```ts
import { $canvasView } from "@/stores/drawingStores"
import { layerRangeIds } from "@/types/layers"
```

Inside the component, after `const layersState = useStore($layersState)`:

```ts
  const canvasView = useStore($canvasView)
  const layerIds = layerRangeIds(canvasView.layerRange)
```

Remove the `maxLayers` prop from `LayerControlsProps` and the function signature default (`maxLayers = 6`). The slots now come from `layerIds`.

- [ ] **Step 2: Render a button per id in the range**

Replace the slot loop. Change:

```tsx
        {Array.from({ length: maxLayers }, (_, index) => {
          const layerId = index + 1
```
to:
```tsx
        {layerIds.map((layerId) => {
```

Everything inside the map body that references `layerId` stays the same. The closing of the `.map` callback stays `})`. (The `key={layerId}` already uses `layerId`, which is now possibly negative — still unique.)

- [ ] **Step 3: Map number keys by slot position, not raw id**

In the keydown handler, replace the number-key block:

```ts
      // Number keys 1-6: switch layer
      const isNumberKey =
        /^[1-6]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey
      if (isNumberKey) {
        e.preventDefault()
        const layerId = parseInt(key)
        if (activeLayerId === layerId) {
          onLayerSelect(null) // Deactivate if already active
        } else {
          onCreateOrActivateLayer(layerId)
          setActiveGroupIndex(0) // Reset group on layer switch
        }
        return
      }
```
with:
```ts
      // Number keys 1-9: switch layer by slot position within the range
      const isNumberKey =
        /^[1-9]$/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey
      if (isNumberKey) {
        const slotIndex = parseInt(key) - 1
        const ids = layerRangeIds($canvasView.get().layerRange)
        if (slotIndex >= ids.length) return // no such slot
        e.preventDefault()
        const layerId = ids[slotIndex]
        if (activeLayerId === layerId) {
          onLayerSelect(null) // Deactivate if already active
        } else {
          onCreateOrActivateLayer(layerId)
          setActiveGroupIndex(0) // Reset group on layer switch
        }
        return
      }
```

(Reading via `$canvasView.get()` inside the handler avoids stale closures and an extra effect dependency.)

- [ ] **Step 4: Allow horizontal overflow for wide ranges**

Change the slot row container to scroll. Replace:

```tsx
      <div className='flex gap-1'>
```
(the one wrapping the slot map, around line 194)
with:
```tsx
      <div className='flex gap-1 max-w-[90vw] overflow-x-auto pb-1'>
```

- [ ] **Step 5: Update App.tsx usage**

In `src/App.tsx`, the `<LayerControls .../>` element (lines 82-88) does not pass `maxLayers`, so removing the prop needs no change there. Confirm no other caller passes `maxLayers`:

Run: `grep -rn "maxLayers" src`
Expected: no remaining references after the LayerControls edit. If any remain, remove them.

- [ ] **Step 6: Type-check**

Run: `pnpm build`
Expected: compiles.

- [ ] **Step 7: Commit**

```bash
git add src/components/LayerControls.tsx src/App.tsx
git commit -m "feat: LayerControls iterate configurable range with slot-based keys"
```

---

## Task 7: Add shadcn AlertDialog component

**Files:**
- Create: `src/components/ui/alert-dialog.tsx` (via CLI)
- Modify: `package.json` (adds `@radix-ui/react-alert-dialog`)

- [ ] **Step 1: Run the shadcn CLI**

Run: `pnpm dlx shadcn@latest add alert-dialog`
Expected: creates `src/components/ui/alert-dialog.tsx` and installs `@radix-ui/react-alert-dialog`. (If the CLI prompts, accept defaults — `components.json` is already configured with the `new-york` style and `@/components` alias.)

- [ ] **Step 2: Verify it installed**

Run: `ls src/components/ui/alert-dialog.tsx && grep "react-alert-dialog" package.json`
Expected: file exists and the dependency appears in `package.json`.

- [ ] **Step 3: Type-check**

Run: `pnpm build`
Expected: compiles (the new file should be self-contained).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/alert-dialog.tsx package.json pnpm-lock.yaml
git commit -m "chore: add shadcn AlertDialog component"
```

---

## Task 8: DrawingSettingsModal (range editing + delete)

**Files:**
- Create: `src/components/DrawingSettingsModal.tsx`

This component is presentational + store-driven; it's verified via the manual smoke test in Task 10 (a unit test would require mocking the dialog + store + navigation, which is low value here).

- [ ] **Step 1: Create the modal**

```tsx
// src/components/DrawingSettingsModal.tsx
import { useEffect, useState } from "react"
import { useStore } from "@nanostores/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { $canvasView, $layersState, setLayerRange } from "@/stores/drawingStores"
import { getLayerPoints } from "@/stores/drawingStores"
import { drawingStore } from "@/lib/storage/store"
import {
  isValidLayerRange,
  clampRangeToContent,
  type LayerRange,
} from "@/types/layers"
import { toast } from "sonner"

interface DrawingSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  drawingId: string
  drawingName: string
  onDeleted: () => void
}

export function DrawingSettingsModal({
  isOpen,
  onClose,
  drawingId,
  drawingName,
  onDeleted,
}: DrawingSettingsModalProps) {
  const canvasView = useStore($canvasView)
  const layersState = useStore($layersState)

  const [min, setMin] = useState(String(canvasView.layerRange.min))
  const [max, setMax] = useState(String(canvasView.layerRange.max))

  // Re-seed local inputs whenever the modal opens or the stored range changes.
  useEffect(() => {
    if (isOpen) {
      setMin(String(canvasView.layerRange.min))
      setMax(String(canvasView.layerRange.max))
    }
  }, [isOpen, canvasView.layerRange.min, canvasView.layerRange.max])

  const commitRange = () => {
    const parsed: LayerRange = { min: parseInt(min, 10), max: parseInt(max, 10) }
    if (!isValidLayerRange(parsed)) {
      toast.error("Invalid range: min must be ≤ max (whole numbers).")
      // reset inputs to current stored values
      setMin(String(canvasView.layerRange.min))
      setMax(String(canvasView.layerRange.max))
      return
    }
    // Don't allow shrinking to orphan drawn layers — widen to cover content.
    const drawnIds = layersState.layers
      .filter((l) => getLayerPoints(l).size > 0)
      .map((l) => l.id)
    const safe = clampRangeToContent(parsed, drawnIds)
    if (safe.min !== parsed.min || safe.max !== parsed.max) {
      toast.info(
        `Range widened to ${safe.min}..${safe.max} to keep existing layers.`,
      )
      setMin(String(safe.min))
      setMax(String(safe.max))
    }
    setLayerRange(safe)
  }

  const handleDelete = async () => {
    await drawingStore.delete(drawingId)
    onDeleted()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grid settings</DialogTitle>
          <DialogDescription>
            Configure the selectable layer range and manage this grid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-2">Layer range</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">min</label>
              <input
                type="number"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                onBlur={commitRange}
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
              />
              <label className="text-xs text-muted-foreground">max</label>
              <input
                type="number"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                onBlur={commitRange}
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Layers render bottom-to-top by number; colors scale lightest→darkest.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete grid</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete grid</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{drawingName}"? This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: compiles. If `DialogDescription` is not exported from `@/components/ui/dialog`, remove that import and its usage (the existing dialog may not export it — check `src/components/ui/dialog.tsx` and drop unavailable parts).

- [ ] **Step 3: Commit**

```bash
git add src/components/DrawingSettingsModal.tsx
git commit -m "feat: add DrawingSettingsModal with range editing and delete"
```

---

## Task 9: Toolbar — drop Download, add Settings gear; wire into App

**Files:**
- Modify: `src/components/GridPaintControls.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace Download with a Settings gear in GridPaintControls**

In `src/components/GridPaintControls.tsx`:

Update imports — remove `Download`, add `Settings`:

```ts
import {
  RefreshCcw,
  HelpCircle,
  Plus,
  Minus,
  Home,
  Cloud,
  Loader2,
  AlertCircle,
  Undo2,
  Redo2,
  Settings,
} from "lucide-react"
```

In `GridPaintControlsProps`, remove `onDownload: () => void` and add:

```ts
  /** Open the grid settings modal */
  onShowSettings: () => void
```

In the destructured props, remove `onDownload,` and add `onShowSettings,`.

Remove the now-unused selection-download styling. Delete these (they exist only to style the download button):

```ts
  const selectionState = useStore($selectionState)
  const currentTool = useStore($currentTool)
  const hasActiveSelection = currentTool === "select" && selectionState.bounds !== null
```

and their imports `$selectionState, $currentTool` from `@/stores/ui` (remove that import line).

Replace the entire Download `<Button>` block (the one with `onClick={onDownload}`, lines ~153-165) with a Settings button:

```tsx
        <Button
          size='icon'
          variant='ghost'
          onClick={onShowSettings}
          title='Grid settings'
          className='w-8 h-8 bg-white/10 hover:bg-white/20 backdrop-blur-sm'
        >
          <Settings className='w-4 h-4' />
        </Button>
```

- [ ] **Step 2: Verify GridPaintControls has no leftover references**

Run: `grep -n "onDownload\|hasActiveSelection\|Download" src/components/GridPaintControls.tsx`
Expected: no matches.

- [ ] **Step 3: Wire the modal into App.tsx**

In `src/App.tsx`:

Add import:

```ts
import { DrawingSettingsModal } from "@/components/DrawingSettingsModal"
```

Add state next to the others (after `const [showShortcuts, ...]`):

```ts
  const [showSettings, setShowSettings] = useState<boolean>(false)
```

Remove the now-unused download handler:

```ts
  const handleDownload = () => canvasRef.current?.saveIMG()
```

In the `<GridPaintControls .../>` element, remove `onDownload={handleDownload}` and add:

```tsx
        onShowSettings={() => setShowSettings(true)}
```

After the `<ShortcutsModal .../>` element, add:

```tsx
      <DrawingSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        drawingId={drawingId!}
        drawingName={drawingMeta.name}
        onDeleted={() => navigate("/")}
      />
```

- [ ] **Step 4: Type-check**

Run: `pnpm build`
Expected: compiles. (If `saveIMG` on the canvas methods is now unused anywhere, that's fine — leaving the canvas method in place is acceptable; do not remove it unless lint flags it as an error rather than a warning.)

- [ ] **Step 5: Run the full test suite**

Run: `pnpm vitest run`
Expected: PASS for all non-scratch tests (the `scratch-*.test.ts` files have pre-existing, unrelated failures — confirm no *new* failures were introduced by comparing to a baseline run).

- [ ] **Step 6: Commit**

```bash
git add src/components/GridPaintControls.tsx src/App.tsx
git commit -m "feat: replace toolbar download with grid settings modal"
```

---

## Task 10: Manual smoke test + final lint

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no new errors. Fix any introduced by these changes (e.g. unused imports).

- [ ] **Step 2: Run the dev server and smoke-test**

Run: `pnpm dev`, open a grid, and verify:
- The gear button (top-right, where Download was) opens the settings modal.
- Setting min/max to e.g. `-3` / `10` adds selectable layer slots (negative labels show); fills scale lightest→darkest across the new range.
- Drawing on a layer, then trying to shrink the range below it, widens the range back and shows the toast.
- Number keys select layers by slot position (key `1` = leftmost slot).
- "Delete grid" opens the AlertDialog; confirming deletes and navigates home.
- The default 1..6 grids still look essentially unchanged.

- [ ] **Step 3: Final commit (if any lint fixes were made)**

```bash
git add -A
git commit -m "chore: lint fixes for configurable layer range"
```

---

## Self-Review Notes

- **Spec coverage:** per-drawing range (T3), interpolated colors (T2/T5), render order any-int (T4), lazy creation (unchanged — range only defines slots, T6), LayerControls range iteration + slot keys (T6), settings modal with range + delete (T8/T9), shadcn AlertDialog via CLI (T7), Download dropped (T9). All spec sections map to tasks.
- **Type consistency:** `LayerRange`, `DEFAULT_LAYER_RANGE`, `layerRangeIds`, `isValidLayerRange`, `clampRangeToContent`, `getLayerFillColor`, `setLayerRange` are defined in T1–T3 and used consistently thereafter.
- **Render-order note:** the unit test in T4 documents the `-id` contract; the source edits in two files must match it.
