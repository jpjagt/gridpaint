# Pendant Case Generator (`casegen`) — Design

Date: 2026-06-11
Status: approved by Jeroen (brainstorming session)

## Purpose

A parametric Python tool that generates watertight STL masters (body + lid) for
cast cases that hold laser-cut layered pendants. The masters are 3D-printed,
silicone molds are made from them, and the final cases are cast in hard resin
or plaster. First target: the starflower pendant (short variant); the tool is
shape-independent so further cases are just new config folders.

## Inputs & repository layout

```
3d-models/
  casegen/                          # the tool (shape-independent)
    casegen.py                      # CLI entry
    ...support modules
  case-starflower-pendant-short/    # one folder per case
    case.toml                       # ALL parameters for this case
    dxfs/...                        # footprint outline (mm units)
    svgs/...
    output/                         # generated: body.stl, lid.stl, previews
```

- CLI: `uv run casegen.py <case-dir>/case.toml [--preview-only]`
  (dependencies declared inline via PEP 723; plain `python` + pip also works).
- Footprint input: DXF (closed POLYLINE/LWPOLYLINE, mm) is primary; SVG
  fallback. Only the outer outline is used; interior holes are ignored.
- Starflower footprint: single closed polyline, ~25.2 × 32.4 mm, long axis
  along y. Pendant stack height: **4 mm** (4 × 1 mm layers).

## Geometry model

Both parts are built as **two heightfields (top/bottom surface) over a 2D plan
domain**. All plan boundaries come from 2D geometry (shapely polygons / signed
distance fields). No CAD kernel.

### Plan (top-down) geometry

- **Pocket outline** = footprint buffered outward by `pocket_clearance`
  (mm, radial). An optional flat shelf band of width `rim_flat_width` at rim
  height surrounds the pocket before the slope begins (set 0 to disable).
- **Outer silhouette** = superellipse `|x/a|^n_plan + |y/b|^n_plan = 1`,
  centered on the footprint bbox center, with `a = footprint_halfwidth +
  margin_x`, `b = footprint_halfheight + margin_y`; `n_plan = 2` is an
  ellipse, larger values go squircle/pillowy.
- The silhouette is **smooth-unioned** (exponential smooth-min on SDFs,
  sharpness `neck_k`) with two **bolt-tab circles** of radius `tab_radius`
  centered at `(0, ±(b + tab_offset))` — the silhouette "necks" steeply but
  smoothly toward the bolt rings at the top and bottom ends of the plan view.

### Vertical geometry & surfaces

Let `z = 0` be the table. Seam (equator) height `z_eq = z_rim + slope_drop`.

- **Parting ("pillow") surface** — the body's top / mating surface.
  With `t ∈ [0,1]` the normalized position between pocket rim (`t=0`) and
  silhouette (`t=1`), computed as `t = d_pocket / (d_pocket + d_edge)` from
  the two SDFs, and `θ` the angle from the pillow center `c` (pocket centroid
  + `pillow_center_offset`):

  ```
  z_part = z_rim + slope_drop · [ w(θ)·f_axis(t) + (1 − w(θ))·f_diag(t) ]
  f_axis(t) = t^a / (t^a + (1−t)^a)     # sigmoid; a = profile_axis_a (≈2.5)
  f_diag(t) = 1 − (1−t)^b               # steep→flat; b = profile_diag_b (≈2.2)
  w(θ)      = |cos 2θ|^k                # quarter blend; k = quarter_sharpness (≈1.5)
  ```

  Both profiles have zero slope at `t=1`, so the surface meets the outer edge
  horizontally — no lip. Axes (θ = 0°, 90°, …) get the sigmoid, diagonals get
  the steep-start curve, giving four pillow-shaped quarters.

- **Lid top (dome):** `z = z_eq + lid_height · (1 − ρ^p_side)^(1/q_side)`,
  where `ρ ∈ [0,1]` is the normalized plan radius derived from the silhouette
  SDF (1 at the silhouette). Vertical tangent at the seam.
