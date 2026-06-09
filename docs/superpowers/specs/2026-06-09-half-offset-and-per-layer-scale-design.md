# Half-Offset Groups & Per-Layer Scale — Design

**Date:** 2026-06-09
**Status:** Approved design, pending spec review

## Summary

Two related features for the GridPaint blob system, both modeled as **coordinate
transforms applied at the layer/group boundary**, leaving the blob engine
(neighborhood analysis, primitive generation, edge-bag stitching) completely
untouched:

1. **Half-offset groups** — draw/shift a region offset by half a grid cell
   (½ in each dimension) on the same layer as normal-grid content.
2. **Per-layer scale** — each layer can have a grid cell that is N× bigger or
   N× smaller than the default grid.

The guiding principle: the blob engine and all three renderers (canvas, SVG,
DXF) already operate on a **half-unit lattice** internally (coordinates stored
as `x2 = x * 2` integers). Both features compose cleanly with that lattice
rather than fighting it.

## Background: how the current system works

- **Points** are stored as integer `"x,y"` keys in `Set<string>`, grouped into
  `InteractionGroup`s. A `Layer` has one or more groups.
- The **blob engine** runs neighborhood analysis per group on the group's own
  integer lattice (`±1` neighbor walk), classifies each of a point's 4 quadrants
  (0=SE, 1=SW, 2=NW, 3=NE), and emits `BlobPrimitive`s keyed by
  `"x,y:quadrant"`.
- `GroupMerger` merges multiple groups into one unified primitive set keyed by
  shared `"x,y:quadrant"` slots ("most-filled-wins"), then applies per-point
  quadrant overrides from `pointModifications`.
- The **SVG/DXF renderers** use an **edge-bag algorithm**: each primitive emits
  its full perimeter as oriented edges; edges that appear twice (shared internal
  edges between adjacent filled regions) **cancel**; surviving boundary edges
  are stitched into continuous closed paths. Coordinates live on the half-unit
  subgrid and are stored as `x2 = x*2` integers for exact keying. **This edge
  cancellation is what fuses separate groups into one continuous outline.**
- World position is computed at the very end as `center * gridSize` (canvas
  uses `ctx` transforms; SVG/DXF multiply coordinates).

## Key insight

A **quadrant is already the half-grid subdivision.** A normal point at `(3,3)`
occupies `x∈[3,4], y∈[3,4]`, split into quadrants at `x=3.5, y=3.5`. A
half-offset point at `(3,3)+(½,½)` occupies `x∈[3.5,4.5], y∈[3.5,4.5]`, split at
`x=4.0, y=4.0`.

**Every corner of a half-offset point still lands on a multiple of 0.5** — i.e.
on the exact same `x2`/`y2` integer keys the renderer already uses. A
half-offset point's NW quadrant is *literally the SE quadrant of the normal
point NW of it*. So a half-offset point is **not a new lattice** — it is a
normal point whose center sits at a quadrant boundary, occupying one quadrant
slot from each of four neighboring normal cells.

Consequence: half-offset primitives land on exact existing `"x,y:quadrant"`
slots and **fuse with normal content via the existing edge-cancellation, for
free** — same blobbing rules, no T-junctions, no new geometry.

## Feature 1: Half-offset groups

### Data model

Add an offset phase to `InteractionGroup`:

```ts
// src/types/gridpaint.ts
export interface InteractionGroup {
  id: string
  name?: string
  points: Set<string>          // "x,y" integer keys, as today
  offsetPhase?: "normal" | "half"  // absent ⇒ "normal"
}
```

- Offset is a property of the **group**, not the point. A point never carries an
  offset, so there is **no collision with quadrant overrides** (which are
  per-point in `pointModifications`). The two mechanisms become orthogonal.
- `"half"` means +½ in **both** dimensions (the only phase requested). Points
  within a half-offset group are still stored as plain integers; the +½ is
  applied at render time.

### Engine integration

The shift happens in exactly one place: **`GroupMerger`**, the only component
that knows group membership. When generating a half-phase group's primitives,
shift each primitive's `center` by +½ in both dims **before** it enters the
merge keyspace:

```
for each group:
  run blob engine on group's integer points        (UNCHANGED)
  if group.offsetPhase === "half":
    shift each primitive center by (+0.5, +0.5)
  merge into shared "x,y:quadrant" keyspace          (keys are now post-shift)
```

Because a half-offset primitive's shifted center + quadrant resolves to a
half-integer position that coincides exactly with a neighboring normal cell's
quadrant slot, the rest of the pipeline (merge, override application, edge-bag
stitching) is **oblivious to offset** and Just Works. Two half-phase groups with
the same phase fuse identically to two normal groups; a half-phase group and a
normal group fuse via edge cancellation where their quadrant slots coincide.

**Renderer consistency:** the shift lives in `GroupMerger` (shared by all
renderers), so canvas, SVG, and DXF all inherit it automatically. No
renderer-specific offset logic.

> Implementation note: `center` is currently typed as integer `GridPoint`. After
> the shift it carries `.5` values. The merge key currently does
> `` `${center.x},${center.y}:${quadrant}` `` — with `.5` centers this still
> produces stable, collision-free keys (e.g. `"3.5,3.5:0"`). The edge-bag
> renderer already tolerates non-integer centers because it converts via
> `pt(x,y) = round(x*2)` into the `x2` space. **Verify** `BlobEngine`'s
> fast-path/caching code (which `split(",").map(Number)` on keys) still
> round-trips `.5` values correctly; the GroupMerger path is used whenever a
> layer has >1 group or any pointModifications, so half-offset groups always go
> through the merge path — confirm half-offset never silently falls onto the
> integer-only fast path.

