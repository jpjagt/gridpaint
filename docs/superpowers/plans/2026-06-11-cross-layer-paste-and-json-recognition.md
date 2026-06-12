# Cross-layer paste and robust JSON recognition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users duplicate a selection from the active layer onto another layer, and make cross-tab JSON selection paste always work when a valid payload is on the clipboard.

**Architecture:** Copy gains an `activeLayerOnly` flag (`cmd+c` = active only, `cmd+shift+c` = all layers). Paste retargets a single-layer clip onto the active layer and honors original layers for multi-layer clips. JSON paste moves from the synthetic `cmd+v` keydown handler onto a shared native-`paste` dispatcher in `useImagePaste.ts` that branches image vs. gridpaint-JSON, using a lenient recognition predicate and viewport-center positioning.

**Tech Stack:** React 18 + TypeScript, Nanostores, Vitest, native Clipboard/`paste` events.

---

## Reference: current code

- `src/hooks/useSelection.ts`
  - `ClipboardData`, `ClipboardLayer`, `ClipboardGroup` interfaces (lines ~15-31).
  - `copySelection` (line ~214) — iterates **all** layers; writes JSON payload.
  - `pasteSelection` (line ~298) — reads clipboard, accepts only `parsed.type === "gridpaint-selection"`, sets `floatingPaste`.
  - `bakeFloatingPaste` (line ~157) / `cancelFloatingPaste` (line ~119) — map clip layers back by `clipGroup.layerId` (cancel only restores when `fp.lifted`).
- `src/components/GridPaintCanvas.tsx`
  - keydown handler (line ~1336): `cmd+c` → `copySelection()`; `cmd+v` → `pasteSelection(...)` guarded by `e.target !== document.body` and `currentTool === "select"`.
  - `getGridCoordinates(clientX, clientY)` (line ~447) returns the grid cell for a client point.
- `src/hooks/useImagePaste.ts` — native `paste` listener for images only.
- `src/stores/ui.ts` — `FloatingPaste` (has optional `lifted`), `$selectionState`.

## File structure

- Modify `src/hooks/useSelection.ts` — add `activeLayerOnly` to `copySelection`; add `pasteData(clipboardData, atGrid)`; single-layer retarget in `bakeFloatingPaste` / `cancelFloatingPaste`; export a `recognizeSelectionPayload` helper.
- Modify `src/hooks/useImagePaste.ts` — generalize into a paste dispatcher that also handles gridpaint-JSON via an injected `onSelectionPaste` callback.
- Modify `src/components/GridPaintCanvas.tsx` — add `cmd+shift+c`; change `cmd+c` to active-only; remove the `cmd+v` keydown branch; pass an `onSelectionPaste` to the dispatcher that floats at viewport center.
- Create `src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`.

The retarget/copy logic lives inside React `useCallback`s in `useSelection.ts` and is
exercised via the manual verification in Task 7 (the only unit-testable pure function,
`recognizeSelectionPayload`, is covered in Task 1).

---

## Task 1: Lenient recognition predicate

**Files:**
- Modify: `src/hooks/useSelection.ts`
- Test: `src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts
import { describe, it, expect } from "vitest"
import { recognizeSelectionPayload } from "@/hooks/useSelection"

const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
const layers = [{ layerId: 1, groups: [{ id: "g1", points: ["0,0"] }] }]

describe("recognizeSelectionPayload", () => {
  it("accepts the canonical payload", () => {
    const text = JSON.stringify({
      type: "gridpaint-selection",
      version: "2.0.0",
      data: { layers, bounds, timestamp: 1 },
    })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("accepts a payload with a different version via shape", () => {
    const text = JSON.stringify({
      type: "gridpaint-selection",
      version: "9.9.9",
      data: { layers, bounds },
    })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("accepts a payload missing type but with the right shape", () => {
    const text = JSON.stringify({ data: { layers, bounds } })
    expect(recognizeSelectionPayload(text)).toEqual({ layers, bounds })
  })

  it("rejects unrelated JSON", () => {
    expect(recognizeSelectionPayload(JSON.stringify({ foo: 1 }))).toBeNull()
  })

  it("rejects non-JSON text", () => {
    expect(recognizeSelectionPayload("hello world")).toBeNull()
  })

  it("rejects a payload missing bounds", () => {
    expect(recognizeSelectionPayload(JSON.stringify({ data: { layers } }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: FAIL — `recognizeSelectionPayload` is not exported.

- [ ] **Step 3: Add the helper to `useSelection.ts`**

Add near the top of `src/hooks/useSelection.ts`, after the interface declarations (after the `ClipboardData` interface, before `export const useSelection`):

```typescript
/**
 * Parse clipboard text and, if it looks like a gridpaint selection, return the
 * normalized { layers, bounds }. Lenient: accepts the canonical type tag OR any
 * object whose `data` has an array `layers` and a `bounds`. Returns null otherwise.
 */