- **Body underside (belly):** mirrored dome with `belly_depth > z_eq`,
  clipped at `z = 0` → the **flat bottom** emerges automatically; deeper
  belly = smaller flat. Vertical tangent at the seam, so the closed case
  reads as one continuous pebble.
- **Lid underside** = `z_part + fit_gap`, with the gap scaled by
  `sqrt(1 + |∇z_part|²)` so clearance is uniform along the surface normal.

### Features

- **Pocket:** total depth `stack_height + pocket_clearance_z`, split by
  `pocket_body_fraction` (default 0.66): floor sits that fraction below the
  rim in the body; the remainder is a matching recess up into the lid so the
  pendant is held without rattle. Walls vertical, floor/ceiling flat.
- **Chain channel + trough:** carved into the **body's** parting surface only
  (the lid underside stays smooth, so these become enclosed voids when the
  case is closed).
  - **Trough:** a closed **stadium ring** (ellipse with straightened sides)
    that **loops around the pocket**, sitting in the slope region. Centerline
    derived from the pocket outline offset by `trough_offset`, straightened
    along the sides; fully overridable via explicit center/size parameters.
  - **Channel:** straight notch from the top edge of the pocket to the ring.
  - Both have a **U-shaped cross-section** (`chain_width`, `chain_depth`,
    semicircular bottom), depth measured perpendicular from the local parting
    surface so the groove is uniform even on the slope.
- **Bolt tabs (×2):** vertical through-hole `bolt_hole_d` (default 4.4 mm for
  M4) through lid and body at each tab center.
  - Lid: a **flat annular ring seat** at height `ring_z_top`; the dome
    funnels down into it with the same smooth-min blending (`ring_blend_k`).
  - Body: tab underside lands at `z = 0` (helps the case stand); flat-ceiling
    counterbore `nut_recess_d` × `nut_recess_h` from below so a nut can be
    epoxied in, making the case operable from the top bolt only.
- **Magnet pockets (optional, off by default):** blind holes opening at the
  parting surface on both halves, `magnet_d + 0.3 mm` × `magnet_h + glue
  allowance`, at parameterized positions.

## Closure rationale (decided)

Through-bolts in compression are the plaster-friendly closure: no sliding
contact (threads/bayonets wear and chip gypsum), no rotation required (so the
non-rotationally-symmetric pillow seam is preserved). Hardware: e.g. brass M4
with knurled head; nut hidden in the bottom recess.

## Meshing & output

- Constrained Delaunay triangulation (`triangle` package) of the plan domain
  with all feature outlines (silhouette, pocket, shelf, trough, channel, bolt
  circles, ring seats) as hard edges; target edge length `mesh_size` with
  refinement near the silhouette (vertical-tangent zone).
- Each vertex gets region-dependent z values; vertices on discontinuity edges
  (pocket walls, bolt holes, counterbores) are duplicated to produce exact
  vertical walls.
- Top, bottom, and wall patches are stitched into watertight meshes; manifold
  and watertightness asserted via trimesh before STL export.
- Outputs per case: `body.stl`, `lid.stl` (lid exported dome-down i.e.
  print-friendly orientation as a parameter), `preview.png` (plan +
  3D shaded), `profile-sections.png` (cross-sections along both axes and both
  diagonals, body and lid overlaid, so slope parameters can be tuned without
  a slicer).

## Casting plan (informational)

- **Body:** one-piece open-face silicone block mold, poured through the flat
  bottom (the one flat face is the pour/screed plane). Detail forms face-down;
  the mild equator overhang releases by flexing the silicone.
- **Lid:** two-part mold — block mold forms the dome, a silicone cap plate
  forms the pillow underside; pour hole + vents at the high points through
  the cap. Vibrate (plaster) or pressure-pot (resin) against bubbles.

