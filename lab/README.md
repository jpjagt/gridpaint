# gridlab

Python toolkit to generate, look at and edit **gridpaint** designs (pixel-grid blob drawings for
laser-cut layered jewellery). Contract: `docs/architecture.md`.

```sh
cd lab && uv sync            # once
bin/gl                       # = uv run gridlab ; lists commands
bin/gl CMD -h                # help per command
uv run pytest                # tests
```

## Conventions (read once)

- Cells are `x,y`, **y grows down**. Regions are **inclusive** `x0,y0,x1,y1`. Coordinates are always absolute
  (ASCII rulers / PNG rulers show them).
- **Layer 1 = physically top**, painted last. Bottom/back plate = highest id. Every upper cell should sit on
  material of the layer directly beneath (`support` metric).
- Diagonal neighbours render as **connected** (concave bridges), so "pieces" are counted 8-connected.
- Groups only scope blob connectivity. Edits go to group `default` unless `--group G`.

## How to work (agent loop)

1. **Look**: `bin/gl show work/x.json` → header (size, bbox, centre), ASCII composite
   (char = topmost layer id, `.` empty), metrics, and a PNG path. **Open the PNG** (Read tool): composite +
   each layer with the layer below ghosted, grid lines every cell, brighter every 5, rulers every 5.
   Zoom: `--region 0,0,15,12`, single layer: `--layer 2`, mark an area: `--highlight x0,y0,x1,y1`.
2. **Small edit** (each prints `ok: ...` + per-layer delta: cells, pieces, holes, symx/symy, support).
3. **Look again.** `undo` freely (`undo FILE -n 3`, `log FILE`). `diff A B` shows `+`/`-` per cell.
4. **Choose between options** with `variants` → contact sheet PNG → `pick`.
5. **Use symmetry so you only draw one quadrant**: draw in the top-left, then `op FILE mirror axis=xy`
   (or `symmetrize kind=d4`), or add `--mirror xy` to `set`/`stamp`/`draw` so every edit is mirrored live.
   Check `header` for `centre` vs `canvas centre`: if the design is off-centre, pass `cx=`/`cy=` to `mirror`
   (or `op FILE center` first).
6. Export: `bin/gl export FILE --clipboard` then Cmd+V in gridpaint (target layer ids must exist there).

## Commands

| command | what |
|---|---|
| `new FILE --size WxH [--layers 3,2,1]` | empty workspace |
| `import SRC FILE [--trim N]` | SRC = path, `clipboard`, or `-`; gridpaint-selection or gridlab-design JSON |
| `export FILE [--clipboard] [--out p.json] [--format selection\|design] [--no-trim]` | selection JSON is bbox-trimmed |
| `show FILE [--region R] [--layer ID] [--png P] [--no-png] [--no-ascii] [--no-metrics] [--groups] [--highlight R]` | the main "look" command |
| `render FILE [--out P] [--cell-px 16] [--grid] [--layers 2,3]` | plain render (no panels) |
| `set FILE --layer ID [--on 'x,y x,y'] [--off '...'] [--group G] [--mirror xy]` | ranges: `3-6,2` = 4 cells |
| `stamp FILE --layer ID --at x,y [--mode set\|or\|and\|xor\|clear] [--text '##./.#.']` | art from `--text` (`/` = newline) or stdin; `#` on, `.` off, space = unchanged |
| `draw FILE --layer ID line x0,y0 x1,y1 [...]` | also `rect`, `fill-rect`, `ellipse cx,cy rx,ry`, `fill-ellipse`, `ring cx,cy rx,ry --thickness T`, `point`; `--off` erases |
| `op FILE NAME [--layer ID\|A,B\|all] [--group G] [--region R] k=v ...` | registered ops, see `ops` |
| `ops [NAME]` | list ops + params |
| `gen FILE RECIPE [--seed N] [k=v] [--layer-map 1:3] [--at x,y] [--mode or\|replace\|area]` | run a recipe; creates FILE if missing, else places it (centred by default) |
| `variants FILE "cmd FILE ...; cmd FILE ..." --seeds 1..6` | runs the chain on copies `FILE.vN.json` (`{seed}` substituted; `gen` gets `--seed`), sheet `work/<name>.variants.png` (v0 = current) |
| `variants RECIPE [k=v] --seeds 1..6 [--sweep k=a,b,c]` | recipe variants → `work/RECIPE.vN.json` + sheet |
| `pick FILE.vN.json FILE [--clean]` | adopt a variant (undoable); `--clean` deletes the siblings |
| `undo FILE [-n N]`, `log FILE`, `diff A B [--layer ID] [--region R] [-q]` | history / compare |
| `metrics FILE [--json]` | full metrics |
| `layer FILE add\|rm ID` | add/remove layers |
| `recipes [NAME]` | list recipes / show params |
| `serve [--port 8765]` | HTTP API for the /lab page |
| `gallery [--out ../public/lab/gallery.json] [--seeds 3] [--only a,b]` | static gallery |

