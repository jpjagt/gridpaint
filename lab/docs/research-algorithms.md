# Generative algorithms for symmetric "pixel lace" jewellery: a research catalogue

Context: binary grids of roughly 10x10 to 60x60 cells (up to about 200), rendered as blobs. Orthogonal neighbours merge, outer corners are rounded, and diagonal neighbours form thin bridges. Designs have 2 to 4 laser-cut layers that stack. The target look is organic, mould- or coral-like lace held in place by strong symmetry, a clear silhouette and a clear composition, with randomness kept local. Restraint and negative space matter. "Soup" is the failure mode.

---

## 0. What the reference samples actually are (measured)

I parsed `lab/samples/*.json` (the union of groups per layer) and computed simple statistics. These numbers are the most useful design targets in this document.

| sample / layer | bbox | fill % of bbox | 4-neighbour degree hist [0,1,2,3,4] | diag-only cells | **2x2 solid blocks** | symmetry |
|---|---|---|---|---|---|---|
| single_1 L3 (lace + cross) | 11x21 | 42% | 24/44/24/0/5 | 24 | **0** | D2 (both mirrors) |
| single_2 L3 (lace frame, empty interior) | 13x21 | 32% | 36/40/12/0/0 | 36 | **0** | D2 |
| single_ring L3 | 29x29 | 17% | 36/56/40/8/0 | 36 | **0** | **D4** (also transpose-symmetric) |
| multi_1 L4 (bottom lace) | 13x23 | 42% | 21/64/32/8/2 | 21 | **0** | D2 |
| multi_1 L2 (top: plain cross) | 5x13 | 26% | 0/4/12/0/1 | 0 | 0 | D2 |
| multi_2 L5 (solid spine + lace) | 9x19 | 53% | 0/40/8/18/24 | 0 | 26 | mirror-X only (near-D2) |
| multi_2 L3 (top: cross with bars) | 9x17 | 22% | 0/12/16/0/5 | 0 | 0 | D2 |

Observations, which act as the aesthetic's hidden grammar:

1. **Lace layers contain no 2x2 solid blocks.** Every stroke is one cell wide. Thickness comes only from the rounded blob rendering.
2. **Diagonal-only adjacency is the main source of wiggle.** 15-25% of lace cells have no orthogonal neighbour and connect only diagonally. That produces the thin bridges and the "slime-mould" look. Low 4-degree dominates (0 to 2). Degree-3 and degree-4 cells are rare and mark junctions.
3. **Odd dimensions with a centre row and centre column** (11x21, 13x23, 29x29). The mirror axis runs through cells, which allows a spine or cross exactly on the axis. Lace often leaves the centre column empty, giving a "split" (a vertical gap between the two halves, as in sample 1 bottom).
4. **The silhouette is a capsule or rounded rectangle**: the corners are cut by 2 to 4 cells, clearly visible in the ASCII dumps. The ring is a circle band about 3 cells thick.
5. **Composition is a frame of lace around a calm interior.** The interior is either empty (single_2, ring) or holds a crisp geometric motif (cross or spine). Lace density sits around 0.4 within the band. Overall density is lower (0.17 to 0.42).
6. **Layers contrast in character**: the bottom is lace, the middle is a mix of solid spine and lace, the top is a pure geometric cross. Top layers are smaller and orthogonal-only, with no diagonal bridges.

A useful hard and soft constraint set for any generator, the **lace grammar**:
- no 2x2 solid blocks (hard, for lace layers)
- 4-degree of 3 or less for most cells; degree-4 cells only at motif junctions
- a target ratio of diag-only cells between 0.10 and 0.30
- no orphan isolated cell (no 8-neighbours) except deliberate "dots"
- fill of the lace band between 0.35 and 0.50; fill of the whole canvas below 0.45
- exact mirror symmetry (D2, or D4 for square or round designs)

A quick prototype (`3x3 patch log-likelihood` plus annealing on the quarter domain, section 4.2) reproduced this texture convincingly in about 20k flips on 13x23. That is the strongest evidence that **learning local statistics from the user's own drawings** is the right core.

---

## 1. Global framework: what makes any algorithm "not soupy"

Every algorithm below should run inside the same scaffold. Without it, all of them produce soup:

1. **Generate on the fundamental domain only**, then mirror. For D2, generate the quarter `ceil(H/2) x ceil(W/2)`, including the centre row and column. For D4, generate the 1/8 triangle (`x <= y` in the quarter). The randomness then reads as intentional pattern, because the brain treats mirrored noise as a motif (inkblot or Rorschach effect).
   - Caveat: for dynamic processes (CA, growth), mirror **after every step**, not only at the end. Otherwise the axes become seams with doubled or missing cells. Alternatively, run the process on the fundamental domain with **reflecting boundary conditions**: neighbour lookups across an axis read the mirrored cell.
2. **Silhouette mask**: a capsule, oval, superellipse, ring, lozenge or shield. Cells outside the mask are forced to 0.
3. **Zones from a distance transform** of the mask: `frame` (d = 1), `lace band` (2 <= d <= k), `breathing gap` (one or two empty cells), and `core` (motif). Each zone gets its own generator and density. This is how the samples are organised.
4. **Grammar cleanup** (section 4.5): remove 2x2 blocks, prune orphans, enforce connectivity to a support, and re-symmetrise.
5. **Scoring and selection**: generate N candidates, score them (section 4.1), and keep the top few. This "generate many, curate" loop is how Nervous System, Inconvergent and others get consistent quality.

