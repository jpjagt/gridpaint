# Assembly rig + layer thickness — design

## Why

Designs are cut as several metal layers and glued into a stack. Today
alignment and glue placement are done by eye: layers end up slightly off,
and glue sometimes lands on a surface that stays exposed. We want to
export, per export rect, a 3D-printable **assembly rig** that the layers
drop into one by one and that holds each layer in exact position while
gluing, plus guidance on **where to put glue**.

Two parts, built in this order:

1. **Layer thickness** (small, independent): a saved global thickness plus a
   per-export-rect override, used by the 3D preview, STL export and the rig.
2. **Assembly rig tool**: pillars + glue spots, each with automatic
   suggestions that the user accepts/places/removes; exported as a printable
   rig plus glue stencils.

## Part 1 — Layer thickness

- New per-drawing setting `layerThickness` (mm), default **1**. Persisted in
  `DrawingDocument` and `$canvasView` (same path as `mmPerUnit`).
- `ExportRect.customThickness?: number` — undefined/0 means "use global"
  (same convention as `customMmPerUnit`). Add one shared resolver for both
  (`resolveRectMmPerUnit`, `resolveRectThickness`) and replace the inline
  `customMmPerUnit > 0 ? … : …` copies.
- UI: global picker in `GridPaintControls` next to mm/unit: preset buttons
  0.5 / 1 / 1.5 / 2 plus custom (reuse `CustomThicknessInput`). Per-rect
  override in the `ExportRectOverlay` dropdown, next to custom mm/unit, with a
  badge like the `@Xmm` one when set.
- The 3D preview (`ModelViewerModal`, both entry points) and `exportStl` use
  the resolved thickness of each rect. The in-modal picker, if kept, edits the
  rect override when one is set and the global value otherwise (builder's
  call to simplify, e.g. show it read-only with a link to the setting).

## Part 2 — Assembly rig

### Physical model

- **Assembly order** follows the 3D preview stacking: highest layer id goes
  in first (sits on the rig floor), layer 1 last. A per-rect "reverse"
  toggle flips this (mirrors `reverseLayers`). Below, "layer j is below
  layer k" means j is placed before k.
- Layer *k* occupies height band `[z_k, z_k + t]` above the rig floor, with
  `t` = resolved thickness of the rect.
- **Drop-in rule:** every layer must drop straight down to its band. So at
  height z the rig must be empty wherever any layer whose bottom is ≤ z has
  material, grown by the clearance. The full "tray" T is therefore, per
  band k: `T_k = region − offset(∪ layers placed at or before k, clearance)`.
  Cross-sections only shrink going up → no overhangs, printable.
- **Pillar** = a grid point `(x, y)` (cell square `[x±0.5, y±0.5]`, in grid
  units, mm via resolved mmPerUnit and per-layer scale). The pillar's solid
  is `cell ∩ T` per band, i.e. a **stepped** column whose cross-section at
  each band is the cell minus the clearance-grown outlines of all layers
  placed so far. This automatically yields round, U-shaped or straight walls
  that follow the adjacent metal.
