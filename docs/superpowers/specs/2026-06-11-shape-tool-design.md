# Shape Tool (Rectangle + Ellipse) — Design

Date: 2026-06-11

## Goal

Add a **shape tool** that lets the user draw rectangles and ellipses/ovals onto
the grid. The user drags out an initial shape, then positions and resizes it as
a live floating preview before committing it into the active layer.

## Requirements

1. **Single tool, shape chosen in the options panel.** One toolbar button;
   the precise shape (rectangle vs ellipse) is selected in `ToolOptionsPanel`.
2. **Fill or edge.** A style toggle in the panel:
   - `fill` — every grid cell inside the shape is filled.
   - `edge` — a single-cell-wide outline only.
3. **Live, movable preview.** After the initial drag, the shape becomes a
   floating preview the user can move (drag body or arrow keys), exactly like a
   pasted selection.
4. **Resize.** While floating, the user can change the shape's size by:
   - dragging one of 8 resize handles (4 corners + 4 edge midpoints), or
   - typing exact width/height (in grid cells) into number inputs in the panel.
5. **Commit semantics.** Committing adds the shape's cells to the active layer's
   active group (union). Holding **Alt/Option** while the shape tool is active
   makes the commit **subtract** those cells instead (mirrors draw/erase).
6. **Squircliness slider.** Both rectangle and ellipse are modelled as a
   **superellipse** `|x/a|^n + |y/b|^n ≤ 1`. A slider in the panel varies the
   exponent `n`, and there is **one slider per shape kind**, rendered in the same
   panel position and switched by the selected kind:
   - **Ellipse → squircliness slider**, `n` from `1` (diamond) → `2` (true
     ellipse, default) → `6` (boxy/near-rect).
   - **Rectangle → corner-roundness slider**, `n` from `8` (sharp rectangle,
     default) → `3` (clearly rounded corners). A high `n` keeps the full bbox with
     crisp corners; lowering it rounds them.
   Each kind stores its own `n` so switching Rect↔Ellipse remembers each setting.

## Key insight: reuse the floating-paste machinery

A rasterized rectangle or ellipse is just a **set of relative `"x,y"` grid
cells** — the same shape as `ClipboardData` / `FloatingPaste`. So the shape tool
generates `ClipboardData` from shape parameters and rides the existing
floating-paste system in `useSelection` (`pasteData`, `moveFloatingPaste`,
`bakeFloatingPaste`, `cancelFloatingPaste`) and its canvas wiring (overlay
render via `renderFloatingPaste`, arrow-key move, Enter-to-commit,
Esc-to-cancel).

We extend that machinery with two shape-specific additions:
- **shape metadata on the float** (so resize can re-rasterize), and
- **resize handles** + a **shape panel** in the UI.

The bake path already targets the active layer/group for single-layer floats
(`retargetSingleLayer`), which is exactly what we want.

## Components

### 1. Tool registration

- Add `"shape"` to the `Tool` union in `src/stores/ui.ts`.
- Add a toolbar button in `ToolSelection.tsx` (Square icon from lucide-react,
  shortcut **`R`**). `R` is only otherwise bound as an Override sub-shape
  shortcut, which is active only while the Override tool is selected, so there is
  no global clash.

### 2. Shape settings store (`src/stores/ui.ts`)

```ts
export interface ShapeToolSettings {
  shape: "rectangle" | "ellipse"
  style: "fill" | "edge"
  /** Superellipse exponent per kind, so each remembers its own slider value. */
  rectExponent: number    // default 8 (sharp); lower = rounder corners (min 3)
  ellipseExponent: number // default 2 (true ellipse); 1 = diamond, up to 6 = boxy
}
export const $shapeToolSettings = map<ShapeToolSettings>({
  shape: "rectangle",
  style: "fill",
  rectExponent: 8,
  ellipseExponent: 2,
})
```