---

## 2. Ranked catalogue

Ranking reflects fit to this aesthetic multiplied by controllability, divided by soup risk. Complexity is rated L (an afternoon), M (a day) or H (multiple days), in Python/numpy and TS.

### Tier A: core techniques (start here)

**A1. Patch-statistics model learned from the user's samples (Markov random field plus annealing)**
- *Idea*: learn the frequency of every 3x3 (or 2x2 / 4x4) binary patch from the user's drawings, augmented with D4. Generate by simulated annealing or Gibbs sampling on the fundamental domain to maximise patch log-likelihood plus density or zone terms.
- *Fit*: it directly captures the "diagonal stepping, no 2x2, low degree" grammar without hand-coding it. It is trained on taste.
- *Params*: patch size (3 is best for 4 to 8 samples; 4 overfits), smoothing epsilon (0.05), density weight, temperature schedule (T0 2.0 to Tmin 0.05, about 20k flips at 13x23), zone masks.
- *Constraint*: the symmetry is exact because the state is the quarter. Mask and zones enter as energy terms or hard clamps.
- *Layers*: train separate models per layer role (bottom lace vs top motif), or add cross-layer energy terms (support, contrast).
- *Complexity*: L/L (about 80 lines). Incremental energy updates (only 9 patches change per flip) make it fast in TS.
- *Soup risk*: low to medium. Too high a density weight or too warm an end temperature produces checkerboard. A weak checkerboard tendency already appears, so add a penalty on long alternating runs if it shows.

**A2. Wave Function Collapse, overlapping model, trained on the samples**
- *Idea*: mxgmn WFC with N=3 patterns from the samples, D4 augmentation and periodic=false, output on the fundamental domain with mirrored boundary constraints. Pre-collapse mask-outside cells to 0.
- *Fit*: the same as A1, but with harder local exactness. Every 3x3 window has appeared in a sample.
- *Params*: N (3), symmetry augmentation (8), ground/border constraints, frequency weighting (heuristic: entropy).
- *Constraint*: pre-collapse mask cells, axis cells and motif cells. For mirror consistency, collapse a cell and its mirror images together (one "orbit" equals one variable).
- *Layers*: run WFC per layer with constraints read from the layer below (for example, cells where the support is 0 are forbidden to be 1).
- *Complexity*: M/M. Contradictions on tiny masked domains are common, so restart or backtrack.
- *Soup risk*: low. The risk instead is **too-homogeneous texture with no hierarchy**, so pair it with zones and motifs.

**A3. Symmetric "worms": constrained self-avoiding random walks with a lace grammar**
- *Idea*: spawn K walkers on the fundamental domain. Each step moves orthogonally or diagonally, chosen with biased probabilities, and is rejected if it would create a 2x2 block, touch another worm orthogonally (except at allowed junctions), or leave the band. Walkers die after length L or when stuck. Mirror every placed cell immediately.
- *Fit*: it produces wiggly tendrils, hooks and curls that read like the samples' fragments. It has explicit control over branchiness and length.
- *Params*: K (3 to 6 per quarter), L (6 to 15), P(diagonal step) 0.4, P(turn) 0.3, branch prob 0.1, min clearance 1, curl bias (persistent turning direction gives spiral hooks).
- *Constraint*: band mask, start positions on the frame (tendrils grow inward) or on the spine (growing outward).
- *Layers*: worms on layer 2 seeded at junctions of layer 1, and so on.
- *Complexity*: L/L.
- *Soup risk*: low, as long as clearance is enforced. Without it, you get a hairball.

**A4. Zoned composition with distance-transform rings plus motif library**
- *Idea*: not a texture generator but the composition engine. Take the silhouette, compute the chamfer or Euclidean distance transform, then assign rings: frame line (d = 1, optionally dashed), lace band, breathing gap, and core motif (cross, spine, star, diamond, dots) drawn from a small parametric library.
- *Fit*: it is how all samples are structured.
- *Params*: band widths, frame style (solid, dashed with period p, or none), gap width (1 to 2), motif type and arm lengths, and whether the motif touches the band (bridges).
- *Layers*: rings naturally split across layers, for example frame on the bottom, lace in the middle and the cross on top.
- *Complexity*: L/L.
- *Soup risk*: none by itself. It is the antidote.

**A5. Space colonization (Runions et al. 2005/2007), rasterised**
- *Idea*: scatter attractor points in the band (symmetrically), grow a vein network from roots (spine or frame) toward attractors, then rasterise segments with a 1-cell line on a grid using 8-connected Bresenham so diagonal bridges appear naturally.
- *Fit*: dendritic, venation-like and hierarchical, with obvious "flow" from a spine. This is close to Nervous System's *Hyphae*.
- *Params*: attractor count (20 to 60 per quarter), influence radius (4 to 8 cells), kill distance (1.5 to 2), segment length (1 cell), roots.
- *Constraint*: mirror the attractors so growth is symmetric, or grow on the quarter with roots on the axis. Mask = attractor region.
- *Layers*: the vein network on the middle layer; dilated veins become the backplate; terminal nodes become dots on top.
- *Complexity*: M/M.
- *Soup risk*: low. Trees are inherently legible. Risk of bushiness if attractors are too dense.

