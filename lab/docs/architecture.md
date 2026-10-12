# Gridpaint generative lab — architecture contract

Branch `generative-lab` (worktree `~/code/jpjagt/gridpaint-lab`). Exploration study, not product code.

```
lab/
  pyproject.toml          # uv project, package "gridlab" (numpy, scipy, pillow; optional typesafe sdk)
  gridlab/
    model.py              # Design / Layer / Group dataclasses, numpy <-> points
    io.py                 # gridlab-design JSON, gridpaint-selection JSON (read/write), clipboard
    render.py             # PNG renderer faithful to gridpaint blob look + contact sheets
    view.py               # ASCII views with coordinate rulers, metrics text
    metrics.py            # density, components, symmetry scores, holes, layer support, ...
    ops/                  # pure numpy ops: masks, symmetry, morphology, draw, CA, growth, ...
    recipes/              # @recipe generators -> Design (optionally with frames)
    jev.py                # TypeSafe/Jev critic + intent router, heuristic fallback
    cli.py                # `gridlab` CLI (AI-facing tool)
    server.py             # tiny HTTP API for the lab page (re-roll / params)
    build_gallery.py      # runs recipes -> public/lab/gallery.json
  bin/gl                  # wrapper: uv run --project lab gridlab "$@"
  samples/                # user's reference designs (gridpaint-selection JSON) + images
  work/                   # CLI workspaces (design files being edited)
  docs/
public/lab/gallery.json   # static gallery consumed by the /lab page
src/pages/lab/...         # the /#/lab route (TS/React)
```

## Coordinate & layer conventions (match gridpaint)
- Cell key `"x,y"`, integers, y grows downward. numpy arrays are indexed `a[y, x]`, shape `(H, W)`, dtype bool.
- Layer ids follow gridpaint: **lower id = physically higher (top), painted last** in 2D. Bottom/back plate = highest id.
  E.g. sample multi_1: layer 4 = bottom lace, 3 = middle lace+cross, 2 = top cross.
- New designs use ids starting at 1 for the top layer unless specified otherwise.
- Groups: a layer has ≥1 group (`"default"` first). Groups only scope blob connectivity: cells merge/round/bridge only
  with cells of the same group. A cell may be in several groups (acts as a junction). The rendered layer is the union
  of each group's blob shape. Most generators emit only `"default"`.

## Blob rendering semantics (to reproduce in Python)
Per group, per cell, split into 4 quadrants (NE, NW, SW, SE) of size half a cell:
- Filled cell, quadrant Q: **full square** if either orthogonal neighbour on Q's side OR the diagonal neighbour in Q's
  direction is filled; otherwise a **rounded corner** = quarter disc centred at the cell centre, radius = half cell.
- Empty cell, quadrant Q: **diagonal bridge (concave fillet)** if BOTH orthogonal neighbours on Q's side are filled:
  fill the quadrant square minus the quarter disc centred at the cell centre (radius half cell).
- Layer shape = union over groups. Composite: paint layers highest id first, lowest id last.
- Default palette (dark theme like the user's screenshots): background `#020817`; layers by rank from top:
  top `#b8c6dc`, then `#8fa5c2`, `#6680a6`, `#4a5f80`, `#3a4c68`, `#2c3a52`. With a single layer use `#8fa5c2`.

## gridlab-design JSON (v1)
```jsonc
{
  "type": "gridlab-design", "version": 1,
  "id": "dla-ring-s3",            // unique within a gallery
  "title": "DLA ring",            // short
  "recipe": "dla_ring",           // recipe name ("manual", "ai-painter", "sample" allowed)
  "params": { "...": 1 },         // resolved params incl. defaults
  "seed": 3,
  "tags": ["growth", "d2"],
  "notes": "free text: how/why",  // optional
  "width": 24, "height": 32,      // bounding grid; all points within [0,W)x[0,H)
  "layers": [ { "id": 3, "groups": [ { "id": "default", "points": ["x,y", ...] } ] } ],
  "frames": [                      // optional temporal snapshots (growth/CA), last frame == final layers
    { "label": "t=10", "layers": [ ...same shape as layers... ] }
  ]
}
```

## gallery.json
```jsonc
{ "type": "gridlab-gallery", "version": 1, "generatedAt": "ISO",
  "sections": [ { "id": "growth", "title": "Growth", "description": "...", "designs": [Design, ...] } ] }
```

## gridpaint-selection JSON (interop with the editor; paste with Cmd+V)
`{"type":"gridpaint-selection","version":"2.0.0","data":{"layers":[{"layerId":N,"groups":[{"id","points":["dx,dy"]}]}],"bounds":{"minX","minY","maxX","maxY"},"timestamp":ms}}`
Points relative to bounds min. Editor needs the target layer ids to exist; single-layer clips go to the active layer.

## HTTP API (server.py, default port 8765; vite proxies `/api/lab` -> it)
- `GET  /api/lab/recipes` -> `[{name, section, title, description, params: {name: {default, min?, max?, step?, choices?, type}}}]`
- `POST /api/lab/run` `{recipe, params?, seed?}` -> Design
- `POST /api/lab/variants` `{recipe, params?, seeds:[...]}` -> `[Design]`
The page must work without the server (static gallery only; controls disabled).
