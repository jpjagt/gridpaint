"""Growth / simulation machinery shared by recipes/growth.py and recipes/simulation.py.

Everything is symmetric by construction: discrete growth adds whole *orbits* (a cell plus its
mirror images), continuous simulations mirror-average their fields every step.

Contents
- orbits & the lace grammar: ``orbit``, ``lace_ok``, ``break_blocks``, ``lace_clean``, ``prune_spurs``
- silhouettes & motifs: ``silhouette``, ``cross``, ``superellipse``
- frame recording: ``Frames``
- discrete growth: ``invasion_percolation``, ``dla``, ``dbm``, ``space_colonize``, ``eden``
- continuous sims: ``physarum``, ``gray_scott``, ``majority_ca``
- CLI ops: lace-clean, spur-prune, tip-dots, grow-coral, grow-dla, physarum-link
"""

from __future__ import annotations

import heapq
import math

import numpy as np
from scipy import ndimage

from . import masks as M
from . import morph
from .fields import downsample, symmetrize_field, upsample_mask
from .registry import register_op

N8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
N4 = [(0, -1), (-1, 0), (1, 0), (0, 1)]


# ---- symmetry orbits ----------------------------------------------------------

def sym_kind_for(h: int, w: int, kind: str) -> str:
    """Downgrade d4 to d2 on non-square canvases."""
    return "d2" if kind == "d4" and h != w else kind


def orbit(x: int, y: int, w: int, h: int, kind: str = "d2") -> set[tuple[int, int]]:
    xs = {x, w - 1 - x} if kind in ("x", "d2", "d4") else {x}
    ys = {y, h - 1 - y} if kind in ("y", "d2", "d4") else {y}
    out = {(a, b) for a in xs for b in ys}
    if kind == "d4":
        out |= {(b, a) for a, b in out}
    if kind == "rot2":
        out = {(x, y), (w - 1 - x, h - 1 - y)}
    return out


def sym_or(mask: np.ndarray, kind: str) -> np.ndarray:
    m = np.asarray(mask, bool)
    if kind == "none":
        return m.copy()
    out = m | m[:, ::-1] if kind in ("x", "d2", "d4") else m.copy()
    if kind in ("y", "d2", "d4"):
        out = out | out[::-1]
    if kind == "d4" and m.shape[0] == m.shape[1]:
        out = out | out.T
    if kind == "rot2":
        out = m | m[::-1, ::-1]
    return out


def sym_and(mask: np.ndarray, kind: str) -> np.ndarray:
    return ~sym_or(~np.asarray(mask, bool), kind)


# ---- lace grammar -------------------------------------------------------------

def _filled(m, x, y):
    H, W = m.shape
    return 0 <= x < W and 0 <= y < H and m[y, x]


def makes_block(m, x, y) -> bool:
    """Would (x, y) (assumed filled) be part of a 2x2 solid block?"""
    for dx in (-1, 1):
        for dy in (-1, 1):
            if _filled(m, x + dx, y) and _filled(m, x, y + dy) and _filled(m, x + dx, y + dy):
                return True
    return False


def counts(m, x, y) -> tuple[int, int]:
    """(orthogonal, 8-) filled neighbour counts of (x, y)."""
    o = sum(_filled(m, x + dx, y + dy) for dx, dy in N4)
    a = sum(_filled(m, x + dx, y + dy) for dx, dy in N8)
    return o, a


def lace_ok(m, cells, max_orth: int = 1, max_n8: int = 3, blocks: bool = False) -> bool:
    """Would adding ``cells`` keep the lace grammar? (checked on the tentative state)."""
    added = [c for c in cells if not m[c[1], c[0]]]
    for x, y in added:
        m[y, x] = True
    ok = True
    for x, y in added:
        o, a = counts(m, x, y)
        if o > max_orth or a > max_n8 or (not blocks and makes_block(m, x, y)):
            ok = False
            break
    for x, y in added:
        m[y, x] = False
    return ok