### Tier B: strong texture sources (need the scaffold)

**B1. Life-like CA with reflecting boundaries (Maze, Mazectric, Coral and others)**
- *Idea*: seed noise in the band, run a B/S rule for a few steps with symmetric updates, then clean up.
- Notable rules: Maze B3/S12345 and Mazectric B3/S1234 crystallise into corridors. Coral B3/S45678 grows slowly with a coral texture. Day & Night B3678/S34678 forms blobby symmetric islands. Diamoeba B35678/S5678 makes diamonds with chaotic boundaries. Assimilation B345/S4567 and "Stains" B3678/S235678 are other options. The 2x2-forbidding constraint can be layered on top.
- *Fit, tested*: Maze and Mazectric gave **too orthogonal and architectural** output on 13x23 (long straight halls, density 0.55). They read like circuitry, not mould. Coral and Day & Night produce blobs, so they need thinning. CA are best as **a structure source followed by skeletonisation**, or used for 1 to 3 steps only on sparse seeds.
- *Params*: rule, seed density (0.2 to 0.4), steps (2 to 12), mask.
- *Layers*: run the CA in 3D on a 3-layer stack (neighbourhood 3x3x3 with a reduced count across z). That is experimental.
- *Complexity*: L/L. *Soup risk*: high without cleanup.

**B2. "Cave" smoothing CA (majority 4-5 rule) then skeletonise**
- *Idea*: noise, then 3 to 5 iterations of "1 if at least 5 of 9 are on", which gives smooth blobs. Then Zhang-Suen thinning gives 1-cell lines.
- *Fit*: it produces organic cell-like loops (the "holes" in the samples). The skeleton of a blobby field yields closed loops and junctions, which is very mould-like.
- *Params*: noise density, iterations, scale (generate at 2x and downsample), thinning type (Zhang-Suen or Guo-Hall).
- *Complexity*: L/L. *Soup risk*: medium.

**B3. Reaction-diffusion (Gray-Scott), thresholded or skeletonised**
- *Idea*: simulate Gray-Scott at 4 to 8x resolution with symmetric seeds, then threshold and downsample, or skeletonise.
- *Fit*: the "mitosis" and "coral" regimes (for example f=0.0545, k=0.062 for coral or labyrinth) give exactly lacy coral. Nervous System's *Reaction* line uses this.
- *Params*: f and k (the Pearson classes), diffusion ratio, steps (2-5k), seed points (mirror-symmetric), the upsample factor, threshold.
- *Constraint*: hold V=0 outside the mask (boundary as an absorber, which creates a nice clean rim effect). Symmetric seeds plus symmetric numerics stay symmetric up to float error, so re-symmetrise by averaging every 100 steps.
- *Layers*: threshold the same field at different levels: low threshold for the backplate, high for the top accents. That is a natural z-stack.
- *Complexity*: L in numpy, M in TS (needs a WebGL or typed-array loop).
- *Soup risk*: high at full field. RD loves to fill. Use in the band only.

**B4. Physarum (Jeff Jones multi-agent model), rasterised trail map**
- *Idea*: thousands of agents sense trail ahead (SA, sensor angle), turn (RA, rotation angle), move, and deposit, while the trail diffuses and decays. Threshold the trail on a coarse grid.
- *Fit*: it is literally slime mould, and forms networks connecting food sources (motif nodes). Low SA/RA gives branching networks; high values give islands.
- *Params*: SA 22-45 degrees, RA 22-45 degrees, sensor offset 9 px (at 8x upsample), decay 0.1, food = motif cells plus frame.
- *Constraint*: mirror the agents (spawn mirrored copies) or mirror-average the trail each step. Food placement controls the composition.
- *Layers*: food on layer N+1 is the motif of layer N+1, so the lower lace "feeds" to the upper motif.
- *Complexity*: M/M. *Soup risk*: medium. It tends toward even meshes, so the threshold must be high.

**B5. DLA (diffusion-limited aggregation) and DBM (dielectric breakdown / Lichtenberg)**
- *Idea*: random walkers stick to the growing cluster. DBM grows with probability proportional to the potential gradient to the power eta.
- *Fit*: dendrites and frost. DBM with eta 1-2 gives Lichtenberg fern-like branching from a spine. On small grids DLA is too sparse and too noisy, so use a **sticking probability below 1 (0.3)** to get fatter, coral-like clusters. Forbid stick moves that create 2x2.
- *Params*: seed (spine or frame), particle count, sticking prob, eta (DBM), and the launch region (band).
- *Complexity*: L/L (a DBM Laplace solve on 60x60 is trivial).
- *Soup risk*: low to medium, because the clusters are sparse. Risk: "hairy" and uncontrolled.

**B6. Eden growth and invasion percolation**
- *Idea*: Eden adds random perimeter cells (compact blobs). Invasion percolation assigns random resistance per cell and always grows into the lowest-resistance neighbour, which gives fractal fingers.
- *Fit*: invasion percolation with a 2x2 ban and growth into perimeter cells with at most one orthogonal neighbour yields **tree-like single-width tendrils**, essentially a randomised spanning-tree growth. It is very close to the samples' local feel.
- *Params*: N cells, resistance field (white noise or Perlin for regional coherence), neighbour rules.
- *Complexity*: L/L. *Soup risk*: low with the degree rule.

