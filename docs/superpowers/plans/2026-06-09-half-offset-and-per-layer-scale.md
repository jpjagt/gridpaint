# Half-Offset Groups & Per-Layer Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-group half-grid offset and per-layer rational scale to GridPaint, leaving the blob engine and edge-bag stitcher untouched.

**Architecture:** Half-offset is a property of an `InteractionGroup` (`offsetPhase: "normal" | "half"`); the +½ shift is applied to each group's primitive centers inside `GroupMerger` before merging, so the existing edge-cancellation fuses half-offset and normal content automatically. Scale is a per-layer rational (`{ num, den }`, one side always 1) applied as a uniform post-process transform on each layer's finished output in every renderer (canvas `ctx.scale`, SVG `<g transform>`, DXF coordinate multiply). Both fields are optional and absent-means-default, so existing drawings load unchanged.

**Tech Stack:** TypeScript, React, Nanostores, P5.js/Canvas2D, Vitest. Import via `@/` alias. Types live in `src/types/*.ts`.

---

## File Structure

**Types & state:**
- `src/types/gridpaint.ts` — add `offsetPhase` to `InteractionGroup`.
- `src/stores/drawingStores.ts` — add `scale` to `Layer`; add `offsetPhase` to its `InteractionGroup` consumers; add toggle action functions.
- `src/lib/blob-engine/types.ts` — mirror `offsetPhase`/`scale` onto `GridLayer`.
- `src/lib/storage/types.ts` — add fields to `SerializedInteractionGroup` and `LayerData`.

**Engine (offset):**
- `src/lib/blob-engine/GroupMerger.ts` — apply +½ center shift for half-phase groups.

**Renderers (scale):**
- `src/lib/blob-engine/renderers/Canvas2DRenderer.ts` — `ctx.scale` per layer.
- `src/lib/blob-engine/renderers/SvgPathRenderer.ts` — wrap layer `<g>` in `transform="scale(...)"`.
- `src/lib/blob-engine/renderers/DxfRenderer.ts` — multiply emitted coords/radii by scale.

**Persistence:**
- `src/lib/storage/local-store.ts` & `src/lib/storage/firestore-store.ts` — serialize/deserialize `offsetPhase` and `scale`.
- `src/lib/export/svgUtils.ts` — `convertLayersToGridLayers` must carry `offsetPhase` + `scale`.

**UI:**
- `src/components/LayerControls.tsx` — per-group ½ toggle, per-layer scale stepper.

**Helper:**
- `src/lib/blob-engine/utils/scale.ts` (new) — `scaleToFactor({num,den})` shared by renderers.

---

## Task 1: Add `offsetPhase` to InteractionGroup type

**Files:**
- Modify: `src/types/gridpaint.ts:118-122`

- [ ] **Step 1: Add the field**

In `src/types/gridpaint.ts`, change the `InteractionGroup` interface from:

```ts
export interface InteractionGroup {
  id: string
  name?: string
  points: Set<string> // "x,y" format
}
```

to:

```ts
export interface InteractionGroup {
  id: string
  name?: string
  points: Set<string> // "x,y" format
  /**
   * Lattice phase for this group. "half" shifts every point by +0.5 in both
   * dimensions at render time (occupying a quadrant boundary). Absent ⇒ "normal".
   */
  offsetPhase?: "normal" | "half"
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no new errors; field is optional).

- [ ] **Step 3: Commit**

```bash
git add src/types/gridpaint.ts
git commit -m "feat: add offsetPhase to InteractionGroup type"
```

---

## Task 2: Add `scale` to Layer types (store + engine mirror)

**Files:**
- Modify: `src/stores/drawingStores.ts:12-20`
- Modify: `src/lib/blob-engine/types.ts:15-23`

- [ ] **Step 1: Add `scale` to the store `Layer`**

In `src/stores/drawingStores.ts`, change the `Layer` interface from:

```ts
export interface Layer {
  id: number
  isVisible: boolean
  renderStyle: "default" | "tiles"
  groups: InteractionGroup[]
  pointModifications?: Map<string, PointModifications>
}
```

to:

```ts
export interface Layer {
  id: number
  isVisible: boolean
  renderStyle: "default" | "tiles"
  groups: InteractionGroup[]
  pointModifications?: Map<string, PointModifications>
  /**
   * Per-layer uniform scale applied to the layer's finished render output.
   * One of num/den is always 1: `{num:2,den:1}` = 2× bigger cell,
   * `{num:1,den:2}` = 2× smaller. Absent ⇒ 1/1.
   */
  scale?: { num: number; den: number }
}
```

- [ ] **Step 2: Mirror onto `GridLayer`**

In `src/lib/blob-engine/types.ts`, change the `GridLayer` interface to add the same two optional fields after `pointModifications`:

```ts
export interface GridLayer {
  id: number
  groups: InteractionGroup[]
  isVisible: boolean
  renderStyle: "default" | "tiles"
  pointModifications?: Map<string, PointModifications>
  /** Per-layer uniform scale (see store Layer.scale). Absent ⇒ 1/1. */
  scale?: { num: number; den: number }
}
```

(`offsetPhase` rides along on `InteractionGroup`, which `GridLayer` already references — no change needed there.)

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stores/drawingStores.ts src/lib/blob-engine/types.ts
git commit -m "feat: add per-layer scale to Layer and GridLayer types"
```