### UI

- **Per-group "½" toggle** in the group controls (a button on each group row)
  that flips `offsetPhase` between `"normal"` and `"half"`.
- **Keyboard shortcut** to flip the active group's phase (so "half-offset draw
  mode" = simply having a half-phase group active; strokes route to the active
  group as they do today — no special routing).
- **Shift-selection-by-half:** operates per-group — toggles/sets the phase of
  the group the selection lives in (consistent with selections already living
  within groups).

## Feature 2: Per-layer scale

### Data model

Add scale to `Layer`:

```ts
// src/stores/drawingStores.ts (and the storage + GridLayer mirror types)
export interface Layer {
  // ...existing...
  scale?: { num: number; den: number }  // absent ⇒ 1/1
}
```

Invariant: **one of `num`/`den` is always `1`** — a layer cell is either N×
bigger (`N/1`) or N× smaller (`1/N`). Stored as a rational pair to keep the math
exact and readable; no float drift.

### Engine integration: scale is a pure post-process

Scale is applied as a **uniform transform on the layer's finished output**,
*after* the layer has fully rendered to paths/primitives in its own coordinate
space. The blob engine and the edge-bag never see scale — so there is no
quarter-unit/keying problem regardless of the ratio.

```
per layer:
  render layer to paths in the layer's OWN units    (engine + half-offset; UNCHANGED)
  apply uniform scale (num/den) to the finished paths   (NEW)
  place in world (gridSize, pan, zoom)              (UNCHANGED)
```

- **Arc radii scale with everything** — the whole blob (corners included) is
  uniformly bigger/smaller. This is the desired behavior and is exactly what
  "scale the finished paths" produces for free.
- Because scale is applied after rendering, **half-offset on a scaled layer is
  automatically ½ of the layer's own cell** (the layer renders as if 1×, then
  the whole thing scales). No "layer cells vs default cells" ambiguity — it
  falls out of the decomposition.

### Per-renderer application

Each renderer applies the same uniform scale to its own output:

- **Canvas (`Canvas2DRenderer`):** wrap the layer's draw in
  `ctx.scale(num/den, num/den)` (combined with the existing pan/zoom transform).
- **SVG (`SvgPathRenderer` / export):** emit the layer's `<g>` with
  `transform="scale(num/den)"`, or multiply path coordinates uniformly.
- **DXF (`DxfRenderer`):** multiply all emitted coordinates (and arc radii) by
  `num/den`.

> Implementation note: world bounding-box computation (used for centering,
> export layout, viewport culling) must account for a layer's scale when
> aggregating bounds across layers, since a scaled layer occupies a
> different-sized world footprint. Audit `BlobEngine.generateGeometry`'s global
> bounds and the export layout code (`exportRectsSvg`, `nestedLayout`) for
> scale-awareness.

### UI

- **Per-layer scale control** in the layer row (a stepper/input showing e.g.
  `2×`, `1×`, `½`, `⅓`). Bigger and smaller both supported, honoring the
  "one side is 1" invariant.

## Persistence & migration

- Both fields are optional and absent-means-default, so **existing drawings load
  unchanged** (no migration needed). `offsetPhase` absent ⇒ `"normal"`; `scale`
  absent ⇒ `1/1`.
- Add both fields to the storage document types (`src/lib/storage/types.ts`),
  the `GridLayer` mirror (`src/lib/blob-engine/types.ts`), and the
  `convertLayerToGridLayer` mapping used by exports.

## Scope / non-goals

- **No true geometric boolean-union** between phases. A half-offset region and a
  normal region fuse via edge-cancellation where their quadrant slots coincide;
  where they merely overlap without sharing slots, they render as overlapping
  outlines (same behavior as any two overlapping groups today). Confirmed
  acceptable.
- **Only the `"half"` phase** (½ in both dims). No per-axis half, no arbitrary
  fractions (¼, ⅓ offsets) in this iteration.
- **Scale is per-layer only** (not per-group). Half-offset is per-group only
  (not per-layer, not per-point).

## Test strategy

- **Half-offset, engine level:** a single half-offset group renders identically
  to the same points drawn normally, just shifted +½ (compare primitive centers
  / emitted path coords).
- **Half-offset, fusion:** a half-offset point sharing a quadrant slot with a
  normal point produces a single fused boundary path (edge cancellation), not
  two overlapping outlines.
- **Half-offset + overrides coexist:** a half-offset group with quadrant
  overrides on its points renders the overridden shapes, shifted — overrides
  unaffected by phase.
- **Scale:** a scaled layer's emitted SVG/DXF coordinates and arc radii equal
  the 1× output multiplied by `num/den` exactly (both N/1 and 1/N).
- **Scale + half-offset compose:** half-offset on a 2× layer shifts by one full
  default cell in world space; verify against expected world coordinates.
- **Round-trip:** save/load preserves `offsetPhase` and `scale`; legacy
  documents without the fields load as defaults.
- **Cross-renderer parity:** canvas, SVG, and DXF agree on placement for a small
  fixture exercising both features.