Slider ranges in the UI: rect `3..8`, ellipse `1..6` (step `0.1`). The active
exponent for a given kind is `rectExponent` when `shape === "rectangle"`, else
`ellipseExponent`.

### 3. Pure rasterizer (`src/lib/gridpaint/rasterizeShape.ts`)

```ts
function rasterizeShape(
  shape: "rectangle" | "ellipse",
  style: "fill" | "edge",
  width: number,    // in grid cells, >= 1
  height: number,   // in grid cells, >= 1
  exponent: number, // superellipse exponent n (>= 1)
): string[]         // relative "x,y" keys, origin at (0,0) top-left of bbox
```

Both kinds share one **superellipse fill test**: a cell `(x,y)` is inside if its
center satisfies `|nx|^n + |ny|^n <= 1` where `nx=(cx-a)/a`, `ny=(cy-b)/b`,
`a=width/2`, `b=height/2`, `cx=x+0.5`, `cy=y+0.5`, and `n` is the exponent.

- **Rectangle** and **ellipse** differ only in their **default exponent** (passed
  in by the caller): rectangle uses a high `n` (≈8, crisp corners), ellipse uses
  `n≈2`. There is no separate perimeter algorithm — the rectangle is just a
  high-`n` superellipse, which fills the whole bbox with rounded-to-crisp corners.
- **fill:** all cells passing the test above.
- **edge:** **fill minus eroded-fill** — a fill cell is on the edge if any of its
  4-neighbours is not filled. Connected single-cell-wide outline, always a strict
  subset of the fill, so toggling fill→edge just hollows the shape out. Degenerate
  cases (`width<=2` or `height<=2`) fall back to the fill of that thin box.

Note: at very high `n` the superellipse fill equals the full bbox (a sharp
rectangle), and its erosion-derived **edge equals the rectangle perimeter** — so
no special-casing is needed for the "sharp rect edge".

This module is pure and unit-tested in isolation (no canvas). Built TDD.

### 4. Floating-shape metadata

Extend the floating model so a float can be a "shape float". Add an optional
field to `FloatingPaste` (in `src/stores/ui.ts`):

```ts
shape?: {
  kind: "rectangle" | "ellipse"
  style: "fill" | "edge"
  width: number    // current size in cells
  height: number
  exponent: number // superellipse exponent for this float
}
```

When `shape` is present:
- The float's `data` (its cell set) is **derived** from
  `rasterizeShape(kind, style, width, height, exponent)`, wrapped as a
  single-layer, single-group `ClipboardData` with `bounds = {0,0,width-1,height-1}`.
- Changing `width`/`height`/`kind`/`style` re-runs the rasterizer and rewrites
  `data` (keeping `origin`/`offset`). A small helper
  `rebuildShapeFloat(partialShape)` in `useSelection` (or a thin store helper)
  centralizes this.

Plain pastes leave `shape` undefined and behave exactly as today.

### 5. Canvas interaction (`GridPaintCanvas.tsx`)

Add a `currentTool === "shape"` branch to the mouse handlers:

- **mousedown** (no active float): record the start grid cell; begin a
  rubber-band drag (reuse a transient start/end like the export-rect drag).
- **mousemove** (dragging): update the rubber-band box; render it (reuse the
  dashed selection rectangle render).
- **mouseup** (drag end): compute `width`/`height`/top-left from the box, then
  create a **shape float**:
  `pasteData(buildShapeClipboard(settings, w, h), topLeftGrid)` plus set the
  `shape` metadata. (If `w` or `h` is 0 — a click without drag — default to a
  1×1 or a small default like 5×5; choose **1×1** so a click is predictable.)

- **When a shape float exists:**
  - mousedown on a **resize handle** → enter resize drag; mousemove updates
    `width`/`height` (and the float origin/offset for handles that move the
    top-left, e.g. NW corner) and re-rasterizes; mouseup ends resize.
  - mousedown on the **body** → existing move drag (reuse floating-paste move).
  - The existing keyboard handler already gives arrow-move, Enter-commit,
    Esc-cancel for free.