def blocks_2x2(m: np.ndarray) -> np.ndarray:
    """bool (H-1, W-1): top-left corners of solid 2x2 blocks."""
    return m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]


def break_blocks(m: np.ndarray, kind: str = "d2", protect: np.ndarray | None = None) -> np.ndarray:
    """Remove 2x2 solid blocks orbit-wise, deleting the block cell with most orthogonal neighbours."""
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    prot = np.zeros_like(m) if protect is None else protect
    for _ in range(H * W):
        b = blocks_2x2(m)
        if not b.any():
            break
        y0, x0 = map(int, np.argwhere(b)[0])
        nc = morph.neighbour_count(m, 4)
        cand = [(x0 + i, y0 + j) for j in (0, 1) for i in (0, 1) if not prot[y0 + j, x0 + i]]
        if not cand:
            cand = [(x0 + i, y0 + j) for j in (0, 1) for i in (0, 1)]
        x, y = max(cand, key=lambda c: (nc[c[1], c[0]], -abs(c[0] - (W - 1) / 2)))
        for a, b2 in orbit(x, y, W, H, kind):
            m[b2, a] = False
    return m


def prune_spurs(m: np.ndarray, n: int = 1, keep: np.ndarray | None = None) -> np.ndarray:
    """Remove endpoint cells (exactly one 8-neighbour) n times; ``keep`` cells are never removed."""
    m = np.asarray(m, bool).copy()
    for _ in range(n):
        nc = morph.neighbour_count(m, 8)
        rm = m & (nc == 1)
        if keep is not None:
            rm &= ~keep
        if not rm.any():
            break
        m &= ~rm
    return m


RING = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]


def smooth_corners(m: np.ndarray, kind: str = "d2", keep: np.ndarray | None = None) -> np.ndarray:
    """Remove 1-cell nubs and staircase corners: cells whose 2-3 filled 8-neighbours form one
    contiguous run around them (so removal keeps the path connected, via a diagonal bridge).
    Turns 4-connected stairs into diagonal steps and shaves side bumps off lines. Orbit-wise."""
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    changed = True
    while changed:
        changed = False
        for y, x in np.argwhere(m):
            x, y = int(x), int(y)
            if not m[y, x] or (keep is not None and keep[y, x]):
                continue
            ring = [_filled(m, x + dx, y + dy) for dx, dy in RING]
            cnt = sum(ring)
            runs = sum(1 for i in range(8) if ring[i] and not ring[i - 1])
            if runs != 1 or not (2 <= cnt <= 3):
                continue
            for p, q in orbit(x, y, W, H, kind):
                m[q, p] = False
            changed = True
    return m


def lace_clean(m: np.ndarray, kind: str = "d2", min_size: int = 3, protect=None) -> np.ndarray:
    """Grammar cleanup: symmetric, no 2x2 blocks, no dust."""
    m = sym_and(m, kind) if kind != "none" else np.asarray(m, bool)
    m = break_blocks(m, kind, protect)
    m = morph.remove_small(m, min_size, 8)
    return m


def tips(m: np.ndarray) -> np.ndarray:
    nc = morph.neighbour_count(m, 8)
    return m & (nc == 1)


def junctions(m: np.ndarray) -> np.ndarray:
    nc = morph.neighbour_count(m, 4)
    return m & (nc >= 3)


def connect_to(m: np.ndarray, anchor: np.ndarray, kind: str = "d2") -> np.ndarray:
    """Keep only 8-components of m that touch (8-adjacent to) anchor."""
    lab, n = morph.label(m, 8)
    if n == 0:
        return m.copy()
    near = morph.dilate(anchor, 1, 8)
    ids = np.unique(lab[near & m])
    return sym_and(np.isin(lab, ids[ids > 0]), kind) if kind != "none" else np.isin(lab, ids[ids > 0])


