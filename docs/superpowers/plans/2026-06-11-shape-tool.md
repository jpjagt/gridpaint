# Shape Tool (Rectangle + Ellipse) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shape tool that lets the user drag out a rectangle or ellipse (fill or single-cell edge), then move/resize it as a live floating preview before committing it into the active layer.

**Architecture:** A rasterized shape is just a set of relative `"x,y"` grid cells — identical to `ClipboardData`/`FloatingPaste`. Both rectangle and ellipse are one **superellipse** `|x/a|^n + |y/b|^n ≤ 1`; a per-kind exponent slider controls squircliness (rect ≈ sharp corners, ellipse = round). The shape tool generates that data and rides the existing floating-paste system in `useSelection` (render overlay, move, bake, cancel). We add: a pure `rasterizeShape` module, shape metadata on the float (so resize/slider can re-rasterize), 8 resize handles, an `Alt`-subtract commit path, and a `ShapeOptions` panel with the slider.

**Tech Stack:** React 18 + TypeScript, Nanostores, Canvas2D, Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-11-shape-tool-design.md`

**Test commands:** `pnpm test:run <path>` for a single file, `pnpm test:run` for all. Build check: `pnpm build`.

---

## File Structure

- **Create** `src/lib/gridpaint/rasterizeShape.ts` — pure rasterizer: shape params → relative `"x,y"` cells. Plus `buildShapeClipboard()` helper producing a single-layer/single-group `ClipboardData`.
- **Create** `src/lib/gridpaint/__tests__/rasterizeShape.test.ts` — unit tests.
- **Modify** `src/types/gridpaint.ts` — add `ShapeKind`, `ShapeStyle`, `ShapeMeta` (incl. superellipse `exponent`) types.
- **Modify** `src/stores/ui.ts` — add `"shape"` to `Tool`, `$shapeToolSettings` map (with per-kind exponents + `activeShapeExponent` helper), and `shape?: ShapeMeta` field on `FloatingPaste`.
- **Modify** `src/hooks/useSelection.ts` — add `subtract` support to `bakeFloatingPaste`; add `startShapeFloat()` and `rebuildShapeFloat()` helpers.
- **Modify** `src/hooks/useSelectionRenderer.ts` — draw 8 resize handles when the float carries shape metadata.
- **Modify** `src/components/ToolSelection.tsx` — add the shape toolbar button.
- **Modify** `src/components/ToolOptionsPanel.tsx` — add `ShapeOptions` block + panel guard.
- **Modify** `src/components/GridPaintCanvas.tsx` — `shape` tool mouse handling (rubber-band create, handle resize, body move) + `Alt`-subtract on commit.

---

## Task 1: Shape & style types

**Files:**
- Modify: `src/types/gridpaint.ts`

- [ ] **Step 1: Add types**

Append to `src/types/gridpaint.ts`:

```ts
// === Shape Tool ===

/** Primitive shapes the shape tool can draw */
export type ShapeKind = "rectangle" | "ellipse"

/** fill = every interior cell; edge = single-cell-wide outline */
export type ShapeStyle = "fill" | "edge"

/**
 * Metadata carried by a floating paste when it represents a live shape preview.
 * Width/height are in grid cells (>= 1). The float's cell data is derived from
 * these params via rasterizeShape().
 */