**B7. Maze generation, then braiding and pruning (maze-to-lace)**
- *Idea*: generate a maze on a coarse lattice (each node maps to cell (2i, 2j)) using DFS or Wilson's algorithm. Walls or passages become 1-cell lines. Then **braid** (remove dead ends to create loops), **prune** (delete random segments to create fragments), and **diagonalise** (replace some L-corners with diagonal steps).
- *Fit*: it guarantees one-width lines and good negative space. Pruning creates "fragments". The parity lattice matches the samples' rhythm (period 2 is visible in the ASCII dumps).
- *Variant*: build the maze on the **diagonal sublattice** (cells where x+y is even, connected diagonally). Rendered as blobs, this gives purely diagonal-bridge lace: very slime-like, and novel.
- *Params*: algorithm (DFS gives long corridors, Wilson is uniform, Prim is bushy), braid fraction, prune fraction, diagonal-corner fraction.
- *Complexity*: L/L. *Soup risk*: low to medium (mazes are dense; prune 30-50%).

**B8. L-systems and turtle on a grid**
- *Idea*: turtle with 45/90 degree turns on the grid, grammar like `F -> F[+F]F[-F]` and stochastic variants. Draw within the quarter and mirror.
- *Fit*: crisp dendrites and ornament (good for **top-layer motifs**, crosses and snowflake arms).
- *Params*: axiom, rules, iterations (2-3 on small grids), angle (45 or 90), step length.
- *Complexity*: L/L. *Soup risk*: low; risk of "too clipart".

### Tier C: ornamental and structural tools

**C1. Truchet tiles (pixel variant)** - 2x2 or 3x3 tiles with arcs approximated by pixel quarter-circles, or a "diagonal" tile set. With rendering, the arcs become rounded paths. Constrain by choosing tiles in the fundamental domain and mirroring (tile mirror maps must be correct). Smith/Truchet in the band produce chains and loops. Complexity L. Soup risk medium (uniform texture); mitigate by leaving some tiles empty (sparse Truchet).

**C2. Wang tiles / edge-matched tiles** - hand-design 8-16 small 3x3 lace tiles with edge colours; random edge-matched tiling within the band. More author control than WFC, but needs the user to design tiles. M.

**C3. Space-filling curves, broken** - Hilbert or Peano curve of order 2-3 laid on the band (or the quarter), then delete segments every k steps to form fragments. Regular, maze-like and ornamental. L. Risk: too technical-looking.