def subtree_sizes(m: np.ndarray, age: np.ndarray) -> np.ndarray:
    """Treat growth as a tree: each cell's parent is its oldest 8-neighbour (age 0 = seed,
    -1 = empty). Returns the number of descendants+1 per cell (0 where empty): large values mark
    the trunk / main veins, 1 marks twigs."""
    H, W = m.shape
    big = np.where(m, np.where(age < 0, 0, age), 10 ** 9).astype(np.int64)
    p = np.pad(big, 1, constant_values=10 ** 9)
    size = np.where(m, 1, 0).astype(np.int64)
    cells = np.argwhere(m & (age > 0))
    order = np.argsort(-age[m & (age > 0)], kind="stable")
    for i in order:
        y, x = map(int, cells[i])
        win = p[y:y + 3, x:x + 3].copy()
        win[1, 1] = 10 ** 9
        a = win.min()
        if a >= age[y, x]:
            continue
        cand = np.argwhere(win == a)
        # prefer orthogonal parents
        cand = sorted(cand, key=lambda c: abs(c[0] - 1) + abs(c[1] - 1))
        py, px = int(cand[0][0]) + y - 1, int(cand[0][1]) + x - 1
        size[py, px] += size[y, x]
    return size


def parent_map(m: np.ndarray, age: np.ndarray) -> dict:
    """{(x, y): (px, py)}: each grown cell's oldest 8-neighbour (orthogonal preferred)."""
    H, W = m.shape
    big = np.where(m, np.where(age < 0, 0, age), 10 ** 9).astype(np.int64)
    p = np.pad(big, 1, constant_values=10 ** 9)
    out = {}
    for y, x in np.argwhere(m & (age > 0)):
        y, x = int(y), int(x)
        win = p[y:y + 3, x:x + 3].copy()
        win[1, 1] = 10 ** 9
        a = win.min()
        if a >= age[y, x]:
            continue
        cand = sorted(np.argwhere(win == a), key=lambda c: abs(c[0] - 1) + abs(c[1] - 1))
        out[(x, y)] = (int(cand[0][1]) + x - 1, int(cand[0][0]) + y - 1)
    return out