Useful ops: `mirror axis=x|y|xy|diag keep=... cx= cy=`, `symmetrize kind=d2|d4|rot2|rot4`, `sym-or kind=`,
`dilate/erode/open/close n= conn=4|8`, `skeleton`, `fill-holes`, `remove-small min_size=`, `keep-largest`,
`outline d= thickness= mode=or|replace`, `fill shape=capsule`, `clip shape=ellipse`, `invert within=`, `shift dx= dy=`,
`flip axis=`, `clear`; design-level: `copy-layer to=`, `move-layer to=`, `swap-layers`, `merge-groups`,
`clip-to-below` (remove unsupported cells), `support grow=` (add material below), `trim margin=`, `pad n=`,
`resize w= h=`, `center`. With `--region` a mask op only sees that rectangle (its centre is the mirror axis).

Example:
```sh
F=work/pendant.json
bin/gl new $F --size 17x25 --layers 3,2,1
bin/gl op $F fill shape=capsule --layer 3 && bin/gl op $F outline d=0 thickness=2 mode=replace --layer 3
printf '..##..\n.#..#.\n#.##.#\n' | bin/gl stamp $F --layer 2 --at 1,1 --mirror xy
bin/gl draw $F --layer 1 line 8,4 8,20 && bin/gl op $F support --layer 1
bin/gl show $F                       # then Read work/pendant.png
bin/gl variants $F "op $F clear --layer 2; gen $F symmetric_noise --layer-map 1:2 width=13 height=21" --seeds 1..6
bin/gl pick work/pendant.v4.json $F --clean
```

## Python API (for recipe/op authors)

- `gridlab.model`: `Design(width, height, layers, id, title, recipe, params, seed, tags, notes, frames)`,
  `Layer(id, groups)` (`.mask` = union), `Group(id, cells)`; `Design.from_masks({id: mask})`, `.layer(id, create=)`,
  `.layers_top_to_bottom()`, `.copy()`, `.crop/pad/translate/trim/resize/paste`, `.bbox()`; `mask_bbox`, `shift_mask`, `paste_mask`.
- `gridlab.io`: `load_any`, `loads_any`, `load_design`, `save_design`, `design_to_dict`, `design_from_dict`,
  `selection_to_dict`, `to_selection_json`, `design_from_selection`, `copy_to_clipboard`, `read_clipboard`.
- `gridlab.render`: `render`, `render_layers_panel`, `contact_sheet`, `layer_alpha`, `layer_colors`, `PALETTE`.
- `gridlab.view`: `ascii_composite`, `ascii_layer`, `ascii_mask`, `ascii_diff`, `layers_legend`, `groups_info`, `header`.
- `gridlab.metrics`: `mask_metrics`, `design_metrics`, `summary_text`, `symmetry_scores`, `pair_metrics`, `rendered_support`.
- `gridlab.ops`: `masks` (ellipse, circle, rect, capsule, ring, diamond, shield, distance_from_edge, distance_to_mask,
  offset_outline), `symmetry` (mirror, symmetrize_d2/d4, rot_sym, symmetry_or/and, images), `morph` (dilate, erode,
  open_, close, fill_holes, remove_small, keep_largest, skeletonize, label, neighbour_count), `draw` (line, polyline,
  rect, ellipse, ring, set_points, stamp_ascii), `registry.register_op(name, kind="mask"|"design")`.
  Any module in `gridlab/ops/` is auto-imported, so new ops appear in `gl ops`.
- `gridlab.recipes`: `@recipe(name, section, title, description, params={k: Param(default, min, max, step, choices)}, tags)`
  on `fn(seed, **params) -> Design`; `register_section(id, title, description)`; `run_recipe`, `list_recipes`.
  Any module in `gridlab/recipes/` is auto-imported. Seed all randomness from `seed`.