### 6. Handle rendering

Extend `renderFloatingPaste` (or add a sibling renderer called alongside it)
so that **when the float has `shape` metadata**, it also draws the 8 resize
handles as small filled squares at the bbox corners and edge midpoints, in the
active outline color. Handle hit-testing on the canvas converts pointer →
grid/screen space and checks proximity to each handle's screen rect.

### 7. Options panel (`ToolOptionsPanel.tsx`)

Render a `ShapeOptions` block. The panel is already shown when there is a
floating paste; also show it when `currentTool === "shape"`. Update the
top-level guard:

```ts
if (currentTool !== "cutout" && currentTool !== "override" &&
    currentTool !== "export" && currentTool !== "shape" && !hasFloatingPaste)
  return null
```

`ShapeOptions` contains:
- **Shape** segmented toggle: Rectangle | Ellipse (writes `$shapeToolSettings`
  AND, if a shape float is active, rebuilds it).
- **Style** segmented toggle: Fill | Edge (same dual-write behavior).
- **Size** W × H number inputs — shown only when a shape float is active;
  editing rebuilds the float at the new size. Inputs clamp to `>= 1`.
- **Squircliness slider** — one slider rendered in a fixed position, switched by
  the selected kind:
  - Rectangle selected → **corner-roundness** slider, range `3..8`, bound to
    `rectExponent`. Label e.g. "corners".
  - Ellipse selected → **squircliness** slider, range `1..6`, bound to
    `ellipseExponent`. Label e.g. "squircle".
  Step `0.1`. Moving the slider writes the per-kind exponent to
  `$shapeToolSettings` AND, if a shape float is active, rebuilds it with the new
  exponent.

When a shape float is active, the existing `FloatingPasteHint` (arrows/Enter/
Esc help) is shown together with these controls.

## Data flow summary

```
shape tool: drag box ──► buildShapeClipboard(settings, w, h)
                         + shape metadata  ──► $selectionState.floatingPaste
floating shape:
  resize handle / W·H input / slider ─► rebuildShapeFloat({width,height,exponent,…})
                               └─► rasterizeShape ─► new data cells
  drag body / arrows ────────► moveFloatingPaste (existing)
  Enter / click-away ────────► bakeFloatingPaste (existing; union into
                               active layer/group)  [Alt held ⇒ subtract]
  Esc ───────────────────────► cancelFloatingPaste (existing; discards)
```

## Alt-subtract on commit

`bakeFloatingPaste` currently only unions. Add an optional `subtract` flag
(threaded from the shape tool's commit when Alt is held): when set, it removes
the float's cells from the target group instead of adding, and clears point
modifications for those cells (same as the erase path in the draw handler).
Default remains union, so paste behavior is unchanged.

## Testing

- **Unit (TDD):** `rasterizeShape` — fill/edge for both kinds, degenerate thin
  shapes, 1×1, symmetry of the fill, edge ⊆ fill, hollow interior for a large
  edge; plus exponent behaviour: high `n` (≈8) fills the whole bbox (sharp rect)
  and its edge equals the rectangle perimeter, while `n=2` omits the bbox corners
  (ellipse).
- **Unit:** `rebuildShapeFloat` produces a single-layer/single-group
  `ClipboardData` with correct bounds and cell count for given params.
- **Manual:** draw rect & ellipse in fill and edge; move with mouse and arrows;
  resize via each handle and via inputs; commit with Enter and click-away; Esc
  cancels; Alt-commit subtracts; committed cells land in the active layer/group
  and render through the blob engine.

## Out of scope (YAGNI)

- Rotation, non-axis-aligned shapes.
- Multi-cell-thick outlines / configurable stroke width.
- Polygon / line / other primitives.
- Persisting shapes as editable objects (committed cells are plain grid cells).
```