def ancestors(m: np.ndarray, age: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """All cells on the growth paths from ``targets`` back to the seed."""
    par = parent_map(m, age)
    out = np.zeros_like(m)
    for y, x in np.argwhere(targets & m):
        c = (int(x), int(y))
        while c is not None and not out[c[1], c[0]]:
            out[c[1], c[0]] = True
            c = par.get(c)
    return out


def trunk(m: np.ndarray, age: np.ndarray, min_size: int, kind: str = "d2") -> np.ndarray:
    """Cells carrying at least ``min_size`` cells of growth (plus the seed): the main branches."""
    t = (subtree_sizes(m, age) >= min_size) | (m & (age == 0))
    return sym_or(t, kind) & m


# ---- silhouettes & motifs -----------------------------------------------------

def superellipse(h: int, w: int, n: float = 3.0, rx=None, ry=None) -> np.ndarray:
    y, x = np.mgrid[0:h, 0:w]
    dx, dy = x - (w - 1) / 2, y - (h - 1) / 2
    rx = w / 2 if rx is None else rx
    ry = h / 2 if ry is None else ry
    return np.abs(dx / rx) ** n + np.abs(dy / ry) ** n <= 1.0


def silhouette(kind: str, w: int, h: int, ring_thickness: float = 4) -> np.ndarray:
    """capsule | oval | shield | octagon | lozenge | ring | rounded."""
    if kind == "capsule":
        return M.capsule(h, w)
    if kind == "oval":
        return M.ellipse(h, w)
    if kind == "shield":
        return M.shield(h, w)
    if kind == "octagon":
        y, x = np.mgrid[0:h, 0:w]
        dx, dy = np.abs(x - (w - 1) / 2), np.abs(y - (h - 1) / 2)
        cut = max(2, min(w, h) // 4)
        return dx + dy <= (w - 1) / 2 + (h - 1) / 2 - cut
    if kind == "lozenge":
        return M.diamond(h, w)
    if kind == "ring":
        return M.ring(h, w, ring_thickness)
    return superellipse(h, w, 3.0)


def cross(w: int, h: int, arm_v: int, arm_h: int, bar_dy: int = 0, cy=None) -> np.ndarray:
    """Plain cross on the centre column: vertical half-length arm_v, horizontal half-length arm_h
    at row cy + bar_dy (mirrored to cy - bar_dy as well)."""
    m = np.zeros((h, w), bool)
    cx = w // 2
    cy = h // 2 if cy is None else cy
    m[max(0, cy - arm_v):cy + arm_v + 1, cx] = True
    for r in {cy + bar_dy, cy - bar_dy}:
        if 0 <= r < h:
            m[r, max(0, cx - arm_h):cx + arm_h + 1] = True
    return m


# ---- frames -------------------------------------------------------------------

class Frames:
    """Collect snapshots {layer_id: mask}; ``out(n)`` subsamples to n keeping first + last."""

    def __init__(self):
        self.items: list[tuple[str, dict[int, np.ndarray]]] = []

    def add(self, label: str, layers: dict[int, np.ndarray]):
        self.items.append((label, {k: np.asarray(v, bool).copy() for k, v in layers.items()}))

    def out(self, n: int = 16, final: dict[int, np.ndarray] | None = None, final_label: str = "final"):
        items = list(self.items)
        if final is not None:
            items.append((final_label, {k: np.asarray(v, bool).copy() for k, v in final.items()}))
        if len(items) > n:
            idx = np.unique(np.rint(np.linspace(0, len(items) - 1, n)).astype(int))
            items = [items[i] for i in idx]
        return items


# ---- discrete growth ----------------------------------------------------------

def invasion_percolation(seed: np.ndarray, allowed: np.ndarray, resistance: np.ndarray, target: int,
                         kind: str = "d2", max_orth: int = 1, max_n8: int = 2, blocks: bool = False,
                         snap_every: int = 0, on_snap=None, age: np.ndarray | None = None) -> np.ndarray:
    """Always grow into the lowest-resistance perimeter cell (8-perimeter) that keeps the lace rule.
    Adds whole orbits. Stops when ``target`` cells are filled (counting seed)."""
    m = np.asarray(seed, bool).copy()
    H, W = m.shape
    heap: list = []
    seen = m.copy()

    def push_nbrs(x, y):
        for dx, dy in N8:
            a, b = x + dx, y + dy
            if 0 <= a < W and 0 <= b < H and not seen[b, a] and allowed[b, a]:
                seen[b, a] = True
                heapq.heappush(heap, (float(resistance[b, a]), a, b))

    for y, x in np.argwhere(m):
        push_nbrs(int(x), int(y))
    added = 0
    while heap and m.sum() < target:
        r, x, y = heapq.heappop(heap)
        if m[y, x]:
            continue
        orb = orbit(x, y, W, H, kind)
        if not all(allowed[b, a] for a, b in orb):
            continue
        if not lace_ok(m, orb, max_orth, max_n8, blocks):
            continue
        added += 1
        for a, b in orb:
            m[b, a] = True
            push_nbrs(a, b)
            if age is not None:
                age[b, a] = added
        if snap_every and on_snap and added % snap_every == 0:
            on_snap(m)
    return m


def eden(seed, allowed, target, rng, kind="d2", max_orth=1, max_n8=2, snap_every=0, on_snap=None, age=None):
    """Eden growth with the lace rule = invasion percolation with white-noise resistance redrawn per run."""
    return invasion_percolation(seed, allowed, rng.random(seed.shape), target, kind, max_orth, max_n8,
                                snap_every=snap_every, on_snap=on_snap, age=age)


def dla(seed: np.ndarray, allowed: np.ndarray, target: int, rng, kind: str = "d2", stick: float = 0.5,
        max_orth: int = 2, max_n8: int = 3, launch: np.ndarray | None = None, max_walkers: int = 4000,
        snap_every: int = 0, on_snap=None, age: np.ndarray | None = None) -> np.ndarray:
    """Diffusion-limited aggregation on the grid. Walkers start on ``launch`` (default: allowed
    cells far from the cluster), random-walk (8-neighbour) inside ``allowed`` and stick with prob
    ``stick`` when 8-adjacent to the cluster, if the lace rule allows the whole orbit."""
    m = np.asarray(seed, bool).copy()
    H, W = m.shape
    near = morph.dilate(m, 1, 8)
    launch = allowed if launch is None else launch & allowed
    added = 0
    steps_dir = np.array(N8)
    for _ in range(max_walkers):
        if m.sum() >= target:
            break
        far = launch & ~morph.dilate(m, 3, 8)
        pts = np.argwhere(far if far.any() else launch & ~m)
        if len(pts) == 0:
            break
        y, x = map(int, pts[rng.integers(len(pts))])
        moves = rng.integers(0, 8, size=600)
        for k in moves:
            dx, dy = steps_dir[k]
            a, b = x + dx, y + dy
            if 0 <= a < W and 0 <= b < H and allowed[b, a] and not m[b, a]:
                x, y = a, b
            if near[y, x] and rng.random() < stick:
                orb = orbit(x, y, W, H, kind)
                if all(allowed[q, p] for p, q in orb) and lace_ok(m, orb, max_orth, max_n8):
                    added += 1
                    for p, q in orb:
                        m[q, p] = True
                        near[max(0, q - 1):q + 2, max(0, p - 1):p + 2] = True
                        if age is not None:
                            age[q, p] = added
                    if snap_every and on_snap and added % snap_every == 0:
                        on_snap(m)
                    break
    return m


def dbm(seed: np.ndarray, allowed: np.ndarray, target: int, rng, kind: str = "d2", eta: float = 1.5,
        max_orth: int = 1, max_n8: int = 2, relax: int = 40, snap_every: int = 0, on_snap=None,
        age: np.ndarray | None = None) -> np.ndarray:
    """Dielectric breakdown (Niemeyer): potential phi = 0 on the cluster, 1 outside ``allowed``;
    grow at a perimeter cell with probability ~ phi^eta (lace rule, whole orbits)."""
    m = np.asarray(seed, bool).copy()
    H, W = m.shape
    phi = np.ones((H, W))
    inside = allowed.copy()
    added = 0
    first = True
    while m.sum() < target:
        fixed0 = m
        free = inside & ~m
        for _ in range(relax * (4 if first else 1)):
            p = np.pad(phi, 1, constant_values=1.0)
            avg = 0.25 * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])
            phi = np.where(free, avg, np.where(fixed0, 0.0, 1.0))
        first = False
        per = morph.dilate(m, 1, 8) & free
        cand = np.argwhere(per)
        if len(cand) == 0:
            break
        wts = np.maximum(phi[per], 0) ** eta + 1e-12
        order = rng.choice(len(cand), size=min(len(cand), 24), replace=False, p=wts / wts.sum())
        grew = False
        for i in order:
            y, x = map(int, cand[i])
            orb = orbit(x, y, W, H, kind)
            if all(allowed[q, p2] for p2, q in orb) and lace_ok(m, orb, max_orth, max_n8):
                for p2, q in orb:
                    m[q, p2] = True
                    if age is not None:
                        age[q, p2] = added + 1
                grew = True
                break
        if not grew:
            # nothing valid among the sampled; mark them as dead ends
            for i in order:
                y, x = map(int, cand[i])
                if not lace_ok(m, orbit(x, y, W, H, kind), max_orth, max_n8):
                    inside[y, x] = False
            if not (morph.dilate(m, 1, 8) & inside & ~m).any():
                break
            continue
        added += 1
        if snap_every and on_snap and added % snap_every == 0:
            on_snap(m)
    return m