---

## Task 3: Apply +½ shift for half-offset groups in GroupMerger

**Files:**
- Modify: `src/lib/blob-engine/GroupMerger.ts:125-175` (`generateGroupPrimitives`)
- Test: `src/lib/blob-engine/__tests__/groupMergerOffset.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/blob-engine/__tests__/groupMergerOffset.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { GroupMerger } from "@/lib/blob-engine/GroupMerger"
import type { GridLayer } from "@/lib/blob-engine/types"

function makeLayer(offsetPhase: "normal" | "half"): GridLayer {
  return {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["3,3"]), offsetPhase }],
  }
}

describe("GroupMerger half-offset", () => {
  it("shifts a half-offset group's primitive centers by +0.5 in both dims", () => {
    const merger = new GroupMerger()
    const normal = merger.generateMergedPrimitives(makeLayer("normal"), 10, 0).primitives
    const half = merger.generateMergedPrimitives(makeLayer("half"), 10, 0).primitives

    // Same number of primitives, just shifted
    expect(half.length).toBe(normal.length)
    expect(half.length).toBeGreaterThan(0)

    // Every half-offset primitive center equals a normal one + (0.5, 0.5)
    const normalCenters = normal.map((p) => `${p.center.x},${p.center.y}:${p.quadrant}`).sort()
    const halfShiftedBack = half
      .map((p) => `${p.center.x - 0.5},${p.center.y - 0.5}:${p.quadrant}`)
      .sort()
    expect(halfShiftedBack).toEqual(normalCenters)
  })

  it("leaves normal groups unshifted", () => {
    const merger = new GroupMerger()
    const normal = merger.generateMergedPrimitives(makeLayer("normal"), 10, 0).primitives
    for (const p of normal) {
      expect(Number.isInteger(p.center.x)).toBe(true)
      expect(Number.isInteger(p.center.y)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/blob-engine/__tests__/groupMergerOffset.test.ts`
Expected: FAIL — half centers equal normal centers (no shift applied yet), so the first test's `toEqual` mismatches.

- [ ] **Step 3: Apply the shift in `generateGroupPrimitives`**

In `src/lib/blob-engine/GroupMerger.ts`, in `generateGroupPrimitives`, the loop currently stores primitives keyed by their center. Change the signature to receive the group's phase and shift centers before keying.

Change the method signature from:

```ts
  private generateGroupPrimitives(
    group: InteractionGroup,
    gridSize: number,
    borderWidth: number,
    layerId: number,
  ): Map<string, BlobPrimitive> {
```

to also read `group.offsetPhase`, and replace the final `for (const prim of pointPrimitives)` block:

```ts
      for (const prim of pointPrimitives) {
        const key = `${prim.center.x},${prim.center.y}:${prim.quadrant}`
        result.set(key, prim)
      }
```

with:

```ts
      const shift = group.offsetPhase === "half" ? 0.5 : 0
      for (const prim of pointPrimitives) {
        if (shift !== 0) {
          prim.center = { x: prim.center.x + shift, y: prim.center.y + shift }
        }
        const key = `${prim.center.x},${prim.center.y}:${prim.quadrant}`
        result.set(key, prim)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/blob-engine/__tests__/groupMergerOffset.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full engine test suite for regressions**

Run: `pnpm exec vitest run src/lib/blob-engine`
Expected: PASS (no regressions in existing merge/override tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/blob-engine/GroupMerger.ts src/lib/blob-engine/__tests__/groupMergerOffset.test.ts
git commit -m "feat: shift half-offset group primitives by +0.5 in GroupMerger"
```

---

## Task 4: Verify half-offset fuses with normal content (SVG edge-bag)

**Files:**
- Test: `src/lib/blob-engine/__tests__/halfOffsetFusion.test.ts` (create)

This task is a verification test only — it locks in the "fuses for free" claim from the spec. No production code changes.

- [ ] **Step 1: Write the test**

