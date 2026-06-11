# Configurable Layer Range — Design

**Date:** 2026-06-11
**Status:** Approved, ready for implementation plan

## Problem

The app is hardwired to exactly 6 layers with IDs `1..6`. A specific project needs more
layers and an arbitrary index range (e.g. `-3` to `10`). We want each drawing to configure
its own `min`/`max` layer. Layer fill colors must scale smoothly between a lightest and a
darkest grey across whatever range is configured.

Separately, the editor toolbar's Download button is being removed and replaced by a
**Settings** (gear) button that opens a per-drawing settings modal. That modal also hosts a
**Delete grid** action.

## Decisions (from brainstorming)

- **Scope:** per-drawing. `layerRange` is stored on the `DrawingDocument`, persisted, and
  cloud-synced.
- **Colors:** interpolated at runtime between two anchor greys across the range.
- **Stacking:** higher layer ID renders on top (unchanged semantics, now works for any int).
- **Layer creation:** lazy — the range defines selectable slots; a `Layer` object is only
  materialized when first activated/drawn on (matches current behavior).
- **Delete confirm:** shadcn `AlertDialog` (added via the shadcn CLI; pulls in
  `@radix-ui/react-alert-dialog`).
- **Download:** dropped entirely from the toolbar. Export tool (`X`) remains for file output.

## Data Model

Add an optional layer range to the drawing document and the canvas-view store.

```ts
// src/types or store
interface LayerRange { min: number; max: number }
const DEFAULT_LAYER_RANGE: LayerRange = { min: 1, max: 6 }
```

- Stored on `DrawingDocument` as `layerRange?: LayerRange`.
- Held in a store so the editor reacts to changes. Add to `$canvasView` (it already carries
  per-drawing view config) or a dedicated `$layerRange` atom — implementation plan picks one;
  prefer `$canvasView` to avoid another store to wire through save/load.
- **Legacy load:** missing `layerRange` ⇒ `DEFAULT_LAYER_RANGE`. Nothing else changes for
  existing drawings.
- Layer IDs may be any integer within `[min, max]`, including negatives and `0`.

### Validation rules (enforced in the settings modal)

- `min <= max`.
- The new range must include every layer ID that currently has content. You cannot shrink the
  range to orphan a drawn layer. The modal blocks the change (or clamps min/max to cover all
  drawn layers) and explains why.
- Reasonable hard bounds to prevent absurd ranges (e.g. clamp each of min/max to `[-50, 50]`);
  exact bounds chosen in the plan.

## Color Generation

Today fills come from fixed CSS tokens `--canvas-layer-1 .. --canvas-layer-6`. Replace per-id
lookups with a runtime interpolation helper.

- Add two anchor tokens in `globals.css`: `--canvas-layer-lightest` and
  `--canvas-layer-darkest`, seeded from the current `--canvas-layer-1` and `--canvas-layer-6`
  HSL values (kept identical in light/dark, per existing theming convention).
- New helper, e.g. `getLayerFillColor(id: number, range: LayerRange): string`:
  - normalize `t = (id - min) / (max - min)` (guard `max === min` ⇒ `t = 0`).
  - interpolate H, S, L between the lightest and darkest anchor HSL triples.
  - return `hsl(h s% l%)`.
- For the default `1..6` range the output closely matches today's greys (linear vs. the
  current hand-tuned steps — acceptable; visually near-identical lightest→darkest ramp).
- Update every fill call site that uses `getCanvasColor('--canvas-layer-${id}')`:
  - `src/components/GridPaintCanvas.tsx`
  - `src/components/ImageImportOverlay.tsx` (two `for (id=1; id<=6)` loops → iterate range)
  - `src/hooks/useSelectionRenderer.ts`
- The old `--canvas-layer-1..6` tokens may remain in CSS but become unused for fills; remove
  only if nothing else references them.

## Render Order & Keyboard

- **Render order:** `renderOrder: 6 - layer.id` → `-layer.id` (higher ID on top, valid for
  negatives). Audit both occurrences:
  - `src/lib/blob-engine/BlobEngine.ts:130`
  - `src/components/GridPaintCanvas.tsx:341`
- **Keyboard:** number keys map to layers **by position within the range**, not by raw ID.
  With range `-3..10`, key `1` selects the first slot (`-3`), key `2` the second (`-2`), etc.
  - `LayerControls` regex `^[1-6]$` → `^[1-9]$`, bounded by the number of slots in range.
  - Pressing key `n` activates the `n`-th slot's layer ID (or deactivates if already active).
  - Visible layer buttons and number keys stay aligned because both iterate the range in order.

## LayerControls UI

`Array.from({ length: maxLayers }, (_, i) => i + 1)` assumes IDs `1..N`. Change to iterate
`min..max`:

- Render one button per ID in the range, labeled with the real ID (can be negative).
- Replace the `maxLayers` prop with the range (read from store or passed down).
- Keep per-layer controls (visibility, render style, half-offset, scale) unchanged.
- Horizontal scroll / wrap when the range is wide so the toolbar stays usable.
- "Layer N" indicator and group suffix logic unchanged (already keyed on real `activeLayerId`).

## Toolbar + Settings Modal

### `GridPaintControls.tsx`

- Remove the Download button and its `onDownload` prop usage (the `hasActiveSelection`
  download styling goes with it). `saveIMG` on the canvas and the `handleDownload` wiring in
  `App.tsx` can be removed if unused elsewhere.
- Add a **gear** (Settings) button that opens `<DrawingSettingsModal>`.

### New `DrawingSettingsModal`

Built on the existing shadcn `Dialog`. Contains:

- **Layer range:** Min layer / Max layer number inputs, validated per the rules above. On
  valid change, update the store (and persist via the normal save path).
- **Delete grid:** a destructive action that opens a shadcn `AlertDialog` confirm
  ("Are you sure… cannot be undone"). On confirm: `await drawingStore.delete(id)` then navigate
  to home (`window.location.hash = '#/'`). Mirrors `Home.tsx` delete behavior.

### shadcn AlertDialog

- Add via shadcn CLI: `npx shadcn@latest add alert-dialog` (installs
  `@radix-ui/react-alert-dialog` and `src/components/ui/alert-dialog.tsx`).
- Use it for the delete confirm in the settings modal.

## Affected Files (summary)

- `src/lib/storage/types.ts` — add `layerRange?` to `DrawingDocument`.
- `src/stores/drawingStores.ts` — store the range; load/save defaults; layer create/render-order helpers.
- `src/globals.css` — add lightest/darkest anchor tokens.
- color helper (new, near `getCanvasColor`) — `getLayerFillColor`.
- `src/components/GridPaintCanvas.tsx` — fills, render order, layer-cap (`>= 6`) logic.
- `src/lib/blob-engine/BlobEngine.ts` — render order.
- `src/components/ImageImportOverlay.tsx`, `src/hooks/useSelectionRenderer.ts` — fills/loops.
- `src/components/LayerControls.tsx` — iterate range, key mapping.
- `src/components/GridPaintControls.tsx` — drop Download, add Settings gear.
- `src/components/DrawingSettingsModal.tsx` — new.
- `src/components/ui/alert-dialog.tsx` — new (via shadcn CLI).
- `src/App.tsx` — wire settings modal, drop download wiring.

## Non-Goals

- No eager creation of layers across the range.
- No global/app-wide range setting.
- No change to group/scale/offset features.
- No migration of existing greys to exact interpolated values (visual parity is "close enough").