export interface ShapeMeta {
  kind: ShapeKind
  style: ShapeStyle
  width: number
  height: number
  /** Superellipse exponent n in |x/a|^n + |y/b|^n <= 1. */
  exponent: number
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: PASS (no new type errors from this file).

- [ ] **Step 3: Commit**

```bash
git add src/types/gridpaint.ts
git commit -m "feat: add shape tool types"
```

---

## Task 2: rasterizeShape — superellipse fill & edge

**Files:**
- Create: `src/lib/gridpaint/rasterizeShape.ts`
- Test: `src/lib/gridpaint/__tests__/rasterizeShape.test.ts`

Both rectangle and ellipse are one superellipse `|x/a|^n + |y/b|^n <= 1`; the
caller passes the exponent `n`. A high `n` (≈8) fills the whole bbox (a sharp
rectangle); `n=2` is a true ellipse; `n=1` is a diamond.

- [ ] **Step 1: Write failing tests**

Create `src/lib/gridpaint/__tests__/rasterizeShape.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { rasterizeShape } from "@/lib/gridpaint/rasterizeShape"

const sorted = (keys: string[]) => [...keys].sort()

describe("rasterizeShape — rectangle (high exponent)", () => {
  it("fills every cell of the bbox at n=8", () => {
    expect(sorted(rasterizeShape("rectangle", "fill", 4, 4, 8))).toEqual(
      sorted([
        "0,0","1,0","2,0","3,0",
        "0,1","1,1","2,1","3,1",
        "0,2","1,2","2,2","3,2",
        "0,3","1,3","2,3","3,3",
      ]),
    )
  })

  it("1x1 fill is a single cell", () => {
    expect(rasterizeShape("rectangle", "fill", 1, 1, 8)).toEqual(["0,0"])
  })

  it("edge of a full bbox (n=8) equals the rectangle perimeter", () => {
    // 4x3 sharp rect: interior cells (1,1) and (2,1) are omitted
    expect(sorted(rasterizeShape("rectangle", "edge", 4, 3, 8))).toEqual(
      sorted([
        "0,0", "1,0", "2,0", "3,0",
        "0,1", "3,1",
        "0,2", "1,2", "2,2", "3,2",
      ]),
    )
  })

  it("edge of a thin (height<=2) box equals fill", () => {
    expect(sorted(rasterizeShape("rectangle", "edge", 4, 2, 8))).toEqual(
      sorted(rasterizeShape("rectangle", "fill", 4, 2, 8)),
    )
  })
})

describe("rasterizeShape — ellipse (n=2)", () => {
  it("fill is symmetric horizontally and vertically", () => {
    const w = 7, h = 5
    const set = new Set(rasterizeShape("ellipse", "fill", w, h, 2))
    for (const key of set) {
      const [x, y] = key.split(",").map(Number)
      expect(set.has(`${w - 1 - x},${y}`)).toBe(true) // mirror X
      expect(set.has(`${x},${h - 1 - y}`)).toBe(true) // mirror Y
    }
  })

  it("fill omits the corners of a large ellipse", () => {
    const set = new Set(rasterizeShape("ellipse", "fill", 9, 9, 2))
    expect(set.has("0,0")).toBe(false)
    expect(set.has("8,0")).toBe(false)
    expect(set.has("4,4")).toBe(true) // center filled
  })

  it("edge cells are a subset of fill cells", () => {
    const fill = new Set(rasterizeShape("ellipse", "fill", 9, 7, 2))
    const edge = rasterizeShape("ellipse", "edge", 9, 7, 2)
    for (const key of edge) expect(fill.has(key)).toBe(true)
  })

  it("edge has no filled interior (center cell absent for a large ellipse)", () => {
    const edge = new Set(rasterizeShape("ellipse", "edge", 11, 11, 2))
    expect(edge.has("5,5")).toBe(false)
  })

  it("thin ellipse (height<=2) falls back to fill", () => {
    expect(rasterizeShape("ellipse", "edge", 6, 2, 2).sort()).toEqual(
      rasterizeShape("ellipse", "fill", 6, 2, 2).sort(),
    )
  })
})

describe("rasterizeShape — exponent controls squircliness", () => {
  it("higher exponent fills strictly more cells than a lower one", () => {
    const lo = new Set(rasterizeShape("ellipse", "fill", 9, 9, 2)) // ellipse
    const hi = new Set(rasterizeShape("ellipse", "fill", 9, 9, 8)) // near-rect
    // ellipse omits corners; near-rect includes them
    expect(lo.has("0,0")).toBe(false)
    expect(hi.has("0,0")).toBe(true)
    expect(hi.size).toBeGreaterThan(lo.size)
  })

  it("n=1 is a diamond (corners and edge-midpoints differ)", () => {
    const set = new Set(rasterizeShape("ellipse", "fill", 9, 9, 1))
    expect(set.has("0,0")).toBe(false)   // corner empty
    expect(set.has("4,0")).toBe(true)    // top-middle filled
    expect(set.has("0,4")).toBe(true)    // left-middle filled
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test:run src/lib/gridpaint/__tests__/rasterizeShape.test.ts`
Expected: FAIL — cannot find module `rasterizeShape`.

- [ ] **Step 3: Implement the superellipse rasterizer**

Create `src/lib/gridpaint/rasterizeShape.ts`:

```ts
import type { ShapeKind, ShapeStyle } from "@/types/gridpaint"

/**
 * Rasterize a superellipse into relative grid-cell keys ("x,y"), bbox top-left
 * at (0,0). width/height are in grid cells (clamped >= 1). `exponent` is the
 * superellipse n: ~8 ⇒ sharp rectangle, 2 ⇒ true ellipse, 1 ⇒ diamond.
 * `kind` is accepted for call-site clarity but does not change the math — only
 * the exponent does (the caller picks the kind-appropriate default exponent).
 */
export function rasterizeShape(
  _kind: ShapeKind,
  style: ShapeStyle,
  width: number,
  height: number,
  exponent: number,
): string[] {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const n = Math.max(1, exponent)

  const fill = superellipseFillCells(w, h, n)
  if (style === "fill") return [...fill]

  // Degenerate thin shape: nothing meaningful to outline → return the fill.
  if (w <= 2 || h <= 2) return [...fill]

  // Edge = fill minus fill eroded by one cell: a fill cell is on the edge if any
  // of its 4-neighbours is not filled. Connected, 1-cell-wide, subset of fill.
  const edge: string[] = []
  for (const key of fill) {
    const [x, y] = key.split(",").map(Number)
    const interior =
      fill.has(`${x - 1},${y}`) &&
      fill.has(`${x + 1},${y}`) &&
      fill.has(`${x},${y - 1}`) &&
      fill.has(`${x},${y + 1}`)
    if (!interior) edge.push(key)
  }
  return edge
}

/** Cells whose center satisfies |nx|^n + |ny|^n <= 1 for the w×h bbox. */
function superellipseFillCells(w: number, h: number, n: number): Set<string> {
  const a = w / 2
  const b = h / 2
  const cells = new Set<string>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x + 0.5 - a) / a)
      const ny = Math.abs((y + 0.5 - b) / b)
      if (Math.pow(nx, n) + Math.pow(ny, n) <= 1) cells.add(`${x},${y}`)
    }
  }
  return cells
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test:run src/lib/gridpaint/__tests__/rasterizeShape.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gridpaint/rasterizeShape.ts src/lib/gridpaint/__tests__/rasterizeShape.test.ts
git commit -m "feat: rasterizeShape superellipse fill/edge with exponent"
```

---

## Task 3: buildShapeClipboard helper

**Files:**
- Modify: `src/lib/gridpaint/rasterizeShape.ts`
- Test: `src/lib/gridpaint/__tests__/rasterizeShape.test.ts`

- [ ] **Step 1: Add failing test**

Append to `rasterizeShape.test.ts`:

```ts
import { buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"

describe("buildShapeClipboard", () => {
  it("wraps cells as a single-layer/single-group ClipboardData with bbox bounds", () => {
    const clip = buildShapeClipboard("rectangle", "fill", 3, 2, 8, 5, "g1")
    expect(clip.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 })
    expect(clip.layers).toHaveLength(1)
    expect(clip.layers[0].layerId).toBe(5)
    expect(clip.layers[0].groups).toHaveLength(1)
    expect(clip.layers[0].groups[0].id).toBe("g1")
    expect(clip.layers[0].groups[0].points.sort()).toEqual(
      ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1"].sort(),
    )
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test:run src/lib/gridpaint/__tests__/rasterizeShape.test.ts`
Expected: FAIL — `buildShapeClipboard` not exported.

- [ ] **Step 3: Implement buildShapeClipboard**

Add to `src/lib/gridpaint/rasterizeShape.ts` (add the import at top):

```ts
import type { ClipboardData } from "@/hooks/useSelection"
```

```ts
/**
 * Build a single-layer/single-group ClipboardData from shape params, targeting
 * the given layerId/groupId. Bounds cover the full bbox (origin 0,0).
 */
export function buildShapeClipboard(
  kind: ShapeKind,
  style: ShapeStyle,
  width: number,
  height: number,
  exponent: number,
  layerId: number,
  groupId: string,
): ClipboardData {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const points = rasterizeShape(kind, style, w, h, exponent)
  return {
    layers: [{ layerId, groups: [{ id: groupId, points }] }],
    bounds: { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 },
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm test:run src/lib/gridpaint/__tests__/rasterizeShape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gridpaint/rasterizeShape.ts src/lib/gridpaint/__tests__/rasterizeShape.test.ts
git commit -m "feat: buildShapeClipboard helper"
```

---

## Task 4: Store — shape tool registration & settings

**Files:**
- Modify: `src/stores/ui.ts`

- [ ] **Step 1: Add tool + settings + float metadata**

In `src/stores/ui.ts`:

a) Add `"shape"` to the `Tool` union:

```ts
export type Tool = "draw" | "erase" | "pan" | "select" | "cutout" | "override" | "measure" | "export" | "shape"
```

b) Add the import for shape types (extend the existing gridpaint import):

```ts
import type { CutoutAnchor, QuadrantState, ShapeKind, ShapeStyle, ShapeMeta } from '@/types/gridpaint'
```

c) Add the settings store (place after `$cutoutToolSettings` or near `$overrideToolSettings`):

```ts
// === Shape tool settings ===

export interface ShapeToolSettings {
  shape: ShapeKind
  style: ShapeStyle
  /** Superellipse exponent per kind so each remembers its own slider value. */
  rectExponent: number    // default 8 (sharp corners); lower = rounder (min 3)
  ellipseExponent: number // default 2 (true ellipse); 1 = diamond, up to 6 boxy
}

export const $shapeToolSettings = map<ShapeToolSettings>({
  shape: "rectangle",
  style: "fill",
  rectExponent: 8,
  ellipseExponent: 2,
})
```

Helper used by both panel and canvas to pick the active exponent:

```ts
export const activeShapeExponent = (s: ShapeToolSettings): number =>
  s.shape === "rectangle" ? s.rectExponent : s.ellipseExponent
```

d) Add the optional `shape` field to the `FloatingPaste` interface (after the `lifted?` field):

```ts
  /**
   * When present, this float is a live shape preview. Its `data` cells are
   * derived from these params via rasterizeShape; editing them re-rasterizes.
   */
  shape?: ShapeMeta
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: PASS (no new errors). `ShapeKind`/`ShapeStyle`/`ShapeMeta` now imported and used.

- [ ] **Step 3: Commit**

```bash
git add src/stores/ui.ts
git commit -m "feat: register shape tool, settings store, float shape metadata"
```

---

## Task 5: bakeFloatingPaste — Alt-subtract support

**Files:**
- Modify: `src/hooks/useSelection.ts`

- [ ] **Step 1: Add a `subtract` param to bakeFloatingPaste**

In `src/hooks/useSelection.ts`, change the `bakeFloatingPaste` callback signature and its add/remove logic. Replace the callback definition:

```ts
  const bakeFloatingPaste = useCallback((subtract: boolean = false) => {
    const fp = $selectionState.get().floatingPaste
    if (!fp) return

    const { data, origin, offset } = fp
    const targetX = origin.x + offset.x
    const targetY = origin.y + offset.y

    let totalPointsPasted = 0

    const retargetSingleLayer =
      !fp.lifted && data.layers.length === 1 && layersState.activeLayerId != null
    const resolveLayerId = (clipLayerId: number): number =>
      retargetSingleLayer ? layersState.activeLayerId! : clipLayerId

    data.layers.forEach(({ layerId, groups, pointModifications }) => {
      const targetLayerId = resolveLayerId(layerId)
      const layer = layersState.layers.find((l) => l.id === targetLayerId)
      if (!layer) return

      groups.forEach((clipGroup) => {
        const targetGroup = layer.groups.find((g) => g.id === clipGroup.id) ?? layer.groups[0]
        if (!targetGroup) return

        const newPoints = new Set<string>(targetGroup.points)

        clipGroup.points.forEach((relativeKey: string) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          if (subtract) {
            newPoints.delete(absKey)
          } else {
            newPoints.add(absKey)
            totalPointsPasted++
          }
        })

        updateGroupPoints(targetLayerId, newPoints, targetGroup.id)
      })

      // Point modifications are only meaningful for additive pastes.
      if (pointModifications && !subtract) {
        Object.entries(pointModifications).forEach(([relativeKey, mod]) => {
          const [relativeX, relativeY] = relativeKey.split(",").map(Number)
          const absKey = `${targetX + relativeX},${targetY + relativeY}`
          updatePointModifications(targetLayerId, absKey, mod)
        })
      }
    })

    $selectionState.setKey("floatingPaste", null)
    toast.success(subtract ? `Subtracted shape` : `Placed ${totalPointsPasted} points`)
  }, [layersState.layers, layersState.activeLayerId])
