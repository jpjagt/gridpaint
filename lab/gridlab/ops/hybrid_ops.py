"""Machinery for the "hybrids" recipes: sacred structures that organic processes must respect.

The recurring trick (research-esoteric §2.6, §5): a symbolic skeleton (sigil, labyrinth, kolam,
Tree of Life nodes) plus ONE organic process that is fed, attracted or fenced by it.

Python API
- ``tree_of_life(sx, sy, margin)`` -> dict(w, h, nodes {name: (x, y)}, paths [(a, b)], daat)
- ``bagua_nodes(size, r)`` -> 8 compass points + centre on a square canvas
- ``node_rings(shape, pts, r)`` -> Chebyshev ring (r=1: 8 cells round a hole) or pixel ring per node
- ``chisel(fill, terminals, priority, kind, ...)`` -> tree spanning the terminals (remove cells /
  orbits in priority order unless that disconnects the terminals; Boris the Brave's chiseling)
- ``braid(tree, removed_order, n, kind)`` -> re-add a few orbit cells that close small loops
- ``astar(a, b, passable, ...)`` -> octilinear route with turn penalties (PCB-like traces)
- ``dbm_target(seed, allowed, target, rng, eta, ...)`` -> dielectric breakdown toward a target
  held at phi=1 (Neumann walls elsewhere): the lightning *aims*
- ``erode_connected(m, prob, rng, kind, protect)`` -> remove orbits without splitting pieces
- ``moat_coral(core, allowed, ...)`` -> lace mould around a core that keeps a 1-cell moat and
  touches the core only at "tap" points (the core's nodes)
- ``prune_to(m, keep)`` -> strip every dangling branch that does not end in ``keep``
CLI ops: ``moat-coral``, ``prune-to-nodes``, ``chisel-tree``.
"""

from __future__ import annotations

import heapq
import math

import numpy as np

from . import growth_ops as G
from . import morph
from .fields import sym_noise
from .registry import register_op

DIRS8 = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]

# ---- node sets ----------------------------------------------------------------------

SEPHIROT = {"keter": (0, 0), "chokmah": (1, 1), "binah": (-1, 1), "chesed": (1, 3), "gevurah": (-1, 3),
            "tiferet": (0, 4), "netzach": (1, 5), "hod": (-1, 5), "yesod": (0, 6), "malkuth": (0, 8)}
TOL_PATHS = [("keter", "chokmah"), ("keter", "binah"), ("keter", "tiferet"), ("chokmah", "binah"),
             ("chokmah", "tiferet"), ("chokmah", "chesed"), ("binah", "tiferet"), ("binah", "gevurah"),
             ("chesed", "gevurah"), ("chesed", "tiferet"), ("chesed", "netzach"), ("gevurah", "tiferet"),
             ("gevurah", "hod"), ("tiferet", "netzach"), ("tiferet", "yesod"), ("tiferet", "hod"),
             ("netzach", "hod"), ("netzach", "yesod"), ("netzach", "malkuth"), ("hod", "yesod"),
             ("hod", "malkuth"), ("yesod", "malkuth")]


def tree_of_life(sx: int = 5, sy: int = 4, margin: int = 2) -> dict:
    """Tree of Life on the grid (Kircher layout). Pillars sx apart, levels sy apart."""
    w = 2 * sx + 2 * margin + 1
    h = 8 * sy + 2 * margin + 1
    cx = w // 2
    nodes = {k: (cx + sx * x, margin + sy * y) for k, (x, y) in SEPHIROT.items()}
    return {"w": w, "h": h, "nodes": nodes, "paths": list(TOL_PATHS), "daat": (cx, margin + 2 * sy)}


def bagua_nodes(size: int, r: int) -> dict:
    c = size // 2
    d = int(round(r / math.sqrt(2)))
    pts = {"centre": (c, c)}
    for i, (dx, dy) in enumerate([(0, -r), (d, -d), (r, 0), (d, d), (0, r), (-d, d), (-r, 0), (-d, -d)]):
        pts[f"g{i}"] = (c + dx, c + dy)
    return pts