**C4. Noise thresholding with masks (Perlin, simplex, Worley)** - threshold `|noise| < eps` (a "ridged" isoline) gives thin wiggly lines. Worley F2-F1 below a threshold gives Voronoi cell edges (cellular, like Nervous System's *Cell Cycle*). Domain-warped noise gives organic flow. Must be sampled symmetrically: evaluate noise at `(|x|, |y|)`, which is mirror-symmetric for free. L. Soup risk medium-high; works best as an **input field** for other methods (resistance for B6, density for A1, attractor placement for A5).

**C5. Voronoi edges / relative neighbourhood graph** - symmetric seed points; rasterise the Voronoi or RNG edges with 8-connected lines. RNG and Gabriel graphs are sparser and more "network-like" (physarum approximates them). L/M. Low soup risk with few seeds.

**C6. Morphological ops** - erode, dilate, open, close, Zhang-Suen thinning, medial axis, hit-or-miss (for pruning spurs and detecting 2x2), connected-component filtering. Not a generator but the **cleanup and layer-derivation toolkit**. L.

**C7. Wolfram 1D CA folded** - run an elementary CA (rules 30, 90, 110, 150, 18, 182...) row by row, either straight (a frieze) or mapped onto concentric square rings (ring k = generation k) so it reads radially. Rule 90 or 150 from a single seed gives Sierpinski-like lace; it is symmetric by construction when the rule is symmetric (rules 18, 90, 150, 182 are left-right symmetric). Cheap and ornamental. L. Risk: recognisably "CA triangles"; best for frames and borders (frieze groups).

**C8. Margolus / block CA (e.g. "Critters", "Tron")** - partitioned 2x2 neighbourhoods, reversible. Interesting for "melting" a motif into lace over a few steps. M. Exotic, low priority.

**C9. Differential growth (pixelised)** - simulate a closed polyline that grows (node insertion, repulsion, alignment) inside the silhouette, then rasterise. Produces meandering "brain coral" folds. Pixelisation at small scale loses the subtlety. Use at 30x30 or larger, or only for the frame line. M/M. Risk: medium (fills the space evenly, a horror vacui tendency).

### Tier D: search and evaluation

**D1. Evolutionary search / annealing against an aesthetic fitness** - mutate grids (flip, move a worm, toggle a tile) and score them (section 4.1). Works with any generator as the mutation operator, or as a "selector" over N random seeds. Interactive variant: the user picks favourites, and their patches go into the A1 statistics (closing the taste loop). M.

**D2. Interactive genetic algorithm with sample-based crossover** - crossover = swap a quarter-zone between two parents (mirror keeps validity). Very good for an exploration page. M.

---

## 3. Symmetry systems on a square grid

- **D2** (mirror X and Y): generate the quarter, axes through cell centres (odd sizes) or between cells (even sizes). Odd sizes allow a spine on the axis; even sizes force a "split" (two halves meeting via pairs of cells or a gap). Expose both options.
- **D4** (adds the diagonal mirror): generate the 1/8 wedge. Square grids only. It fits rings, rosettes and brooches.
- **C4 / C2 (rotation without mirror)**: pinwheel or swirling look. The samples don't use it, but it is an "out-of-the-box" option; C2 on a capsule gives an "S" swirl.
- **Frieze groups** (7 types) for long bands or bracelets: translate the motif along the long axis with glide reflection or mirror. Useful for elongated silhouettes and frames.
- **Wallpaper groups** (p4m, p2mm, cmm, p4g): generate one tile and repeat it. Only for large grids. Risk of a wallpaper look. Cmm and p4g give diagonal-feeling repeats.
- **Radial symmetry on a square grid** (5-fold, 6-fold, 8-fold): it doesn't map onto cells exactly. Tricks:
  1. Generate in polar coordinates (r, theta) on a wedge, then rasterise each mirrored wedge by **pulling** values (for each grid cell compute (r, theta mod wedge), mirror theta and sample) rather than pushing. That gives approximate 6/8-fold symmetry with minor pixel asymmetries.
  2. Accept only D4 for exact symmetry, plus "illusory" higher order from the motif (an 8-arm star in D4).
  3. Use a ring: in the ring sample the lace band itself runs around a circle, and D4 makes it read as radial.
- **Broken symmetry accents**: after symmetrising, apply 1-3 deliberate asymmetric edits (one extra dot, one bridge, a single mirrored wedge replaced). These read as "handmade" without soup. Keep them small and away from the axes. Typically placed on the top layer.
- **Implementation detail**: always represent symmetry as an *orbit map* (each cell maps to its orbit id). Generators then operate on orbit ids, so CA steps, annealing flips and WFC collapses all apply to whole orbits. This one utility makes every algorithm symmetric.

---

## 4. Supporting machinery

### 4.1 Aesthetic fitness (for selection, annealing and evolution)
Score terms, each normalised to 0..1:
- `patchLL`: mean 3x3 log-likelihood under the sample model (A1).
- `density`: Gaussian around the target per zone (band 0.42, total 0.25-0.35).
- `noBlocks`: number of 2x2 blocks (penalty).
- `diagRatio`: share of diag-only cells, target 0.15-0.25.
- `components`: number of connected components (8-conn). Few for a backplate; several fragments allowed in lace. Penalise components smaller than 3 cells (dust).
- `negativeSpace`: the largest empty 8-connected region inside the silhouette relative to area (want 0.15-0.4 = "breathing").
- `edgeInterest`: perimeter/area ratio of filled cells (moderate, not maximal).
- `holeCount`: closed loops (Euler number). The samples have a few small rounded loops (`.#.#.` / `###` patterns); target a few per quarter.
- `silhouetteFill`: fraction of the outer frame contour (d=1..2) covered, which makes the outline legible.

### 4.2 Learning from samples (pattern-language model)
- Parse gridpaint selections (union of groups per layer; groups seem to be painting sub-selections), crop and pad with 2 zeros.
- Augment with D4 (8 transforms).
- Count 3x3 codes (512 bins) with additive smoothing. Optionally, separate models for "lace" (layers with 0 2x2 blocks) and "solid/motif" layers.
- Energy for state g: `E = -sum log p(patch) + lambda_d * (density - target)^2 * n + lambda_b * blocks2x2`. Metropolis single-orbit flips; geometric cooling.
- **Measured prototype result** (13x23 capsule, outer band only): after 20k flips, 0 blocks, density 0.43, lace matching the sample "feel" (diagonal zig-zags, small loops at the top and bottom). It tends slightly toward checkerboard on straight edges. Fix with a lower density target or a 4x4 term.

### 4.3 Silhouette primitives
Superellipse `|x/a|^n + |y/b|^n <= 1` (n=2 oval, n=3 capsule-ish rounded rectangle as in the samples, n=4-6 rounded rectangle), stadium/capsule (rectangle plus semicircles), ring (annulus), lozenge (`|x/a| + |y/b| <= 1`), shield (half rectangle plus half ellipse), and an octagon (rectangle with corners cut, which matches the "cut corners" in the samples best). Always symmetrise the mask (sample at cell centres with symmetric coordinates).

### 4.4 Inner motifs (parametric)
Cross (arm lengths), Lorraine/patriarchal cross (2 bars, matching multi_2 L3), spine with bars, diamond outline, star (4 or 8 arms with diagonal arms as diagonal steps), dot rosette, "eye" (lozenge with a centre dot). All axis-aligned on the centre row and column.

### 4.5 Grammar cleanup pass (apply to every generator output)
1. Re-symmetrise (union or intersection over the orbit, or majority).
2. Break 2x2 blocks: remove the cell in each block that has the most orthogonal neighbours, applied orbit-wise.
3. Remove dust: components below `minSize` (3) unless flagged as dots.
4. Spur prune: remove 1-cell side spurs on a straight line (optional; they are the "hooks" sometimes).
5. Clearance: enforce a 1-cell gap between components or allow a diagonal bridge (both are aesthetic choices; expose a toggle).
6. Clip to mask.

---

## 5. Layer (z) strategies

Physical rules (for laser-cut stacking): every top-layer cell should lie above a filled cell in the layer below (`support = top & ~below` = 0, or at most a small overhang ratio). Each layer must be one connected piece (or pieces that are glued: each component must be fully supported). Minimum feature size: a 1-cell line is the thinnest feature, so diagonal-only bridges are structurally weak. Discourage them in the **bottom** layer or back it with a solid plate.

Derivation strategies (layer 1 = bottom):
1. **Backplate = dilated union**: `L1 = close(dilate(L2 ∪ L3, 1))`, possibly with holes kept (`L1 = dilate(L2) & mask`). This is the safest supporting layer.
2. **Skeleton up**: `L(n+1) = skeleton(L(n))` with pruning, so each upper layer is a "spine" of the one below and always supported.
3. **Erode up**: `L(n+1) = erode(L(n))`, which gives a stepped "terrace" (a topographic or relief effect). With blob rendering this looks like a soft 3D relief.
4. **Nodes to accents**: the top layer has dots or small crosses at junction nodes (4-degree of 3 or more, or skeleton branch points) of the layer below. This produces a sparse "jewel setting" effect.
5. **Contrast**: lace over solid (the solid backplate shows through lace holes as a darker tone) or solid spine over lace (as in the samples: the cross on top of lace). Assign different generators per layer: lace (A1/A3) for the middle, geometric (A4 motif) for the top, dilation for the bottom.
6. **Shifted copies / parity offset**: layer 2 = layer 1 shifted by (1, 1) on the diagonal sublattice, intersected with support. It creates a moiré or "woven" depth effect. Out of the box, but cheap.
7. **Density gradient**: same generator, decreasing band and density per layer (0.45, 0.30, 0.15), with the band shrinking inward. Bottom is big; top is small and sparse.
8. **Threshold stack from a scalar field**: RD, noise or the distance transform as a height field h(x, y); `L_k = h > t_k`. Automatically nested, and therefore supported.
9. **Alternating role / interlock**: layer 2 fills where layer 1 has holes, overlapping by one cell at edges (for gluing), producing a "two-tone" pattern seen from above.
10. **Joint generation**: run A1 annealing on all layers at once with cross-layer energy terms: support violation (hard), overlap target (e.g. 60% of L2 lies over L1 lace, not over L1 holes), contrast (L2 diagRatio low, L1 diagRatio high).

Checks to show in the UI: unsupported cells count, components per layer, minimum width violations, and fill per layer.

---

## 6. Artists and practitioners, and what keeps their work from being soup

- **Nervous System** (Jessica Rosenkrantz and Jesse Louis-Rosenberg): *Hyphae* (venation / auxin canalisation, close to space colonisation), *Floraform* (differential growth of elastic surfaces), *Reaction* (reaction-diffusion), *Cell Cycle* (Voronoi). Their restraint comes from **strong physical boundaries** (the body, ring sizes), **hierarchy** (thick-to-thin vein orders), and **curation** (hundreds of grown pieces, a few sold). Lesson: hierarchy plus boundary constraints.
- **Anders Hoff (Inconvergent)**: *hyphae*, *differential-line*, *sand-spline*, *orbitals*. Uses a **very small number of simple rules**, lots of white space, monochrome, and often grows from a single seed or line. The growth is constrained (collision avoidance), which gives clean negative space.
- **Jared Tarbell (complexification.net)**: *Invader Fractal* / pixel space invaders. Random 5x7 grids **mirrored left-right** become instantly readable "creatures". That is the core rationale for generating on a fundamental domain. *Substrate* shows constrained growth (lines stop when they hit others).
- **Kjetil Golid**: *Apparatus* generator. Symmetric pixel/block structures grown by a simple randomised rule with mirror symmetry and colour grouping. Also uses grid-based "Chromatic stacks" (layered depth). Lesson: symmetry plus a block grammar plus a limited palette.
- **Sage Jenson** (mxsage): Physarum-based artwork (the 36 points series). Demonstrates how parameter choice in the Jones model goes from network to blob.
- **Tyler Hobbs**: flow-field work. His essays on margins, density control and "controlled randomness" (randomness in a constrained layer of the decision hierarchy) are directly relevant.
- **Textile traditions** with grid plus symmetry: *Kogin-zashi* and *Sashiko* (Japanese counted-thread stitching on grid, D2/D4 diamond motifs), *blackwork* and *Assisi* embroidery, *Hardanger* (cut-work lace on a grid), bobbin and filet lace (filet lace is literally a binary grid). These are rich motif libraries for A4 and good training data for A1.
- **Algorithmic botany** (Prusinkiewicz, Runions): L-systems, space colonisation, venation.

The common recipe across all of these: **one simple local rule, a strong global constraint (boundary or symmetry), a hierarchy of scales, a limited palette, and curation**.

---

## 7. Recommended shortlist: presets for an exploration study page

All presets share the scaffold: `W, H` odd (default 13x23 for capsules, 29x29 for rings); a symmetry orbit map (D2 default, D4 for square); a silhouette; zones via a distance transform; the cleanup pass of section 4.5; and an optional "generate 24, show top 8 by fitness". The default seed is deterministic per tile.

### P1. "Sample Echo": 3x3 patch MRF in a capsule band (safe bet)
1. Mask: superellipse n=3, 13x23. Zones: band = distance 1..4 from the edge; core = empty.
2. Learn 3x3 patch probabilities from all lace layers in the samples (D4 augmented, epsilon 0.05).
3. State: quarter (7x12). Random init with p=0.35 in the band.
4. Anneal 20k single-orbit flips. Energy = `-sum logp + 200*(dens-0.42)^2*nBand + 50*blocks2x2`. T: 2.0 to 0.05 geometric.
5. Cleanup. Done. Knobs: band width, density target, patch size 2/3/4.

### P2. "Sample Echo + Cross": composition with a motif (safe bet)
P1 plus: core = cross (vertical arm `H-6`, horizontal arm 5, centred), clamped to 1 and excluded from annealing. Breathing gap = 1 cell around the cross clamped to 0, except 2 "bridge" orbits allowed. Optional top layer: the cross only; bottom: dilate(union).

### P3. "Worm Lace": constrained symmetric random walks
1. Capsule 13x23, band of 4.
2. Per quarter, K=4 walkers starting at random frame cells (distance 1).
3. Step: choose from 8 directions with weights orthogonal 1.0 / diagonal 0.8, persistence bonus x2 for the same turning direction (curl). Reject a step if it creates a 2x2 block, touches a different worm orthogonally, or leaves the band. Branch with p=0.1 (spawn a child walker of length L/2). Length L in 6..14.
4. Mirror each placed cell immediately (orbits). Stop when density reaches 0.40 or all walkers are dead.
Knobs: K, L, diagonal weight, curl, clearance.

### P4. "Venation Spine": space colonisation from a spine (safe bet)
1. Capsule 15x25. Roots: the full centre column (spine) clamped as a line.
2. Attractors: 40 per quarter, uniform in the band (distance 1..5), mirrored.
3. Iterate: each attractor pulls its nearest node within radius 6. Nodes step 1 cell toward the mean direction (quantised to 8 directions). Kill attractors within 1.5.
4. Rasterise with 8-connected steps; apply cleanup.
5. Layers: L1 = dilate(all, 1) ∩ mask; L2 = veins; L3 = spine plus dots at vein tips.

### P5. "Braided Diagonal Maze": maze on the diagonal sublattice (out of the box)
1. Cells with `(x+y)` even are nodes; nodes are diagonal neighbours (x plus or minus 1, y plus or minus 1). Restrict to the band of an oval.
2. Run Wilson's algorithm (uniform spanning tree) on the orbit-quotient graph (nodes on the fundamental domain with mirror wiring).
3. Edges are implicit (diagonal neighbours rendered as bridges). Then prune 40% of the leaves (iteratively, 2 rounds) and braid 10% (add edges to close loops).
4. Add an orthogonal "frame": cells at distance 1 with a dash pattern of period 3.
It yields pure diagonal-bridge lace: very slime-mould, extremely distinctive.

### P6. "Coral Seeds": invasion percolation with a lace rule
1. Ring mask: 29x29, annulus radius 10..14. D4.
2. Resistance = simplex noise (scale 0.25) sampled at the D4-canonical coordinate, plus 0.3 white noise.
3. Seeds: 3 per 1/8 wedge on the mid-radius.
4. Repeatedly add the lowest-resistance perimeter cell that has at most one orthogonal filled neighbour, doesn't create 2x2, and has at most 2 filled 8-neighbours (allowing diagonal bridges). Stop at density 0.40 of the band.
Knobs: noise scale, rule strictness (max 8-neighbours), seeds.

### P7. "Cave Skeleton": smoothing CA then thinning
1. Generate at 2x resolution (26x46) within a capsule mask; noise p=0.48 (symmetric).
2. 4 iterations of the majority rule (on if at least 5 of 9).
3. Zhang-Suen thinning to 1-px skeleton, then downsample by "any" (2x2 OR) and rethin once at 1x.
4. Prune spurs below 2 cells, cleanup.
Gives closed loops ("cells" of mould). Layers: L1 = the downsampled blobs before thinning (natural backplate), L2 = skeleton.

### P8. "Gray-Scott Band" with a threshold stack
1. 8x upsampled grid inside a capsule; U=1, V=0. Seed V=1 in small mirrored spots in the band.
2. Gray-Scott f=0.055, k=0.062 (coral), Du=1, Dv=0.5, dt=1, 3000 steps, V clamped to 0 outside the band. Mirror-average every 100 steps.
3. Downsample by mean. Layers: L1 = V > 0.15 (dilated), L2 = skeleton(V > 0.25), L3 = local maxima of V above 0.35 as dots.

### P9. "Physarum Feeding": Jones agents between motif food sources (out of the box)
1. Capsule 15x25, 8x upsample. Food: the core cross plus frame cells (deposit 5 per step).
2. 2000 agents (mirrored in 4 quadrants), SA 45 degrees, RA 45 degrees, sensor offset 9px, step 1, deposit 5, decay 0.1, 3x3 diffusion. 400 steps.
3. Downsample the trail (max-pool), threshold at the 70th percentile within the band, thin, cleanup.
The result is a network of tendrils connecting the cross to the frame: a compositional link.

### P10. "Folded Rule 90 Frame": 1D CA as a radial or rectangular border (ornamental)
1. Square 25x25 D4, or capsule. Concentric rings by Chebyshev or superellipse distance: ring 0 = outer.
2. Unroll ring k into a 1D row (perimeter order over 1/8 wedge, mirrored), set generation k = rule(gen k-1) using a symmetric elementary rule (90, 150, 18 or 182), with a seed of 1-3 ones.
3. Use 4-6 generations (outer band only); interior: motif (P2) or empty.
It gives a structured lace border with triangular rhythms; the variant with random rule per ring is good for exploration.

### P11. "Truchet Lace, Sparse"
1. Band in an oval; tiles are 3x3 cells. Tile set: quarter-arc pixel tiles (4 rotations), a diagonal-bridge tile, a dot tile, an empty tile; probabilities 0.5 / 0.2 / 0.1 / 0.2.
2. Choose tiles on the fundamental domain only; mirror tile transforms correctly when reflecting.
3. Cleanup (tile seams may create 2x2s).

### P12. "Kogin Rosette": D4 motif grammar (safe bet for top layers and brooches)
1. Square 17x17 or 21x21, D4 (1/8 wedge).
2. Concentric diamond rings (L1 distance) at radii r1 < r2 < r3. Each ring gets a pattern chosen from {solid, dashed period 2, dashed period 3, dot every 4, zigzag (diagonal step every cell)}.
3. Centre: a dot, a small cross or a diamond outline. Optional 8 arm "rays" along the axes and diagonals.
Fully deterministic given choices, so it is good for top layers and ring centres.

### P13. "Learned WFC Ring"
1. Overlapping WFC N=3 trained on all lace layers (D4 augmented), output domain = ring band 29x29 radius 10..14.
2. Orbit-WFC: one variable per D4 orbit (constraints propagate through the orbit's members). Cells outside the band pre-collapsed to 0. Restart on contradiction (max 50).
3. Cleanup. Compare directly with P1 (MRF): WFC is crisper, MRF is softer.

### P14. "Terraced Relief": derived layer stack (layer strategy)
Input any lace L_mid (e.g. P1 output). Then:
- L1 (bottom) = close(dilate(L_mid, 1), 1) ∩ silhouette; optionally punch holes where the distance from L_mid exceeds 2.
- L2 = L_mid.
- L3 (top) = pruned skeleton of the core motif plus dots at 4-degree-3+ junctions of L_mid ∩ erode(L1).
Check support (L3 ⊆ L2 ∪ L1 etc.) and show violations in red.

### P15. "Broken Mirror": single symmetry-break accent (out of the box)
Take any finished D2 design and apply exactly one asymmetric edit from: (a) add a 3-5 cell worm in one quadrant only; (b) replace one quadrant's band section with a fresh sample; (c) shift the top-layer motif one cell off-axis; (d) one quadrant of the frame missing (as in the third composition in sample 1, the opened ring). Rank by fitness minus asymmetry plus 0.1. This tests whether "slight imperfection" improves the result.

### Suggested study-page layout
A grid of tiles: rows = presets, columns = 6 seeds. Each tile renders with blob rendering per layer (different grey per layer, as in gridpaint). Global controls: canvas size, symmetry, silhouette, density, band width. Per tile: copy as gridpaint-selection JSON (same format as the samples: `{"type":"gridpaint-selection","version":"2.0.0","data":{"layers":[{"layerId",groups:[{"id":"default","points":["x,y",...]}]}]}}`), so the user can paste results into gridpaint. Show the fitness breakdown on hover. Add a "like" button that appends the design to the A1/A2 training set: this closes the loop and makes the system converge to the user's taste.

---

## Sources
- Life-like rules: [Wikipedia: Life-like cellular automaton](https://en.wikipedia.org/wiki/Life-like_cellular_automaton), [ConwayLife wiki: List of Life-like rules](https://conwaylife.com/wiki/List_of_Life-like_rules)
- WFC: [mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse), [Merrell: comparison of model synthesis and WFC](https://paulmerrell.org/wp-content/uploads/2021/07/comparison.pdf)
- Physarum: [Jones 2010, Influences on the formation and evolution of Physarum-inspired emergent transport networks](https://uwe-repository.worktribe.com/output/985963/influences-on-the-formation-and-evolution-of-physarum-polycephalum-inspired-emergent-transport-networks), [Mechanisms inducing parallel computation in a model of Physarum transport networks](https://arxiv.org/pdf/1511.05869)
- Space colonisation and venation: [Runions et al. 2005, Modeling and visualization of leaf venation patterns](https://algorithmicbotany.org/papers/venation.sig2005.html), [Runions et al. 2007, Modeling trees with a space colonization algorithm](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.html)
- Nervous System: [Floraform: an exploration of differential growth](https://n-e-r-v-o-u-s.com/blog/?p=6721), [projects](https://n-e-r-v-o-u-s.com/projects/)
- Also from background knowledge: Gray-Scott (Pearson 1993 parameter classes), Zhang-Suen thinning, Witten-Sander DLA, Niemeyer DBM, Inconvergent (inconvergent.net), Jared Tarbell (complexification.net), Kjetil Golid (Apparatus), Sage Jenson (Physarum works).
