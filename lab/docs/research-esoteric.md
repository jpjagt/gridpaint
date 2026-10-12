# Research pass 2: arcane, sacred and grid-native generative systems for pixel-lace jewellery

Companion to `research-algorithms.md` (pass 1). Pass 1 already covers the lace grammar measured from the samples (no 2x2 blocks, low degree, 10–30 % diagonal-only cells, odd sizes, frame + band + calm core), the orbit-map symmetry scaffold, the cleanup pass, and generic generators (MRF/WFC, worms, space colonisation, CA, Gray-Scott, physarum, DLA/DBM, invasion percolation, mazes, Truchet, L-systems, folded Wolfram rules). **None of that is repeated here; everything below assumes it.** Where a preset says "cleanup" it means pass-1 §4.5; "orbit" means pass-1 §3 orbit map.

What this pass adds:
1. The tricks practitioners use to keep output from being soup, plus the "doubled lattice" and stroke rules that make line-based systems render well as blobs.
2. A catalogue of **grid-native traditional and esoteric pattern systems** with exact algorithms: mirror curves (kolam, lusona, Celtic, Lunda), hitomezashi, kamea sigils, labyrinths, geomancy and I Ching, Ogham and runes, square Kufic, yantras, 45° girih, tocapu and step-frets, the Tree of Life, vèvè-style scaffolds, alchemical glyph grammars, bitwise ornaments.
3. 28 preset specs that cross those systems with the organic simulations from pass 1.

Layer naming. gridpaint composites 6→1, so a *higher* layer id sits *lower*. To avoid confusion, layers are named by role here: **BASE** (backplate, lowest), **MID**, **TOP**, **CROWN** (only in 4-layer stacks). Physical rule as in pass 1: each cell in a layer should sit over material in the layer directly below. Only small bridged overhangs are allowed, and each layer piece must be connected or glued down.

---

## 1. Curated techniques and breakdowns (key trick per source)

