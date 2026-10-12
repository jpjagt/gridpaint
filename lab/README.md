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
| `ask FILE "request" [--region R] [--layer ID] [--dry-run]` | Jev routes free text to a registered op: apply (undoable) / candidates sheet / handoff |
| `brief "a delicate airy ring pendant" [--out FILE] [--n 6]` | Jev picks recipe + silhouette/density/symmetry/layers/size -> variants sheet |
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

## Jev in gridlab (`ask`, `brief`)

`gridlab/jev.py` is a urllib client for TypeSafe Jev (model pinned to `jev-1.13.0`, key from `TYPESAFE_API_KEY` or
`lab/.env`). It caches answers in `work/.jev-cache/` by (state, questions), logs every exchange to
`work/.jev-cache/log.jsonl`, and falls back to a keyword `HeuristicJudge` that returns the same answer shapes when
there is no key or a call fails. `GRIDLAB_JEV=off|cache|jev` or `--judge` chooses the judge.
`gridlab/assist.py` uses it only where `docs/jev-experiments.md` shows it works: **language -> closed-set choices**.
It never reads grids or judges beauty. Code computes the metrics, and you or the human look at the PNGs.

- `gl ask work/x.json "fill the holes in layer 3"` builds the op options **from the live registry**
  (hand-written descriptions in `assist.OP_HINTS`, else the op docstring's first sentence). It asks the op Choice
  in forward and reversed order and averages them, then gets the args as Choices plus "was it stated?" Nouls.
  - **conf ≥ 0.7**: applies the edit (one undo entry).
  - **0.5–0.7**, or an essential arg left open (mirror axis, d4 vs rot4, flip axis): writes `x.vN.json` candidates
    plus `work/x.ask.png`, then you run `gl pick`.
  - **`other`, conf < 0.5, or the two orders disagree**: prints `handoff:` with the likely ops. You (the
    coordinator) decide, chain ops for compound requests, or ask the user.

  Code still does the exact work: `--layer` and "layer N" beat Jev, and "bottom half" is a side, not a layer.
  "make the top layer the skeleton of the middle" becomes `copy-layer` then the op. Symmetry ops on off-centre
  designs use `cx/cy` or trim first. Square-only kinds (`d4`/`rot4`/`diag`) resize first.
- `gl brief "..."` chooses the recipe (from the registry: title, description and section) and the buckets. A slot
  the brief does not imply (conf < 0.5, or its `*_stated` Noul is low) uses the recipe default in v1 and is sampled
  from Jev's probabilities in v2..vN. Buckets map onto whatever knobs a recipe exposes
  (`silhouette/shape`, `sym`, `density/fill` as a ×0.6–1.25 nudge, `layers`, `width/height/size`). An empty result is
  re-run with only the choice params.
- Observed with real Jev on `samples/multi_1.json` (18 requests, 22 API calls including briefs):
  - **11 auto-applied, all with the right op**: mirror L->R, remove specks, top = skeleton(middle),
    fill holes in L3, frame, a bit chunkier on the bottom layer, clip-to-below, join the floating bits, swap top and
    middle, "bottom half match the top", and stray dots with `--region`.
  - **3 became candidate sheets**: "4-fold symmetric" (d4 vs rot4), "flip upside down" (axis not stated), and
    "layer 2 hug the outline of layer 3" (conf 0.61: outline vs clip-to-below).
  - **4 were handed off**: "export svg", "I don't love it", "too busy, thin it out" (sym-thin/erode/skeleton tie) and
    "soften the corners" (there is no smoothing op).
  - Briefs: leaf+veins → `venation_spine` D1 2 layers (conf 1.0); airy ring → ring/very-airy/D4 with the recipe
    sampled (conf 0.41); chunky celtic medallion → dense/D4/large, but the recipe was unsure (0.20) because there is
    no truchet recipe.
- Caveats:
  - Adding or renaming an op changes the routing questions, which invalidates the cache (one new call per request).
  - The op descriptions are the main tuning knob, and they are worth more than thresholds. Example: `frame` (border
    around the silhouette) vs `outline` (band around every stroke).
  - What a bucket means per recipe is a heuristic.

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