```

- [ ] **Step 2: Verify existing callers still type-check**

Run: `pnpm build`
Expected: PASS — `subtract` defaults to `false`, so existing `bakeFloatingPaste()` calls are unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSelection.ts
git commit -m "feat: bakeFloatingPaste supports Alt-subtract"
```

---

## Task 6: useSelection — startShapeFloat & rebuildShapeFloat

**Files:**
- Modify: `src/hooks/useSelection.ts`

- [ ] **Step 1: Add the two helpers**

In `src/hooks/useSelection.ts`:

a) Add imports at top (extend existing imports):

```ts
import { $shapeToolSettings, activeShapeExponent } from "@/stores/ui"
import { buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"
import type { ShapeMeta } from "@/types/gridpaint"
```

b) Add the helpers near `pasteData` (they need access to `layersState`, so define them inside the hook body as `useCallback`s). Insert after `moveFloatingPaste`:

```ts
  /**
   * Create a shape float at a grid origin (top-left), using the current
   * $shapeToolSettings and the given size in cells. Targets the active layer's
   * active group at bake time (single-layer retarget).
   */
  const startShapeFloat = useCallback(
    (origin: { x: number; y: number }, width: number, height: number) => {
      if ($selectionState.get().floatingPaste) bakeFloatingPaste()
      const { activeLayerId, layers } = layersState
      if (activeLayerId == null) return
      const layer = layers.find((l) => l.id === activeLayerId)
      if (!layer) return
      const groupId = layer.groups[0]?.id ?? "default"
      const settings = $shapeToolSettings.get()
      const { shape, style } = settings
      const exponent = activeShapeExponent(settings)
      const w = Math.max(1, Math.round(width))
      const h = Math.max(1, Math.round(height))

      $selectionState.setKey("floatingPaste", {
        data: buildShapeClipboard(shape, style, w, h, exponent, activeLayerId, groupId),
        origin,
        offset: { x: 0, y: 0 },
        shape: { kind: shape, style, width: w, height: h, exponent },
      })
    },
    [bakeFloatingPaste, layersState],
  )

  /**
   * Re-derive the active shape float's cells after a param change (kind, style,
   * size). Optionally shift the origin (used when dragging the NW/N/W handles so
   * the opposite edge stays anchored).
   */
  const rebuildShapeFloat = useCallback(
    (
      patch: Partial<ShapeMeta>,
      originDelta: { x: number; y: number } = { x: 0, y: 0 },
    ) => {
      const fp = $selectionState.get().floatingPaste
      if (!fp || !fp.shape) return
      const next: ShapeMeta = {
        ...fp.shape,
        ...patch,
        width: Math.max(1, Math.round(patch.width ?? fp.shape.width)),
        height: Math.max(1, Math.round(patch.height ?? fp.shape.height)),
      }
      // Keep targeting whatever layer/group the float already had.
      const layerId = fp.data.layers[0]?.layerId ?? 0
      const groupId = fp.data.layers[0]?.groups[0]?.id ?? "default"

      $selectionState.setKey("floatingPaste", {
        ...fp,
        shape: next,
        origin: { x: fp.origin.x + originDelta.x, y: fp.origin.y + originDelta.y },
        data: buildShapeClipboard(
          next.kind,
          next.style,
          next.width,
          next.height,
          next.exponent,
          layerId,
          groupId,
        ),
      })
    },
    [],
  )
```

c) Export both from the hook's return object (add to the returned object alongside `pasteData`, `moveFloatingPaste`, `bakeFloatingPaste`, etc.):

```ts
    startShapeFloat,
    rebuildShapeFloat,
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSelection.ts
git commit -m "feat: startShapeFloat and rebuildShapeFloat helpers"
```

---

## Task 7: Toolbar button

**Files:**
- Modify: `src/components/ToolSelection.tsx`

- [ ] **Step 1: Add the shape tool button**

In `src/components/ToolSelection.tsx`:

a) Add `Square` to the lucide import:

```ts
import { Brush, Eraser, Hand, MousePointer, Circle, Layers, Ruler, BoxSelect, Square } from "lucide-react"
```

b) Add an entry to the `tools` array (after `override`, before `measure` is fine):