| Source | What to read | Key trick for us |
|---|---|---|
| Anders Hoff / Inconvergent | [Shepherding random numbers](https://inconvergent.net/2016/shepherding-random-numbers), [On generative algorithms](https://inconvergent.net/generative), [differential line](https://inconvergent.net/generative/differential-line/), hyphae | Randomness with **memory**: random walks that integrate noise into velocity give smooth, intentional-looking wander instead of jitter. Hyphae grows a node only if it doesn't collide, and branch probability decays per generation, so hierarchy emerges and negative space stays clean. Use this for worm and tendril steering: keep a turning *velocity*, not a random turn per step. |
| Nervous System | [Hyphae](https://n-e-r-v-o-u-s.com/projects/albums/hyphae-animations/) (auxin canalisation after Runions), Floraform, Reaction, Cell Cycle | Hyphae: **flow reinforces flow**, so veins thicken where more tips drain through (a pipe model). Give vein **order** (number of downstream tips) its own layer: high-order veins appear on BASE+MID+TOP and twigs only on MID. Floraform: growth rate varies with distance from the edge, so the ruffles stay on the margins. A spatial modulation of the growth parameter *is* the composition. |
| Jason Webb | [morphogenesis-resources](https://github.com/jasonwebb/morphogenesis-resources), [2D DLA experiments](https://jasonwebb.github.io/2d-diffusion-limited-aggregation-experiments/), [space colonization in JS](https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5), [differential growth](https://medium.com/@jason.webb/2d-differential-growth-in-js-1843fd51b0ce) | His DLA and space colonisation demos use **SVG shapes as bounds, obstacles and attractor sources**. Placing attractors *along a glyph's strokes* makes veins "write" the glyph, which is the bridge from symbol to organism (presets P9 and P20). |
| Sage Jenson | [physarum](https://cargocollective.com/sagejenson/physarum), 36 points | Jones's model, with collision detection usually skipped because it looks better. In "36 points", per-agent parameters are **functions of the local trail value**. For us, sensor angle and decay become spatial fields (low near sacred nodes, high elsewhere), so the network concentrates where meaning lives. |
| Deniz Bicer | [Understanding the Physarum simulation](https://denizbicer.com/202408-UnderstandingPhysarum.html) | An interactive intuition for sensor angle, sensor distance and step size. Useful when tuning by hand. |
| Ken Voskuil | [Simulating slime mold with WebGL](https://kaesve.nl/projects/mold/summary.html) | A GPU trail-map implementation reference (TS port). |
| Tyler Hobbs | [Working with color](https://tylerxhobbs.com/words/working-with-color-in-generative-art), flow-field and probability-distribution essays on tylerxhobbs.com/words | Fidenza's curves are **non-overlapping by construction** (a spacing check against an occupancy grid). Put randomness at a chosen level of the decision hierarchy, and draw parameters from skewed distributions so most outputs are calm and a few are wild. For us: per-preset "rarity" parameters and an occupancy-grid clearance check on every stroke. |
| Jared Tarbell | complexification.net (Invaders, Substrate) | Mirrored 5×7 noise reads as a creature. Substrate's lines stop when they hit other lines, which gives perfect negative space. |
| Kjetil Golid | Apparatus, Chromatic stacks ([gallery notes](https://www.katevassgalerie.com/blog/kjetil-golid)) | A cell is coloured from its **left and top neighbours** (extend left block / extend top block / start new), then mirrored. That gives machine-like symmetric glyphs. It is a 1-pass CA we can use for reliquary "mechanisms". |
| Boris the Brave | [WFC tips and tricks](https://boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks), [Chiseled paths revisited](https://www.boristhebrave.com/2022/03/20/chiseled-paths-revisited/) | WFC has no global structure, so **pin fixed tiles** (entrances, motifs) and add a **path constraint** (annotated tiles must form one connected component). *Chiseling*: start full and remove random cells unless removal disconnects the key points (a witness path keeps it fast). You get a random winding path or tree between chosen points. That is the ideal "sacred points → organic path" primitive (P20, P21). |
| marian42 | [WFC infinite city](https://github.com/marian42/wavefunctioncollapse) | Backtracking WFC (fewer contradictions on small masked domains). |
| Oskar Stålberg | [How Townscaper works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making), [Sylves Townscaper grid](https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html) | **Dual grid / corner tiles.** Shape is decided at corners and tiles are picked by their 4 corner states, which is marching squares. The blob renderer already *is* a dual-grid renderer, so design at the **cell** level and trust the renderer for curvature. Don't try to draw curves with cells. |
| Amit Patel / Red Blob Games | [Grid parts and relationships](https://www.redblobgames.com/grids/parts/), [Grid edges](https://redblobgames.com/grids/edges) | Faces, edges and vertices are different things. The **doubled-coordinates trick** (§2.1) maps all three onto pixels, and it underlies every line system below. |
| Ned Batchelder / C. Carlson | [Truchet images](https://nedbatchelder.com/blog/202208/truchet_images.html), [Multi-scale Truchet](https://archive.bridgesmathart.org/2018/bridges2018-39.html) | A tile can be replaced by 4 half-size tiles with inverted colours plus "wings", and the pattern stays seamless. **Subdivide only where you want detail** (near the core), which gives density hierarchy for free. |
| Étienne Jacob | necessarydisorder.wordpress.com ("Drawing from noise", looping noise) | Sample noise **on a circle** (x = R cos θ, y = R sin θ) to get seamless periodic noise. For us: modulate ring bands with noise(θ) for Cₙ-periodic variation with no seam. Use noise(cos(nθ), sin(nθ)) for exact n-fold repetition. |
| Dave Whyte (bees & bombs) | (GIF practice) | Every element's parameter is a function of **distance from centre** (phase delay), so the result reads as concentric rhythm, never noise. Static version: the band parameter is f(ring index). |
| Joshua Davis | HYPE framework | Hand-drawn **atoms** with algorithmic arrangement. Here the user's own drawn motifs become stamps for the generators (motif-library slots in presets). |
| Generative Artistry / 10 PRINT | [10 PRINT book](https://10print.org) and Generative Artistry tutorials | `10 PRINT CHR$(205.5+RND(1))` gives a diagonal Truchet maze. On our grid, a diagonal-only maze is the most "slime" texture available (pass-1 P5). |
| PICO-8 tweetcarts and the demoscene | Lexaloffle BBS ([hitomezashi toy](https://www.lexaloffle.com/bbs/?pid=194947)), fire and plasma effects | Bitwise ornaments: `f(x,y) = (x ^ y) % k == 0`, `(x & y) == 0` (Sierpiński), `(x \| y) % k`. Evaluated at `x=\|dx\|, y=\|dy\|`, **any symmetric bitwise formula is D4 for free** (P23). "Fire": heat = average of the cells below minus decay, giving flame tongues (P24). |
| 1-bit dithering | [Ordered dithering](https://en.wikipedia.org/wiki/Ordered_dithering), [Bart Wronski on dithering](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/) | A Bayer threshold of a *smooth symmetric field* gives regular lace (crosshatch) at low levels. Void-and-cluster blue noise at about 10 % gives evenly spaced "stars". Atkinson error diffusion makes worms at mid-grey. Index Bayer by `(\|dx\| mod 4, \|dy\| mod 4)` to keep D2. |
| Paulus Gerdes | [Lunda Geometry (PDF)](https://www.sahistory.org.za/sites/default/files/archive-files3/paulus_gerdes_lunda_geometry_mirror_curves_desbook4you.pdf), [Visual Math pages](https://www.mi.sanu.ac.rs/vismath/paulus/index.html), [Plus: new designs from Africa](https://plus.maths.org/new-designs-africa) | Mirror curves, Lunda and Liki binary designs (§3.1). An m×n plaited-mat lusona needs **gcd(m,n)** lines. |
| Slavik Jablan | [Mirror curves](https://www.mi.sanu.ac.rs/vismath/mir/index.html), [Mirror-curves and knot mosaics (arXiv)](https://arxiv.org/pdf/1106.3784) | Tracing algorithm and enumeration of one-component curves with minimal internal mirrors. |
| Christian Mercat / Celtic | [entrelacs.net poster](https://entrelacs.net/IMG/pdf/poster-entrelacs_en.pdf), [Celtic Knot Thingy explanation](https://isotropic.org/celticknot/explanation/) | Posts on alternating corners, barriers (walls) between posts, a diagonal strand per square bent by walls, and over/under decided by **column parity**. This is identical to mirror curves (§3.1), so one engine serves kolam, sona, Celtic and Lunda. |
| Kolam literature | [Siromoney et al. 1974, Array Grammars and Kolam](https://visionbib.com/bibliography/pattern637.html), [Gopalan: square-tile sikku kolams](https://arxiv.org/pdf/2304.14134), [Ishimoto: infinite kolam in knot theory](https://arxiv.org/pdf/0710.1976), [Raghavachary: tile-based kolam](https://research.dreamworks.com/wp-content/uploads/2018/07/058-raghavachary-Edited.pdf), [Hridaya kolam (arXiv)](https://arxiv.org/pdf/2507.02874) | Kolam patterns are sentences of 2D array grammars. Sikku rules: every dot encircled, crossings at discrete points, no loose ends. Classification is by point group (exactly our orbit-map approach). |
| Hitomezashi | [Defant and Kravitz, Loops and regions](https://arxiv.org/pdf/2201.03461), [Mathematical specification of hitomezashi](https://arxiv.org/pdf/2208.12580), [Bridges 2024](https://archive.bridgesmathart.org/2024/bridges2024-227.pdf), [Numberphile](https://numberphile.com/videos/hitomezashi-stitch-patterns), [toroidal](https://arxiv.org/pdf/2309.02741) | Two binary words determine everything. Loops have odd width and height, length ≡ 4 (mod 8) and area ≡ 1 (mod 4), and regions are **2-colourable** (§3.2). |
| Labyrinth topology | [Phillips, Hidden symmetries of labyrinths (AMS)](https://www.ams.org/samplings/feature-column/fc-2015-10), [Stony Brook notes](https://commack.math.stonybrook.edu/~tony/whatsnew/oct15/labyrinths.html), [Math::PlanePath::CretanLabyrinth](https://metacpan.org/pod/Math::PlanePath::CretanLabyrinth) | A labyrinth *is* its level sequence. Cretan = 0 3 2 1 4 7 6 5 8, and replacing n by 8−n gives the sequence reversed (a hidden symmetry) (§3.5). |
| Agrippa's kameas | [David Rankine, Agrippa and the magic squares](https://www.davidrankine.com/post/agrippa-and-the-magic-squares), [thelema.org sigil thread](https://thelema.org/forum/post/84348) | Aiq Bekar reduction, circle start, bar end, a loop for doubled letters, a fork for a doubled first letter. Published sigils were redrawn freehand and sometimes rotated (§3.3). |
| Geomancy | [Digital Ambler: shield chart construction](https://digitalambler.com/tag/shield-chart/), [geomantic mathematics](https://digitalambler.com/?p=4816) | Daughters are the transpose of the Mothers. Everything else is **XOR** of pairs (§3.6). |
| Square Kufic | [Sakkal: principles of square Kufic](https://sakkal.com/articles/principles_of_square_kufic.html), [Tuts+ square Kufic](https://design.tutsplus.com/tutorials/creative-arabic-calligraphy-square-kufic--cms-23012) | Stroke width equals gap width, and **no 2x2 block of all-ink or all-void** ("even distribution"). That is a crisp binary constraint (§3.7). |
| Chinese lattice | [Stiny ice-ray grammars (MIT)](https://web.mit.edu/haldane/www/icerays/index.html), [Stiny 1977](https://journals.sagepub.com/doi/10.1068/b040089) | Ice-ray rule `x → x' + x''`: split a triangle, quad or pentagon by one line into two such polygons, recursively (§3.9). |
| Tocapu, kogin | [Tocapu](https://en.wikipedia.org/wiki/Tocapu), [kogin technique (TRC Leiden)](https://www.trc-leiden.nl/trc-needles/regional-traditions/east-asia/japan/kogin-zashi-technique) | Tocapu: a square unit subdivided into quadrants of geometric signs, no two units alike. Kogin: floats over **odd** thread counts (1, 3, 5), built from the centre line out into lozenges (§3.9). |
| Sri Yantra | [Pustynski, algebraic Śrīyantra](https://cahc.jainuniversity.ac.in/assets/ijhs/Vol49_3_5_Pustynski.pdf), [texample construction](https://texample.net/sri-yantra/) | The real construction is an optimisation for triple-line concurrency. On a pixel grid with 45° slopes, concurrency is *exact and free* (§3.8). |
| DBM / Lichtenberg | [Niemeyer et al. 1984 (PDF)](https://ifisc.uib-csic.es/~tomas/MFCS/EdenDLA/dielectric_break.pdf), [Lichtenberg-Figures sim](https://github.com/epa058/Lichtenberg-Figures) | Growth probability ∝ φ^η. With η = 0 you get Eden blobs, η = 1 DLA-like growth, and η ≥ 2 sparse lightning. |
| Ogham, runes | [Ogham aicmí](https://liaswyrd.bearblog.dev/the-aicmes-blog/), [bindrunes](https://liaswyrd.bearblog.dev/and-now-you-want-to-make-bindrunes/) | Ogham is a **spine with 1–5 bars** per letter (exactly the samples' "spine with bars" top layers). Bindrunes **share one stave**. Historically there are no more than 2–3 runes per bind. |
| Glyph generation | [Generating glyphs (5×5, ≤1 crossing)](https://tetraslam.beehiiv.com/p/generating-glyphs), [asemic writing post-mortem](https://sia.hackernoon.com/post-mortem-of-a-fiction-generator-asemic-writing-with-some-properties-of-natural-languages-2b008fbf8563) | Small node lattice, polyline through k unique nodes, **reject if more than one self-crossing**, and angles limited to 45° steps so characters stay distinct (§3.7). |

Cross-cutting lessons. These are the anti-soup tricks that show up repeatedly in the sources above:
1. **Collision and clearance as a first-class rule** (Hoff, Hobbs, Tarbell, physarum without collisions only on the GPU). On our grid: a stroke may not come within Chebyshev distance 1 of a *different* stroke except at a designed junction or bridge.
2. **A pinned skeleton with a generated fill** (WFC fixed tiles, Stålberg, Davis). The esoteric system is the skeleton, and the organic process only fills.
3. **Hierarchy by order** (Nervous System veins, multi-scale Truchet): coarse structure lives on more layers, fine detail on one.
4. **Periodic or radial parameter fields** (Jacob, Whyte), not white noise.
5. **Generate many, curate few**, with the like-button feeding back into the training set (pass 1).

---

## 2. Rasterisation principles for line systems under blob rendering

The esoteric systems are mostly **curves on lattices** (strings, stitches, walls, sigil lines). They look good only if rasterised to respect the blob renderer:

### 2.1 Doubled lattice (faces, edges, vertices as pixels)
For a lattice of `N×M` squares, use a pixel grid of `(2N+1)×(2M+1)`:
- `(2i, 2j)` is a **vertex**
- `(2i+1, 2j)` is a **horizontal edge**, `(2i, 2j+1)` a **vertical edge**
- `(2i+1, 2j+1)` is a **face**

A line system on lattice edges is drawn as `vertex pixels ∪ edge pixels`. Because face pixels are never set, **no 2x2 block can ever form**, which satisfies the lace grammar by construction. Corners become rounded L-turns and straight runs become capsules. Faces are free for "dots" (an isolated dot needs all 8 neighbours empty; see 2.3) or for region fills on another layer.

### 2.2 Diagonal lattice
Cells with `(x+y)` even, connected by diagonal steps, render as **diagonal bands with concave fillets** (the slime look). A curve that moves at 45° through edge midpoints (mirror curves, kolam) lands naturally here.

### 2.3 Stroke rules
- **Octilinear only** (0°, 45°, 90°, 135°). Every system in §3 is octilinear by design or can be made so. Other slopes give jaggy staircases. Exception: slope 1/2 "knight steps" read as intentional zig-zags in moderation.
- **Isolated dot**: Chebyshev distance ≥ 2 to any other set cell. Otherwise it fuses into a bridge.
- **Clearance**: two distinct strokes need Chebyshev distance ≥ 2. Distance 1 diagonally creates an (often unwanted) bridge, and distance 1 orthogonally merges them.
- **Turns**: an L-corner cell gives a rounded outer corner. Replacing the corner by a diagonal step (chamfer) gives a soft 45° bend with a fillet.
- **Crossings**: `+` (orthogonal) or `x` (diagonal) junction cell. To show over/under, use two layers (2.5).
- **Pixel circles**: ring = cells with `round(hypot(dx,dy)) == r`. Then delete "corner-redundant" cells (cells with exactly two orthogonal ring neighbours forming an L, whose removal keeps 8-connectivity) to get a clean 8-connected ring of diagonal bands and short capsules. Radii 2–12 look good. Always compute from `(|dx|,|dy|)` so the ring is D4-exact.
- **Lines**: Bresenham 8-connected (gives bridges on diagonals). Use "supercover / 4-connected" only for BASE layers that need strength.

### 2.4 Text to bits and numbers (making it personal and talismanic)
- `bits(text)`: UTF-8 bytes to bits (MSB first), or one bit per letter (vowel=1/consonant=0, or letter-ordinal parity).
- `gematria(letter)`: Latin in the "Hebrew order" of values `A..I = 1..9, J..R = 10..90, S..Z = 100..800`. Hebrew uses the standard 1–400 values (finals 500–900).
- `seed(text)`: a hash to a PRNG seed, so a name *deterministically* yields one piece: the piece is "that person's seal".
- **Palindromise** for symmetry: `w + reverse(w)` (even) or `w + [c] + reverse(w)` (odd, centre bit c).

### 2.5 Over/under with layers (true interlace in laser-cut stacks)
At each crossing cell `m` with "over" strand O and "under" strand U:
- MID: all strands (O and U pass through m).
- TOP: the 3 cells of O centred on m (`m-o, m, m+o`, o is O's step direction). These are small **bridge pieces** glued onto MID.
- Optional: BASE shows through holes. Seen from above, O is raised and U dives under it.
- Alternation rule (Celtic and alternating knots): with midpoints indexed `(i,j)`, O is the "/" strand if `(i+j)` is even, otherwise the "\" strand.

Variant without small parts: TOP = full strands of one **component** (in multi-loop kolams), so whole loops lie over others. Or the single-layer convention: U is broken by one empty cell on each side of m. That produces many fragments, so it must sit on a BASE.

### 2.6 Reserved void ("meaningful negative space")
Many presets reserve a set `R` of cells that carry meaning *by being empty* (the labyrinth's walking path, the sigil's channel, the kolam's dot positions, a relic cavity). All organic generators treat `dilate(R, c)` as forbidden. This is the single most effective anti-soup trick for this aesthetic: **the mould grows everywhere except where the sacred thing is.**

---

## 3. Catalogue of grid-native esoteric systems, with algorithms

### 3.1 Mirror curves: kolam (pulli / sikku), lusona, Celtic knotwork, Lunda designs

**Unified model** (Gerdes, Jablan, Mercat). Dots `D` occupy a set of lattice positions (a rectangle, a diamond `1-3-5-7-5-3-1`, any polyomino). Every dot is surrounded by a loop made of 4 quarter-arcs (NE, NW, SW, SE) joining its 4 edge midpoints (E, N, W, S). An **internal midpoint** `m` lies between two horizontally or vertically adjacent dots A and B. A **border midpoint** has only one dot. Each internal midpoint has a state:
- `X`: crossing. Strands go straight through (classic kolam crossing).
- `S`: separating wall, perpendicular to AB. A's two arcs at m join each other, and B's two join each other.
- `T`: transferring wall, parallel to AB. The upper arcs of A and B join, and the lower arcs join.

Border midpoints are always "closed" (A's two arcs join, like S). All-`X` on an `m×n` rectangle gives **gcd(m,n)** closed loops (the plaited mat). D2 and D4 reflections map `S→S` and `T→T`, so states are invariant under the orbit map: assign states per orbit.

**Tracing (component count)**: union-find over arc ends.
```
arcs = {(dot, q) for dot in D for q in [NE,NW,SW,SE]}
# each arc has 2 ends: which midpoint it touches
#   NE: E-mid & N-mid   NW: N-mid & W-mid   SW: W-mid & S-mid   SE: S-mid & E-mid
for each midpoint m:
  if border: join(A.arcs_at(m))                         # A's 2 arcs at m
  elif horizontal pair A|B:   # A left, B right; A's arcs at m: A.NE, A.SE; B's: B.NW, B.SW
     X: join(A.NE, B.SW); join(A.SE, B.NW)
     S: join(A.NE, A.SE); join(B.NW, B.SW)
     T: join(A.NE, B.NW); join(A.SE, B.SW)
  elif vertical pair A over B: same with N/S roles rotated
components = number of cycles = number of union-find classes over arcs
```
**Sikku search (a single continuous loop)**:
```
state[all internal orbits] = X
repeat K = 50·|orbits| times:
   o = random orbit; s' = sample({X:wX, S:wS, T:wT})
   c' = components(with o := s')
   accept if c' == 1  or  (c' < c_current)        # descend to 1, then random walk inside c==1
return if c == 1
```
`wX` is about 0.5. More `S` and `T` give more "bounces" (orthogonal capsules). Fewer give more diagonal weave.

**Raster A: diagonal style, dot pitch s = 4, dotless (compact)**. Dot at `(4i, 4j)`, offset into the canvas. The ring around a dot is the L1-diamond of radius 2. Quarter-arcs are the single cells `(±1, ±1)`. The midpoint between A=(0,0) and B=(4,0) is `M=(2,0)`:
```
X: set M                       → diagonal X-junction
S: set (1,0) and (3,0)         → each ring closes with a short vertical capsule; M stays empty
T: set (2,-1) and (2,1)        → horizontal capsules joining A's and B's upper/lower arcs
border (closed): set M (pointed tip)   or set (1,0) (flat side; option "border = flat")
always set the quarter-arc cells (±1,±1) around each dot
```
Verified properties: dot centres and the "square centres" `(4i+2, 4j+2)` are never set, so **no 2x2 block can occur**. The result is diagonal lace with orthogonal capsules wherever there is a wall, which is exactly the samples' mix. Canvas = `4n+1` for n dots across (n=7 gives 29, n=13 gives 53).

**Raster B: diagonal style, s = 6, with pulli dots**. The ring is the L1-diamond of radius 3 (quarter-arcs are 2 cells: `(1,±2),(2,±1)`), with `M=(3,0)`. Stencils: `X` sets M, `S` sets `(2,0),(4,0)`, `T` sets `(3,±1)`. The dot cell `(0,0)` is set: it sits at Chebyshev distance 2 from every ring cell, so it renders as a clean isolated pulli dot. Canvas = `6n+1` (n=5 gives 31, n=9 gives 55). Dots are physically islands, so they need a BASE beneath.

**Raster C: rotated, "Celtic/orthogonal" style**. Rotate the dot lattice by 45°: dot (i,j) goes to pixel `(4(i+j), 4(i−j))`. Rings become Chebyshev squares of radius 2, crossings become `+`, and walls become chamfers. This gives a woven-band look with orthogonal strands, closer to Celtic interlace. Pulli dots need ring radius 3 (pitch 6 on the rotated lattice).

**Lusona variants (Gerdes)**: draw the same engine on rectangles with the all-`X` "plaited mat" plus **a few walls in symmetric orbits**. The Chokwe drawings are single-stroke, so run the sikku search. Story-figures (animals) come from non-rectangular dot sets; for jewellery use capsule- or lozenge-shaped dot sets that match the silhouette.

**Lunda and Liki designs (binary images straight from a curve)**. For a single-component curve, walk the curve and number the quarter-arcs `0,1,2,…` in traversal order. Quarter-arc `(dot (i,j), q)` corresponds to one unit square of a `2n×2m` grid: `px = 2i + (q∈{NE,SE}?1:0)`, `py = 2j + (q∈{SE,SW}?1:0)`. Colour = index mod 2. The result is a black/white design in which every 2x2 window around a midpoint has exactly 2 black cells (local equilibrium) and rows and columns are balanced. **It is a dense, never-solid binary texture: an ideal BASE plate pattern or a MID lace at 1 cell per unit.** Liki designs (Gerdes's stricter subclass) are counted by `2^(gcd(m,n)−1)`.

**Celtic interlace**: the same engine plus §2.5 over/under. Mercat's and Sloss's "barrier" grids are the `S`/`T` walls. Long straight walls along the border and the symmetry axes give the classic panel look.

**Anti-soup notes**: kolams are dense by nature, so use them as the **top or middle motif inside a silhouette** (a dot set shaped like the silhouette), never as a texture filling everything. The dot pitch sets the rhythm. Pitch 4 is lacy, pitch 6 is airy with dots.

### 3.2 Hitomezashi (一目刺し, "one stitch")

Binary words `a[0..N]` (one per horizontal line) and `b[0..N]` (one per vertical line). On the doubled lattice (§2.1), a lattice point `(i,j)` maps to pixel `(2i,2j)`:
```
for j in 0..N:  for k in 0..N-1:  if (k + a[j]) % 2 == 0: set (2k,2j),(2k+1,2j),(2k+2,2j)
for i in 0..N:  for k in 0..N-1:  if (k + b[i]) % 2 == 0: set (2i,2k),(2i,2k+1),(2i,2k+2)
```
Every lattice point is the endpoint of exactly one horizontal and one vertical dash, so every vertex has degree 2. The pattern is a disjoint union of **closed loops plus border paths**, every vertex is an L-turn, and there are **zero 2x2 blocks**. Pixel size is `2N+1`.

- **Exact D2**: N odd and `a`, `b` palindromes (a reflection maps a dash starting at k to one starting at N−1−k, and N odd preserves parity). **D4**: square and `a == b`. Recommended N ∈ {11, 13, 15, 17, 19, 23}, giving 23–47 px.
- **Word sources**: palindromised text bits, prime/composite indicator (1 if prime), Thue–Morse `t(k)=popcount(k)%2` (self-similar loops), Fibonacci word, digits of π mod 2, hexagram lines (yang=1).
- **Region 2-colouring** (faces): `c(0,0)=0`. Crossing from face `(i,j)` to `(i+1,j)` toggles iff a vertical dash lies on line `i+1` at segment `j`, which is `(j + b[i+1]) % 2 == 0`. Similarly for vertical moves. The `N×N` face image is a **solid two-tone version**, good as BASE (with stitches as MID).
- **Loop islands (anti-soup)**: label loop components on the stitched pixel graph. Keep only *closed* loops (not touching the border), optionally only those of size within [Lmin, Lmax], or only the central loop and its orbit. Isolated hitomezashi loops are startlingly beautiful: nested, crinkled, rune-like rings.
- **Kissing loops**: for a jewellery piece, keep the central loop plus the loops that touch its bounding box, then add 1-cell diagonal bridges between them to make one piece.

### 3.3 Kamea (planetary magic squares) and sigil tracing

**Squares** (Agrippa, *De Occulta Philosophia* II.22; order goes with planet: Saturn 3, Jupiter 4, Mars 5, Sun 6, Venus 7, Mercury 8, Moon 9):
```
Saturn  4 9 2 / 3 5 7 / 8 1 6                                     (Lo Shu)
Jupiter 4 14 15 1 / 9 7 6 12 / 5 11 10 8 / 16 2 3 13
Mars    11 24 7 20 3 / 4 12 25 8 16 / 17 5 13 21 9 / 10 18 1 14 22 / 23 6 19 2 15
        (closed form: v = 5·((2+3i+2j) mod 5) + ((3i+3j) mod 5) + 1, i=row, j=col)
Sun     6 32 3 34 35 1 / 7 11 27 28 8 30 / 19 14 16 15 23 24 / 18 20 22 21 17 13 / 25 29 10 9 26 12 / 36 5 33 4 2 31
Mercury 8 58 59 5 4 62 63 1 / 49 15 14 52 53 11 10 56 / 41 23 22 44 45 19 18 48 / 32 34 35 29 28 38 39 25 /
        40 26 27 37 36 30 31 33 / 17 47 46 20 21 43 42 24 / 9 55 54 12 13 51 50 16 / 64 2 3 61 60 6 7 57
```
(All rows and columns were checked against the magic constants 15, 34, 65, 111 and 260.) For Venus (7) and Moon (9), use Agrippa's tables, or any construction: odd n via Siamese `start top-middle, move up-right, if occupied move down`; doubly-even n via `fill 1..n² row-major, then replace v by n²+1−v where i%4==j%4 or i%4+j%4==3`. Different squares give different but equally "valid" sigils.

**Name to numbers**: Hebrew values (Aiq Bekar), or Latin gematria (§2.4). **Reduction**: while `v > n²`, take `v ← v/10` (drop a zero: 30→3, 200→20→2 on Saturn). On Venus 100→10. Agrippa is inconsistent (he sometimes merges `IA` into 11), so expose an option.

**Tracing on the pixel grid**:
```
k = floor((G - 1) / n)            # pixels per kamea square; G=29: Saturn k=9, Mars k=5, Moon k=3
pos(v) = (k*col(v) + k//2 + off, k*row(v) + k//2 + off)
start: Chebyshev ring of radius 1 around pos(v0)                       (8 cells → a small "o")
for consecutive (u, v): Bresenham8(pos(u), pos(v))
   if u == v (doubled letter): add a radius-1 ring offset perpendicular to the incoming direction ("loop")
first two letters equal: draw a fork (two short diagonals) at the start instead of the ring
end: bar of 5 cells perpendicular to the last segment (quantised to 0/45/90)
optional: if first == last cell, close the figure and drop the start and end marks
```
Then run the grammar cleanup. Crossing lines at shallow angles can form 2x2 clumps; break them.

**Kamea lattice as structure**: the square itself can be drawn on BASE as `n×n` compartments, a dot at each centre (Chebyshev-isolated), or a faint diagonal-lattice lace. The sigil sits on MID/TOP, so the viewer sees the "map" and the "route".

**Symmetrising a sigil** (sigils are asymmetric): (a) **bilateral seal**: `sigil ∪ mirrorX(sigil)` (inkblot insect). (b) **C4 wheel**: union of 4 rotations about the square's centre. (c) Keep it asymmetric but inside a D4 frame (kamea lattice and ring). Pass 1's lesson holds: (a) and (b) read as intentional, while (c) needs a very strong frame.

### 3.4 Other sigil machines
- **Spare monogram**: `text → uppercase → drop vowels → drop repeated letters`. Draw each remaining letter as an **octilinear skeleton** on a 3×5 node lattice (pitch 3, so 7×13 px), using a fixed 26-letter stroke font. Overlay all letters at the same centre, randomly mirrored or rotated by 90° per letter (seeded by the text). OR with `mirrorX` for D1. Thin and clean. The result is a dense, hieratic monogram; it works best small, on TOP.
- **Sigil wheel (rose-cross style)**: place letters on 3 concentric rings (Golden Dawn: 3 mother, 7 double and 12 simple Hebrew letters; for Latin, rings of 5/8/13). Each letter gets a polar position `(r_ring, θ = 2π·idx/count + phase)`. Draw a polyline through the letters of the word with start circle and end bar. Pixel-snap to the grid, Bresenham8. The rings themselves can be drawn faintly on BASE. Pinned layout plus a word gives a star-polygon-like sigil.
- **Kamea sum-path ("magic walk")**: instead of letters, trace the numbers 1→n² in order on the kamea. That produces the square's intrinsic "knight-ish" path (beautiful for the Siamese squares), a canonical planetary pattern with no text.

### 3.5 Labyrinths (Cretan, Roman, medieval) as level sequences

A one-axis labyrinth with `n` circuits is a permutation `0, a1, …, an, n+1` (0 = outside, n+1 = centre). The walker traverses circuit `a_k` fully, turning at the axis. The transition `a_k → a_{k+1}` happens at the axis on the **left** side if k is even and the **right** side if k is odd. Validity: on each side, the transition intervals `[min, max]` must be pairwise **nested or disjoint** (a planar arc system). Enumerate by DFS with that pruning. Classical 7-circuit Cretan: `0 3 2 1 4 7 6 5 8` (left arcs [0,3],[1,2],[4,7],[5,6]; right arcs [2,3],[1,4],[6,7],[5,8]). It is "self-dual": `n → 8−n` reverses it.

**Seed method** (the traditional drawing): a cross, an L-bracket in each quadrant, and a dot in each quadrant. Join the top of the cross to the nearest right endpoint with a small arc, then repeatedly join the next free left endpoint to the next free right endpoint with an arc enclosing the previous one. Eight arcs give the eight walls of the 7-circuit labyrinth. Larger seeds (more nested Ls) give 11 or 15 circuits.

**Grid rendering (square or round)**:
```
centre c; goal radius r0 (2..3); circuit L (1=outermost) at radius r(L) = r0 + 2*(n - L) + 2
ring(L)   = cells at Chebyshev (square) or round(Euclid) (round) distance r(L) from c
cut every ring at the top axis: remove cells with |x-cx| <= g and y < cy     (g = 1)
for each transition (p,q) on side s ∈ {left,right}:
    depth = number of same-side arcs enclosing [p,q]
    bar_x = cx ∓ (g + 1 + 2*depth)               # outer arcs sit closer to the axis
    extend rings p and q from their cut end to bar_x; draw a vertical bar at bar_x from r(p) to r(q)
entry: the outermost transition from 0 opens to the outside; exit: from a_n into the goal
PATH = those cells.   WALLS = (disc of radius r(1)+1) \ PATH \ goal
```
Pitch 2 (1-cell path, 1-cell wall). A 7-circuit labyrinth needs about 2·(2·7+3)+1 = 35 px. **Walls form one connected piece** (they hang off the seed cross), so they are good jewellery material, and the PATH becomes a reserved void (§2.6). The round version (Euclidean rings) gives the familiar Chartres/Cretan look with pixel-circle bands.

Multi-axis (Chartres-type, 4 axes, 11 circuits, C2 overall) labyrinths: split each ring into 4 quadrant arcs, and give each axis its own transition list. That is more complex; start with one axis.

### 3.6 Binary oracles: geomancy, I Ching, Ifá

**Geomantic figure** = 4 bits (head, neck, body, feet), 1 = odd = one point, 0 = even = two points. There are 16 figures (Via = 1111, Populus = 0000, and so on).
```
Mothers M1..M4: from seed(text) or from 16 random "lines of dots" (bit = count % 2)
Daughters: D_k = (M1[k], M2[k], M3[k], M4[k])                 # transpose
Nieces:    N1 = M1⊕M2, N2 = M3⊕M4, N3 = D1⊕D2, N4 = D3⊕D4
Witnesses: RW = N1⊕N2, LW = N3⊕N4;  Judge J = RW⊕LW (always has an even point-total);  Reconciler = J⊕M1
```
Shield chart layout (it reads right to left): top row `D4 D3 D2 D1 M4 M3 M2 M1`, then `N4 N3 N2 N1`, then `LW RW`, then `J`. That is an **inverted pyramid = heraldic shield silhouette**.

**Figure raster** (5×7 cells): rows at y = 0, 2, 4, 6. A *1* is a 5-cell capsule (or a single centred dot); a *0* is two 2-cell capsules with a 1-cell gap (or two dots at x = 0 and 4). The bar rendering connects nothing vertically, so figures need a plate beneath.

**I Ching**: hexagram = 6 bits (bottom to top). Yang = solid 7-cell capsule; yin = `3 + gap + 3`. Line pitch 2, so a hexagram is 7×11. Trigram = 3 bits, 5×5 or 7×5. **Bagua ring (D4)**: 8 trigrams on the 8 compass positions of a Chebyshev ring, each rotated to face the centre. N/S positions use horizontal lines and E/W vertical ones; the 4 diagonal positions use **diagonal lines** (diagonal bands, yin = 2+gap+2 diagonal cells). The Earlier-Heaven (Fu Xi) order puts complements opposite, so the composition is **anti-symmetric under 180° rotation** (rotation equals bitwise NOT). The Fu Xi order is binary counting (Leibniz noticed this). **Taijitu** centre: a disc split by an S of two half-discs, with eye dots. It is C2 with colour inversion: BASE = disc, MID = one "fish" (including the opposite eye as a hole).

**Ifá / Opele**: 16 principal odù are the same 4-bit figures (written in double columns: 8 bits per odù, 256 combinations). Render as a pair of geomantic figures side by side, which is naturally D1 when both columns are equal (the 16 *meji*). The meji are perfect symmetric seeds.

**Oracle-to-pattern couplings** (new digital meets ancient):
- **Hexagram → hitomezashi**: palindromise the 6 lines as an 11-bit word for both `a` and `b` (D4). Each hexagram has its own stitched loop-sigil, so there are 64 canonical loop-forms.
- **Hexagram → Truchet**: King Wen sequence × 6 lines = 384 bits, one per tile orientation (16×24 tiles). Or one hexagram's 6 bits repeat as the tile orientation per row.
- **Hexagram → Wolfram rule**: rule number = `hexagram_bits << 2 | (changing-line bits)`, restricted to the 32 left-right symmetric rules (rules where `bit(110) == bit(011)` and `bit(100) == bit(001)`) so the result is mirror-symmetric. Seed = palindromised hexagram. Fold onto rings (pass-1 P10).
- **Geomantic chart → layer stack**: the 4 bits of each figure toggle 4 layers (P13).

### 3.7 Scripts and glyph grammars: Ogham, runes, square Kufic, asemic glyphs

**Ogham** (pure grid script, stemline = spine). Aicme B: `B L F S N` = 1..5 strokes on the right. Aicme H: `H D T C Q` = 1..5 on the left. Aicme M: `M G NG Z R` = 1..5 strokes *across* (diagonal in inscriptions, horizontal across the spine on our grid, so they are symmetric). Vowels: `A O U E I` = 1..5 notches (dots on or beside the spine). Grid: vertical spine 1 cell wide; each stroke is a 3- to 4-cell bar; strokes within a letter at pitch 2; a letter gap of 3 rows. **A name in Ogham is a "spine with bars" top layer, exactly the samples' cross and Lorraine-cross TOP motifs, but personal.** Symmetrise by mirroring B/H strokes (render each stroke as across-spine), or by writing the name on the left and its mirror on the right.

**Runes and bindrunes**: Elder Futhark as octilinear segments on a `5×9` box (stave = vertical line x=2, y 0..8; twigs at 45°). Many runes are mirror-symmetric (ᛉ Algiz, ᛏ Tiwaz, ᚷ Gebo, ᛞ Dagaz, ᛜ Ingwaz, ᛗ Mannaz, ᛁ Isa, ᛟ Othala, ᛇ Eihwaz under C2). **Bindrune**: overlay ≤ 3 runes on a shared stave (aligned x = 2), union of segments. Symmetrise as `bind ∪ mirrorX(bind)`. Constraint: reject if the union has more than 4 junction cells, or if a twig runs within Chebyshev 1 of another twig without meeting it. (Note: Othala-with-serifs, Algiz in some contexts, and doubled Sowilo carry extremist connotations in Europe. Keep a blocklist if pieces are shared publicly.)

**Square Kufic grammar** (bannāʾī brick script): stroke = gap = 1 cell, orthogonal strokes only. **Balanced-window constraint: every 2x2 window contains 1, 2 or 3 filled cells (never 0, never 4).** That forces both ink and void to be 1-cell meanders. Generation:
```
domain: square or ring band; symmetry: C4 (pinwheel, traditional for square Kufic medallions) or D4
energy: +∞ for any 2x2 window with 0 or 4 ink (hard), + λ·|density - 0.5|,
        + μ·(#orthogonal T-junctions)        # Kufic prefers corners and long runs over branching
        + ν·(#ink components - 1)
init: write a "word" as columns: letter = vertical stroke of height h_l ∈ {2..7} on a baseline band,
      baseline running around the square spiral; repeat ×4 under C4
anneal orbit flips (pass-1 A1 machinery) with the hard window constraint
```
The 2x2 rule *forbids* pass-1's empty-band texture, so use it inside a fixed sub-region (a seal) and frame it with a void. The result reads as "a word you can't quite read", which is very powerful. With blob rendering, the 1-cell void meander becomes a continuous rounded channel.

**Asemic glyph grammar (5×5 or 7×7)**:
```
nodes = 3x3 lattice (pitch 2 → 5x5 px) or 4x4 (pitch 2 → 7x7)
glyph = polyline through k ∈ {3..5} distinct nodes, steps restricted to the 8 directions (octilinear)
        + optional diacritic: an isolated dot (Chebyshev ≥2) or a short bar
reject if: self-crossings > 1; any node degree > 3; bbox < 3x3; glyph equals another under D4 (alphabet uniqueness)
keep alphabets of 16–26; "language feel": reuse 2–3 radical sub-strokes across glyphs (stroke-type → consonant,
angle change → vowel, after the asemic-writing post-mortem)
```
**Glyph block** (Mayan-like cartouche): `main sign 7×7` + `prefix 2×7` (left) + `superfix 7×2` (top) + `postfix 2×7`, each filled from the glyph grammar, inside a rounded-rectangle cartouche outline. It is very jewellery-like as a single "seal" pendant.

### 3.8 Mandalas, yantras, Islamic star patterns on the square grid

**Bhupura** (the yantra's outer square with 4 T-gates, D4-exact):
```
for t in 0..2:                               # three nested square lines, pitch 2
   R_t = R - 2t; line = Chebyshev ring radius R_t
   gate on each side: replace the side cells with |u| <= w_t by a jog outward by g:
       cells (u, -(R_t+g)) for |u| <= w_t, plus vertical connectors at u = ±w_t
   (w_t = w + 2t so the jogs nest; g = 2)
```
**Lotus ring** (8 or 16 petals, D4): a petal is a lens between radii r1 < r2, angular half-width `α(r) = α0·sin(π (r-r1)/(r2-r1))`. Fill or outline cells where `|θ − θ_k| < α(r)`. Compute θ from `(|dx|,|dy|)` folded into the 1/8 wedge (pull rasterisation, pass-1 §3), so it is D4-exact.

**45° triangles (Sri-Yantra-like stacks)**: on the pixel grid a triangle with a horizontal base and slopes ±1 is exact (apex angle 90°). Up-triangle k: apex `y = a_k`, base `y = b_k > a_k`, edges `|x| = y − a_k`. Down-triangles are mirrored. **If all apex and base levels share parity, every intersection lands on a cell centre, so the triple-concurrency that makes the real Śrī Yantra an optimisation problem is automatic here.** Pattern: 4 up and 5 down with interleaved levels, all inside a circle, with a bindu dot at the centre. It is D1 (and D2 if you take as many up as down triangles).

**Khatam / Rub el Hizb (8-point star = two squares)**: an axis-aligned square outline `max(|x|,|y|) = R` together with a diamond outline `|x|+|y| = D`, `D ≈ round(R·√2)`, with the parity of D matching R. The union outline gives the star; both full outlines interlaced (over/under by layers, §2.5) give the girih feel.

**Pixel Hankin (polygons-in-contact) at a 45° contact angle**: tile the region with squares of side `s` (s even), or with the 4.8.8 tiling (pixel octagon: orthogonal edges `a`, diagonal edges `b` steps). From each edge midpoint, emit two rays at ±45° to the edge into the polygon. Stop each ray where it meets another ray. In square tiles this produces rotated squares (the classic "square-in-square" interlace). In 4.8.8 it produces **8-pointed stars and crosses**. All rays are octilinear, so the result is exact on the grid. Add interlace by layers. Islamic geometric patterns are wallpaper patterns (p4m), so crop to a silhouette and **centre a star on the axis intersection**.

**Ammann–Beenker** (8-fold quasicrystal, square plus 45° rhombs, de Bruijn 4-grid): all edges are octilinear, but square and rhomb edge lengths differ by √2. Approximate 5 orthogonal cells ≈ 7 diagonal steps (7/5 ≈ √2). Only D4 is exact on the grid. Use the central 8-fold patch only, as a "quasi-crystal relic". (The hat monotile is not grid-native: skip it.)

**Flower of Life / Seed of Life / Shippo**: circles of radius r centred on hex-lattice points `(r·(i + j/2), r·j·√3/2)` (Flower of Life: 7 or 19 centres within 2r). Rasterise each ring with the §2.3 pixel-circle rule. D2-exact if evaluated from `(|dx|,|dy|)`. **Petal-only variant**: cells covered by exactly 2 discs, outlined, give the vesica lenses (much less soupy than all rings). Shippo (七宝, "seven treasures", sashiko): circles centred on a square lattice with pitch ≈ r√2 (r=5, pitch 7), giving 4-petal flowers on a square grid: D4.

**Vesica / mandorla silhouette**: `mask = disc(c1, R) ∩ disc(c2, R)` with centres `(±R/2, 0)`, giving a vertical pointed oval: the Christian mandorla and Hindu/Buddhist flame-arch. It is a superb pendant silhouette alternative to pass 1's capsule.

### 3.9 Textile and lattice ornament: tocapu, step-frets, leiwen, kogin, ice-ray

- **Step-fret** (*xicalcoliuhqui* / greca escalonada / Andean stepped fret): a staircase of `k` steps (each step `(+p, -p)` as an L of capsules) ending in a **square spiral hook** with `t` turns (segment lengths `L, L, L-2, L-2, …`). Pitch 2 keeps a 1-cell gap. Mirror for D1 bands. It is the most "ancient America" glyph primitive and exact on a grid.
- **Leiwen / thunder pattern** (雷纹, Chinese bronzes, Dye's lattices): square spirals as a frieze. Units alternate handedness (glide reflection, frieze group p2mg) for borders and frames. A frame of leiwen around a lace core reads like an archaic bronze.
- **Tocapu unit grammar**: unit = `u×u` (u = 9 or 11) with a 1-cell frame. Interior is split into 4 quadrants (or 2 triangles by the diagonal). Each quadrant gets a primitive from {step-fret, diagonal band, 1-cell checker (diagonal-only connectivity = slime), concentric squares, cross, dot, void}. Relation rule per unit: one of {all 4 rotated (C4), opposite quadrants equal (C2), opposite quadrants colour-inverted (C2 with inversion), quadrant mirrors (D2)}. **No two units in a piece equal** (the tocapu "no repetition" rule). Compose 1×N (bracelet) or 3×5 (pendant).
- **Kogin modoko** (hishi lozenges): runs (floats) of **odd length** {1, 3, 5} in each row, run pattern a function of the diamond distance `d = |x| + |y|·q` (q = 1 or 2, since kogin lozenges are vertically elongated). On our grid, either (a) use only every other row (capsule stacks; needs a plate), or (b) offset each row's runs by exactly 1 so consecutive rows meet only **diagonally at run ends**. That gives a connected lace of horizontal capsules joined by diagonal bridges, which is an amazing texture between kogin and the samples.
- **Ice-ray** (Stiny): `split(P)`: pick a random edge pair of polygon P and a cut line on {0°, 45°, 90°, 135°} through a lattice point, such that both parts are polygons with 3–5 sides and area ≥ Amin. Recurse. Draw cuts as 1-cell lines. Mirror the quarter (D2) for jewellery. It reads as cracked ice or stained glass.

### 3.10 Sacred node graphs: Tree of Life, constellations, bagua points

**Tree of Life** (10 sephirot, 22 paths; mirror-symmetric). Unit coordinates `(x, y)`: Keter (0,0), Chokmah (1,1), Binah (−1,1), [Daʿat (0,2), hidden], Chesed (1,3), Gevurah (−1,3), Tiferet (0,4), Netzach (1,5), Hod (−1,5), Yesod (0,6), Malkuth (0,8). Grid example `px = 7 + 5x`, `py = 2 + 4y`, giving a 15×37 canvas.

Paths (Kircher / Golden Dawn): K–Ch, K–B, K–T, Ch–B, Ch–T, Ch–Che, B–T, B–G, Che–G, Che–T, Che–N, G–T, G–H, T–N, T–Y, T–H, N–H, N–Y, N–M, H–Y, H–M, Y–M.

The sephirot are rings (Chebyshev radius 1–2) or dots. The paths are a graph to be **realised by a process**: straight Bresenham (canonical), physarum (P19), chiseling (P20) or PCB routing (P21).

Other node sets: geomantic figure points, kamea sigil vertices, the 8 bagua positions, the 7 classical planets on a heptagram (not grid-exact; use the vertices only), and real constellations (Pleiades for 7, Orion's belt for 3; asymmetric, so use them inside a D2 frame or as a TOP accent).

### 3.11 Vèvè-style scaffolds and scroll-arm crosses
Vèvè (Haitian Vodou) are cornmeal ground drawings anchored on the central pole (poto-mitan): an axis line drawn first, symmetric scrollwork, stars and hearts, and **finishing points scattered along the outer edge**. Legba's vèvè famously breaks symmetry with one extra mark. Generic **scaffold grammar** (inspired by the structure, *not* reproducing specific lwa signatures):
```
spine: vertical line on the axis (pole) with 1–3 cross-bars (lengths decreasing upward)
bar ends: scroll = square spiral hook (2–3 turns, pitch 2), curling inward or outward (mirrored left/right)
flourish: diagonal "S" bands linking bar ends to scrolls (diagonal steps)
finishing points: isolated dots placed every 3–4 cells along the outer contour of the dilated drawing (Chebyshev-isolated)
one deliberate asymmetry: a single mark crossing one bar on one side (pass-1 "broken mirror")
```
The **scroll-arm cross** is the same grammar under C4 or D4 (cross plus 4 spiral arms). It is shared across Adinkra forms (e.g. Fawohodie, Mpatapo-like knots), Celtic triskele and spiral crosses, and pinwheel frets. Note: vèvè and Adinkra are living sacred and cultural systems. Generate from the grammar; don't copy specific signs for sale.

### 3.12 Alchemical, planetary and "Monas" glyph stacks
The planetary signs are stacks of primitives on a vertical axis: **horns** (upper arc of a ring), **circle** (ring, optional centre dot = ☉), **cross** (Earth/matter), **arrow**, **Aries horns** (two lower arcs). ☿ = horns + circle + cross; ♀ = circle + cross; John Dee's **Monas Hieroglyphica** = horns + circle-with-dot + cross + Aries horns. Elements: △ fire, ▽ water, △ with a bar for air, ▽ with a bar for earth (45° triangles, exact on the grid).
```
stack = sample 2–4 primitives from {horns, circle(r∈{2,3,4}), circle+dot, cross(arm a), double-cross, △, ▽, bar, aries}
place along the axis with 1-cell gaps or 0-gap fusion (shared cells → junctions); width ≤ W
constraint: mirror-symmetric (D1) by construction; reject if height/width outside [1.4, 3.0]
```
This produces "new planets" and talismanic glyphs that look 16th-century and digital at once. It is a good TOP layer.

### 3.13 Bitwise, CA and oracle ornaments
- **XOR mandala**: `x=|dx|, y=|dy|`; `on = F(x,y)` for F in {`(x^y)%k==r`, `(x&y)==0`, `((x|y)%k)==0`, `popcount(x^y)==p`, `(x*y)%k==r`, `((x+y) ^ |x-y|) % k == 0`}. Any F symmetric in x and y gives D4 for free. Intersect with a ring band, then clean up. Sierpiński `(x&y)==0` gives a fractal cross, and `(x^y)%9==0` gives diagonal lattices with moiré. It is very "circuit scripture".
- **Folded Wolfram as oracle** (extends pass-1 P10): rule = from hexagram (§3.6), seed = palindromised name bits, generations mapped to concentric rings.
- **Fire / plasma corona** (demoscene): radial heat propagation (P24).
- **Dither halo**: Bayer-threshold of a radial gradient `g(r) = smoothstep` inside a ring gives regular stipple rings. Void-and-cluster at 8–12 % gives evenly spaced "stars" (isolated dots for a CROWN layer over a solid BASE).

---

## 4. Presets for the exploration board

Common scaffold (pass 1): odd sizes, orbit-map symmetry, silhouette, zones, cleanup, generate N and keep the top few. Each preset lists defaults; "→" marks a pipeline step. Layers are listed bottom to top.

### P1. Sikku Kolam: the Single Thread
- **Concept**: one unbroken line circling every dot, a threshold drawing at dawn. Infinity as a closed path. Calm, devotional, mathematically perfect.
- **Pipeline**: dot set = diamond `1-3-5-7-5-3-1` (or 5×5) → mirror-curve engine (§3.1), D4 orbits, sikku search (wX = 0.55, wS = 0.25, wT = 0.20) → Raster B (pitch 6, with dots), canvas 6·7+1 = 43 (diamond fits 43×43) → cleanup (keep dots).
- **Layers**: BASE = `close(dilate(curve,1))` ∩ diamond silhouette, with dot positions punched as holes (a "pulli as void" option). MID = curve. TOP (optional) = dots as 1-cell islands *over* BASE (only if BASE is solid there; otherwise put dots on MID). Physical: the curve is one piece by definition.
- **Anti-soup**: the dot pitch gives rhythm; a single loop guarantees one coherent gesture; the silhouette equals the dot set, so no fill-to-edge.

### P2. Kolam Interlace: Over and Under
- **Concept**: kolam becomes Celtic. The same loop now weaves over and under itself in physical layers. Light falls into the crossings.
- **Pipeline**: P1 with Raster A (pitch 4, dotless), 5×5 dots, canvas 21 → crossings `X` get alternating over-strand (§2.5) → TOP = 3-cell over-bridges.
- **Layers**: BASE = silhouette plate (rounded square) with lace holes = Lunda image (§3.1) thresholded at a coarse level. MID = the full curve. TOP = over-bridges (small glued pieces), or alternatively the over-component of a 2-loop all-X kolam (gcd = 2 on 4×6 dots), so whole loops ride on top.
- **Anti-soup**: walls (`S`/`T`) on the border orbit and the axes give clean edges. Keep wX ≤ 0.6 in the interior.

### P3. Lusona Plaited Mat with Lunda Ground
- **Concept**: Chokwe sand-drawing logic. A woven mat whose number of threads is gcd(m,n), on a black-and-white Lunda ground that is the curve's own shadow.
- **Pipeline**: 4×6 dots (a capsule-ish rectangle), all-`X` plus walls only on the long axis orbit (vertical walls `S` on the centre column), single-loop search → Raster A, canvas 17×25 → compute the Lunda image (8×12 binary, 1 px per unit square) → upscale ×2 with the "on = 1-cell inset dot" rule (or use 1:1 on a 2× finer BASE grid).
- **Layers**: BASE = Lunda image as a solid two-tone plate: black cells become material, white cells holes; it is always connected because the 2x2 equilibrium leaves no isolated cells in practice (check). MID = curve. A 2-layer piece.
- **Anti-soup**: the Lunda image is dense, so it must be the BASE, *seen through* the curve, never the top. The rectangle silhouette is clipped to a capsule.

### P4. Hitomezashi Mantra
- **Concept**: write a mantra (or a name) as two binary words and let the stitches decide the sigil. Japanese sashiko logic reading Sanskrit or Latin.
- **Pipeline**: N = 15 (canvas 31), `w = bits(text)[0:7]`, `a = b = w + [c] + reverse(w)` (D4) → stitch raster (§3.2) → label loops → keep closed loops whose bbox centre is within radius 9 of the centre → bridge kissing loops into one piece (diagonal bridges at closest points, symmetric orbits).
- **Layers**: BASE = region 2-colouring (faces of colour 1 at 2×2 px, plus stitches) masked by a disc, which is a solid patterned plate. MID = all stitches inside the disc. TOP = only the kept central loops ("the answer").
- **Anti-soup**: selecting loops is the curation. The full hitomezashi field is wallpaper; the isolated loop is a glyph.

### P5. Hitomezashi Hexagram Oracle (64 canonical forms)
- **Concept**: each of the 64 I Ching hexagrams has a stitched loop-sigil. Cast, then wear.
- **Pipeline**: cast hexagram (seed or 3-coin method) → 6 bits → `a = b = bits + [1] + reverse(bits)` (N = 13, canvas 27) → stitch → keep the loop containing the centre plus its D4 orbit → TOP = hexagram as capsule lines (7×11) below the loop (pendant: loop above, hexagram below = capsule silhouette 15×41).
- **Layers**: BASE = capsule plate with a lace band (pass-1 P1, MRF lace). MID = central loop. TOP = hexagram bars.
- **Anti-soup**: two crisp symbols, one organic band, strict vertical stacking.

### P6. Kamea Seal of Saturn (sigil traced through the magic square)
- **Concept**: a name traced across the Lo Shu: the oldest magic square, made into a route. Planetary-talisman austerity.
- **Pipeline**: kamea by planet (default Saturn n=3, k=9, canvas 29) → text → gematria → reduce → trace (§3.3) with ring start and bar end → bilateral seal: `sigil ∪ mirrorX(sigil)` → cleanup.
- **Layers**: BASE = disc or rounded square plate with the 3×3 kamea compartments as a 1-cell lattice cut through (or 9 Chebyshev-isolated dot holes at the square centres). MID = seal line (dilated by 1 into an orthogonal "supercover" for strength). TOP = start rings and end bars only (the "seal nodes").
- **Anti-soup**: the line is sparse by nature. Don't add texture. The lattice is the only secondary structure.

### P7. Sigil Mycelium
- **Concept**: the sigil is planted; mould grows from its strokes but never covers them. Intention made biological.
- **Pipeline**: P6 sigil on Mars (n = 5, k = 5, canvas 27; capsule silhouette 21×31 alternative) → **reserved void** `R = dilate(sigil, 1) \ sigil` (a 1-cell moat) → invasion percolation (pass-1 B6) seeded at sigil vertices and junctions, lace rule (≤ 1 orthogonal neighbour, no 2x2), forbidden: R; resistance = simplex(0.3) + distance-to-sigil·0.15 (stays near the sigil) → stop at band density 0.35 → D2 orbits.
- **Layers**: BASE = `dilate(sigil ∪ mould, 1)` ∩ silhouette. MID = mould lace. TOP = sigil (continuous, crisp, raised).
- **Anti-soup**: the moat keeps the sigil legible. Growth is distance-limited, so empty margins remain.

### P8. Spare Monogram Reliquary
- **Concept**: Austin Osman Spare's method: strip a desire to its unique consonants and fuse them into a mute glyph. Then house it like a relic.
- **Pipeline**: text → unique consonants (≤ 5) → octilinear stroke font on 3×5 nodes (pitch 2, 5×9 px per letter) → overlay with per-letter seeded flips → `∪ mirrorX` → thin → centre in a mandorla silhouette (vesica, R = 14, canvas 21×33) → halo ring (pixel circle r = 6) around the monogram → lace band outside the halo (pass-1 MRF or worms).
- **Layers**: BASE = mandorla plate with lace. MID = halo ring plus a solid disc inside the halo (a plate for the monogram). TOP = monogram.
- **Anti-soup**: three nested zones (lace, halo, glyph) with a 1-cell breathing gap between each.

### P9. The Tree Writes the Name (space colonisation onto a glyph)
- **Concept**: a vein network grows from the root and, without knowing it, spells a sigil. Hyphae as scribe.
- **Pipeline**: glyph = Ogham name or a kamea sigil, scaled to 15×29 → attractors = 3–4 points per glyph stroke cell (jittered ±0.3) **plus** sparse band attractors (10 per quadrant) → root = bottom-centre cell → space colonisation (pass-1 A5), influence radius 5, kill distance 1.5, octilinear step quantisation → order (tip count) per segment.
- **Layers**: BASE = all veins dilated by 1. MID = all veins. TOP = veins with order ≥ 4 (the trunk and the glyph-tracing main branches).
- **Anti-soup**: attractor density concentrated on the glyph means the network has a reason. Band attractors are few.

### P10. Overgrown Labyrinth
- **Concept**: the Cretan labyrinth's walls, slowly eaten and colonised by coral-mould; the walking path stays clear as an empty meander. Pilgrimage through decay.
- **Pipeline**: 7-circuit Cretan, round variant (§3.5), r0 = 3, canvas 37 → WALLS and PATH → reserved void = PATH → erosion: remove wall cells with probability `p = 0.25·noise01(cell)` where removal keeps walls connected (articulation-point check) and never removes the seed cross → regrowth: worms (pass-1 A3) start from eroded gaps and grow *along* the remaining walls into the outer margin (radius r(1)+1 to r(1)+4) → D2 orbits (the labyrinth is D1; use mirrorX only, so effectively D1).
- **Layers**: BASE = disc plate (radius r(1)+4) with the PATH cut as a through-channel. MID = walls (eroded) plus outer mould band. TOP = the seed cross plus the goal ring (centre).
- **Anti-soup**: the empty path is a continuous readable line through everything.

### P11. Labyrinth Oracle (random valid meander)
- **Concept**: every seed (name, date) yields a *different valid* labyrinth: a personal walk of n circuits.
- **Pipeline**: n ∈ {5, 7, 9}; enumerate valid level sequences by DFS (§3.5); choose by `seed(text)` → square (Chebyshev) variant, canvas 2·(2n+3)+1 → walls as material → corners of the square rings chamfered (replace each ring corner with a diagonal step) for softer blobs.
- **Layers**: BASE = square plate. MID = walls. TOP = the axis column (the turning spine: cells on the axis that belong to walls) plus the goal. This echoes the samples' "spine" TOP.
- **Anti-soup**: no texture at all; pure architecture. Pair it with P10 on the board to compare austerity and decay.

### P12. Geomantic Shield (4-layer stack)
- **Concept**: a full geomantic chart computed from a question: 15 figures forming the heraldic shield, the Judge at the point.
- **Pipeline**: Mothers from `seed(question)` → chart (§3.6) → layout as an inverted pyramid: figure 5×7 with 1-cell gaps; top row 8 figures = 47 wide, so use a **narrower variant**: render only Nieces (4), Witnesses (2), Judge (1), giving a 29×25 shield, with Mothers and Daughters encoded as a 16-dot frieze along the top edge (1 dot = odd, 2 dots = even, per row).
- **Layers**: BASE = shield silhouette plate with a 1-cell lace border (MRF, band = 2). MID = compartment plates: a rounded 7×9 rectangle under each figure, connected by diagonal bridges in pyramid order. TOP = figure bars (odd = 5-capsule, even = two 2-capsules). CROWN = the Judge's bars only, doubled in thickness (supported by the TOP Judge bars), so the answer stands highest.
- **Anti-soup**: a grid of compartments is inherently ordered. Only the border carries lace.

### P13. Geomantic Layer Code
- **Concept**: the 4 rows of one geomantic figure (fire, air, water, earth) switch the 4 physical layers on or off. The stack *is* the figure.
- **Pipeline**: compute the Judge (or a chosen figure) → for layer ℓ ∈ {fire, air, water, earth} (top to bottom), bit = 1 means a *single* motif (one central disc ring), bit = 0 means a *pair* (two rings side by side) → each layer's motif is lace-filled (pass-1 P1) inside its rings; rings shrink upward (r = 9, 7, 5, 3) so each is supported.
- **Layers**: earth = BASE (largest) up to fire = CROWN. Physical: pair-layers over single-layers need overlap. Choose ring spacing so the pairs' discs lie within the lower layer's footprint (check support, shrink if needed).
- **Anti-soup**: very few elements per layer. The meaning is in the stacking.

### P14. Bagua Ring around the Taijitu
- **Concept**: the eight trigrams in Fu Xi order, complements facing each other, around a yin-yang that is literally two plates.
- **Pipeline**: canvas 41, D4 frame (C2-with-inversion trigram content) → Chebyshev ring radius 16 carrying 8 trigrams (§3.6), with diagonal trigrams as diagonal bands → inner pixel circle r = 9 → taijitu inside r = 8 (S-curve of two half-discs radius 4, eyes radius 1) → outer lace band r = 18–20 (MRF or a hitomezashi stitch band with `a = b = Thue–Morse`).
- **Layers**: BASE = disc r = 20 with an outer lace band cut through. MID = trigram plates (rounded rects) plus the inner circle plus the taijitu "yin" half (with yang-eye hole). TOP = trigram bars plus the "yang" eye dot. The taijitu reads as two tones (BASE vs MID).
- **Anti-soup**: 8 + 1 discrete symbols in fixed positions. Lace only in the outermost ring.

### P15. Ogham Spine
- **Concept**: the wearer's name in Ogham on the pendant's spine, the oldest Irish script, rendering as the same "cross with bars" the user already draws. Lace mould on both sides.
- **Pipeline**: name → Ogham strokes (§3.7), rendered symmetric (B/H strokes as across-spine bars of length 3, M as length 5, vowels as dots beside the spine at Chebyshev 2) → spine height = sum of letters → capsule silhouette width 13, height = spine + 6 (cap ≤ 55) → pass-1 P2 (sample-echo lace band + motif) with motif = Ogham spine and a breathing gap of 1.
- **Layers**: BASE = `dilate(lace ∪ spine, 1)` ∩ capsule. MID = lace. TOP = the Ogham spine. This directly mirrors sample multi_1 / multi_2.
- **Anti-soup**: the top layer is crisp and orthogonal-only, and the lace is learned from the user.

### P16. Bindrune Reliquary
- **Concept**: two or three runes bound on one stave, mirrored into perfect symmetry, set inside a halo of coral.
- **Pipeline**: choose runes from text (initials) or seed → bindrune on a 5×9 box at pitch 2 (gives 9×17) → `∪ mirrorX` → reject by junction count > 4 → centre in a capsule 17×31 → halo = Chebyshev-rounded ring at distance 2 from the bindrune bbox → coral: invasion percolation outside the halo with lace rule, D2, density 0.35.
- **Layers**: BASE = capsule plate. MID = coral plus halo ring. TOP = bindrune (with 45° twigs as diagonal bands).
- **Anti-soup**: the halo separates sign from growth. Twigs are octilinear.

### P17. Kufic Pinwheel Seal
- **Concept**: an illegible word in square Kufic, rotated four times about a centre: architecture-writing, brick-and-void in perfect balance.
- **Pipeline**: canvas 21 (square), C4 orbits (quarter-turn) → balanced-window Kufic annealing (§3.7) inside a central 15×15 square, hard window constraint, density 0.5, initial "word" = 4–6 letter columns along the inner spiral → 1-cell void moat → outer frame: leiwen (thunder) spirals frieze along the border (§3.9) with p4 rotation.
- **Layers**: BASE = 21×21 rounded-square plate. MID = Kufic seal plus leiwen frame. TOP = the four "ascender" strokes (the longest vertical runs in each quarter) only, raised.
- **Anti-soup**: the 2x2 rule makes every region crisp, ink and void equal. The frame is a different, coarser rhythm.

### P18. Pixel Yantra
- **Concept**: bhupura gates, lotus ring and interlocked 45° triangles around a bindu. A meditation diagram on graph paper, perfectly concurrent.
- **Pipeline**: canvas 45, D2 (triangles) inside D4 (gates, lotus) → bhupura 3 lines R = 21, 19, 17 with T-gates (w = 3, g = 2) → circle r = 15 → 8-petal lotus r1 = 11 to r2 = 15 outline → 4 up and 5 down 45° triangles with apex and base levels of equal parity inside r = 10 → bindu dot.
- **Layers**: BASE = full square plate with the gates' outline cut. MID = bhupura lines plus lotus outlines plus circle. TOP = triangles (thin diagonal-band lattice). CROWN = bindu plus the innermost triangle (supported by TOP's triangle edges: make the inner triangle a filled 45° triangle for support).
- **Anti-soup**: a strict concentric hierarchy with fixed gaps of 1 cell between every ring. No randomness except optional lotus petal style (outline, filled, double).

### P19. Tree of Life Physarum: the Slime Finds the Paths
- **Concept**: place the ten sephirot as food and let *Physarum polycephalum* discover the 22 paths, or almost. The oracle's version of the Tree.
- **Pipeline**: canvas 15×37 (§3.10 coordinates), mirrorX → physarum (pass-1 B4) at 8× resolution, agents 3000, SA 30°, RA 30°, SO 9 px, decay 0.15, food deposit 8 at the sephirot every step, with agents spawned *only* near the sephirot → 600 steps → trail max-pool to grid → threshold at the 80th percentile → skeleton → **prune**: drop skeleton branches that don't connect two sephirot (so only "paths" survive) → mirror-sym re-cleanup.
- **Layers**: BASE = `dilate(paths ∪ sephirot, 1)` ∩ silhouette (a rounded vertical capsule). MID = paths (organic, wobbly). TOP = sephirot as Chebyshev rings of radius 1 (8 cells around a hole) or radius-2 rounded rings, with Daʿat as an empty ring (hidden).
- **Anti-soup**: branch pruning by "connects two nodes" removes the dangling hair. Compare with P20 and P21 (the same graph, three different "intelligences").

### P20. Chiseled Paths between Sacred Points
- **Concept**: the same nodes (sephirot, bagua, geomantic points), connected by randomly chiselled one-cell paths: a Steiner-tree root system.
- **Pipeline**: node set N (Tree of Life or 8 bagua points at r = 14 plus centre, canvas 31) → start: band mask fully filled → chiseling (Boris the Brave): in random orbit order, remove a cell (and its orbit) unless that disconnects N (witness tree for speed); continue until nothing more is removable → result: a random tree spanning N → braid: re-add 2–4 orbit cells that close small loops (holes look good).
- **Layers**: BASE = `dilate(tree, 1)`. MID = tree. TOP = nodes (rings).
- **Anti-soup**: a tree is minimal, so there is no excess matter. Braiding adds a handful of loops only.

### P21. Circuit Sutra (PCB routing between sacred nodes)
- **Concept**: technological scripture. The 22 paths, or a kamea sigil's edges, routed like copper traces with 45° chamfers and vias. Digital monasticism.
- **Pipeline**: node set = Tree of Life (15×37) or kamea-sigil vertices → nets = the path list (or consecutive sigil pairs) → sort nets by length (short first) → for each net: A* on the grid, 8 directions, cost = 1 per orthogonal step, 1.41 per diagonal, +2 per 45° turn, +6 per 90° turn; blocked = `dilate(previous traces ∪ nodes, 1)` except at its own endpoints (enforces 1-cell clearance) → node = via (Chebyshev ring radius 1 with a hole) → mirrorX symmetrisation: route only the left half plus axis nets and mirror.
- **Layers**: BASE = silhouette plate with "drill holes" at via centres. MID = traces. TOP = vias plus a few "components" (rounded 3×5 pads) at path midpoints.
- **Anti-soup**: design-rule clearance is built in. Traces are octilinear and deliberate.

### P22. Lichtenberg Annunciation (divine lightning)
- **Concept**: lightning descends from a halo at the top and strikes a sigil or heart below. DBM as a theophany.
- **Pipeline**: capsule 17×41, mirrorX → cluster seed = halo ring (pixel circle r = 5 at the top) → target = small TOP glyph near the bottom (P15/P16/P30 glyph), held at φ = 1. Halo φ = 0 → DBM (pass-1 B5), η = 2.5, growth only into perimeter cells with ≤ 1 orthogonal and ≤ 2 diagonal filled neighbours (lace rule), orbit growth (add a cell and its mirror) → stop when the cluster touches the target.
- **Layers**: BASE = `dilate(lightning, 1) ∪ halo disc ∪ target disc`, all inside the capsule. MID = lightning plus halo ring. TOP = target glyph plus halo centre dot.
- **Anti-soup**: η ≥ 2 keeps it sparse. The stopping condition (strike) ends the growth decisively.

### P23. XOR Mandala
- **Concept**: 1962 hacker "munching squares" meets mandala: pure arithmetic, D4 for free, eerily ancient.
- **Pipeline**: canvas 33 (odd, centre cell), `x=|dx|, y=|dy|` → F from a menu (§3.13), default `(x ^ y) % 7 == 0` → intersect with ring band r ∈ [9, 15] → cleanup (2x2 break, dust < 3) → core: pixel circle r = 4 plus centre dot.
- **Layers**: BASE = disc r = 16 plate. MID = XOR band. TOP = inner circle and dot plus 4 axis "rays" `(x==0 || y==0) && r ∈ [5,8]` with breathing gap.
- **Anti-soup**: the band restriction plus a calm core. The formula menu gives a whole family; show 12 formulas on the board.

### P24. Pentecost Corona (demoscene fire nimbus)
- **Concept**: a halo made of flame tongues: the burning bush and the Pentecost fire. A demoscene effect turned into an icon nimbus.
- **Pipeline**: canvas 35, D4 (or D1 for a "flame crown" pointing up) → source = ring r = 8 with heat 1 → radial propagation outward ring by ring: `heat(c) = mean(heat of the 2–3 neighbours closer to the centre) − decay(0.09) + 0.08·noise(c)` (noise via `|dx|,|dy|` hash for symmetry) → threshold heat > 0.35 → **edge only**: cells where heat > 0.35 and at least one 4-neighbour ≤ 0.35 (gives flame outlines, not a blob) → cleanup.
- **Layers**: BASE = disc to the flame extent (dilated). MID = flame outlines. TOP = inner ring r = 8 plus centre motif (cross / Chi-Rho / dot; user choice).
- **Anti-soup**: edge extraction turns a filled field into lace. Decay sets the corona radius.

### P25. DLA Monstrance
- **Concept**: a reliquary: an empty oval cavity "holding" an absent relic, ringed by a crystalline aggregate that grows *inward* toward it but never touches.
- **Pipeline**: capsule 21×35 → cavity = vertical ellipse 7×13 at the centre, reserved void plus a 1-cell moat → seed = the silhouette frame line (d = 1) → walkers launched from the moat boundary, random walk until they touch the cluster, stick with p = 0.35 if the lace rule holds (no 2x2, ≤ 1 orthogonal neighbour) → orbit placement (D2) → stop at 220 cells per quadrant or when the growth reaches the moat.
- **Layers**: BASE = capsule plate *with the cavity cut out*: a window. MID = frame plus DLA crystal. TOP = 4 "rays" (short orthogonal capsules) on the cavity's axes, starting 2 cells outside the moat (sunburst monstrance).
- **Anti-soup**: the void is the composition; the crystal is just the halo of it.

### P26. Mandorla Skin (reaction-diffusion of a deity)
- **Concept**: a vesica-shaped body skin: Gray-Scott coral spots and stripes clipped to the sacred almond. Skin of a god, not soup, because only the band lives.
- **Pipeline**: mandorla silhouette (vesica R = 16, canvas 19×33) → Gray-Scott (pass-1 B3) at 6× resolution, f = 0.0545, k = 0.062, V held at 0 outside the band d ∈ [2, 6], D2 mirror-averaging every 100 steps → threshold stack → inner core: a vertical "figure": a capsule spine with a pixel-circle head (r = 2) near the top (an icon silhouette).
- **Layers**: BASE = V > 0.12 ∪ silhouette outline. MID = skeleton(V > 0.22). TOP = icon figure plus local maxima dots of V > 0.35 inside the band (max 6 per quadrant).
- **Anti-soup**: RD is confined to a band. The figure has a 2-cell gap all around.

### P27. Tocapu Thunder Bracelet (frieze)
- **Concept**: a band of tocapu units, no two alike, separated by leiwen thunder spirals. Andean heraldry meets Shang bronze.
- **Pipeline**: canvas 11 × (11·k + 3·(k−1)) with k = 4 → units 11×11 (§3.9), each with a different quadrant rule and primitive draw (seeded, rejection if equal) → separators: 3-wide columns with a vertical step-fret → frieze symmetry p2mm (mirror the whole about the centre).
- **Layers**: BASE = band plate with rounded ends. MID = unit frames plus separators. TOP = one primitive per unit (the step-fret or the cross), raised.
- **Anti-soup**: strong unit framing. Each unit is small and only half-filled (quadrant rule includes void).

### P28. Vèvè Scaffold with the One Mark
- **Concept**: a pole-centred ground-drawing grammar: crossbars, spiral scrolls, scattered finishing points, and one deliberate asymmetric mark. The crossroads.
- **Pipeline**: canvas 25×35 → spine (axis, length 27) → 2 crossbars at y = 9 (len 17) and y = 19 (len 11) → square-spiral scrolls at bar ends (2 turns, pitch 2, curling inward), mirrored → diagonal S-flourishes from spine to scrolls (diagonal steps, 4–6 cells) → finishing points along `contour(dilate(drawing, 2))` every 3 cells (isolated dots) → one extra 3-cell diagonal mark crossing the upper bar on one side.
- **Layers**: BASE = `close(dilate(drawing, 2))` plate (holds the finishing points). MID = drawing. TOP = spine plus crossbars only (the cross).
- **Anti-soup**: an open, airy drawing: no lace texture. The dots replace texture.

### P29. Monas Stack (alchemical glyph generator)
- **Concept**: John Dee's hieroglyphic monad and planetary signs as a grammar: generate new planets, impossible elements, a personal monad.
- **Pipeline**: canvas 17×33 → stack 3–4 primitives (§3.12) with seeded sizes → D1 by construction → around it: a vesica (mandorla) outline with a lace band 2 cells wide (MRF), or a thin pixel-circle "orbit" ring for the circle primitive.
- **Layers**: BASE = mandorla plate. MID = lace band plus a solid plate under the glyph (dilate 1). TOP = glyph.
- **Anti-soup**: one glyph, one band. Show 24 seeds side by side on the board as a "lost alphabet of planets".

### P30. Asemic Codex Tablet
- **Concept**: a small tablet of glyphs from a language that never existed: three rows of procedurally generated characters, like a fragment of an Enochian or Voynich page.
- **Pipeline**: alphabet = 16 glyphs via the §3.7 grammar (3×3 nodes, pitch 2, 5×5 px, ≤ 1 crossing, a radical reused in 5 glyphs) → tablet 3 rows × 5 glyphs, 1-cell spacing, cartouche around the centre glyph → tablet 33×21 → optional mirror column-order symmetry (the right half is the left half mirrored, giving a palindromic inscription).
- **Layers**: BASE = rounded tablet plate. MID = 1-cell frame plus row rules (baselines). TOP = glyphs.
- **Anti-soup**: typographic order (rows, baselines, spacing) is itself the anti-soup grammar.

### P31. Ice-Ray Shrine Window
- **Concept**: a Chinese lattice window of cracked ice, mirrored into a shrine niche (a pointed-arch silhouette), with a single circle (the moon gate) left intact.
- **Pipeline**: silhouette = rectangle 21×31 with a 45° pointed top → reserved: pixel circle r = 5 at the centre plus moat → ice-ray split (§3.9) on the left half, Amin = 10 cells, octilinear cuts → mirrorX → frame line d = 1.
- **Layers**: BASE = silhouette plate. MID = frame plus ice-ray lines. TOP = moon ring.
- **Anti-soup**: a minimum area per facet; the moon ring is a calm focal point.

### P32. Kolam Eaten by Mould ("the threshold after the rain")
- **Concept**: a perfect sikku kolam partially dissolved and re-grown by slime: rice-flour lines washing away, organisms moving in. Order meeting entropy, still legible.
- **Pipeline**: P1 (Raster A, 7×7 dots, canvas 29) → erosion field = physarum trail (pass-1 B4, 1200 agents, food = 4 seed points on the diagonals at r = 10, D4) → delete curve cells where the trail is above the 70th percentile (never more than 30 % of the curve; keep crossings) → regrow: worms from cut ends follow the trail gradient (curl bias), lace rule, max 8 cells each.
- **Layers**: BASE = original *uneroded* kolam dilated by 1: the "memory" of the full loop is in the plate. MID = eroded kolam plus slime regrowth. TOP = the 4 crossings closest to the centre plus the centre dot.
- **Anti-soup**: the BASE keeps the full order visible. The erosion is a capped fraction.

---

## 5. Esoteric-specific anti-soup principles (summary)

1. **Symbol as skeleton, process as servant.** Every organic process is constrained by the symbolic structure: food (physarum), attractors (space colonisation), seeds (DLA, percolation), forbidden voids (§2.6) and distance limits.
2. **Meaningful voids.** Reserve the path, the cavity, the moat, the dot positions. Emptiness carries the meaning, and mould never enters it.
3. **Counted elements.** Sacred systems use fixed small numbers (3, 7, 8, 10, 15, 16, 22, 64). That *bounds density* and makes each element legible. Never "N random".
4. **Octilinear discipline.** Lines at 0, 45 and 90 degrees only; the blob renderer turns them into capsules and fillets. Arbitrary angles become jaggy noise.
5. **One texture per piece.** The sacred structure plus at most one organic texture (lace, mould, RD, flames), never two.
6. **Layer hierarchy = semantic hierarchy.** BASE = ground or plate (often a two-tone structural pattern such as Lunda or hitomezashi regions), MID = the drawing or route, TOP = the symbol's core (nodes, crossings, bindu, Judge, spine). Top layers are orthogonal and crisp; organic matter stays low.
7. **Deterministic from text.** `seed(name)`, so each piece is a reproducible talisman. It also makes the board a dictionary: same name, different preset.
8. **One deliberate break** (Legba's mark, the opened ring in sample 1): at most one asymmetric edit, on TOP or at the silhouette.

Cultural note: kolam, vèvè, Adinkra, Ifá and Ogham are living traditions. Generating *from their grammars* (dots and loops, pole and scrolls, binary figures, spine and strokes) is homage. Reproducing specific sacred signs (a particular lwa's vèvè, named Adinkra) for sale is a different matter, so keep those out of default presets.

---

## Sources

Creative coding and algorithms: [Inconvergent: shepherding random numbers](https://inconvergent.net/2016/shepherding-random-numbers), [Inconvergent: generative](https://inconvergent.net/generative), [Nervous System Hyphae](https://n-e-r-v-o-u-s.com/projects/albums/hyphae-animations/), [Hyphae press kit](https://n-e-r-v-o-u-s.com/pressKit/hyphaeLamp.html), [Jason Webb morphogenesis-resources](https://github.com/jasonwebb/morphogenesis-resources), [Sage Jenson physarum](https://cargocollective.com/sagejenson/physarum), [Deniz Bicer: understanding physarum](https://denizbicer.com/202408-UnderstandingPhysarum.html), [Tyler Hobbs: working with color](https://tylerxhobbs.com/words/working-with-color-in-generative-art), [Kjetil Golid (Kate Vass)](https://www.katevassgalerie.com/blog/kjetil-golid), [Boris the Brave: WFC tips](https://boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks), [Boris the Brave: chiseled paths revisited](https://www.boristhebrave.com/2022/03/20/chiseled-paths-revisited/), [marian42 WFC](https://github.com/marian42/wavefunctioncollapse), [How Townscaper works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making), [Sylves: Townscaper grid](https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html), [Red Blob Games: grid parts](https://www.redblobgames.com/grids/parts/), [Red Blob Games: grid edges](https://redblobgames.com/grids/edges), [Ned Batchelder: Truchet images](https://nedbatchelder.com/blog/202208/truchet_images.html), [Carlson: multi-scale Truchet](https://archive.bridgesmathart.org/2018/bridges2018-39.html), [Looping noise (after É. Jacob)](https://derivative.ca/community-post/tutorial/looping-noise-part-1-ending-beginning), [Ordered dithering](https://en.wikipedia.org/wiki/Ordered_dithering), [Bart Wronski: dithering](https://bartwronski.com/2016/10/30/dithering-part-three-real-world-2d-quantization-dithering/), [Lexaloffle hitomezashi toy](https://www.lexaloffle.com/bbs/?pid=194947), [Niemeyer et al. DBM](https://ifisc.uib-csic.es/~tomas/MFCS/EdenDLA/dielectric_break.pdf), [Lichtenberg-Figures](https://github.com/epa058/Lichtenberg-Figures), [Generating glyphs](https://tetraslam.beehiiv.com/p/generating-glyphs), [Asemic writing post-mortem](https://sia.hackernoon.com/post-mortem-of-a-fiction-generator-asemic-writing-with-some-properties-of-natural-languages-2b008fbf8563), [Procedural glyph language](https://legacy.codeproject.com/Tips/468059/Procedural-Gyph-Language).

Traditional systems: [Gerdes: Lunda Geometry](https://www.sahistory.org.za/sites/default/files/archive-files3/paulus_gerdes_lunda_geometry_mirror_curves_desbook4you.pdf), [Gerdes (Visual Math)](https://www.mi.sanu.ac.rs/vismath/paulus/index.html), [Plus: new designs from Africa](https://plus.maths.org/new-designs-africa), [Jablan: mirror curves](https://www.mi.sanu.ac.rs/vismath/mir/index.html), [Mirror-curves and knot mosaics](https://arxiv.org/pdf/1106.3784), [Celtic Knot Thingy](https://isotropic.org/celticknot/explanation/), [entrelacs.net poster](https://entrelacs.net/IMG/pdf/poster-entrelacs_en.pdf), [Siromoney et al. 1974](https://visionbib.com/bibliography/pattern637.html), [Siromoney archive](https://www.cmi.ac.in/gift/TheoreticalComputerScience.htm), [Gopalan: sikku kolams](https://arxiv.org/pdf/2304.14134), [Ishimoto: infinite kolam](https://arxiv.org/pdf/0710.1976), [Raghavachary: tile-based kolam](https://research.dreamworks.com/wp-content/uploads/2018/07/058-raghavachary-Edited.pdf), [Hridaya kolam](https://arxiv.org/pdf/2507.02874), [Defant and Kravitz: hitomezashi](https://arxiv.org/pdf/2201.03461), [Hitomezashi specification](https://arxiv.org/pdf/2208.12580), [Bridges 2024 hitomezashi](https://archive.bridgesmathart.org/2024/bridges2024-227.pdf), [Toroidal hitomezashi](https://arxiv.org/pdf/2309.02741), [Numberphile hitomezashi](https://numberphile.com/videos/hitomezashi-stitch-patterns), [Rankine: Agrippa and the magic squares](https://www.davidrankine.com/post/agrippa-and-the-magic-squares), [thelema.org: drawing planetary sigils](https://thelema.org/forum/post/84348), [Phillips: hidden symmetries of labyrinths](https://www.ams.org/samplings/feature-column/fc-2015-10), [Phillips notes](https://commack.math.stonybrook.edu/~tony/whatsnew/oct15/labyrinths.html), [Math::PlanePath::CretanLabyrinth](https://metacpan.org/pod/Math::PlanePath::CretanLabyrinth), [Labyrinth Society: classical 7-circuit](https://labyrinthsociety.org/labyrinth-types/3636-classical-7-circuit-diagram), [Digital Ambler: shield chart](https://digitalambler.com/tag/shield-chart/), [Digital Ambler: geomantic mathematics](https://digitalambler.com/?p=4816), [Sakkal: square Kufic](https://sakkal.com/articles/principles_of_square_kufic.html), [Tuts+ square Kufic](https://design.tutsplus.com/tutorials/creative-arabic-calligraphy-square-kufic--cms-23012), [Stiny ice-ray (MIT)](https://web.mit.edu/haldane/www/icerays/index.html), [Stiny 1977](https://journals.sagepub.com/doi/10.1068/b040089), [Tocapu](https://en.wikipedia.org/wiki/Tocapu), [Kogin (TRC Leiden)](https://www.trc-leiden.nl/trc-needles/regional-traditions/east-asia/japan/kogin-zashi-technique), [Pustynski: Śrīyantra](https://cahc.jainuniversity.ac.in/assets/ijhs/Vol49_3_5_Pustynski.pdf), [texample: Sri Yantra](https://texample.net/sri-yantra/), [Ogham aicmí](https://liaswyrd.bearblog.dev/the-aicmes-blog/), [Bindrunes](https://liaswyrd.bearblog.dev/and-now-you-want-to-make-bindrunes/), [Veve (Wikipedia)](https://en.wikipedia.org/wiki/Veve), [Rose Cross](https://www.wikipedia.org/wiki/Rose_Cross), [Aperiodic monotile](https://arxiv.org/pdf/2303.10798v1).

Background knowledge (not fetched this session): Siamese and doubly-even magic-square constructions, the Agrippa square values (verified arithmetically above), the Tree of Life layout and the 22 paths, I Ching and Fu Xi binary order, bitwise "munching squares", demoscene fire, Hankin's polygons-in-contact method, Ammann–Beenker via de Bruijn multigrids.