## Parameters (case.toml)

All lengths in mm. Defaults shown for the starflower-short case.

| Group | Parameter | Default | Meaning |
|---|---|---|---|
| input | `footprint_path` | dxfs/…layer-1.dxf | relative to case.toml |
| shape | `stack_height` | 4.0 | total pendant thickness |
| pocket | `pocket_clearance` | 0.5 | radial buffer around footprint |
| pocket | `pocket_clearance_z` | 0.5 | extra vertical room |
| pocket | `pocket_body_fraction` | 0.66 | share of depth in the body |
| pocket | `rim_flat_width` | 1.0 | flat shelf band before slope |
| plan | `margin_x`, `margin_y` | 9.0, 9.0 | silhouette half-axis margins |
| plan | `n_plan` | 2.3 | plan superellipse exponent |
| tabs | `tab_radius` | 7.0 | bolt-tab circle radius |
| tabs | `tab_offset` | 2.0 | tab center beyond oval end |
| tabs | `neck_k` | 6.0 | smooth-union sharpness (higher = tighter neck) |
| heights | `z_rim` | 6.0 | parting surface at pocket rim |
| heights | `slope_drop` | 6.0 | rise from rim to seam (z_eq = 12.0) |
| heights | `lid_height` | 9.0 | dome height above seam |
| heights | `belly_depth` | 16.0 | virtual belly depth (> z_eq → flat bottom) |
| profile | `profile_axis_a` | 2.5 | axis sigmoid exponent |
| profile | `profile_diag_b` | 2.2 | diagonal profile exponent |
| profile | `quarter_sharpness` | 1.5 | angular blend exponent k |
| profile | `pillow_center_offset` | (0, 0) | shift of pillow center vs pocket centroid |
| side | `p_side`, `q_side` | 2.5, 2.5 | dome/belly superellipse exponents |
| fit | `fit_gap` | 0.15 | lid/body clearance along normal |
| chain | `chain_width` | 2.4 | groove width |
| chain | `chain_depth` | 2.0 | groove depth below local surface |
| chain | `trough_offset` | 3.0 | ring distance from pocket outline |
| chain | `channel_at` | "top" | channel exit point on pocket |
| bolt | `bolt_hole_d` | 4.4 | through-hole (M4) |
| bolt | `ring_z_top` | 14.5 | lid ring seat height |
| bolt | `ring_d` | 11.0 | flat ring seat diameter |
| bolt | `ring_blend_k` | 5.0 | dome→ring funnel sharpness |
| bolt | `nut_recess_d`, `nut_recess_h` | 8.4, 3.5 | M4 nut pocket from below |
| magnets | `magnets_enabled` | false | optional magnet pockets |
| mesh | `mesh_size` | 0.5 | target triangle edge length |
| mesh | `lid_print_orientation` | "dome_down" | STL export orientation |

Defaults are starting points, expected to be tuned via `--preview-only`
iterations.

## Validation & error handling

- Reject open/self-intersecting footprint polylines with a clear message.
- Assert geometric sanity: pocket (+ shelf + trough + channel) must fit inside
  the silhouette with positive slope-band width everywhere; pocket depth split
  must leave ≥ 1.5 mm material under the pocket floor and above the lid
  recess; tab recesses must leave ≥ 2 mm web between counterbore ceiling and
  ring seat.
- Assert output meshes are watertight and manifold (trimesh) before writing.

## Testing

- Unit tests for: DXF/SVG loading (the real starflower file as fixture),
  profile functions (endpoint values and end slopes: `f(0)=0, f(1)=1,
  f'(1)=0`), SDF/`t`-field sanity, and mesh watertightness/manifoldness of a
  full generation run on the starflower case.
- Golden-number checks: bounding box of generated body/lid vs expected
  dimensions from parameters.

## Out of scope (for now)

- Mold-negative generation, STEP output, bayonet/thread variants, GUI.