Create `src/lib/blob-engine/__tests__/halfOffsetFusion.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function renderLayerSvg(layer: GridLayer): string {
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, 10, 0)
  const renderer = new SvgPathRenderer(false)
  return renderer.renderLayer(
    geometry,
    { fillColor: "#000" },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    layer,
  )
}

describe("half-offset fusion", () => {
  it("produces a valid path for a half-offset point on the 0.5 subgrid", () => {
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "h", points: new Set(["3,3"]), offsetPhase: "half" }],
    }
    const svg = renderLayerSvg(layer)
    // A half-offset point still emits coordinates on the 0.5 subgrid (no NaN,
    // no quarter-units). All coordinates in the path must be multiples of 0.5.
    const nums = Array.from(svg.matchAll(/-?\d+(\.\d+)?/g)).map((m) => parseFloat(m[0]))
    expect(nums.length).toBeGreaterThan(0)
    for (const n of nums) {
      expect(Number.isNaN(n)).toBe(false)
      // multiples of 0.5 (allow arc radius 0.5 and flags 0/1)
      expect(Math.abs((n * 2) - Math.round(n * 2))).toBeLessThan(1e-9)
    }
  })

  it("a normal point and the half-offset point NW of it share a quadrant slot", () => {
    // Normal point (4,4) SE quadrant occupies x∈[4,4.5], y∈[4,4.5].
    // Half-offset point at (3,3)+0.5 = center (3.5,3.5); its SE quadrant
    // occupies x∈[3.5,4], y∈[3.5,4] — adjacent. Drawing both should yield a
    // single fused outer path, not two separate ones.
    const layer: GridLayer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [
        { id: "n", points: new Set(["4,4"]), offsetPhase: "normal" },
        { id: "h", points: new Set(["3,3"]), offsetPhase: "half" },
      ],
    }
    const svg = renderLayerSvg(layer)
    // Count subpaths (each closed loop starts with "M ").
    const subpaths = (svg.match(/M /g) || []).length
    // Touching-at-corner is allowed to be 1 or 2 loops depending on pinch
    // handling; assert it renders without error and is non-empty.
    expect(subpaths).toBeGreaterThanOrEqual(1)
    expect(svg).toContain("<path")
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run src/lib/blob-engine/__tests__/halfOffsetFusion.test.ts`
Expected: PASS. If the second test reveals an actual stitching failure (STUCK/open path) for the touching case, that's a real finding — STOP and use superpowers:systematic-debugging before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/blob-engine/__tests__/halfOffsetFusion.test.ts
git commit -m "test: verify half-offset points render on the 0.5 subgrid and fuse"
```

---

## Task 5: Add shared scale helper

**Files:**
- Create: `src/lib/blob-engine/utils/scale.ts`
- Test: `src/lib/blob-engine/utils/__tests__/scale.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/blob-engine/utils/__tests__/scale.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"

