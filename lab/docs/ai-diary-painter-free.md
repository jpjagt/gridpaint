# AI diary: painter-free

Brief: free voice, avoid kitsch. Made 4 pieces in `lab/curated/ai_painter/` using only `gl` (plus bash loops that
generate `set --on` coordinate lists and stdin ASCII for `stamp`).

## Pieces
1. **counting-cord** (from empty, 7x31, 2 layers). L1 = beads: each bead is a 4-cell diagonal diamond, which blob
   rendering turns into a round ring with an eye. Beads come in groups of 1-2-3-2-1. L2 = one straight cord
   underneath, longer than the bead run, so its darker tone shows through every eye. 64 cells.
2. **stair-of-hours** (from empty, 25x25, 4 layers). Ring, then `grow-coral n=7 reach=2 kind=d4` (picked from 8
   variants), copied to 4 layers. Each higher layer loses one more quadrant (pinwheel-shaped quadrant regions). Every
   plate is a C of lace. Stacked, the tone climbs around the ring in 4 steps, and the brightest step meets the darkest
   at the top. The spiral exists only in the stack.
3. **growth-fossil** (19x25, 4 layers). One DBM growth (`dla_reliquary` seed 8, eta 1.6, motif dot) run at
   fill 0.05/0.10/0.16/0.24. The runs only add cells, so they nest (checked with `diff`): youngest on top/brightest,
   oldest outermost and darkest. Seed picked with `variants` over a 4-`gen` chain.
4. **unravelled-trellis** (from empty, 15x22, 2 layers). A diagonal lattice (x+y≡0 or x-y≡2 mod 4) stamped from stdin
   ASCII. It is all diagonal links and renders as a quatrefoil trellis. Clipped to a capsule, then cut along one of its
   own lattice lines (stamp mode=clear with a half-plane), so the edge follows the grain. One strand leaves the cut
   edge along a lattice line and ends in a single loose quatrefoil, and only that strand is raised on L1. Asymmetric,
   but every cell is on the lattice.

Rejected: plumb line + bob (it read as "!"), a hand-drawn tendril (it read as "?"/"2"; my hand gestures drift into
glyphs), and a capsule frame + bracket + bead spine (it read as a razor blade/zipper). Also rejected: CA ops (`life`)
applied to a lattice inside a rect region, which leaves hard rectangular seams, and `grow-coral kind=none`, which
makes long straight runs (circuit board, not coral). Ivy as `grow-dla` over the full trellis turned to noise on
noise. Lichen-tide (frame + rot2 grow-coral, 3 nested layers) thickened the frame into 2x2 lumps, and the two bright
blobs read as eyes. Left in work/, not curated.

## Discoveries (good)
- A 4-cell diagonal diamond renders as a perfect ring. Diagonal-only lattices render as quatrefoil lace. These are
  native gridpaint textures and much more beautiful than any symbol I tried. Worth a `lattice` op/recipe.
- Same-seed recipe runs with an increasing `fill` nest, which works as a "process fossil" substitute for frames.
- Delta lines after each edit (cells/pieces/holes/sym/support) are excellent: they caught off-centre lattices
  (symx 0.49) without looking.
- `variants` over a multi-command chain + `pick --clean` was the best part of the loop.

## Problems / findings
- **No way to set title/notes.** Title = workspace file stem. Manual edits (`set`/`draw`/`stamp`/`op`) are not
  recorded in `notes`; only `gen`-placement appends. Exports of hand-made pieces have `notes: ""`. Workaround: I named
  files by slug. Two exported titles are "ramp" and "trellis" (wrong stem). Need `gl meta FILE --title --notes`,
  and `import` should allow `--title`.
- **Default PNG/sheet paths go to `lab/work/<stem>.png`**, not next to the workspace. Parallel agents collide (also
  `variants RECIPE` writes `lab/work/RECIPE.vN.json`). Default should be the workspace's own dir.
- **No access to recipe `frames`** from the CLI (`gen --frame N`, or `gen --frames-to-layers`). I faked it with fill
  sweeps.
- **stdin `stamp` silently drops leading all-blank lines** (my first half-plane clear printed "15x20 art" instead of
  27 rows and cut the wrong area). Only '.' rows are safe. It should keep rows or warn.
- No region shapes beyond rects for `clear`/ops: no half-plane, wedge/sector or polygon. I made a sector by quadrant
  rects and a diagonal cut by generated stamp ASCII. Something like `--where 'x+y>20'` or `--sector a0,a1` would help.
- No layer boolean ops (AND/SUB of two layers, "keep cells within d of point"); `copy-layer mode=or` is the only one.
- No contact sheet for arbitrary files (`gl sheet a.json b.json ...`). I had to Read 3 PNGs one by one.
- `grow-coral`/`grow-dla` grow from every cell of the layer. Growing from one point needs a temp layer and then a
  merge (I used L9, then `layer rm`). A `from=x,y` param would help.
- `grow-coral n=` counts orbits (×8 for d4), which is easy to overshoot: n=30 filled the whole canvas.
- Variant tiles in big sheets are small (25x25 at ~200px). I rendered favourites separately at cell-px 16-20.
- zsh: `P="k=v k=v"` doesn't word-split (my error, but `gen` gave a confusing float-parse error).
- `show` per-layer ghost panels are good. Composite tone differences are subtle in `render`, so tone-based ideas
  (stair) need a high-contrast view.
- Careless `rm $D/en*` deleted my main workspace. A `gl rm-variants` or trash would be nicer.

## Top-5 tool improvements (ranked)
1. `gl meta FILE --title --notes` + automatic notes log of all manual commands in the export.
2. Per-workspace output paths for show/variants PNGs and variant JSONs (no shared `lab/work/` collisions).
3. Non-rect selections: `--where` expression / half-plane / sector / polygon / "within d of x,y", plus layer
   booleans (and/sub/xor between layers).
4. Frames access: `gen --frame N` and `--frames-to-layers 1,4,8,12`, for process-fossil stacks.
5. `gl sheet FILES...` contact sheet with large tiles, and a `lattice` op (diagonal mesh/quatrefoil/ring-chain
   generators). Also fix stdin stamp dropping blank leading lines.