```ts
    { id: "shape" as const, icon: Square, label: "Shape", shortcut: "R" },
```

- [ ] **Step 2: Verify it compiles & renders**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ToolSelection.tsx
git commit -m "feat: shape tool toolbar button"
```

---

## Task 8: ShapeOptions panel

**Files:**
- Modify: `src/components/ToolOptionsPanel.tsx`

- [ ] **Step 1: Update the panel guard to include the shape tool**

In `ToolOptionsPanel`, add `$shapeToolSettings` to the imports from `@/stores/ui`:

```ts
import {
  $currentTool,
  $cutoutToolSettings,
  $overrideToolSettings,
  $selectionState,
  $shapeToolSettings,
} from "@/stores/ui"
```

(Additional imports for the `ShapeOptions` component are listed in Step 3.)

Update the early-return guard:

```ts
  if (
    currentTool !== "cutout" &&
    currentTool !== "override" &&
    currentTool !== "export" &&
    currentTool !== "shape" &&
    !hasFloatingPaste
  ) {
    return null
  }
```

- [ ] **Step 2: Render ShapeOptions in the panel body**

Inside the returned `<div>`, add a branch (after the override branch, before export). It must also read the floating paste so it can show W×H when a shape float is active:

```tsx
      {!hasFloatingPaste && currentTool === "shape" && (
        <ShapeOptions floatingPaste={null} />
      )}
      {hasFloatingPaste && selectionState.floatingPaste?.shape && (
        <ShapeOptions floatingPaste={selectionState.floatingPaste} />
      )}