def space_colonize(roots: np.ndarray, allowed: np.ndarray, attractors: np.ndarray, kind: str = "d2",
                   radius: float = 6.0, kill: float = 1.5, max_iter: int = 60, max_orth: int = 1,
                   max_n8: int = 2, on_snap=None, clearance: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Grid space colonisation (Runions). attractors: (N, 2) float (x, y). Each attractor pulls its
    nearest vein cell within ``radius``; pulled cells step one cell (8-dir quantised) toward the
    mean direction. Returns (veins, generation index per cell; -1 = empty, 0 = root)."""
    m = np.asarray(roots, bool).copy()
    H, W = m.shape
    gen = np.where(m, 0, -1)
    att = np.asarray(attractors, float).reshape(-1, 2)
    for it in range(1, max_iter + 1):
        if len(att) == 0:
            break
        nodes = np.argwhere(m)[:, ::-1].astype(float)  # (x, y)
        d = np.sqrt(((att[:, None, :] - nodes[None, :, :]) ** 2).sum(-1))
        nearest = d.argmin(1)
        dn = d[np.arange(len(att)), nearest]
        att = att[dn > kill]
        if len(att) == 0:
            break
        nearest, dn = nearest[dn > kill], dn[dn > kill]
        pull = dn <= radius
        if not pull.any():
            break
        props = {}
        for ai in np.nonzero(pull)[0]:
            ni = nearest[ai]
            v = att[ai] - nodes[ni]
            props.setdefault(ni, np.zeros(2))
            props[ni] += v / (np.linalg.norm(v) + 1e-9)
        grown = False
        for ni, v in props.items():
            x0, y0 = int(nodes[ni][0]), int(nodes[ni][1])
            ang = math.atan2(v[1], v[0])
            k = int(round(ang / (math.pi / 4)))
            cands = [k, k + 1, k - 1]
            for kk in cands:
                dx, dy = int(round(math.cos(kk * math.pi / 4))), int(round(math.sin(kk * math.pi / 4)))
                x, y = x0 + dx, y0 + dy
                if not (0 <= x < W and 0 <= y < H) or m[y, x] or not allowed[y, x]:
                    continue
                orb = orbit(x, y, W, H, kind)
                if not all(allowed[b, a] for a, b in orb):
                    continue
                if clearance and any(
                        _filled(m, x + ddx, y + ddy) and max(abs(x + ddx - x0), abs(y + ddy - y0)) > 1
                        for ddx, ddy in N8):
                    continue  # would touch another branch
                if lace_ok(m, orb, max_orth, max_n8):
                    for a, b in orb:
                        m[b, a] = True
                        gen[b, a] = it
                    grown = True
                    break
        if on_snap:
            on_snap(m)
        if not grown:
            break
    return m, gen


# ---- continuous simulations -----------------------------------------------------

def physarum(allowed_hi: np.ndarray, food_hi: np.ndarray, rng, n_agents: int = 1500, steps: int = 250,
             sa: float = 0.6, ra: float = 0.5, so: float = 4.0, step: float = 1.0, deposit: float = 1.0,
             food_amt: float = 3.0, decay: float = 0.12, kind: str = "d2", spawn: np.ndarray | None = None,
             snap_every: int = 0, on_snap=None, wiggle: float = 0.05) -> np.ndarray:
    """Jeff Jones physarum on a hi-res mask. Agents sense trail at 3 sensors (angle sa, offset so),
    rotate by ra towards the strongest, move, deposit. Trail diffuses (3x3 mean), decays, is
    clamped to ``allowed_hi``, fed at ``food_hi`` and mirror-averaged each step (``kind``)."""
    H, W = allowed_hi.shape
    pts = np.argwhere(spawn if spawn is not None and spawn.any() else allowed_hi)
    sel = pts[rng.integers(len(pts), size=n_agents)]
    py = sel[:, 0] + rng.random(n_agents)
    px = sel[:, 1] + rng.random(n_agents)
    th = rng.random(n_agents) * 2 * np.pi
    trail = np.zeros((H, W))
    allowed_f = allowed_hi.astype(float)
    food = food_hi.astype(float) * food_amt

    def sense(ang):
        sx = np.clip((px + so * np.cos(ang)).astype(int), 0, W - 1)
        sy = np.clip((py + so * np.sin(ang)).astype(int), 0, H - 1)
        return trail[sy, sx] + (allowed_f[sy, sx] - 1) * 10  # walls are repulsive

    for t in range(steps):
        trail += food
        fl, fc, fr = sense(th - sa), sense(th), sense(th + sa)
        rnd = rng.random(n_agents)
        turn = np.zeros(n_agents)
        both = (fl > fc) & (fr > fc)
        turn[both] = np.where(rnd[both] < 0.5, -ra, ra)
        left = (fl > fr) & ~both & (fl > fc)
        right = (fr > fl) & ~both & (fr > fc)
        turn[left] = -ra
        turn[right] = ra
        th = th + turn + rng.normal(0, wiggle, n_agents)
        nx, ny = px + step * np.cos(th), py + step * np.sin(th)
        ix, iy = nx.astype(int), ny.astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        ok[ok] = allowed_hi[iy[ok], ix[ok]]
        px = np.where(ok, nx, px)
        py = np.where(ok, ny, py)
        th = np.where(ok, th, rng.random(n_agents) * 2 * np.pi)
        np.add.at(trail, (py.astype(int).clip(0, H - 1), px.astype(int).clip(0, W - 1)), deposit)
        trail = ndimage.uniform_filter(trail, 3, mode="constant") * (1 - decay)
        trail *= allowed_f
        trail = symmetrize_field(trail, kind)
        if snap_every and on_snap and (t + 1) % snap_every == 0:
            on_snap(trail)
    return trail


def gray_scott(allowed_hi: np.ndarray, seed_hi: np.ndarray, f: float = 0.0545, k: float = 0.062,
               du: float = 0.2, dv: float = 0.1, steps: int = 3000, kind: str = "d2", rng=None,
               snap_every: int = 0, on_snap=None) -> np.ndarray:
    """Gray-Scott reaction-diffusion with V clamped to 0 outside ``allowed_hi``. Returns V."""
    H, W = allowed_hi.shape
    U = np.ones((H, W))
    V = np.zeros((H, W))
    V[seed_hi] = 0.5
    U[seed_hi] = 0.5
    if rng is not None:
        V += symmetrize_field(rng.random((H, W)) * 0.02, kind) * seed_hi
    a = allowed_hi.astype(float)
    # no-flux (Neumann) boundary at the mask edge: outside neighbours mirror the centre value,
    # so stripes meet the edge at right angles instead of running parallel to it
    pa = np.pad(a, 1)
    nb = [pa[:-2, 1:-1], pa[2:, 1:-1], pa[1:-1, :-2], pa[1:-1, 2:]]

    def lap(Z):
        p = np.pad(Z, 1, mode="edge")
        ns = [p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]
        return sum(m * (n - Z) for m, n in zip(nb, ns))

    for t in range(steps):
        uvv = U * V * V
        U += du * lap(U) - uvv + f * (1 - U)
        V += dv * lap(V) + uvv - (f + k) * V
        V *= a
        if (t + 1) % 200 == 0:
            U, V = symmetrize_field(U, kind), symmetrize_field(V, kind)
        if snap_every and on_snap and (t + 1) % snap_every == 0:
            on_snap(V)
    return symmetrize_field(V, kind)


def majority_ca(m: np.ndarray, allowed: np.ndarray, iters: int = 4, birth: int = 5, survive: int = 4,
                kind: str = "d2", on_snap=None) -> np.ndarray:
    """Smoothing 'cave' CA: cell on if (3x3 count incl. self) >= birth (off cells) / survive+1 (on cells)."""
    m = np.asarray(m, bool) & allowed
    k = np.ones((3, 3), int)
    for _ in range(iters):
        c = ndimage.convolve(m.astype(int), k, mode="constant")
        m = np.where(m, c >= survive + 1, c >= birth) & allowed
        m = sym_and(m, kind) if kind != "none" else m
        if on_snap:
            on_snap(m)
    return m


# ---- CLI ops ------------------------------------------------------------------

def _kind_for(mask, kind):
    return sym_kind_for(mask.shape[0], mask.shape[1], kind)


@register_op("orbit-clean")
def _lace_clean(mask, kind: str = "d2", min_size: int = 3):
    """Lace grammar cleanup: keep symmetric cells (kind none|x|d2|d4), break 2x2 blocks orbit-wise,
    drop pieces smaller than min_size."""
    return lace_clean(mask, _kind_for(mask, kind), min_size)


@register_op("spur-prune")
def _spur_prune(mask, n: int = 1):
    """Remove line ends (cells with exactly one 8-neighbour) n times: shortens tendrils."""
    return prune_spurs(mask, n)


@register_op("tip-dots")
def _tip_dots(mask, what: str = "tips"):
    """Replace the mask by its tips (8-degree 1) | junctions (4-degree >= 3) | both: for top-layer dots."""
    sk = mask
    t = tips(sk) if what in ("tips", "both") else np.zeros_like(sk)
    j = junctions(sk) if what in ("junctions", "both") else np.zeros_like(sk)
    return t | j


@register_op("grow-coral")
def _grow_coral(mask, n: int = 40, reach: int = 4, scale: float = 0.3, kind: str = "d2", seed: int = 0):
    """Invasion-percolation lace tendrils grown from the existing cells: adds ~n orbits within
    `reach` cells of them (noise resistance, no 2x2, max 1 orthogonal neighbour)."""
    from .fields import sym_noise

    k = _kind_for(mask, kind)
    h, w = mask.shape
    allowed = morph.dilate(mask, reach, 8)
    res = sym_noise(h, w, scale, k if k != "none" else "none", white=0.3, seed=seed)
    target = int(mask.sum()) + n * (8 if k == "d4" else 4 if k == "d2" else 2 if k == "x" else 1)
    return invasion_percolation(mask, allowed, res, target, k, max_orth=1, max_n8=2)


@register_op("grow-dla")
def _grow_dla(mask, n: int = 30, reach: int = 5, stick: float = 0.5, kind: str = "d2", seed: int = 0):
    """DLA frost grown from the existing cells within `reach` cells (adds ~n orbits)."""
    k = _kind_for(mask, kind)
    rng = np.random.default_rng(seed)
    allowed = morph.dilate(mask, reach, 8)
    target = int(mask.sum()) + n * (8 if k == "d4" else 4 if k == "d2" else 2 if k == "x" else 1)
    return dla(mask, allowed, target, rng, k, stick, launch=allowed & ~morph.dilate(mask, 2, 8))


@register_op("physarum-link")
def _physarum_link(mask, reach: int = 6, q: float = 0.8, steps: int = 200, kind: str = "d2", seed: int = 0):
    """Treat the existing cells as food; grow a slime-mould network (Jones physarum at 3x) in the
    area within `reach` cells and add its thinned trails (top 1-q quantile)."""
    k = _kind_for(mask, kind)
    rng = np.random.default_rng(seed)
    s = 3
    allowed = morph.dilate(mask, reach, 8)
    hi = upsample_mask(allowed, s)
    trail = physarum(hi, upsample_mask(mask, s), rng, n_agents=int(hi.sum() * 0.6), steps=steps, kind=k,
                     spawn=upsample_mask(mask, s))
    t = downsample(trail, s, "mean")
    net = (t > np.quantile(t[allowed], q)) & allowed
    net = morph.skeletonize(net | mask)
    return lace_clean(net | mask, k, 3, protect=mask) | mask