def node_rings(shape, pts, r: int = 1, hole: bool = True) -> np.ndarray:
    """Ring per node: r=1 -> the 8 cells around (x, y); r>=2 -> clean pixel circle."""
    from .glyphs import ring_mask

    H, W = shape
    m = np.zeros(shape, bool)
    for x, y in pts:
        if r <= 1:
            m[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
            if hole:
                m[y, x] = False
        else:
            m |= ring_mask(H, W, r, x, y)
    return m


def points_mask(shape, pts) -> np.ndarray:
    m = np.zeros(shape, bool)
    for x, y in pts:
        m[y, x] = True
    return m


# ---- pruning ------------------------------------------------------------------------

def prune_to(m: np.ndarray, keep: np.ndarray, max_iter: int = 400) -> np.ndarray:
    """Remove endpoints (8-degree <= 1) repeatedly unless they are in ``keep``: only branches that
    run between keep-cells (or form loops) survive."""
    return G.prune_spurs(m, max_iter, keep=keep)


def _orbit_ids(h, w, kind):
    ids = {}
    for y in range(h):
        for x in range(w):
            orb = frozenset(G.orbit(x, y, w, h, kind))
            ids.setdefault(orb, (x, y))
    return list(ids.keys())


# ---- chiseling ----------------------------------------------------------------------

def chisel(fill: np.ndarray, terminals: list[np.ndarray] | np.ndarray, priority: np.ndarray, kind: str = "d2",
           protect: np.ndarray | None = None, conn: int = 8, on_snap=None, snap_every: int = 20):
    """Remove whole orbits of ``fill`` in increasing ``priority`` order unless that would split the
    terminal set (each terminal = a bool mask that must stay in one 8-component with the others).
    Returns (tree, removal_order list of orbits)."""
    m = np.asarray(fill, bool).copy()
    H, W = m.shape
    prot = np.zeros_like(m) if protect is None else np.asarray(protect, bool)
    terms = terminals if isinstance(terminals, list) else [terminals]
    t_pts = [tuple(np.argwhere(t)[0]) for t in terms if t.any()]
    orbs = [o for o in _orbit_ids(H, W, kind) if any(m[y, x] for x, y in o)]
    orbs.sort(key=lambda o: min(priority[y, x] for x, y in o))
    removed = []
    k = 0
    for o in orbs:
        if any(prot[y, x] for x, y in o):
            continue
        cells = [(x, y) for x, y in o if m[y, x]]
        for x, y in cells:
            m[y, x] = False
        lab, _ = morph.label(m, conn)
        ids = {lab[p] for p in t_pts}
        if 0 in ids or len(ids) > 1:
            for x, y in cells:
                m[y, x] = True
            continue
        removed.append(o)
        k += 1
        if on_snap and k % snap_every == 0:
            on_snap(m)
    return m, removed


def braid(tree: np.ndarray, removed: list, n: int, kind: str = "d2", allowed: np.ndarray | None = None,
          min_loop: int = 6, max_loop: int = 40) -> np.ndarray:
    """Re-add up to n removed orbits (latest-removed first) that close a loop of a pleasant size and
    keep the lace grammar (no 2x2)."""
    m = tree.copy()
    added = 0
    for o in reversed(removed):
        if added >= n:
            break
        if allowed is not None and not all(allowed[y, x] for x, y in o):
            continue
        before = morph.fill_holes(m) & ~m
        trial = m.copy()
        for x, y in o:
            trial[y, x] = True
        if G.blocks_2x2(trial).any():
            continue
        holes = morph.fill_holes(trial) & ~trial
        new = holes & ~before
        if not new.any():
            continue
        lab, k = morph.label(new, 4)
        sizes = np.bincount(lab.ravel())[1:]
        if sizes.min() < min_loop or sizes.max() > max_loop:
            continue
        m = trial
        added += 1
    return m


# ---- routing ------------------------------------------------------------------------

def astar(a, b, passable: np.ndarray, turn45: float = 1.5, turn90: float = 5.0, goal_mask: np.ndarray | None = None,
          max_expand: int = 60000, cost: np.ndarray | None = None):
    """Octilinear A*: orthogonal step 1, diagonal 1.41, +turn45 per 45-degree turn, +turn90 per 90.
    ``goal_mask``: any of these cells ends the route (b is then only the heuristic target).
    Returns a list of (x, y) cells or None."""
    H, W = passable.shape
    bx, by = b

    def hcost(x, y):
        dx, dy = abs(x - bx), abs(y - by)
        return max(dx, dy) + 0.41 * min(dx, dy)

    start = (a[0], a[1], -1)
    g = {start: 0.0}
    par = {}
    heap = [(hcost(*a), 0.0, start)]
    n = 0
    while heap and n < max_expand:
        f, gc, s = heapq.heappop(heap)
        if gc > g.get(s, 1e18) + 1e-9:
            continue
        n += 1
        x, y, d = s
        if (goal_mask is not None and goal_mask[y, x] and (x, y) != tuple(a)) or (goal_mask is None and (x, y) == (bx, by)):
            out = [(x, y)]
            while s in par:
                s = par[s]
                out.append((s[0], s[1]))
            return out[::-1]
        for nd, (dx, dy) in enumerate(DIRS8):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or not passable[ny, nx]:
                continue
            if dx and dy and not (passable[y, nx] or passable[ny, x]):
                pass  # diagonal squeeze is fine: renders as a bridge
            c = (1.41 if dx and dy else 1.0) + (0.0 if cost is None else float(cost[ny, nx]))
            if d >= 0 and nd != d:
                t = min((nd - d) % 8, (d - nd) % 8)
                c += turn45 if t == 1 else turn90 if t == 2 else 50.0
            ns = (nx, ny, nd)
            ng = gc + c
            if ng < g.get(ns, 1e18):
                g[ns] = ng
                par[ns] = s
                heapq.heappush(heap, (ng + hcost(nx, ny), ng, ns))
    return None


# ---- aimed dielectric breakdown ----------------------------------------------------------

def dbm_target(seed: np.ndarray, allowed: np.ndarray, target: np.ndarray, rng, eta: float = 2.5,
               kind: str = "x", max_orth: int = 1, max_n8: int = 2, max_cells: int = 4000, relax: int = 30,
               on_snap=None, snap_every: int = 4, age: np.ndarray | None = None, stop_dist: int = 1,
               stop: bool = True):
    """DBM where phi = 0 on the cluster, 1 on ``target``, and no-flux (Neumann) at the walls of
    ``allowed`` - so the discharge is drawn to the target rather than the silhouette edge. Stops
    when the cluster comes within ``stop_dist`` (Chebyshev) of the target (``stop``), else after
    ``max_cells`` growth steps (orbits). eta=1 is statistically DLA, but fast."""
    m = np.asarray(seed, bool).copy()
    H, W = m.shape
    tgt = np.asarray(target, bool)
    free = allowed & ~m & ~tgt
    phi = np.where(tgt, 1.0, 0.0)
    # Neumann: average over in-domain neighbours only
    dom = (allowed | tgt | m).astype(float)
    pd = np.pad(dom, 1)
    nbw = [pd[:-2, 1:-1], pd[2:, 1:-1], pd[1:-1, :-2], pd[1:-1, 2:]]
    nsum = sum(nbw)
    nsum[nsum == 0] = 1
    # initial guess: linear in distance
    from scipy import ndimage

    d_t = ndimage.distance_transform_edt(~tgt)
    phi = np.where(free, 1 - d_t / (d_t[free].max() + 1), phi)
    near_t = morph.dilate(tgt, stop_dist, 8)
    added = 0
    blocked = np.zeros_like(m)
    for it in range(max_cells):
        free = allowed & ~m & ~tgt
        for _ in range(relax):
            p = np.pad(phi, 1)
            avg = sum(w_ * n_ for w_, n_ in zip(nbw, [p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])) / nsum
            phi = np.where(free, avg, np.where(tgt, 1.0, 0.0))
        per = morph.dilate(m, 1, 8) & free & ~blocked
        cand = np.argwhere(per)
        if len(cand) == 0:
            break
        wts = np.maximum(phi[per], 0) ** eta + 1e-12
        order = rng.choice(len(cand), size=min(len(cand), 16), replace=False, p=wts / wts.sum())
        grew = False
        for i in order:
            y, x = map(int, cand[i])
            orb = G.orbit(x, y, W, H, kind)
            if all(allowed[q, p2] and not tgt[q, p2] for p2, q in orb) and G.lace_ok(m, orb, max_orth, max_n8):
                for p2, q in orb:
                    m[q, p2] = True
                    if age is not None:
                        age[q, p2] = added + 1
                grew = True
                break
            blocked[y, x] = True
        if not grew:
            continue
        added += 1
        if on_snap and added % snap_every == 0:
            on_snap(m)
        if stop and (m & near_t).any():
            break
    return m


# ---- erosion ------------------------------------------------------------------------

def erode_connected(m: np.ndarray, prob: np.ndarray, rng, kind: str = "x", protect: np.ndarray | None = None,
                    on_snap=None, snap_every: int = 6, max_frac: float = 1.0) -> np.ndarray:
    """Visit orbits in random order; remove one with probability ``prob`` (per cell, orbit max) if
    the number of 8-pieces does not grow and no piece vanishes. Returns the eroded mask."""
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    prot = np.zeros_like(m) if protect is None else protect
    orbs = [o for o in _orbit_ids(H, W, kind) if any(m[y, x] for x, y in o)]
    rng.shuffle(orbs)
    n0 = morph.label(m, 8)[1]
    total = m.sum()
    k = 0
    for o in orbs:
        if (total - m.sum()) >= max_frac * total:
            break
        if any(prot[y, x] for x, y in o):
            continue
        p = max(prob[y, x] for x, y in o)
        if rng.random() >= p:
            continue
        cells = [(x, y) for x, y in o if m[y, x]]
        for x, y in cells:
            m[y, x] = False
        if morph.label(m, 8)[1] > n0:
            for x, y in cells:
                m[y, x] = True
            continue
        k += 1
        if on_snap and k % snap_every == 0:
            on_snap(m)
    return m


# ---- moat coral ---------------------------------------------------------------------

def moat_coral(core: np.ndarray, region: np.ndarray, nodes, rng, kind: str = "x", density: float = 0.35,
               reach: float = 6.0, scale: float = 0.3, pull: float = 0.15, taps_per_node: int = 1,
               max_orth: int = 1, max_n8: int = 2, on_snap=None, snap_every: int = 0, age=None):
    """Mould around ``core`` that never enters its 1-cell moat, except through one 'tap' cell per
    node (the mould feeds on the sigil's vertices). Returns (mould, taps)."""
    core = np.asarray(core, bool)
    H, W = core.shape
    moat = morph.dilate(core, 1, 8) & ~core
    from .masks import distance_to_mask

    dist = distance_to_mask(core)
    allowed = region & ~core & ~moat & (dist <= reach)
    res = sym_noise(H, W, scale, kind if kind in ("x", "d2", "d4") else "none", white=0.4,
                    seed=int(rng.integers(1 << 30))) + pull * dist
    seeds = np.zeros_like(core)
    taps = np.zeros_like(core)
    for nx, ny in nodes:
        opts = []
        for dx, dy in DIRS8:
            sx, sy = nx + 2 * dx, ny + 2 * dy
            tx, ty = nx + dx, ny + dy
            if 0 <= sx < W and 0 <= sy < H and allowed[sy, sx] and moat[ty, tx]:
                opts.append(((sx, sy), (tx, ty)))
        if not opts:
            continue
        rng.shuffle(opts)
        for (sx, sy), (tx, ty) in opts[:taps_per_node]:
            for a, b in G.orbit(sx, sy, W, H, kind):
                if allowed[b, a]:
                    seeds[b, a] = True
            for a, b in G.orbit(tx, ty, W, H, kind):
                if moat[b, a]:
                    taps[b, a] = True
    if not seeds.any():
        return np.zeros_like(core), taps
    target = int(seeds.sum() + density * allowed.sum())
    mould = G.invasion_percolation(seeds, allowed, res, target, kind, max_orth, max_n8,
                                   snap_every=snap_every, on_snap=on_snap, age=age)
    return mould, taps


# ---- CLI ops ------------------------------------------------------------------------

def _kind(mask):
    from .composition import detect_sym

    k = detect_sym(mask)
    return k if k in ("x", "d2", "d4") else ("x" if k == "y" else "none")


@register_op("moat-coral")
def _moat_coral_op(mask, density: float = 0.35, reach: float = 5.0, seed: int = 0):
    """Grow lace mould around the existing drawing that keeps a 1-cell moat (the drawing stays
    legible) and touches it only at its junction/end cells ('taps'). Symmetry auto-detected."""
    k = _kind(mask)
    k = "x" if k == "none" else k
    nodes = [(int(x), int(y)) for y, x in np.argwhere(G.tips(mask) | G.junctions(mask))]
    region = np.ones_like(mask)
    mould, taps = moat_coral(mask, region, nodes, np.random.default_rng(seed), k, density, reach)
    return mask | mould | taps


@register_op("prune-to-nodes")
def _prune_to_op(mask, r: int = 1):
    """Strip dangling branches until every remaining line ends in a 'node' (a cell with >= 3
    8-neighbours = ring/blob, dilated by r): turns hairy networks into node-to-node paths."""
    nodes = mask & (morph.neighbour_count(mask, 8) >= 4)
    return prune_to(mask, morph.dilate(nodes, r, 8))


@register_op("chisel-tree")
def _chisel_op(mask, seed: int = 0, scale: float = 0.3):
    """Fill the mask's outline area and chisel it down to a random tree that still connects all of
    the mask's current pieces (Boris the Brave chiseling; noise-ordered, symmetric)."""
    k = _kind(mask)
    k = "none" if k == "none" else k
    lab, n = morph.label(mask, 8)
    terms = [lab == i for i in range(1, n + 1)]
    fill = morph.fill_holes(morph.close(mask, 2, 8)) | mask
    pr = sym_noise(*mask.shape, scale, k if k != "none" else "none", white=0.3, seed=seed)
    tree, _ = chisel(fill, terms, pr, k if k != "none" else "none", protect=mask)
    return tree