```

Note: the existing `{hasFloatingPaste && <FloatingPasteHint />}` line stays; for a
shape float both the hint and the shape options render together.

- [ ] **Step 3: Implement the ShapeOptions component**

Add at the bottom of `src/components/ToolOptionsPanel.tsx`. It imports the rebuild through the store by re-deriving the float; since `rebuildShapeFloat` lives in the hook, the panel instead writes settings to `$shapeToolSettings` and directly rewrites the float using `buildShapeClipboard` (same logic), keeping the panel dependency-free of React hooks:

Add these imports near the top of the file (note `FloatingPaste` lives in
`@/stores/ui`, not `@/types/gridpaint`):

```tsx
import { activeShapeExponent } from "@/stores/ui"
import { buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"
import type { ShapeKind, ShapeStyle } from "@/types/gridpaint"
import type { FloatingPaste } from "@/stores/ui"
```

(`$shapeToolSettings` and `$selectionState` are already imported in Step 1.)

Then the component:

```tsx
function ShapeOptions({ floatingPaste }: { floatingPaste: FloatingPaste | null }) {
  const settings = useStore($shapeToolSettings)

  // When a shape float is live, the controls reflect the shape being edited;
  // otherwise they reflect the persisted tool settings.
  const kind = floatingPaste?.shape?.kind ?? settings.shape
  const style = floatingPaste?.shape?.style ?? settings.style
  const exponent =
    floatingPaste?.shape?.exponent ?? activeShapeExponent(settings)

  // Slider range + label depend on the kind.
  const sliderRange = kind === "rectangle" ? { min: 3, max: 8 } : { min: 1, max: 6 }
  const sliderLabel = kind === "rectangle" ? "corners" : "squircle"

  /** Rewrite the live float (if any) after a param change. */
  const rebuild = (
    patch: Partial<{ kind: ShapeKind; style: ShapeStyle; width: number; height: number; exponent: number }>,
  ) => {
    const fp = $selectionState.get().floatingPaste
    if (!fp || !fp.shape) return
    const next = {
      kind: patch.kind ?? fp.shape.kind,
      style: patch.style ?? fp.shape.style,
      width: Math.max(1, Math.round(patch.width ?? fp.shape.width)),
      height: Math.max(1, Math.round(patch.height ?? fp.shape.height)),
      exponent: patch.exponent ?? fp.shape.exponent,
    }
    const layerId = fp.data.layers[0]?.layerId ?? 0
    const groupId = fp.data.layers[0]?.groups[0]?.id ?? "default"
    $selectionState.setKey("floatingPaste", {
      ...fp,
      shape: next,
      data: buildShapeClipboard(
        next.kind, next.style, next.width, next.height, next.exponent, layerId, groupId,
      ),
    })
  }

  const setKind = (k: ShapeKind) => {
    $shapeToolSettings.setKey("shape", k)
    // Switching kind also switches to that kind's stored exponent.
    const exp = k === "rectangle" ? settings.rectExponent : settings.ellipseExponent
    rebuild({ kind: k, exponent: exp })
  }
  const setStyle = (s: ShapeStyle) => {
    $shapeToolSettings.setKey("style", s)
    rebuild({ style: s })
  }
  const setExponent = (n: number) => {
    // Persist into the per-kind slot so each kind remembers its own value.
    $shapeToolSettings.setKey(kind === "rectangle" ? "rectExponent" : "ellipseExponent", n)
    rebuild({ exponent: n })
  }

  const seg = (active: boolean) =>
    cn(
      "text-xs font-mono px-2 py-1 transition-colors",
      active ? "bg-foreground text-background" : "bg-transparent text-muted-foreground hover:text-foreground",
    )

  return (
    <div className='flex items-center gap-3'>
      {/* Shape kind */}
      <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
        {(["rectangle", "ellipse"] as ShapeKind[]).map((k) => (
          <button key={k} type='button' onClick={() => setKind(k)} className={seg(kind === k)}>
            {k === "rectangle" ? "Rect" : "Ellipse"}
          </button>
        ))}
      </div>

      <div className='w-px h-5 bg-border' />

      {/* Style */}
      <div className='flex gap-0.5 border border-border rounded overflow-hidden'>
        {(["fill", "edge"] as ShapeStyle[]).map((s) => (
          <button key={s} type='button' onClick={() => setStyle(s)} className={seg(style === s)}>
            {s}
          </button>
        ))}
      </div>

      <div className='w-px h-5 bg-border' />

      {/* Squircliness slider — range/label switch by kind, same position */}
      <label className='flex items-center gap-1.5 text-xs font-mono text-muted-foreground select-none'>
        {sliderLabel}
        <input
          type='range'
          min={sliderRange.min}
          max={sliderRange.max}
          step={0.1}
          value={exponent}
          onChange={(e) => setExponent(parseFloat(e.target.value))}
          className='w-24 accent-foreground'
        />
      </label>

      {/* Size — only when a shape float is live */}
      {floatingPaste?.shape && (
        <>
          <div className='w-px h-5 bg-border' />
          <div className='flex items-center gap-2'>
            {(["width", "height"] as const).map((dim) => (
              <label key={dim} className='flex items-center gap-1 text-xs font-mono text-muted-foreground'>
                {dim === "width" ? "W" : "H"}
                <input
                  type='number'
                  min={1}
                  value={floatingPaste.shape![dim]}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) rebuild({ [dim]: Math.max(1, v) })
                  }}
                  className='w-14 bg-muted/50 text-xs text-foreground border border-border rounded px-1.5 py-0.5 font-mono'
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

Note: when no float is live, the slider still edits the persisted per-kind
exponent (via `setExponent` → `$shapeToolSettings`), so the next shape drawn uses
it; `rebuild` simply no-ops because there's no float yet.

- [ ] **Step 4: Verify it compiles & renders**

Run: `pnpm build`
Expected: PASS. Then `pnpm dev`, select the shape tool — the panel shows Rect/Ellipse + fill/edge toggles and the squircliness slider (range/label switching by kind).

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolOptionsPanel.tsx
git commit -m "feat: ShapeOptions panel (kind/style toggles, squircliness slider, W/H inputs)"
```

---

## Task 9: Resize-handle rendering

**Files:**
- Modify: `src/hooks/useSelectionRenderer.ts`

- [ ] **Step 1: Draw 8 handles when the float carries shape metadata**

In `renderFloatingPaste` (in `src/hooks/useSelectionRenderer.ts`), after the dashed
bounding rectangle is drawn (just before `ctx.restore()`), add handle rendering.
The 8 handles sit at the bbox corners and edge midpoints. Add this block, using the
`boundsMinX/Y/MaxX/Y` already computed in that function:

```ts
    // Resize handles — only for shape floats.
    if (floatingPaste.shape && boundsMinX !== Infinity) {
      const handleColor = getCanvasColor("--canvas-outline-active")
      const x0 = boundsMinX * gs
      const y0 = boundsMinY * gs
      const x1 = (boundsMaxX + 1) * gs
      const y1 = (boundsMaxY + 1) * gs
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const size = 8 / canvasView.zoom // screen-constant handle size
      const half = size / 2
      const positions: [number, number][] = [
        [x0, y0], [cx, y0], [x1, y0],
        [x0, cy],           [x1, cy],
        [x0, y1], [cx, y1], [x1, y1],
      ]
      ctx.fillStyle = handleColor
      for (const [hx, hy] of positions) {
        ctx.fillRect(hx - half, hy - half, size, size)
      }
    }
```

- [ ] **Step 2: Verify it compiles & renders**

Run: `pnpm build` then `pnpm dev`. (Handles will appear once Task 11 wires up
shape-float creation; if you want to eyeball now, you can temporarily paste a
selection — handles only draw when `floatingPaste.shape` is set, so they won't
show for a plain paste, which is correct.)
Expected: PASS build.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSelectionRenderer.ts
git commit -m "feat: render resize handles for shape floats"
```

---

## Task 10: Canvas — shape tool create / move / resize

**Files:**
- Modify: `src/components/GridPaintCanvas.tsx`

This is the integration task. It has no unit test (canvas/pointer interaction); it
is validated manually in Task 11.

- [ ] **Step 1: Add refs and helpers for shape interaction**

Near the other `useRef`s at the top of the component, add:

```ts
  // Shape tool: rubber-band drag (before a float exists)
  const shapeDragStartRef = useRef<{ x: number; y: number } | null>(null)
  const shapeDragEndRef = useRef<{ x: number; y: number } | null>(null)
  // Shape tool: active resize gesture on an existing float
  const shapeResizeRef = useRef<{
    handle: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se"
    // fixed (anchored) grid corner in absolute coords
    fixed: { x: number; y: number }
  } | null>(null)
```

Add a hit-test helper (place with other `useCallback`s). It returns which handle,
if any, a screen point is over, given the current shape float:

```ts
  const hitShapeHandle = useCallback(
    (clientX: number, clientY: number) => {
      const fp = $selectionState.get().floatingPaste
      if (!fp?.shape) return null
      const view = $canvasView.get()
      const gs = view.gridSize
      const baseX = fp.origin.x + fp.offset.x
      const baseY = fp.origin.y + fp.offset.y
      const w = fp.shape.width
      const h = fp.shape.height
      // bbox in screen space
      const toScreenX = (gx: number) => gx * gs * view.zoom + view.panOffset.x
      const toScreenY = (gy: number) => gy * gs * view.zoom + view.panOffset.y
      const x0 = toScreenX(baseX)
      const y0 = toScreenY(baseY)
      const x1 = toScreenX(baseX + w)
      const y1 = toScreenY(baseY + h)
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const handles: { id: "nw"|"n"|"ne"|"w"|"e"|"sw"|"s"|"se"; x: number; y: number }[] = [
        { id: "nw", x: x0, y: y0 }, { id: "n", x: cx, y: y0 }, { id: "ne", x: x1, y: y0 },
        { id: "w", x: x0, y: cy },                              { id: "e", x: x1, y: cy },
        { id: "sw", x: x0, y: y1 }, { id: "s", x: cx, y: y1 }, { id: "se", x: x1, y: y1 },
      ]
      const r = 10 // px hit radius
      for (const hnd of handles) {
        if (Math.abs(clientX - hnd.x) <= r && Math.abs(clientY - hnd.y) <= r) return hnd.id
      }
      return null
    },
    [],
  )
```

- [ ] **Step 2: Wire mousedown for the shape tool**

In the `handleMouseDown` callback, add a `currentTool === "shape"` branch (place it
alongside the other tool branches, e.g. after the `select` branch). Logic:

```ts
      } else if (currentTool === "shape") {
        const fp = $selectionState.get().floatingPaste
        if (fp?.shape) {
          // Existing float: handle resize or body-move
          const handle = hitShapeHandle(e.clientX, e.clientY)
          if (handle) {
            // Compute the anchored (fixed) corner = opposite of the dragged handle.
            const baseX = fp.origin.x + fp.offset.x
            const baseY = fp.origin.y + fp.offset.y
            const w = fp.shape.width
            const h = fp.shape.height
            const left = baseX, right = baseX + w
            const top = baseY, bottom = baseY + h
            const fixedX = handle.includes("w") ? right : handle.includes("e") ? left : left
            const fixedY = handle.includes("n") ? bottom : handle.includes("s") ? top : top
            shapeResizeRef.current = { handle, fixed: { x: fixedX, y: fixedY } }
          } else {
            // Body move: reuse the floating-paste move-drag machinery used by select.
            const grid = getGridCoordinates(e.clientX, e.clientY)
            if (grid) {
              moveDragStartRef.current = { x: grid.x, y: grid.y }
            }
          }
        } else {
          // No float yet: begin rubber-band create drag.
          const grid = getGridCoordinates(e.clientX, e.clientY)
          if (grid) {
            shapeDragStartRef.current = grid
            shapeDragEndRef.current = grid
          }
        }
      }
```

Note: `moveDragStartRef` is the existing ref used by the `select` tool to drag a
float. Confirm its name in the file; if it differs, use the existing one. The
existing mousemove handler for `select` already moves the float when
`moveDragStartRef.current` is set — reuse that same code path so shape floats move
identically.

- [ ] **Step 3: Wire mousemove for the shape tool**

In the `handleMouseMove` callback add a `currentTool === "shape"` branch:

```ts
        } else if (currentTool === "shape") {
          if (shapeResizeRef.current) {
            // Resizing: recompute width/height from the dragged pointer vs fixed corner.
            const grid = getGridCoordinates(e.clientX, e.clientY)
            if (grid) {
              const fixed = shapeResizeRef.current.fixed
              const newLeft = Math.min(fixed.x, grid.x)
              const newTop = Math.min(fixed.y, grid.y)
              const newRight = Math.max(fixed.x, grid.x)
              const newBottom = Math.max(fixed.y, grid.y)
              const newW = Math.max(1, newRight - newLeft)
              const newH = Math.max(1, newBottom - newTop)
              const fp = $selectionState.get().floatingPaste
              if (fp?.shape) {
                // Move origin to the new top-left, reset offset to 0, rebuild cells.
                const layerId = fp.data.layers[0]?.layerId ?? 0
                const groupId = fp.data.layers[0]?.groups[0]?.id ?? "default"
                $selectionState.setKey("floatingPaste", {
                  ...fp,
                  origin: { x: newLeft, y: newTop },
                  offset: { x: 0, y: 0 },
                  shape: { ...fp.shape, width: newW, height: newH },
                  data: buildShapeClipboard(fp.shape.kind, fp.shape.style, newW, newH, fp.shape.exponent, layerId, groupId),
                })
              }
            }
          } else if (moveDragStartRef.current) {
            // Body move handled by the shared select move path (see select branch).
            // Fall through to the same logic the select tool uses.
            const grid = getGridCoordinates(e.clientX, e.clientY)
            if (grid) {
              const dx = grid.x - moveDragStartRef.current.x
              const dy = grid.y - moveDragStartRef.current.y
              if (dx !== 0 || dy !== 0) {
                selection.moveFloatingPaste(dx, dy)
                moveDragStartRef.current = { x: grid.x, y: grid.y }
              }
            }
          } else if (shapeDragStartRef.current) {
            // Rubber-band create drag: update the live box.
            const grid = getGridCoordinates(e.clientX, e.clientY)
            if (grid) shapeDragEndRef.current = grid
          }
        }
```

Add the import for `buildShapeClipboard` at the top of `GridPaintCanvas.tsx`:

```ts
import { buildShapeClipboard } from "@/lib/gridpaint/rasterizeShape"
```

- [ ] **Step 4: Wire mouseup for the shape tool**

In `handleMouseUp` add:

```ts
      if (currentTool === "shape") {
        if (shapeResizeRef.current) {
          shapeResizeRef.current = null
        } else if (moveDragStartRef.current) {
          moveDragStartRef.current = null
        } else if (shapeDragStartRef.current && shapeDragEndRef.current) {
          const a = shapeDragStartRef.current
          const b = shapeDragEndRef.current
          const left = Math.min(a.x, b.x)
          const top = Math.min(a.y, b.y)
          const w = Math.abs(b.x - a.x) + 1
          const h = Math.abs(b.y - a.y) + 1
          selection.startShapeFloat({ x: left, y: top }, w, h)
        }
        shapeDragStartRef.current = null
        shapeDragEndRef.current = null
      }
```

- [ ] **Step 5: Render the live rubber-band box while creating**

In the render effect, where the selection rectangle / export rects are drawn, add a
branch to draw the in-progress shape box (before a float exists). Near the existing
`if (currentTool === "select" && ...) renderSelectionRectangle(...)` call, add:

```ts
    if (
      currentTool === "shape" &&
      !selectionState.floatingPaste &&
      shapeDragStartRef.current &&
      shapeDragEndRef.current &&
      renderer
    ) {
      renderSelectionRectangle(
        renderer,
        shapeDragStartRef.current,
        shapeDragEndRef.current,
        canvasView,
      )
    }
```

(The existing `if (selectionState.floatingPaste && renderer) renderFloatingPaste(...)`
call already renders the shape float + handles once it exists.)

- [ ] **Step 6: Alt-subtract on commit (Enter and click-away)**

The Enter-to-commit path lives in the keyboard handler. Find the
`if (e.key === "Enter")` block that calls `selection.bakeFloatingPaste()` and change
it to thread the Alt key:

```ts
        if (e.key === "Enter") {
          e.preventDefault()
          selection.bakeFloatingPaste(e.altKey)
          return
        }
```

If there is a click-away / outside-click commit for floats, pass `e.altKey` there
too. If commit-on-mousedown-outside doesn't exist, Enter is sufficient (the spec
requires Alt-subtract; Enter-with-Alt satisfies it).

- [ ] **Step 7: Ensure switching away from the shape tool clears transient drag state**

In the `handleSelect`-equivalent or a `useEffect` keyed on `currentTool`, clear the
refs when leaving the shape tool so a stale rubber-band doesn't persist:

```ts
  useEffect(() => {
    if (currentTool !== "shape") {
      shapeDragStartRef.current = null
      shapeDragEndRef.current = null
      shapeResizeRef.current = null
    }
  }, [currentTool])
```

- [ ] **Step 8: Verify it compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/GridPaintCanvas.tsx
git commit -m "feat: shape tool canvas interaction (create/move/resize/commit)"
```

---

## Task 11: Full manual verification

**Files:** none (manual QA).

- [ ] **Step 1: Run the app**

Run: `pnpm dev` and open the editor with a drawing.

- [ ] **Step 2: Walk the checklist**

Verify each:
- Select the shape tool (toolbar button or `R`). Panel shows Rect/Ellipse + fill/edge.
- **Rectangle fill:** drag a box → floating preview with 8 handles appears.
- Drag the body → it moves. Arrow keys → it moves. Shift+arrows → ×10.
- Drag each of the 8 handles → resizes correctly; opposite edge stays anchored.
- Edit W and H inputs in the panel → preview resizes.
- Switch to **Ellipse** in the panel while floating → preview updates to an oval.
- Switch **fill → edge** → preview becomes a 1-cell outline.
- With **Rectangle** selected, drag the squircliness slider (range 3–8) → corners
  round off as it lowers. Switch to **Ellipse**: slider becomes range 1–6, and at
  the low end the preview becomes a diamond, mid an ellipse, high near-rect.
- Switch Rect↔Ellipse repeatedly → each remembers its own slider value.
- **Enter** → committed cells appear on the active layer/group and render through the blob engine.
- Repeat, press **Esc** → preview discarded, nothing committed.
- Draw a shape overlapping existing cells, hold **Alt** + press **Enter** → those cells are removed (subtract).
- Switch to another tool mid-drag → no stale rubber-band remains.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test:run`
Expected: PASS (no regressions; new `rasterizeShape` tests green).

- [ ] **Step 4: Final commit (if any QA fixes were needed)**

```bash
git add -A
git commit -m "fix: shape tool QA adjustments"
```
(Skip if nothing changed.)

---

## Notes for the implementer

- **Reuse over rebuild:** the shape float IS a floating paste. Move, arrow-keys,
  Enter, Esc all already work via `useSelection` + the canvas keyboard handler.
  Don't duplicate that logic.
- **Ref names:** `moveDragStartRef` is the existing ref the `select` tool uses to
  drag a float. Confirm the exact name when editing `GridPaintCanvas.tsx`
  (search for the select move-drag code) and reuse it; the plan assumes that name.
- **Single-layer retarget:** because the shape clipboard has exactly one layer and
  is not `lifted`, `bakeFloatingPaste` retargets it onto the active layer's active
  group automatically — matching the spec's commit target.
```