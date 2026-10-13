# Gridlab: overnight report

Branch `generative-lab`, in the worktree at `~/code/jpjagt/gridpaint-lab`. Your WIP on `main` was not touched.

## Open it

```sh
cd ~/code/jpjagt/gridpaint-lab
pnpm dev                 # then open http://localhost:5173/#/lab (or the port vite prints)
lab/bin/gl serve         # optional: live mode with param sliders, re-roll and "6 variants" in the detail drawer
```

How to use the board:
- Click a card to open the drawer.
  - It shows the large render, layer toggles and the layers side by side.
  - Use the timeline scrubber to replay growth; cards marked `t` have frames.
  - **Open in editor** creates a real drawing; **3D** opens the existing model viewer.
  - **Copy as gridpaint selection** puts the design on the clipboard; press Cmd+V in the editor to paste it.
- ←/→ steps through designs, and Esc closes the drawer.
- Cmd+V on the board, or dropping a file, shows any selection or design JSON as a card for comparison.
- **"jewel"** colours layers by their rank from the top; **"theme"** uses the app's own layer colours.

## What's in there

357 designs: ~65 generator recipes (4 seeds each + 15 tuned presets) in 13 sections, plus curated sections:

| section | what | notable |
|---|---|---|
| Start here | 25 curated picks across every approach (20 replay their growth) | start with this one |
| AI as painter | 12 pieces by 3 Claude agents, made only through the CLI | reliquary set and growth-fossil are good; oracle set is too heavy |
| AI as editor | 8 before/after pairs from your samples with a plain-language request | carried out through `gl ask` (Jev) and then hand ops |
| Algorithm from a sketch | a rough frame/spine/nodes sketch, then grown organic | spine with ribs became a coral tree of life |
| Mould meets the sacred | sigil/kolam/labyrinth/Tree of Life combined with mould, DLA, lightning, reaction-diffusion | **sigil_mycelium, chiseled_paths, lichtenberg_annunciation, mandorla_skin** |
| Threads | kolam (sikku, interlace), lusona/lunda, celtic, name-kolam | **thread_reliquary** is closest to your own work |
| Sigils & scripts | kamea seals, kufic pinwheel, ogham spine, bindrunes, geomancy, asemic codex | **kufic_pinwheel**, kamea_seal |
| Sacred geometry | yantra, bagua/taijitu, monas stack, pentecost corona, magic-walk rose | |
| Stitch & lattice | hitomezashi, labyrinths, xor mandala, ice-ray window, tocapu | |
| Growth / Simulations | DLA reliquary, coral seeds, lichen rim, venation, physarum, pulse mould, cave skeleton, Gray-Scott | **pulse_mould** (breathing D4 snowflakes), dla_reliquary |
| Learned from your samples | patch-statistics lace, WFC, sample_echo_cross, void_lace | sample_echo_cross reads like your talismans |
| Lace walkers | worms, diagonal maze | |
| Layer composition | the same lace with 10 different layer strategies | makes the point that composition matters |
| Cellular automata / Tiles | Life-like (raw vs refined), folded rule-90 frames, margolus, crystal sigil, truchet, kogin | raw CA is the honest "before" |

Contact sheets for every recipe (8 seeds each) are in `lab/docs/sheets/`.

## What we learned about the algorithms

- **Generate a quarter and mirror it (or mirror at every step for simulations).** This is the single biggest lever. Mirrored noise still reads as soup, though; it needs a local rule as well.
- **The lace grammar, measured from your samples:** no 2x2 solid blocks, 1-cell strokes, 15–25% diagonal-only links. As a cleanup pass or as a score it turns most generators from blobby into lacy.
- **Zoning carries the composition:** frame, then lace band, then a one-cell gap, then a motif, all from a distance transform. Reserved voids that the mould may not enter (a moat around a sigil, an empty relic window, the labyrinth path) are the most "arcane" trick.
- **Growth emits frames.** Stacking frames as layers ("process fossil", "chiseling") is the most natural way to get layers that are genuinely related.
- **Solid back plates make dense designs soupy.** Sparse bases work better: a spine, the outline, a dot grid, or the dilated union of the layers above.
- **Your own pieces have only 20–45% support between layers,** so support is reported as information, not enforced.

## AI tooling: what an LLM needs (verified by dogfooding)

`lab/bin/gl` is the AI-facing CLI; `lab/README.md` documents it. Four Claude agents used it blind and kept diaries (`lab/docs/ai-diary-*.md`); their findings led to a v2 of the CLI. What turned out to matter:
- **Seeing:** a PNG with grid lines and coordinate rulers, plus ASCII with rulers for exact coordinates and a terse metrics line. ASCII alone misleads about visual weight. `gl describe` adds a short verbal summary per layer.
- **Feedback per edit:** a one-line delta per layer (cells, pieces, holes, symmetry, support). The agents named this the most useful feature.
- **Exploring:** `variants` plus a contact sheet. Picking from a visual sheet is far better than editing blind.
- **Editing in symmetry:** `--mirror d2|d4` on set/stamp/draw, so you only draw one quadrant.
- **Selections beyond rectangles,** layer booleans (`--sel circle:..&layer:3`, `layer bool`, `clip-to-layer`), and `--dry-run` with a diff preview.
- **Provenance:** title, notes and the command chain travel with the exported design.
- **Recurring trap:** the design being off-centre on the canvas silently broke symmetric ops. Those ops now default to the material's centre.

## Jev: honest verdict (`lab/docs/jev-experiments.md`)

Jev cost about $0.01 for roughly 160 calls; the key stays in `lab/.env`, which is gitignored.
- **Good at routing an edit request to an op** (49/50 correct, and confidence ≥ 0.7 was always right) and at turning a brief into generator settings. This is wired up as `gl ask FILE "…"` and `gl brief "…"`.
- **Not good at reading grids or judging beauty.** It scored mirrored noise as highly as your samples. Code computes the grid properties; Claude looks at the PNGs.
- **In practice (editor run):**
  - On the 4 requests it acted on itself it always picked the right op, but 2 of its 3 auto-applies needed undo because of wrong arguments or the wrong layer.
  - The other 4 requests it rightly handed off.
  - v2 adds a "details unhandled" check that falls back to candidates.
- **Proposed split:** Jev routes cheap and fast; the LLM coordinator handles multi-step edits, composition and taste; code handles geometry.

## Suggested next steps for gridpaint itself

1. **Selection → "make organic" menu** in the editor: grow-coral / lace-clean / sym-thin / connect / frame on the current selection, through `gl serve` or by porting the best ops to TS.
2. **Selection → "ask"** box: Jev routing with a Claude fallback, applied as an undoable floating paste.
3. **Porting the top recipes to TS:** pulse_mould, dla_reliquary, sigil_mycelium, chiseled_paths, sample_echo_cross, thread_reliquary. They are numpy but simple, and all run in under 0.5 s.
4. **Tighter clipboard round-trip:** the `gl import clipboard` / `gl export --clipboard` loop already works with the paste format, but the editor should create missing layers and groups on paste (today it skips them).

## Status

- Checks: TS typecheck, the lab files' lint, 263 vitest tests and 97 pytest tests all pass.
- `pnpm lint` on the whole repo already reported 42 errors in core files this branch didn't touch (blob-engine, components, twin types); they are untouched.
- Rebuild the gallery after changing recipes: `lab/bin/gl gallery --seeds 4 --out public/lab/gallery.json`.
- Scratch outputs from the agents are in `lab/work/` (gitignored), and can be deleted.
