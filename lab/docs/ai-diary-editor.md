# AI diary: editor (AI as editor + algorithm from a sketch)

Work dir: lab/work/editor/. Output: curated/ai_editor/01..08 (before/after), curated/grow_from_sketch/01..03.

## Jev routing scorecard (gl ask)

| # | request | Jev | verdict |
|---|---|---|---|
| 1 | complete the symmetry (half-drawn single_1) | symmetrize 0.71 → candidates d2/d4 | right op, d2 right. d4 candidate is pointless for an 11x21 portrait shape: the aspect ratio should prune it |
| 2 | frame on bottom layer, 1-cell gap | frame --layer 4, 0.96, applied | right op and layer. **Ignored "1-cell gap"**: default d=1 touches. Needed d=2 |
| 3 | small 4-fold motif in empty middle, new top layer | motif --layer 3, 0.94, applied | right op family, **wrong layer** (wrote into the ring layer, ignored "new top layer"), kind=cross is not 4-fold |
| 4 | ends more mouldy, keep symmetric | handoff (noise-fill/grow-coral/grow-dla) | fair handoff: there's no op that grows "at the ends" |
| 5 | one blob in the middle, lacier, keep the cross | handoff (height-threshold 0.25) | fair. The request was ambiguous (the "middle layer" L4 is already lace; the blob is L5) |
| 6 | turn this into a 3-layer piece | handoff (height-threshold 0.35) | fair, compositional request |
| 7 | connect loose pieces, one piece/layer | connect 0.93, applied to all | right op, **bad result**: symmetry broke (canvas off-centre, symx 0.18) and it also edited L4 per group |
| 8 | less busy, thin by a third, keep rhythm | handoff (order disagreement) | fair, as the README predicts |

So: 4/8 auto-applied or candidates with the right op, but 2 of the 3 auto-applies needed undo (the arg or layer was wrong, or the op misbehaved). When Jev applies, the op is right, but its "conf ≥ 0.7 → apply" trusts args it never extracted (gap distance, new layer, 4-fold).

## What I tried / what worked

- 1: symmetrize keep=tl propagates the TL scribbles (good: user intent) but silently drops the bottom-left edit. A "majority vote across the orbit" symmetrize would suit a half-drawn design better.
- 2: frame d=2 looks like the user's sample 1 (frame around lace). The frame is necessarily its own piece.
- 3: motif kind=star reads as a snowflake (kitsch). The kufic seal sits in a heavy square box. A small plus grown with grow-coral kind=d4 n=3 reach=2 gave a rosette that matches the ring's mould texture. That's the "grow from a seed motif" pattern again. The motif floats (support 0), and no op makes spokes or a backplate under a floating island and ties it to the ring.
- 4: grow-coral on the top-end region filled the inner loops (blobby). grow-dla n=6 reach=3 kind=x on the region, then mirror y, gave tendrils. With --region, D2 would mirror inside the region, so I used kind=x + mirror axis=y.
- 5: worley-edges on a 9x19 blob stays blobby. `outline d=0` on a 3-wide body keeps almost everything. sym-thin gave the right thing.
- 6: contrast-layer merge=True (the default) writes a fat blob into the lace: avoid it. derive-backplate mode=laced came out solid (0 holes) for this dense lace. mode=lace = rim + a floating spine (2 pieces). Final: frame + grow-coral on the frame (corner tendrils looked like insect legs, so I cleared them by region).
- 7: **groups matter for laser cutting**. `connect` works per group, so it added 22 cells and left 2 union pieces. `merge-groups` changes the *rendered* look (diagonal bridges now form across groups) but the delta printout says "(no change)". After merge-groups, connect needed only 4 cells.
- 8: no "thin by X%" op. spur-prune n=2 gave −23% and kept half the loops. Two hand-removed knob spurs with --mirror xy brought it to −29%. Opening all the loops by hand killed the rhythm.
- Sketch → organic: plain grow-coral/grow-dla on a 1-cell sketch only adds orthogonal stubs ("circuit board"), not mould. What worked for the oval+cross: dilate → noise-fill kind=x → connect → skeleton → mirror → grow-coral. On ring+nodes and spine+ribs, grow-coral alone was already good (seeds 7 and 8 of 8). Spine+ribs → coral tree of life is the best piece of the session.

## Friction / findings

- No way to set **title/notes** from the CLI (export has no --title/--notes; notes are not auto-filled from the op log). I used `jq` on the exported metadata fields only.
- `gl ops` list prints `motif name=cross`, but the op takes `kind=` (the error message says so). The doc and the param disagree.
- `show` writes its PNG to `work/<stem>.png`, not next to FILE in a subdir. Parallel agents clobber each other unless they pass --png. Same for `variants` sheets and `ask` sheets (`work/t1.ask.png`).
- Off-centre canvases (even size with odd content, or `single_2` sitting left) silently break mirror-based ops: connect sym=auto, sym-thin. I had to remember `trim` first every time. Ops should mirror about the design centre by default, or at least warn.
- `--region` + symmetric kinds: the mirror axis becomes the region centre. That's correct but easy to forget. "Grow only at the ends" needed kind=x + a mirror afterwards.
- sym-thin sym=x leaves 2–3-wide solid blocks (it can't remove mirrored pairs). skeleton + mirror worked better.
- PNG vs ASCII: at contact-sheet scale, diagonal-bridged lace looks solid. I suspected 2x2 blocks that weren't there (break-2x2 said no change). The ASCII told the truth.
- After `pick`, the `undo -n 1` I meant for the variants undid only a no-op lace-clean. The no-change op still created a history entry. Ops with no change shouldn't log.
- zsh: `$c` with spaces doesn't word-split (my problem, but `gl` could accept a single quoted "op args" string).
- `cp`/`mv` are aliased -i on this machine, and `cp` silently skipped overwrites. Not gl's fault, but it caused stale variant files.

## Ideas

- `gl ask` should extract numeric/spatial args it can parse in code ("1-cell gap" → d=2, "new top layer" → layer add + target, "4-fold" → d4/rot4 kinds) before deciding to auto-apply.
- A `describe FILE` command: a 5-line natural-language summary (silhouette, symmetry, pieces per layer, floating islands, dense spots). That's what I reconstructed manually from metrics + PNG every time.
- `thin pct=33 keep=loops`: remove the lowest-importance orbit cells (spurs first, then loop-doubling) until a target fraction is gone.
- `anchor` / `spokes` op: tie a floating island (top motif) to the surrounding structure, or add a minimal backplate below it.
- Group-aware piece metric: report rendered pieces (union, with blob rules), not just pieces8, and flag group-induced splits.
- `grow-coral` diag bias param so sketches get mould, not circuit stubs.

## Top-5 tool improvements (ranked)

1. **Auto-centre or warn for symmetric ops on off-centre canvases.** This caused silent asymmetry in connect, sym-thin and symmetrize in 4 of 11 tasks.
2. **`gl ask` must parse and honour stated args** (distance, layer intent such as "new top", symmetry order) or downgrade to candidates. 2 of 3 auto-applies needed undo.
3. **Title/notes on export** (`--title --notes`), plus auto-notes from the op log.
4. **Per-file output paths** for show/variants/ask PNGs (next to FILE), so parallel agents don't collide.
5. **Group semantics surfaced**: connect/merge-groups deltas should show rendered-piece changes, and metrics should give rendered (cut) pieces.
