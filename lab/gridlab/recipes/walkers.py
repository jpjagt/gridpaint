"""Lace walkers: symmetric random walks and maze growth that obey the lace grammar.

- worm_lace:      curling random walkers on symmetry orbits (no 2x2, clearance between worms) (P3)
- diagonal_maze:  braided spanning tree on a diagonal node lattice: all links are diagonal bridges (P5)
- void_lace:      out of the box: lace grows everywhere EXCEPT a reserved motif channel, so the sacred
                  sign appears as negative space; an optional solid back plate shows through it.
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import composition as C
from ..ops import lace as L
from ..ops import morph
from . import Param, recipe, register_section

register_section(
    "walkers", "Lace walkers",
    "Symmetric agents that crawl one cell at a time and obey the lace grammar (one-cell strokes, no 2x2 "
    "blocks, a cell of clearance between strands), plus a maze grown on the diagonal lattice.")

DIRS = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]  # (dy, dx), 45-degree steps


def _sym_for(w, h, sym):
    if sym == "auto":
        return "d4" if w == h else "d2"
    return "d2" if (sym == "d4" and w != h) else sym


class OrbitCanvas:
    """Grid where every placement is applied to the whole symmetry orbit, with worm ownership."""

    def __init__(self, free: np.ndarray, sym: str):
        self.free = C.symmetrize(free, sym, how="and")
        self.H, self.W = free.shape
        self.sym = sym
        self.g = np.zeros_like(free)
        self.owner = np.full(free.shape, -1, np.int32)
        self.orb = C.orbit_map(self.H, self.W, sym)
        self._members = {}

    def members(self, y, x):
        k = int(self.orb[y, x])
        if k not in self._members:
            one = np.zeros((self.H, self.W), bool)
            one[y, x] = True
            self._members[k] = [tuple(p) for p in np.argwhere(C.symmetrize(one, self.sym))]
        return self._members[k]

    def can_place(self, y, x, wid, recent, clearance=True, allow_join=False):
        if not (0 <= y < self.H and 0 <= x < self.W) or not self.free[y, x] or self.g[y, x]:
            return False
        mem = self.members(y, x)
        g = self.g
        for (my, mx) in mem:
            g[my, mx] = True
        ok = True
        for (my, mx) in mem:
            sub = g[max(0, my - 1):my + 2, max(0, mx - 1):mx + 2]
            if L.blocks2x2(sub).any():
                ok = False
                break
        if ok and clearance:
            # neighbours of the new cell (in the canonical copy) must be own recent cells, except an
            # occasional diagonal-only join to another strand (allow_join)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not (dy or dx):
                        continue
                    ny, nx = y + dy, x + dx
                    if not (0 <= ny < self.H and 0 <= nx < self.W) or not g[ny, nx] or (ny, nx) in mem:
                        continue
                    if (ny, nx) in recent:
                        continue
                    if allow_join and dy and dx:
                        continue
                    ok = False
                    break
                if not ok:
                    break
        for (my, mx) in mem:
            g[my, mx] = False
        return ok

    def place(self, y, x, wid):
        for (my, mx) in self.members(y, x):
            self.g[my, mx] = True
            self.owner[my, mx] = wid


def crawl(rng, free: np.ndarray, sym: str, n_worms: int = 4, length: tuple[int, int] = (6, 14),
          diag: float = 0.8, curl: float = 2.0, branch: float = 0.1, join: float = 0.15,
          density: float = 0.4, starts: np.ndarray | None = None, n_frames: int = 14, max_worms: int = 160,
          wiggle: float = 0.5):
    """Run symmetric curling walkers in ``free``; returns (grid, frames)."""
    cv = OrbitCanvas(free, sym)
    H, W = free.shape
    canon = cv.free & (cv.orb == (np.arange(H)[:, None] * W + np.arange(W)[None, :]))
    pool = np.argwhere(canon & (starts if starts is not None else True))
    if not len(pool):
        pool = np.argwhere(canon)
    if not len(pool):
        return cv.g, []
    target = density * cv.free.sum()

    def newborn(y, x, L_):
        # continuous heading (in 45-degree units) + angular velocity: rasterises into organic zig-zags
        return [int(y), int(x), float(rng.uniform(0, 8)), float(rng.choice([-1, 1]) * curl * 0.15 * rng.uniform(0.5, 1.5)), L_]

    queue = []
    for _ in range(n_worms):
        y, x = pool[rng.integers(len(pool))]
        queue.append(newborn(y, x, int(rng.integers(length[0], length[1] + 1))))
    snaps = []
    placed = 0
    wid = 0
    spawned = n_worms
    while queue and cv.g.sum() < target:
        y, x, th, om, L_ = queue.pop(0)
        recent = []
        if not cv.can_place(y, x, wid, recent):
            if spawned < max_worms:  # respawn somewhere else
                ny, nx = pool[rng.integers(len(pool))]
                queue.append(newborn(ny, nx, L_))
                spawned += 1
            continue
        cv.place(y, x, wid)
        recent = [(y, x)]
        for _ in range(L_):
            th += om + rng.normal(0, wiggle)
            om = float(np.clip(om + rng.normal(0, 0.05), -1.0, 1.0))
            if rng.random() < 0.08:  # S-curves
                om = -om
            base = int(np.floor(th))
            opts, ws = [], []
            for k in range(base - 2, base + 4):
                dy, dx = DIRS[k % 8]
                ny, nx = y + dy, x + dx
                w = np.exp(-((k - th) ** 2) / 0.5) * (diag if dy and dx else 1.0)
                if w < 1e-3:
                    continue
                if cv.can_place(ny, nx, wid, recent[-3:], allow_join=rng.random() < join):
                    opts.append((ny, nx, k))
                    ws.append(w)
            if not opts or sum(ws) < 0.25:  # preferred heading blocked: stop rather than slide along walls
                break
            ws = np.array(ws)
            ny, nx, k = opts[rng.choice(len(opts), p=ws / ws.sum())]
            cv.place(ny, nx, wid)
            recent.append((ny, nx))
            th = 0.5 * th + 0.5 * k  # heading follows the step actually taken
            y, x = ny, nx
            placed += 1
            if rng.random() < branch and spawned < max_worms:
                queue.append([y, x, th + float(rng.choice([-2, 2])), -om, max(3, L_ // 2)])
                spawned += 1
            if placed % 2 == 0:
                snaps.append(cv.g.copy())
        wid += 1
        if not queue and cv.g.sum() < target and spawned < max_worms:
            ny, nx = pool[rng.integers(len(pool))]
            queue.append(newborn(ny, nx, int(rng.integers(length[0], length[1] + 1))))
            spawned += 1
    snaps.append(cv.g.copy())
    idx = np.unique(np.linspace(0, len(snaps) - 1, min(n_frames, len(snaps))).round().astype(int))
    frames = [(f"step {int(i * 2)}", snaps[i]) for i in idx]
    return cv.g, frames


@recipe(
    "worm_lace", section="walkers", title="Worm lace",
    description="Curling random walkers (continuous heading + angular velocity, rasterised) crawl on mirrored orbits; a step "
                "is refused if it would make a 2x2 block or touch another strand (except rare diagonal joins). "
                "Frames show them crawl.",
    params={
        "width": Param(13, 7, 41, 2), "height": Param(23, 7, 41, 2),
        "silhouette": Param("capsule", choices=list(C.SILHOUETTES)),
        "band": Param(5, 1, 12, 1),
        "worms": Param(4, 1, 12, 1, description="walkers per fundamental domain"),
        "length": Param(10, 3, 30, 1, description="max steps per walker"),
        "curl": Param(2.0, 0.0, 6.0, 0.25, description="preference for turning the same way (spirals/hooks)"),
        "diag": Param(0.9, 0.1, 2.0, 0.1, description="weight of diagonal steps (bridges)"),
        "wiggle": Param(0.5, 0.0, 1.5, 0.05, description="heading noise per step"),
        "branch": Param(0.1, 0.0, 0.5, 0.02),
        "join": Param(0.5, 0.0, 1.0, 0.05, description="chance a step may touch another strand diagonally"),
        "density": Param(0.38, 0.1, 0.6, 0.02),
        "sym": Param("auto", choices=["auto", "d2", "d4", "x"]),
        "start": Param("band", choices=["edge", "band"], description="where walkers are born"),
        "connected": Param(True),
    },
    tags=["walkers", "agents", "d2"],
)
def worm_lace(seed, width, height, silhouette, band, worms, length, curl, diag, wiggle, branch, join, density, sym, start,
              connected):
    rng = np.random.default_rng(seed)
    sym = _sym_for(width, height, sym)
    sil = C.silhouette(silhouette, height, width)
    z = C.zones(sil, band=band, gap=0)
    free = z["band"]
    starts = z["dist"] <= (2 if start == "edge" else band)
    g, frames = crawl(rng, free, sym, worms, (max(3, length // 2), length), diag, curl, branch, join, density, starts,
                      wiggle=wiggle)
    g = L.lace_clean(g, 3, sym)
    if connected:
        g = L.lace_clean(C.connect(g, free, sym, 4), 3, sym)
    frames.append(("clean", g))
    sc = L.lace_score(g)
    d = Design.from_masks({1: g}, frames=[(lab, {1: f}) for lab, f in frames])
    d.notes = (f"{worms} curling walkers per {sym} fundamental domain in a {band}-deep {silhouette} band; "
               f"curl {curl}, diag {diag}, branch {branch}; diag-only {sc['diag_ratio']}, pieces {sc['pieces']}.")
    return d


# ---- diagonal maze -----------------------------------------------------------------------------

def diagonal_lattice(h: int, w: int):
    """Node and link masks of the diagonal lattice centred on the canvas: nodes at even offsets with
    (dx+dy)/2 even, links at odd/odd offsets (each joins exactly one diagonal node pair)."""
    dx, dy = C.centred(h, w)
    dx = np.rint(dx).astype(int)
    dy = np.rint(dy).astype(int)
    node = (dx % 2 == 0) & (dy % 2 == 0) & (((dx + dy) // 2) % 2 == 0)
    link = (dx % 2 == 1) & (dy % 2 == 1)
    return node, link


def diag_maze(rng, region: np.ndarray, sym: str, prune: float = 0.4, braid: float = 0.1, n_frames: int = 12):
    """Wilson UST on the canonical (fundamental-domain) diagonal nodes inside region, pruned + braided,
    mirrored. Returns (grid, frames)."""
    H, W = region.shape
    node, link = diagonal_lattice(H, W)
    orb = C.orbit_map(H, W, sym)
    idx = np.arange(H)[:, None] * W + np.arange(W)[None, :]
    region = C.symmetrize(region, sym, how="and")
    canon = region & node & (orb == idx)
    nodes = [tuple(p) for p in np.argwhere(canon)]
    nset = set(nodes)

    def nbrs(p):
        y, x = p
        out = []
        for dy, dx in ((-2, -2), (-2, 2), (2, -2), (2, 2)):
            q = (y + dy, x + dx)
            ly, lx = y + dy // 2, x + dx // 2
            if q in nset and region[ly, lx]:
                out.append(q)
        return out

    adj = {p: nbrs(p) for p in nodes}
    in_tree = set()
    edges = set()
    order = list(nodes)
    rng.shuffle(order)
    snaps = []
    for root in order:
        if root in in_tree:
            continue
        in_tree.add(root)  # new component root (forest when the domain is split)
        for start in order:
            if start in in_tree:
                continue
            # loop-erased random walk until hitting the tree (bounded: component may not reach it)
            path = [start]
            pos = {start: 0}
            cur = start
            steps = 0
            while cur not in in_tree and steps < 4000:
                nb = adj[cur]
                if not nb:
                    break
                cur = nb[rng.integers(len(nb))]
                steps += 1
                if cur in pos:
                    path = path[:pos[cur] + 1]
                    pos = {p: i for i, p in enumerate(path)}
                else:
                    pos[cur] = len(path)
                    path.append(cur)
            if cur not in in_tree:
                continue
            for a, b in zip(path, path[1:]):
                edges.add(frozenset((a, b)))
            in_tree.update(path)
            if len(snaps) < 200:
                snaps.append(set(edges))
    # prune leaves
    deg = {p: 0 for p in nodes}
    for e in edges:
        for p in e:
            deg[p] += 1
    for _ in range(2):
        leaves = [p for p in nodes if deg[p] == 1 and rng.random() < prune]
        for p in leaves:
            for e in [e for e in edges if p in e]:
                edges.discard(e)
                for q in e:
                    deg[q] -= 1
        snaps.append(set(edges))
    # braid: close some loops between tree nodes that are adjacent but not linked
    for p in nodes:
        if deg[p] == 0:
            continue
        for q in adj[p]:
            e = frozenset((p, q))
            if e not in edges and deg.get(q, 0) > 0 and rng.random() < braid / 2:
                edges.add(e)
                deg[p] += 1
                deg[q] += 1
    snaps.append(set(edges))

    def raster(es):
        g = np.zeros((H, W), bool)
        for e in es:
            a, b = tuple(e)
            g[a] = g[b] = True
            g[(a[0] + b[0]) // 2, (a[1] + b[1]) // 2] = True
        return C.symmetrize(g, sym)

    pick = np.unique(np.linspace(0, len(snaps) - 1, min(n_frames, len(snaps))).round().astype(int))
    frames = [(f"links {len(snaps[i])}", raster(snaps[i])) for i in pick]
    return raster(edges), frames


def dashed(ring: np.ndarray, sym: str, period: int = 3, on: int | None = None) -> np.ndarray:
    """Dash a 1-cell ring: walk the canonical part by angle, keep ``on`` of every ``period`` cells, mirror."""
    H, W = ring.shape
    on = max(1, period - 1) if on is None else on
    orb = C.orbit_map(H, W, sym)
    canon = ring & (orb == (np.arange(H)[:, None] * W + np.arange(W)[None, :]))
    dx, dy = C.centred(H, W)
    pts = np.argwhere(canon)
    ang = np.arctan2(dy[canon], dx[canon])
    out = np.zeros_like(ring)
    for i, j in enumerate(np.argsort(ang)):
        if i % period < on:
            out[tuple(pts[j])] = True
    return C.symmetrize(out, sym) & ring


@recipe(
    "diagonal_maze", section="walkers", title="Braided diagonal maze",
    description="A uniform spanning tree (Wilson) grown on the diagonal node lattice of a silhouette band, so every "
                "link renders as a thin diagonal bridge: pure slime-mould lace. Leaves pruned, a few loops braided "
                "in, then mirrored; optional dashed frame and central motif.",
    params={
        "width": Param(19, 9, 41, 2), "height": Param(29, 9, 41, 2),
        "silhouette": Param("capsule", choices=list(C.SILHOUETTES)),
        "band": Param(6, 2, 20, 1, description="band depth; large = fill the whole silhouette"),
        "prune": Param(0.35, 0.0, 1.0, 0.05, description="fraction of dead ends cut (2 rounds)"),
        "braid": Param(0.1, 0.0, 0.6, 0.05, description="loops added"),
        "frame": Param("none", choices=["none", "dash", "solid"], description="dash = dotted seal ring (separate beads)"),
        "motif": Param("cross", choices=["none"] + list(C.MOTIFS)),
        "sym": Param("auto", choices=["auto", "d2", "d4"]),
    },
    tags=["walkers", "maze", "diagonal", "d2"],
)
def diagonal_maze(seed, width, height, silhouette, band, prune, braid, frame, motif, sym):
    rng = np.random.default_rng(seed)
    sym = _sym_for(width, height, sym)
    sil = C.silhouette(silhouette, height, width)
    has_frame = frame != "none"
    z = C.zones(sil, frame=1 if has_frame else 0, frame_gap=1, band=band, gap=0)
    inner = z["band"] | z["core"]
    mot = np.zeros_like(sil)
    region = z["band"].copy()
    if motif != "none":
        ry = max(2, round((height - 1) / 2 * 0.62))
        rx = max(1, round((width - 1) / 2 * 0.55))
        mot = C.symmetrize(C.motif(motif, height, width, ry, rx), "x") & morph.erode(inner, 1, 4)
        region = inner & ~morph.dilate(mot, 1, 8)
    g, frames = diag_maze(rng, region, sym, prune, braid)
    extra = np.zeros_like(sil)
    if has_frame:
        ring = z["frame"]
        if frame == "dash":
            ring = dashed(ring, sym, period=4, on=2)
        extra |= ring
    out = C.connect(g | mot, region | mot | morph.dilate(mot, 1, 8), sym, 3)
    if frame == "solid":
        out = C.connect(out | extra, sil, sym, 3)
    else:
        out = out | extra  # dashes stay as separate beads (the frame reads as a dotted seal)
    out = L.lace_clean(out, 2, sym, keep=mot | extra)
    frames = [(lab, f | extra | mot) for lab, f in frames] + [("final", out)]
    sc = L.lace_score(out)
    d = Design.from_masks({1: out}, frames=[(lab, {1: f}) for lab, f in frames])
    d.notes = (f"Wilson UST on the diagonal lattice ({sym} fundamental domain), prune {prune}, braid {braid}; "
               f"frame {frame}, motif {motif}. diag-only {sc['diag_ratio']}.")
    return d


# ---- void lace (out of the box) -------------------------------------------------------------------

@recipe(
    "void_lace", section="walkers", title="Void lace (reliquary)",
    description="Out of the box: lace (learned or worms) grows everywhere EXCEPT a reserved channel around a hidden "
                "motif, so the cross/eye/star is drawn by absence. With 2 layers a back plate shaped like the void "
                "shows through it in a darker tone, like a relic behind lace.",
    params={
        "width": Param(17, 9, 41, 2), "height": Param(25, 9, 41, 2),
        "silhouette": Param("capsule", choices=list(C.SILHOUETTES)),
        "motif": Param("cross", choices=list(C.MOTIFS)),
        "motif_scale": Param(0.6, 0.3, 1.0, 0.05),
        "filler": Param("learned", choices=["learned", "worms"], description="what grows around the void"),
        "channel": Param(1, 1, 2, 1, description="half-width of the empty channel around the motif"),
        "worms": Param(6, 1, 14, 1),
        "curl": Param(2.0, 0.0, 6.0, 0.25),
        "density": Param(0.44, 0.2, 0.6, 0.02),
        "layers": Param(2, 1, 2, 1, description="2 = add a back plate shaped like the void (the relic) + rim"),
    },
    tags=["walkers", "negative-space", "layers"],
)
def void_lace(seed, width, height, silhouette, motif, motif_scale, filler, channel, worms, curl, density, layers):
    rng = np.random.default_rng(seed)
    sym = "d2"
    sil = C.silhouette(silhouette, height, width)
    ry = max(2, round((height - 1) / 2 * motif_scale))
    rx = max(1, round((width - 1) / 2 * motif_scale))
    mot = C.symmetrize(C.motif(motif, height, width, ry, rx), "x") & sil
    void = morph.dilate(mot, channel, 8)
    free = sil & ~void
    # an outline of the void is the natural starting place: worms seem to flow around the sign
    starts = morph.dilate(void, 1, 8) & ~void
    if filler == "learned":
        from .learned import lace_fill

        g, frames = lace_fill(rng, free, np.zeros_like(sil), sym, "vote", density, 100, 0.5)
    else:
        g, frames = crawl(rng, free, sym, worms, (5, 14), 0.9, curl, 0.12, 0.5, density, starts)
    g = L.lace_clean(g, 3, sym)
    g = L.lace_clean(C.connect(g, free, sym, 4), 3, sym)
    frames.append(("clean", g))
    if layers == 2:
        # the relic: a plate shaped like the reserved void (+1 cell under the lace rim for glue), joined to
        # an outer ring by short spokes; it shows through the void in a darker tone
        rim = C.zones(sil, band=1, gap=0)["band"]
        plate = (morph.dilate(void, 1, 4) & sil) | rim
        plate = C.connect(plate, sil, sym, 8)
        out = {1: g, 2: plate}
        fl = [(lab, {1: f, 2: plate}) for lab, f in frames]
    else:
        out = {1: g}
        fl = [(lab, {1: f}) for lab, f in frames]
    d = Design.from_masks(out, frames=fl)
    d.notes = (f"Reserved void: dilate({motif}, {channel}) is forbidden ground; {filler} lace fills the rest. " + ("Back plate = the void shape + rim + spokes, seen through the lace." if layers == 2 else ""))
    return d
