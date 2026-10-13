# AI diary: painter-oracle ("mould oracles")

Brief: place meaningful nodes first, let growth ops connect and overgrow them, then curate. I used only `gl`. The one
exception was `python3 -c` to *read* an exported JSON and check whether a title had been set. I never wrote JSON.

## Pieces (lab/curated/ai_painter/)
- `painter-oracle-pulli-corona-ring.json` (31x31, annular). Eight 3x3 pulli rings (kolam dots) on r=11. grow-coral
  d4 (seed 3) clipped to an annulus guide. L1 = the 4 cardinal pulli raised. L3 = a narrow solid band (r 10-12), so
  the coral tips fray past it like a corona. The title inside the file is "ring" (see findings).
- `painter-oracle-caput-cauda-earrings.json` (33x29, pair). These are the geomantic figures Caput Draconis (2,1,1,1)
  and Cauda Draconis, which are vertical flips of each other: the dragon's head and tail make a natural earring pair.
  Steps: plus nodes, then physarum-link, then grow-coral kind=x (seed 8), clipped to a capsule guide. Back =
  derive-backplate hull grow=1, which gives a feather-shaped silhouette. Top = figure dots on a thin staff. Then
  `resize anchor=topleft`, `mirror axis=x`, `flip axis=y --region` on the right half.
- `painter-oracle-pleiades-scrying.json` (21x33). The Pleiades in the top half, mirrored in "water" (mirror y).
  `connect` drew straight constellation-like chords and grow-coral (kind=y, seed 3) added the mould, which formed a
  rune-like X/H. Back = the oval scrying mirror as a 1-cell rim plus dilate(lace), then `close` to kill pinholes. Top =
  Alcyone and its reflection.
- `painter-oracle-augury-lozenge.json` (21x31). The 15x15 sigil-trace of "augury" (saturn kamea) is a lozenge with a
  crossbar. I placed only its 4 vertices and let physarum-link, connect and a light grow-coral (n=12) re-draw the sigil
  by themselves (seed 1). Top = the raised crossbar with plus ends. Back = derive-backplate laced.
- Dropped: a full "oracle" saturn sigil (seal) with mould around it. It came out as a busy starfish/pentagram, which is
  kitsch.

## What worked
- Guide-layer trick: draw the silhouette (annulus, capsule, oval) on the layer *below* the work layer, grow freely, then
  `clip-to-below`. That gave me arbitrary clip masks.
- `connect` is the hidden star for oracles: it makes straight, symmetric chords between nodes, which read as
  constellation or sigil lines. Overgrowing them lightly with grow-coral makes it look organic.
- `variants` with an op chain plus `layer FILE rm 4` at the end of the chain hides the guide layer in the sheet.
- derive-backplate hull grow=1 gives good organic silhouettes. `laced` keeps the lace legible.

## Where I got lost or misread
- `stamp --at` is the TOP-LEFT corner, not the centre. I placed 5 nodes off by one and had to `shift` them.
- `physarum-link` only makes shortest links when nodes are close: 3-11 new cells, and `q` barely changed anything. On
  far single-cell nodes it fragmented (6-15 pieces). I had to add `connect`.
- grow-coral n=30 on a 21x31 canvas was already soupy. n≈12 is the restraint zone.
- ASCII only shows the topmost layer, so a guide or storage layer hides what I'm working on. Dilating lace always
  gives a solid blob, so a "laced back" needs derive-backplate.
- `undo -n 3` undid steps I didn't expect. The log shows commands but not which are the latest undo points. I had to
  re-run `show` to learn what state I was in.
- `move-layer` errors if the target exists, even when it's empty. Removing empty layers needs another command.

## Missing / confusing
- There is no way to set title or notes (`gl meta FILE title=... notes=...`). The title is frozen to the stem at
  `new`, and `import` keeps the old one. All my curated pieces have empty notes, and the ring is titled "ring".
- `show`/`variants` write PNGs to `work/<stem>.png`, not next to FILE. That risks clashes between parallel agents
  (two `ring.json` would collide).
- Running `variants` a second time silently overwrites `FILE.vN.json` from the previous run. There's no `--tag`.
- The `variants` placeholder is integer-only: no `q=0.3,0.5` and no `planet=saturn,jupiter`. Op params need `--sweep`
  like recipes have.
- Missing ops and commands:
  - `clip --to-layer N` / `and-layer` / `or-layer`, which would replace the guide-layer hack. copy-layer mode=or
    exists, but there's no AND with an arbitrary layer.
  - `fill-holes max_size=`, to remove pinholes without filling the windows.
  - `scale` for a stamp or layer (to enlarge a sigil).
  - `stamp --at` with a list of points, or `--center`. I wrote bash loops.
  - A contact sheet of arbitrary files, with a layer filter (`gl sheet a.json b.json --layers 2`).
  - `variants --layers`, to show only some layers.
  - A `corners`/`vertices` op for sigil turning points. tip-dots only gives ends and junctions.
- Render colours: back and middle layers have low contrast in `render`, so relief is hard to judge.

## Top-5 tool improvements (ranked)
1. `gl meta FILE title= notes= tags=` (curation needs it; currently impossible).
2. Layer-to-layer boolean ops (`clip-to-layer N`, `and/or/sub-layer`) so silhouettes can mask growth directly.
3. `variants`: `--sweep` for op params (floats and strings), `--layers` filter, `--tag` to avoid overwriting, and
   output beside FILE.
4. `gl sheet FILES... [--layers]`: compare arbitrary candidates side by side. I rendered and Read 3-6 PNGs one by one.
5. Node-placement helpers: `stamp --center --at 'x,y x,y ...'`, `scale`, and `vertices` (sigil corners), plus
   `fill-holes max_size`.
