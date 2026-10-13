# AI diary — painter-reliquary (theme: reliquaries & icons)

## Piece 1: mandorla (from empty grid, by hand)
- `new 17x27`, vesica outline as ONE `draw line` polyline with `--mirror xy` (9 points, top-left quarter). Worked first try; ASCII confirmed it.
- Wanted coral/frost grown only INSIDE the frame. No "grow inside hull" option and no layer-AND op, so trick: `copy-layer 3 to=4`, `fill-holes` on 4 (= hull), grow on 3, `clip-to-below --layer 3` (= L3 ∩ hull), `layer rm 4`. Works, but it's a 4-command idiom for "mask by another layer" — wants an op `and-layer other=4` / `clip-to layer=N`.
- `variants FILE "...; layer FILE rm 4"` — nice that any command chains, incl. `layer`. First attempt without rm: temp hull layer dominated the contact sheet (no per-variant `--layers` filter for the sheet).
- grow-coral looked rigid/orthogonal (grid-like T-shapes); grow-dla reach=3 n=25 gave restrained frost at the tips and a calm centre (v5). Seeds vary a lot; contact sheet essential.
- `show` writes its PNG to `work/<stem>.png`, NOT next to the file -> parallel agents with same stem would clash; I passed `--png` every time. Same for `variants` sheet (`work/<stem>.variants.png`).
- Composition lesson (cost me ~6 iterations): a top relic needs mid-layer material under it. `support --layer 1 grow=1` makes a bezel on L2 and `support --layer 2` pushes it to L3 — great ops. But the bezel swallowed the frost when the relic was large; shrinking the relic was the fix. Also an `--off fill-rect` erase wiped the frost I wanted to keep: I thought in "relic area" but the frost lived in those columns. A `--highlight` preview before destructive erase would help (dry-run for draw/set?).
- ASCII with a solid backplate becomes a wall of `3`s — composite ASCII is useless there; PNG necessary.
- No CLI for title/notes (title = workspace filename stem from `new`; notes only appended by `gen`). `log` loses provenance of `pick` (it says "pick mandorla.v5.json", not the chain/seed that produced it).
- Accidentally dumped the whole JSON incl. history (each history entry stores full prev state) — ~15k tokens. History of full snapshots makes workspace files huge.

## Piece 2: halo (composed from 2 recipes + hand edits)
- `new 27x27`, `gen coral_seeds --layer-map 1:3` (halo), `gen dla_reliquary` 13x13 octagon (all 3 layers) — both centred by default. Composing via gen-into-workspace is smooth.
- `variants RECIPE --out-dir D --name N`: JSONs land in D but the contact sheet still goes to `work/N.variants.png` (inconsistent).
- `op copy-layer --region R` silently IGNORED the region (copied the whole layer, coral and all). Expected "copy only this rect". Worked around with 4× `op clear --layer 2 --region <rect>` around the octagon. A `--region` that is silently ignored by design ops is a trap; should error or work.
- `fill-holes --region` did respect the region (filled the octagon into a solid back disc) — inconsistent semantics between mask and design ops.
- `set --on '13,5-6' --mirror d4` -> 4 radial spokes joining halo to octagon in one command. Range syntax + d4 mirror = very efficient.
- Lengthening the cross + `support` bloated L2 into a slab (support fills the frost voids under the arms). Undo, shorter cross. `support` would benefit from `--preview`/delta-ASCII of what it adds.

## Piece 3: seed (hand + ops)
- Ring = `draw ellipse 11,11 10,10` (renders octagonal-ish, fine). Seed = stamp a 3x4 quarter with `--mirror xy` — but an even-height stamp mirrored about row 11 leaves row 11 empty (two pieces). Had to `set 9,11 --mirror x`. Mirror stamping should warn "art doesn't reach the axis" or offer `--include-axis`.
- `physarum-link` did NOT link a centre motif to a ring 6-7 cells away (reach 6 and 10, q .6/.8): it only thickened the food lines. Disappointing; the docstring promises links.
- `grow-coral n=50 reach=8` filled the whole square including outside the ring. With the hull idiom (copy-layer→fill-holes→grow→clip-to-below→rm) + `connect`, n=22 reach=4: v1 gave a lovely result (spine suspending the seed, mould frills on the ring).
- Ran two `variants` on the same FILE back to back: the second silently overwrote v1..v4 JSONs of the first (and its sheet). Needs a `--name`/tag for FILE variants or auto-increment.
- Layering recipe that keeps working: L3 = everything incl. organic matter, L2 = the "structure" redrawn with the same draw command, L1 = relic restamped; `support` to patch.

## Piece 4: vein icon (recipe + 4-layer hand stack)
- `gen venation_spine roots=frame --layer-map 1:2,2:3,3:4` into a NEW file + `layer add 1` -> 4 layers. Raw venation fills the whole capsule (horror vacui, reads as ribcage).
- Fix by hand: `draw --off fill-ellipse 8,13 4,5` on L2..L4 (calm void), a spine on L1 (`draw line`), then `support` L1->L2->L3 in a loop. Removed 4 floating 1-cell dots (`set --off 4,9 --mirror xy`) that were separate pieces on L2/L3, added a 1-cell cross-arm node.
- Metric lines after each edit are the best part of the tool: "pieces 5->1", "support 0.93 (2 cells not over L3)" tell me exactly what to fix without opening the PNG.
- Confusing: the delta line after `support --layer 1` prints L2's support (vs L3), not L1's; took a while to read.

## Export
- `export --format design --out` works, but title = workspace stem (`halo`, `seed`...) and notes = only the `gen` lines (hand edits/ops not recorded, the recipe seeds of `pick`ed variants lost). No CLI to set title/notes -> curated files carry poor titles; I did not hand-edit JSON per the rules. Need `gl meta FILE --title --notes` (or `export --title --notes`).

## General
- ASCII composite is great for coordinates (rulers!) and symmetric hand-drawing; PNG needed for any judgement of weight/blobbiness (orthogonal neighbours fuse into slabs that ASCII doesn't convey).
- Typical loop cost: ~1 PNG read per 2-3 edits; contact sheets are the most token-efficient way to choose.

## Top-5 tool improvements (ranked)
1. **Layer-as-mask ops**: `and-layer/clip-to layer=N`, `copy-layer --region` that actually honours the region (today silently ignored), `grow-* within=hull|layer:N`. The 5-command hull idiom was my most-used workaround.
2. **Metadata + provenance**: `gl meta FILE --title --notes`; `pick` should record the variant's chain+seed in log/notes; export should carry the full op log as notes.
3. **Output paths**: `show`/`variants` PNGs and FILE-variants JSONs should live next to the workspace and not overwrite earlier variant runs (`--name`/auto-increment). Parallel agents clash in `work/`.
4. **Preview for destructive / additive edits**: `--dry-run` on draw/set/op that prints the ±diff ASCII (or highlights it in PNG) — would have prevented erasing my frost and the `support` slab.
5. **Stamp/mirror ergonomics**: warn when mirrored art leaves an empty axis row/col (or `--axis-included`), and a `physarum-link` that really bridges motif↔frame (or a `bridge a=x,y b=x,y style=tendril` op for hand-placed organic links).