- **Pillar height:** up to the top of the highest layer it *touches*
  *(my call: at that layer's own band, the cross-section boundary is within
  clearance + ε of the layer's outline)*,
  plus a small extra (default = stencil thickness, so stencils also
  register), capped where the cross-section stops being printable (min wall
  width / min area, e.g. 1.0 mm). A band where the cross-section is empty
  ends the pillar.
- Pillars may sit outside the drawn shape: candidate points cover the rect
  plus a 2-cell margin. The **base plate** covers the rect + margin
  footprint (simple rectangle with rounded corners; builder may trim it to
  the convex hull of shape + pillars to save filament).
- **Glue spots** belong to an *interface*: a pair of neighbouring layers.
  They are stored with the higher id of the pair, numbered as the user does:
  layer 2's spots are the 1↔2 interface, layer 3's spots are 2↔3. The lowest
  layer has none. A spot is a disk at a half-grid position with a global
  diameter. *(My call)* "Neighbour" means the next lower **visible** layer
  id in the drawing, not literally k−1. An interface whose layers don't both
  have material inside a rect is skipped for that rect.
- *(My call)* The spot is tied to the pair, not to a physical side. Within a
  rect, glue goes onto whichever layer of the pair is placed **first** in
  that rect's assembly order. That layer gives the stencil outline and the
  marker heights. Reversing a rect flips which side that is, but the spots
  stay the same.
- *(My call)* Pillar and glue-spot coordinates use the **canvas grid**
  (scale 1), even when layers have their own `scale`. Layer outlines are
  scaled into canvas grid units before any geometry is computed.

### Defaults (global, per user, not per drawing)

Stored in localStorage as a "print setup", editable in the rig tool panel:

| Setting | Default |
|---|---|
| Clearance (gap between metal and rig wall) | 0.2 mm |
| Base plate thickness | 1.2 mm |
| Min printable wall | 1.0 mm |
| Pillar extra height above top touched layer | = stencil thickness |
| Stencil thickness | 0.6 mm |
| Glue spot diameter | 1.5 mm |
| Glue edge margin | 0.5 mm |

### Suggestions

**Pillars.** For each candidate point compute its stepped cross-sections,
which layers it touches, and the contact normals (sampled along the
touching boundary). A layer is **locked** when its contacts block every
small in-plane rigid motion (tx, ty, rotation). *(My call)* This only checks
in-plane motion. Each layer rests on the one below and is glued, so tipping
and lifting are ignored. Test it by sampling directions in
(tx, ty, θ) space and checking each is blocked by some contact; contacts
in notches (normals spanning >90°) count for a lot. Greedy selection in
assembly order: repeatedly pick the candidate that locks the most
not-yet-locked layers per unit of printed volume, with a bonus for notches
and for reusing one pillar across several layers, and a minimum spacing,
until every layer is locked (or no candidate helps — then warn). Already
placed pillars count first; suggestions only fill what is still missing.

**Glue spots.** For interface (k−1, k): overlap region
`O = layer_k ∩ layer_{k−1}`. Valid centres are points where a disk of
`diameter/2 + margin` fits inside O. Adaptive margin: if a connected
overlap component has no valid centre, retry with smaller margin down to 0,
then smaller diameter down to a floor (e.g. 0.8 mm); if still nothing, place
one dot at the component's most-inside point and flag it. Pick spots on the
half-grid, spaced (~3 cells), at least one per connected overlap component,
more for large components.

### The tool

- New tool **"Rig"** (toolbar + shortcut), works on the export rect under
  the cursor / the selected rect. Two sub-modes in its options panel:
  **Pillars** and **Glue**.
- **Pillars mode:** overlay draws placed pillars solid and suggestions
  ghosted, each with a small label of the layers it holds (e.g. `3·2·1`).
  Click a suggestion to place it, click a placed pillar to remove it,
  click any empty point to place one there. "Accept all suggestions" and
  "Clear" buttons. Per layer a status: locked ✓ / not locked ⚠.
- **Glue mode:** shows spots for the **active layer**'s interface (layer k
  ↔ k−1), with the overlap region tinted. Same click semantics and accept
  all. **Always warn** (red spot + count in the panel) when a placed spot is
  not fully covered by both layers (with margin 0 — margin violations are a
  softer warning).
- Placed pillars and glue spots are saved; suggestions are recomputed live
  (debounced, in a worker if slow) and never saved.

### Storage

- `ExportRect.rig?: { pillars: {x, y}[]; reverse?: boolean }` — pillars are
  per rect since the rig is per rect.
- `DrawingDocument.glueSpots?: { layerId: number; x: number; y: number }[]`
  — per drawing (they describe the design, not a rect), `x, y` in half-grid
  units. New top-level store following the `exportRects` pattern; add it to
  the autosave deps in `useDrawingState`. Objects, not nested arrays
  (Firestore).

### Export

One button in the rig panel exports, for the rect:

- **Rig body:** base plate + pillars.
- **Glue stencils:** one per interface, a flat plate of stencil thickness
  whose outline is layer *k*'s footprint (the layer the glue goes onto)
  shrunk by the clearance, with round holes at that interface's glue
  spots, plus a small engraved layer number. Because it has the layer's
  own outline it drops into the rig and registers on the same pillars.
- **Glue markers:** small triangles on top of pillars (on the top face of
  the pillar step ending at layer k's top) pointing toward the nearest glue
  spot of that interface within a few cells. Engraved or raised by
  ~0.3 mm; on by default, toggle in panel.
- Format: **3MF** with rig and each stencil as separate named objects
  (hand-written XML zipped with `fflate`), plus a fallback zip of STLs.
  All in mm.
- Nice to have: show the rig (and optionally layers exploded above it) in
  the 3D preview.

### Geometry implementation notes

- Layer outlines for a rect: `clipLayersToSelection` →
  `convertLayerToGridLayer` → `generateLayerSvgContent` →
  `classifySvgLoops`, scaled by effective mmPerUnit and layer scale.
- Offsets and booleans: add **clipper2-js** (or clipper-lib) — there is no
  polygon library today. Work in mm, flatten arcs finely (≤0.02 mm error;
  clearance is 0.2 mm).
- Meshing stepped pillars: each band's cross-section is a polygon set →
  extrude per band with three's `ExtrudeGeometry` / `ShapeGeometry`, or
  build directly; merge into one watertight-enough mesh per object (slicers
  tolerate touching/overlapping shells, but prefer union).
- Unit tests: drop-in rule (no rig solid inside any lower layer footprint
  + clearance at any height), touch detection, lock test on simple shapes
  (a plus shape in a 4-notch rig), glue coverage check.

### Non-goals

- Per-layer thickness (one thickness per rect).
- Ordering service / third-party printing.
- Automatic pillar shapes beyond one cell per pillar.
- Undo history for rig edits (layers-only history stays as is).