export function recognizeSelectionPayload(text: string): ClipboardData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null

  const obj = parsed as { type?: unknown; data?: unknown }
  const data = obj.data as { layers?: unknown; bounds?: unknown } | undefined
  if (!data || typeof data !== "object") return null

  const looksRight = Array.isArray(data.layers) && data.bounds != null
  const taggedRight = obj.type === "gridpaint-selection"
  if (!looksRight && !taggedRight) return null
  if (!Array.isArray(data.layers) || data.bounds == null) return null

  return {
    layers: data.layers as ClipboardData["layers"],
    bounds: data.bounds as ClipboardData["bounds"],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSelection.ts src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts
git commit -m "feat: lenient gridpaint-selection clipboard recognizer"
```

---

## Task 2: Copy active-layer-only flag

**Files:**
- Modify: `src/hooks/useSelection.ts` (`copySelection`)

- [ ] **Step 1: Add the `activeLayerOnly` parameter and filter**

In `copySelection`, change the signature and add a layer filter. Replace the
`const copySelection = useCallback(async () => {` line and the
`layersState.layers.forEach((layer) => {` line:

```typescript
  const copySelection = useCallback(async (activeLayerOnly: boolean = false) => {
    if (!selectionStart || !selectionEnd) {
      toast.error("No selection to copy")
      return
    }

    const minX = Math.min(selectionStart.x, selectionEnd.x)
    const minY = Math.min(selectionStart.y, selectionEnd.y)
    const maxX = Math.max(selectionStart.x, selectionEnd.x)
    const maxY = Math.max(selectionStart.y, selectionEnd.y)

    const clipboardData: ClipboardData = {
      layers: [],
      bounds: { minX, minY, maxX, maxY },
    }

    let totalPointsCopied = 0

    const layersToCopy = activeLayerOnly
      ? layersState.layers.filter((l) => l.id === layersState.activeLayerId)
      : layersState.layers

    layersToCopy.forEach((layer) => {
```

(The body inside the `forEach` is unchanged.)

- [ ] **Step 2: Update the dependency array**

Add `layersState.activeLayerId` to the `copySelection` `useCallback` deps:

```typescript
  }, [selectionStart, selectionEnd, layersState.layers, layersState.activeLayerId])
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: PASS (no behavior change to existing tests; confirms `useSelection.ts` still type-checks under vitest's transpile).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSelection.ts
git commit -m "feat: copySelection supports active-layer-only copy"
```

---

## Task 3: Single-layer retarget on bake/cancel

**Files:**
- Modify: `src/hooks/useSelection.ts` (`bakeFloatingPaste`, `cancelFloatingPaste`)

This is the core of cross-layer duplication: when a floating paste came from the
clipboard (not a lift) and contains exactly one layer, drop it onto the active
layer instead of the stored `layerId`.

- [ ] **Step 1: Add a target-layer resolver in `bakeFloatingPaste`**

In `bakeFloatingPaste`, after `const { data, origin, offset } = fp` and before the
`data.layers.forEach(...)` loop, add:

```typescript
    // Single-layer clipboard pastes retarget onto the active layer (cross-layer
    // duplication). Lifted floats and multi-layer clips keep their original layerId.
    const retargetSingleLayer = !fp.lifted && data.layers.length === 1
    const resolveLayerId = (clipLayerId: number) =>
      retargetSingleLayer ? layersState.activeLayerId : clipLayerId
```

Then inside the loop, change the layer lookup. Replace:

```typescript
    data.layers.forEach(({ layerId, groups, pointModifications }) => {
      const layer = layersState.layers.find((l) => l.id === layerId)
      if (!layer) return
```

with:

```typescript
    data.layers.forEach(({ layerId, groups, pointModifications }) => {
      const targetLayerId = resolveLayerId(layerId)
      const layer = layersState.layers.find((l) => l.id === targetLayerId)
      if (!layer) return
```

And change the two `updateGroupPoints(layerId, ...)` / `updatePointModifications(layerId, ...)`
calls in this loop to use `targetLayerId` instead of `layerId`.

- [ ] **Step 2: Apply the same resolver in `cancelFloatingPaste`**

`cancelFloatingPaste` only writes points back when `fp.lifted` is true. A lifted
float is never retargeted, so its restore path is already correct and must keep
using the original `layerId`. **No change needed** in `cancelFloatingPaste` — add
a clarifying comment above its `if (fp.lifted) {` block:

```typescript
    // Lifted floats always restore to their original layerId (never retargeted).
    if (fp.lifted) {
```

- [ ] **Step 3: Update `bakeFloatingPaste` deps**

The deps array already lists `layersState.layers`. Add `layersState.activeLayerId`:

```typescript
  }, [layersState.layers, layersState.activeLayerId])
```

- [ ] **Step 4: Verify compile**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSelection.ts
git commit -m "feat: retarget single-layer paste onto active layer"
```

---

## Task 4: `pasteData` entry point (paste without reading clipboard)

**Files:**
- Modify: `src/hooks/useSelection.ts`

The native-paste dispatcher already has the parsed `ClipboardData`; it should be
able to start a floating paste without `pasteSelection` re-reading the clipboard.
Extract a `pasteData(clipboardData, atGrid)` that sets `floatingPaste`, and make
`pasteSelection` delegate to it.

- [ ] **Step 1: Add `pasteData` and refactor `pasteSelection`**

Add this callback just above `pasteSelection`:

```typescript
  /**
   * Begin a floating paste from already-parsed clipboard data at a grid origin.
   * Bakes any pending float first so we don't lose it.
   */
  const pasteData = useCallback(
    (clipboardData: ClipboardData, atGrid: { x: number; y: number }) => {
      if ($selectionState.get().floatingPaste) bakeFloatingPaste()

      let totalPoints = 0
      clipboardData.layers.forEach(({ groups }) => {
        groups.forEach(({ points }) => {
          totalPoints += points.length
        })
      })

      $selectionState.setKey("floatingPaste", {
        data: clipboardData,
        origin: atGrid,
        offset: { x: 0, y: 0 },
      })

      toast.info(
        `Paste ready — use arrow keys to position, Enter to place, Esc to cancel`,
      )
      return totalPoints
    },
    [bakeFloatingPaste],
  )
```

Then replace the body of `pasteSelection` (after `const targetGrid = getGridCoordinates(...)`)
so it uses the recognizer + `pasteData`:

```typescript
      const targetGrid = getGridCoordinates(clientX, clientY)
      if (!targetGrid) return

      let clipboardText: string
      try {
        clipboardText = await navigator.clipboard.readText()
      } catch (error) {
        console.error("Failed to read clipboard:", error)
        toast.error("Failed to read clipboard")
        return
      }

      const clipboardData = recognizeSelectionPayload(clipboardText)
      if (!clipboardData) {
        toast.error("Nothing to paste")
        return
      }

      pasteData(clipboardData, targetGrid)
```

Update `pasteSelection`'s deps from `[bakeFloatingPaste]` to `[pasteData]`.

- [ ] **Step 2: Export `pasteData` from the hook**

In the returned object of `useSelection`, add `pasteData` next to `pasteSelection`:

```typescript
    pasteSelection,
    pasteData,
```

- [ ] **Step 3: Run existing recognizer tests (regression)**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSelection.ts
git commit -m "refactor: pasteData entry point reused by pasteSelection"
```

---

## Task 5: Shared paste dispatcher (image + gridpaint-JSON)

**Files:**
- Modify: `src/hooks/useImagePaste.ts`

Generalize the existing native-`paste` listener so that, after the image branch,
it tries the gridpaint-JSON branch and calls an injected `onSelectionPaste`
callback. The callback (provided by the canvas) owns positioning + `pasteData`.

- [ ] **Step 1: Add an options param and the JSON branch**

Change the hook signature and add the branch. Replace
`export function useImagePaste() {` and the start of `onPaste`:

```typescript
import { recognizeSelectionPayload } from '@/hooks/useSelection'
import type { ClipboardData } from '@/hooks/useSelection'

interface PasteDispatcherOptions {
  /** Called when a recognized gridpaint selection payload is pasted. */
  onSelectionPaste?: (data: ClipboardData) => void
}

export function useImagePaste(options: PasteDispatcherOptions = {}) {
  const canvasView = useStore($canvasView)
  const imageImport = useStore($imageImport)
  const { onSelectionPaste } = options

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      const imgItem = Array.from(items).find(i => i.type.startsWith('image/'))
      if (imgItem) {
        e.preventDefault()
        // ... existing image handling unchanged ...
        return
      }

      // gridpaint-JSON branch
      const text = e.clipboardData?.getData('text') ?? ''
      const selectionData = recognizeSelectionPayload(text)
      if (selectionData && onSelectionPaste) {
        e.preventDefault()
        onSelectionPaste(selectionData)
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canvasView, imageImport.isActive, onSelectionPaste])
}
```

Move the existing image-handling body (the `try { ... }` block that builds the
bitmap and calls `setImageSource` / `setTransform`) inside the `if (imgItem)`
block, before its `return`. Remove the old standalone
`const imgItem = ...; if (!imgItem) return; e.preventDefault()` lines since they
are now inside the `if (imgItem)` branch.

- [ ] **Step 2: Verify compile / existing behavior**

Run: `pnpm vitest run src/lib/gridpaint/__tests__/recognizeSelectionPayload.test.ts`
Expected: PASS (the dispatcher imports the recognizer; this confirms no circular-import break under vitest).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useImagePaste.ts
git commit -m "feat: shared paste dispatcher handles image and gridpaint-JSON"
```

---

## Task 6: Wire the dispatcher and copy shortcuts in the canvas

**Files:**
- Modify: `src/components/GridPaintCanvas.tsx`
- Modify: `src/App.tsx` (only if `useImagePaste()` is called there — see Step 1)

- [ ] **Step 1: Decide where the dispatcher lives**

`useImagePaste()` is currently called in `src/App.tsx:41`. The `onSelectionPaste`
callback needs `selection.pasteData` + viewport-center grid, which live in
`GridPaintCanvas`. Move the `useImagePaste()` call into `GridPaintCanvas` and remove
it from `App.tsx`.

In `src/App.tsx`, remove the import `useImagePaste` (line ~17) and the
`useImagePaste()` call (line ~41) and its comment.

- [ ] **Step 2: Add the dispatcher call in `GridPaintCanvas`**

Add an import at the top of `GridPaintCanvas.tsx`:

```typescript
import { useImagePaste } from "@/hooks/useImagePaste"
import type { ClipboardData } from "@/hooks/useSelection"
```

Inside the component, after `getGridCoordinates` is defined, add:

```typescript
  // Native-paste dispatcher: gridpaint-JSON floats at viewport center, any tool.
  const handleSelectionPaste = useCallback(
    (data: ClipboardData) => {
      const center =
        getGridCoordinates(window.innerWidth / 2, window.innerHeight / 2) ?? {
          x: 0,
          y: 0,
        }
      selection.pasteData(data, center)
    },
    [getGridCoordinates, selection.pasteData],
  )

  useImagePaste({ onSelectionPaste: handleSelectionPaste })
```

- [ ] **Step 3: Add `cmd+shift+c` and make `cmd+c` active-only**

In the keydown handler, replace the Copy block:

```typescript
      // ── Copy ────────────────────────────────────────────────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.copySelection()
        }
      }
```

with:

```typescript
      // ── Copy ────────────────────────────────────────────────────────────
      // cmd+c copies the active layer only; cmd+shift+c copies all layers.
      if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
        if (currentTool === "select" && selection.hasSelection) {
          e.preventDefault()
          selection.copySelection(!e.shiftKey)
        }
      }
```

- [ ] **Step 4: Remove the `cmd+v` keydown branch**

Delete the entire Paste block:

```typescript
      // ── Paste (enters floating mode at cursor position) ─────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (currentTool === "select") {
          e.preventDefault()
          const { x: mx, y: my } = lastMousePosRef.current
          selection.pasteSelection(mx, my, getGridCoordinates)
        }
      }
```

Then remove now-unused entries from the keydown `useEffect` deps:
`selection.pasteSelection` (the `getGridCoordinates` dep is still used by the
lift-then-move block, so keep it). Add `selection.copySelection` is already present.

- [ ] **Step 5: Build to verify no type errors**

Run: `pnpm build`
Expected: TypeScript compiles; no errors about `pasteSelection`/`lastMousePosRef`
being unused (if `lastMousePosRef` becomes unused elsewhere, leave it — it is still
used by the mouse-move tracking at line ~1157).

- [ ] **Step 6: Commit**

```bash
git add src/components/GridPaintCanvas.tsx src/App.tsx
git commit -m "feat: native JSON paste + active/all-layer copy shortcuts"
```

---

## Task 7: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Run the app**

Run: `pnpm dev`

- [ ] **Step 2: Cross-layer duplication**

1. Select tool, draw on layer 1, make a rectangular selection over it.
2. `cmd+c`. Toast: "Copied N points from 1 layers".
3. Press `2` to switch to layer 2.
4. `cmd+v` (or paste). A floating paste appears; arrow-keys move it; `Enter` bakes.
5. Confirm the content now exists on layer 2 (toggle layer 1 visibility to verify).

- [ ] **Step 3: All-layer copy unchanged**

1. Draw on layers 1 and 2 overlapping the selection.
2. `cmd+shift+c`. Toast mentions 2 layers.
3. Paste → bake. Both layers receive their original content (no collapse).

- [ ] **Step 4: Cross-tab JSON paste robustness**

1. `cmd+c` a selection, open the same app in a second tab.
2. In the second tab, click a panel/button first (so focus is NOT on body), then
   paste. It must still float a paste (previously this silently failed).
3. With a non-select tool active, paste again — it must still work.
4. Paste arbitrary non-gridpaint text — nothing happens (no error toast spam).

- [ ] **Step 5: Lift/move still restores correctly**

1. Select content on the active layer, press an arrow key (lifts + moves).
2. Press `Escape`. Content returns to its **original** layer and position.

- [ ] **Step 6: Commit (if any doc/notes updated)**

No code commit expected; this task is verification only.

---

## Self-review notes

- **Spec coverage:** Part 1 → Task 2 + Task 6 (shortcuts). Part 2 → Task 3 (retarget) + lifted guard (Task 3 Step 2). Part 3 → Tasks 1, 4, 5, 6 (recognizer, pasteData, dispatcher, viewport-center wiring, removal of keydown guards).
- **Type consistency:** `recognizeSelectionPayload(text): ClipboardData | null`, `pasteData(data, atGrid)`, `copySelection(activeLayerOnly?)`, `useImagePaste({ onSelectionPaste })` used consistently across tasks.
- **Viewport center:** reuses `getGridCoordinates(innerWidth/2, innerHeight/2)` rather than duplicating pan/zoom math.