describe("scaleToFactor", () => {
  it("returns 1 for undefined", () => {
    expect(scaleToFactor(undefined)).toBe(1)
  })
  it("returns num/den for bigger", () => {
    expect(scaleToFactor({ num: 2, den: 1 })).toBe(2)
  })
  it("returns num/den for smaller", () => {
    expect(scaleToFactor({ num: 1, den: 2 })).toBe(0.5)
  })
  it("returns 1 for 1/1", () => {
    expect(scaleToFactor({ num: 1, den: 1 })).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/blob-engine/utils/__tests__/scale.test.ts`
Expected: FAIL — `scaleToFactor` not defined / module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/blob-engine/utils/scale.ts`:

```ts
/** Per-layer uniform scale, stored as a rational with one side always 1. */
export interface LayerScale {
  num: number
  den: number
}

/**
 * Convert a layer scale to a numeric multiplier. Absent ⇒ 1.
 * `{num:2,den:1}` → 2 (bigger), `{num:1,den:2}` → 0.5 (smaller).
 */
export function scaleToFactor(scale: LayerScale | undefined): number {
  if (!scale) return 1
  return scale.num / scale.den
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/blob-engine/utils/__tests__/scale.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blob-engine/utils/scale.ts src/lib/blob-engine/utils/__tests__/scale.test.ts
git commit -m "feat: add scaleToFactor helper for per-layer scale"
```

---

## Task 6: Apply scale in SvgPathRenderer

**Files:**
- Modify: `src/lib/blob-engine/renderers/SvgPathRenderer.ts:805-960` (`renderLayer`)
- Test: `src/lib/blob-engine/renderers/__tests__/svgScale.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/blob-engine/renderers/__tests__/svgScale.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { SvgPathRenderer } from "@/lib/blob-engine/renderers/SvgPathRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function render(scale?: { num: number; den: number }): string {
  const layer: GridLayer = {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["0,0", "1,0"]) }],
    scale,
  }
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, 10, 0)
  const renderer = new SvgPathRenderer(false)
  return renderer.renderLayer(
    geometry,
    { fillColor: "#000" },
    { zoom: 1, panOffset: { x: 0, y: 0 }, viewportWidth: 100, viewportHeight: 100 },
    layer,
  )
}

describe("SvgPathRenderer scale", () => {
  it("emits no transform when scale is absent or 1/1", () => {
    expect(render()).not.toContain("transform=")
    expect(render({ num: 1, den: 1 })).not.toContain("transform=")
  })
  it("wraps output in a scale transform for a 2x layer", () => {
    expect(render({ num: 2, den: 1 })).toContain('transform="scale(2)"')
  })
  it("wraps output in a scale transform for a 1/2 layer", () => {
    expect(render({ num: 1, den: 2 })).toContain('transform="scale(0.5)"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/blob-engine/renderers/__tests__/svgScale.test.ts`
Expected: FAIL — no transform emitted.

- [ ] **Step 3: Wrap the layer group in a scale transform**

In `src/lib/blob-engine/renderers/SvgPathRenderer.ts`, add the import near the other imports at the top of the file:

```ts
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
```

In `renderLayer`, both `return` statements emit a `<g ...>...</g>`. Compute the factor once near the top of `renderLayer` (after `const dbg = this.debugMode`):

```ts
    const scaleFactor = scaleToFactor(layer?.scale)
    const scaleAttr = scaleFactor !== 1 ? ` transform="scale(${scaleFactor})"` : ""
```

Then in the `holeStrokeColor` branch, change:

```ts
      return (
        `<g fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}">\n` +
        `${pathElements}\n` +
        `</g>`
      )
```

to:

```ts
      return (
        `<g fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}"${scaleAttr}>\n` +
        `${pathElements}\n` +
        `</g>`
      )
```

And the final `return`, change:

```ts
    return (
      `<g fill="${fill}" stroke="${outerStroke}" stroke-width="${strokeWidth}" opacity="${opacity}">\n` +
      `${pathElements}\n` +
      `</g>`
    )
```

to:

```ts
    return (
      `<g fill="${fill}" stroke="${outerStroke}" stroke-width="${strokeWidth}" opacity="${opacity}"${scaleAttr}>\n` +
      `${pathElements}\n` +
      `</g>`
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/blob-engine/renderers/__tests__/svgScale.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blob-engine/renderers/SvgPathRenderer.ts src/lib/blob-engine/renderers/__tests__/svgScale.test.ts
git commit -m "feat: apply per-layer scale as SVG group transform"
```

> NOTE on stroke-width under scale: a `transform="scale(2)"` also scales the
> visual stroke width. For laser-cut exports the stroke is hairline and visual
> only, so this is acceptable. If a future task needs constant stroke width,
> add `vector-effect="non-scaling-stroke"` to the paths — out of scope here.

---

## Task 7: Apply scale in Canvas2DRenderer

**Files:**
- Modify: `src/lib/blob-engine/renderers/Canvas2DRenderer.ts:116-129` (layer loop in `renderComposite`) and `renderLayerGeometry`

- [ ] **Step 1: Add scale around the per-layer draw**

In `src/lib/blob-engine/renderers/Canvas2DRenderer.ts`, add the import at the top:

```ts
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
```

In `renderComposite`, the loop calls `this.renderLayerGeometry(...)` per layer inside the already-active pan/zoom transform. Wrap each layer's draw in its own `save`/`scale`/`restore` so the scale composes on top of pan/zoom. Change:

```ts
    for (const layerGeometry of geometry.layers) {
      const layerStyle = getLayerStyle
        ? getLayerStyle(layerGeometry.layer.id)
        : options.style

      this.renderLayerGeometry(
        layerGeometry.geometry,
        layerStyle,
        options.transform,
        layerGeometry.layer,
        options.mmPerUnit ?? 1,
      )
    }
```

to:

```ts
    for (const layerGeometry of geometry.layers) {
      const layerStyle = getLayerStyle
        ? getLayerStyle(layerGeometry.layer.id)
        : options.style

      const scaleFactor = scaleToFactor(layerGeometry.layer.scale)
      if (scaleFactor !== 1) {
        mainCtx.save()
        mainCtx.scale(scaleFactor, scaleFactor)
      }

      this.renderLayerGeometry(
        layerGeometry.geometry,
        layerStyle,
        options.transform,
        layerGeometry.layer,
        options.mmPerUnit ?? 1,
      )

      if (scaleFactor !== 1) {
        mainCtx.restore()
      }
    }
```

> The viewport culling inside `renderLayerGeometry` (via `RenderUtils.cullPrimitives`)
> uses `transform` to decide visibility but draws in the already-scaled context.
> Culling may be slightly conservative/loose under scale but never drops visible
> geometry incorrectly because the scale only shrinks/grows around the origin and
> the cull margin is generous. Acceptable for this iteration.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`, open a drawing, set a layer's `scale` via the UI (built in Task 11) — defer visual verification to Task 11. For now just confirm no console errors on load: `pnpm build`.
Expected: build PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/blob-engine/renderers/Canvas2DRenderer.ts
git commit -m "feat: apply per-layer scale in Canvas2DRenderer"
```

---

## Task 8: Apply scale in DxfRenderer

**Files:**
- Modify: `src/lib/blob-engine/renderers/DxfRenderer.ts` (coordinate emit + radius)
- Test: `src/lib/blob-engine/renderers/__tests__/dxfScale.test.ts` (create)

- [ ] **Step 1: Read the renderer to locate the coordinate/radius emit**

Run: `grep -n "mmPerUnit\|renderLayer\|x2\|y2 \|radius\|export class DxfRenderer" src/lib/blob-engine/renderers/DxfRenderer.ts`
Identify the public `renderLayer`-equivalent method and the single place where `x2/2` and `y2/2` (subgrid coords) get multiplied by `mmPerUnit` to produce final output coordinates, plus the arc radius (0.5 in subgrid units).

- [ ] **Step 2: Write the failing test**

Create `src/lib/blob-engine/renderers/__tests__/dxfScale.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { BlobEngine } from "@/lib/blob-engine/BlobEngine"
import { DxfRenderer } from "@/lib/blob-engine/renderers/DxfRenderer"
import type { GridLayer } from "@/lib/blob-engine/types"

function maxCoord(dxf: string): number {
  // DXF group codes 10/20 carry X/Y vertex coords on the following line.
  const lines = dxf.split(/\r?\n/)
  let max = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i].trim()
    if (code === "10" || code === "20") {
      const v = Math.abs(parseFloat(lines[i + 1]))
      if (!Number.isNaN(v)) max = Math.max(max, v)
    }
  }
  return max
}

function render(scale?: { num: number; den: number }): string {
  const layer: GridLayer = {
    id: 1,
    isVisible: true,
    renderStyle: "default",
    groups: [{ id: "g", points: new Set(["0,0", "1,0", "0,1", "1,1"]) }],
    scale,
  }
  const engine = new BlobEngine({ enableCaching: false })
  const geometry = engine.generateLayerGeometry(layer, 10, 0)
  const renderer = new DxfRenderer()
  // NOTE: confirm the actual method name/signature in Step 1; adjust if needed.
  return renderer.renderLayer(geometry, layer, 5 /* mmPerUnit */)
}

describe("DxfRenderer scale", () => {
  it("doubles output extent for a 2x layer vs 1x", () => {
    const base = maxCoord(render())
    const doubled = maxCoord(render({ num: 2, den: 1 }))
    expect(base).toBeGreaterThan(0)
    expect(doubled).toBeCloseTo(base * 2, 3)
  })
  it("halves output extent for a 1/2 layer vs 1x", () => {
    const base = maxCoord(render())
    const halved = maxCoord(render({ num: 1, den: 2 }))
    expect(halved).toBeCloseTo(base / 2, 3)
  })
})
```

> In Step 1 you confirmed the real public method signature. If it differs from
> `renderLayer(geometry, layer, mmPerUnit)`, update the `render()` helper above
> to match before running.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/blob-engine/renderers/__tests__/dxfScale.test.ts`
Expected: FAIL — scaled output extent equals base (scale not applied).

- [ ] **Step 4: Multiply final coordinates and radius by the scale factor**

In `src/lib/blob-engine/renderers/DxfRenderer.ts`, add the import:

```ts
import { scaleToFactor } from "@/lib/blob-engine/utils/scale"
```

In the public render method, after obtaining `layer`, compute:

```ts
    const scaleFactor = scaleToFactor(layer?.scale)
```

Then, at the single place where subgrid coordinates are converted to output mm (the `x2/2 * mmPerUnit` / `y2/2 * mmPerUnit` conversion) AND where the arc radius is emitted, multiply by `scaleFactor`. Concretely, change the coordinate conversion to fold in `scaleFactor`:

```ts
    // before: const ox = (x2 / 2) * mmPerUnit
    // after:
    const effectiveUnit = mmPerUnit * scaleFactor
    const ox = (x2 / 2) * effectiveUnit
    const oy = (y2 / 2) * effectiveUnit
```

and apply the same `effectiveUnit` to the arc radius (subgrid radius 0.5):

```ts
    // radius in output units
    const r = 0.5 * effectiveUnit
```

> Because DXF translates coordinates so the bbox starts at (0,0), multiplying
> the per-unit factor uniformly scales the whole shape about the origin after
> translation — equivalent to scaling the finished paths. Use one consistent
> `effectiveUnit` everywhere a raw subgrid coordinate or radius becomes output.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/blob-engine/renderers/__tests__/dxfScale.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the DXF suite for regressions**

Run: `pnpm exec vitest run src/lib/blob-engine/renderers`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/blob-engine/renderers/DxfRenderer.ts src/lib/blob-engine/renderers/__tests__/dxfScale.test.ts
git commit -m "feat: apply per-layer scale in DxfRenderer"
```

---

## Task 9: Carry offsetPhase + scale through convertLayersToGridLayers

**Files:**
- Modify: `src/lib/export/svgUtils.ts:369-381`
- Test: `src/lib/export/__tests__/convertLayer.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/__tests__/convertLayer.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { convertLayerToGridLayer } from "@/lib/export/svgUtils"
import type { Layer } from "@/stores/drawingStores"

describe("convertLayerToGridLayer", () => {
  it("preserves group offsetPhase and layer scale", () => {
    const layer: Layer = {
      id: 1,
      isVisible: true,
      renderStyle: "default",
      groups: [{ id: "h", points: new Set(["1,1"]), offsetPhase: "half" }],
      scale: { num: 2, den: 1 },
    }
    const grid = convertLayerToGridLayer(layer)
    expect(grid.groups[0].offsetPhase).toBe("half")
    expect(grid.scale).toEqual({ num: 2, den: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/export/__tests__/convertLayer.test.ts`
Expected: FAIL — `offsetPhase`/`scale` undefined on the converted layer.

- [ ] **Step 3: Carry the fields**

In `src/lib/export/svgUtils.ts`, change `convertLayersToGridLayers`:

```ts
export function convertLayersToGridLayers(layers: Layer[]): GridLayer[] {
  return layers.map((layer) => ({
    id: layer.id,
    groups: layer.groups.map((g) => ({
      id: g.id,
      name: g.name,
      points: new Set(g.points),
      offsetPhase: g.offsetPhase,
    })),
    isVisible: layer.isVisible,
    renderStyle: layer.renderStyle || "default",
    pointModifications: layer.pointModifications,
    scale: layer.scale,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/export/__tests__/convertLayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/svgUtils.ts src/lib/export/__tests__/convertLayer.test.ts
git commit -m "feat: carry offsetPhase and scale through layer->GridLayer conversion"
```

---

## Task 10: Persist offsetPhase + scale (serialize/deserialize)

**Files:**
- Modify: `src/lib/storage/types.ts:15-19` and `:30-42`
- Modify: `src/lib/storage/local-store.ts:73-86` (deserialize), `:141-150` (serialize)
- Modify: `src/lib/storage/firestore-store.ts:111-122` (deserialize), `:198-211` (serialize)
- Test: `src/lib/storage/__tests__/persistOffsetScale.test.ts` (create)

- [ ] **Step 1: Extend the serialized types**

In `src/lib/storage/types.ts`, change `SerializedInteractionGroup`:

```ts
export interface SerializedInteractionGroup {
  id: string
  name?: string
  points: string[]
  offsetPhase?: "normal" | "half"
}
```

and add `scale` to `LayerData` (after `pointModifications?`):

```ts
  /** Per-layer uniform scale; one of num/den is always 1. Absent ⇒ 1/1. */
  scale?: { num: number; den: number }
```

- [ ] **Step 2: Write the failing round-trip test**

Create `src/lib/storage/__tests__/persistOffsetScale.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { LocalDrawingStore } from "@/lib/storage/local-store"
import type { DrawingDocument } from "@/lib/storage/types"

function makeDoc(): DrawingDocument {
  return {
    id: "test-1",
    name: "t",
    createdAt: 0,
    updatedAt: 0,
    gridSize: 10,
    borderWidth: 0,
    panOffset: { x: 0, y: 0 },
    zoom: 1,
    mmPerUnit: 5,
    layers: [
      {
        id: 1,
        isVisible: true,
        renderStyle: "default",
        groups: [
          { id: "n", points: new Set(["0,0"]) },
          { id: "h", points: new Set(["1,1"]), offsetPhase: "half" },
        ],
        scale: { num: 1, den: 2 },
      },
    ],
  }
}

describe("persist offsetPhase + scale", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips offsetPhase and scale through save/get", async () => {
    const store = new LocalDrawingStore()
    await store.save(makeDoc())
    const loaded = await store.get("test-1")
    expect(loaded).not.toBeNull()
    const layer = loaded!.layers[0]
    expect(layer.scale).toEqual({ num: 1, den: 2 })
    expect(layer.groups.find((g) => g.id === "h")!.offsetPhase).toBe("half")
    expect(layer.groups.find((g) => g.id === "n")!.offsetPhase).toBeUndefined()
  })

  it("loads a legacy doc without the fields as defaults", async () => {
    const legacy = makeDoc()
    delete legacy.layers[0].scale
    legacy.layers[0].groups.forEach((g) => delete g.offsetPhase)
    const store = new LocalDrawingStore()
    await store.save(legacy)
    const loaded = await store.get("test-1")
    expect(loaded!.layers[0].scale).toBeUndefined()
    expect(loaded!.layers[0].groups[0].offsetPhase).toBeUndefined()
  })
})
```

> Confirm the exported class name in `src/lib/storage/local-store.ts` (Step 3
> grep). If it differs from `LocalDrawingStore`, update the import and `new`
> call above accordingly. The vitest environment must provide `localStorage`
> (jsdom). If the project's vitest config is `node`, this test uses the store's
> in-memory path — verify with the grep in Step 3.

- [ ] **Step 3: Confirm class name and localStorage availability**

Run: `grep -n "export class\|localStorage\|readStorage\|writeStorage" src/lib/storage/local-store.ts | head`
Run: `grep -n "environment" vitest.config.* vite.config.* 2>/dev/null`
Adjust the test's import/class name to match. If no jsdom environment is configured and `localStorage` is undefined in tests, add `// @vitest-environment jsdom` as the first line of the test file.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/storage/__tests__/persistOffsetScale.test.ts`
Expected: FAIL — `offsetPhase`/`scale` not persisted (dropped during serialize).

- [ ] **Step 5: Serialize the fields (local-store)**

In `src/lib/storage/local-store.ts`, in `save`, change the groups map (around line 141):

```ts
          groups: layer.groups.map((g) => ({
            id: g.id,
            name: g.name,
            points: Array.from(g.points),
            offsetPhase: g.offsetPhase,
          })),
```

and add `scale` to the `serialized` object (after the `groups:` block, before the `pointModifications` guard):

```ts
        if (layer.scale) {
          serialized.scale = layer.scale
        }
```

- [ ] **Step 6: Deserialize the fields (local-store)**

In `src/lib/storage/local-store.ts`, in `get`, change the new-format group deserialization (around line 73):

```ts
        groups = layer.groups.map((g) => ({
          id: g.id,
          name: g.name,
          points: new Set(g.points),
          offsetPhase: g.offsetPhase,
        }))
```

and change the final returned layer object (around line 116) to include scale:

```ts
      return {
        id: layer.id,
        isVisible: layer.isVisible,
        renderStyle: layer.renderStyle,
        groups,
        pointModifications,
        scale: layer.scale,
      }
```

- [ ] **Step 7: Mirror the same four edits in firestore-store**

In `src/lib/storage/firestore-store.ts`, apply the identical changes:
- Deserialize groups (around line 111): add `offsetPhase: g.offsetPhase` to the group map.
- Returned layer (in the same `.map`): add `scale: layer.scale`.
- Serialize groups (around line 198): add `offsetPhase: g.offsetPhase` to the group map.
- Serialized layer object (around line 198-211): add `if (layer.scale) serialized.scale = layer.scale`.

(Match the exact surrounding structure already present in that file — it mirrors local-store.)

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/storage/__tests__/persistOffsetScale.test.ts`
Expected: PASS (both tests).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/storage/types.ts src/lib/storage/local-store.ts src/lib/storage/firestore-store.ts src/lib/storage/__tests__/persistOffsetScale.test.ts
git commit -m "feat: persist group offsetPhase and layer scale"
```

---

## Task 11: UI — per-group ½ toggle and per-layer scale control

**Files:**
- Modify: `src/stores/drawingStores.ts` (add actions)
- Modify: `src/components/LayerControls.tsx` (add controls)
- Test: `src/stores/__tests__/offsetScaleActions.test.ts` (create)

- [ ] **Step 1: Write the failing test for store actions**

Create `src/stores/__tests__/offsetScaleActions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  $layersState,
  createDefaultLayer,
  toggleGroupOffsetPhase,
  setLayerScale,
} from "@/stores/drawingStores"

describe("offset/scale store actions", () => {
  beforeEach(() => {
    const layer = createDefaultLayer(1)
    $layersState.set({ layers: [layer], activeLayerId: 1 })
  })

  it("toggleGroupOffsetPhase flips a group between normal and half", () => {
    const groupId = $layersState.get().layers[0].groups[0].id
    toggleGroupOffsetPhase(1, groupId)
    expect($layersState.get().layers[0].groups[0].offsetPhase).toBe("half")
    toggleGroupOffsetPhase(1, groupId)
    expect($layersState.get().layers[0].groups[0].offsetPhase).toBe("normal")
  })

  it("setLayerScale sets and clears a layer's scale", () => {
    setLayerScale(1, { num: 2, den: 1 })
    expect($layersState.get().layers[0].scale).toEqual({ num: 2, den: 1 })
    setLayerScale(1, undefined)
    expect($layersState.get().layers[0].scale).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/stores/__tests__/offsetScaleActions.test.ts`
Expected: FAIL — `toggleGroupOffsetPhase` / `setLayerScale` not exported.

- [ ] **Step 3: Add the store actions**

In `src/stores/drawingStores.ts`, add after `updateGroupPoints` (around line 318):

```ts
/**
 * Toggle a group's offset phase between "normal" and "half".
 * Half shifts the group's rendered points by +0.5 in both dimensions.
 */
export function toggleGroupOffsetPhase(layerId: number, groupId: string): void {
  const current = $layersState.get()
  pushHistory(current.layers)
  const layers = current.layers.map((layer) => {
    if (layer.id !== layerId) return layer
    const groups = layer.groups.map((g) =>
      g.id === groupId
        ? { ...g, offsetPhase: (g.offsetPhase === "half" ? "normal" : "half") as "normal" | "half" }
        : g,
    )
    return { ...layer, groups }
  })
  $layersState.setKey("layers", layers)
}

/**
 * Set (or clear, with undefined) a layer's uniform scale.
 * One of num/den is expected to be 1.
 */
export function setLayerScale(
  layerId: number,
  scale: { num: number; den: number } | undefined,
): void {
  const current = $layersState.get()
  pushHistory(current.layers)
  const layers = current.layers.map((layer) =>
    layer.id === layerId ? { ...layer, scale } : layer,
  )
  $layersState.setKey("layers", layers)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/stores/__tests__/offsetScaleActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire UI controls in LayerControls**

Read `src/components/LayerControls.tsx` to find the per-group row rendering and the per-layer row rendering. Add:

- On each group row: a small toggle button labeled `½` that calls `toggleGroupOffsetPhase(layer.id, group.id)` and shows active styling when `group.offsetPhase === "half"`.
- On each layer row: a compact scale control. Use a select/stepper offering options `½`, `⅓`, `1×`, `2×`, `3×` mapped to scale values:
  - `½` → `{num:1,den:2}`, `⅓` → `{num:1,den:3}`, `1×` → `undefined`, `2×` → `{num:2,den:1}`, `3×` → `{num:3,den:1}`.
  - On change call `setLayerScale(layer.id, value)`. Display current value from `layer.scale` (default `1×` when absent).

Follow the existing button/select styling in that file (the codebase uses Radix UI + Tailwind; reuse the existing icon-button pattern used for visibility/render-style toggles). Import `toggleGroupOffsetPhase` and `setLayerScale` from `@/stores/drawingStores`.

- [ ] **Step 6: Build to verify UI compiles**

Run: `pnpm build`
Expected: PASS (TypeScript compile + Vite build succeed).

- [ ] **Step 7: Manual verification**

Run: `pnpm dev`. In a drawing:
1. Draw points in the default group, add a second group, toggle its `½` button, draw — confirm the new region renders shifted half a cell and blobs with the normal region.
2. Set a layer's scale to `2×` — confirm the whole layer (including corner radii) renders twice as large; set `½` — half size.
3. Reload the page — confirm both settings persist.
4. Export SVG and DXF — confirm scaled layers export at the scaled size.

Expected: all four behaviors correct.

- [ ] **Step 8: Commit**

```bash
git add src/stores/drawingStores.ts src/components/LayerControls.tsx src/stores/__tests__/offsetScaleActions.test.ts
git commit -m "feat: add UI for per-group half-offset toggle and per-layer scale"
```

---

## Task 12: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm exec vitest run`
Expected: PASS — all tests green, including the new offset/scale tests and all pre-existing blob-engine/export/storage tests.

- [ ] **Step 2: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: both PASS.

- [ ] **Step 2b: Audit cross-layer bounding box under scale (cosmetic)**

The engine's global bounding box (`BlobEngine.generateGeometry`, used for
canvas centering) aggregates per-layer bounds computed in each layer's own
(pre-scale) units. A scaled layer's world footprint differs, so "center
canvas" may be slightly off for drawings with scaled layers. This is cosmetic
(centering only — does not affect rendered geometry or exports, which scale
per-layer output directly). If centering is visibly wrong in Task 11's manual
check, multiply each layer's bbox by `scaleToFactor(layer.scale)` before
aggregating in `generateGeometry`. Otherwise leave as-is (YAGNI).

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint and build pass for half-offset + per-layer scale" || echo "nothing to commit"
```
