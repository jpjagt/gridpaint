"""One-axis labyrinths (Cretan / classical family) from level sequences (research-esoteric §3.5).

A labyrinth with n circuits is a permutation ``0, a1, ..., an, n+1`` (0 = outside, n+1 = goal;
circuit 1 = outermost). The walker runs circuit a_k fully around, turning at the axis; transition
k (a_k -> a_k+1) happens on the left of the axis when k is even, on the right when k is odd. Valid
iff on each side the transition intervals are pairwise nested or disjoint (planar U-turns).
Classical 7-circuit Cretan: 0 3 2 1 4 7 6 5 8.

Python API
- ``CRETAN``, ``valid_sequences(n, limit=None)``, ``is_valid(seq)``, ``sequence_for(n, seed)``
- ``labyrinth(seq, style="square"|"octagon"|"round", goal=2, axis="bottom", chamfer=True)`` -> dict with
  ``path`` (walking channel incl. goal), ``walls``, ``goal``, ``disc`` (outline area),
  ``axis`` (wall cells on the axis column = the turning spine), ``size``
- pitch 2: 1-cell path, 1-cell walls; size = 2*(goal + 2n + 1) + 1 (+ 2*margin)

CLI op: ``labyrinth-fill`` (walls of a labyrinth centred in the mask/region).
"""

from __future__ import annotations

import numpy as np

from .registry import register_op

CRETAN = [0, 3, 2, 1, 4, 7, 6, 5, 8]
CRETAN_11 = None  # filled lazily by sequence_for


def _crosses(a, b):
    (p, q), (r, s) = sorted(a), sorted(b)
    return (p < r < q < s) or (r < p < s < q)


def is_valid(seq) -> bool:
    n = len(seq) - 2
    if sorted(seq) != list(range(n + 2)) or seq[0] != 0 or seq[-1] != n + 1:
        return False
    sides = {0: [], 1: []}
    for k in range(n + 1):
        iv = (seq[k], seq[k + 1])
        for other in sides[k % 2]:
            if _crosses(iv, other):
                return False
        sides[k % 2].append(iv)
    return True


def valid_sequences(n: int, limit: int | None = None) -> list[list[int]]:
    out = []
    sides = {0: [], 1: []}
    seq = [0]
    used = [False] * (n + 2)

    def rec():
        if limit is not None and len(out) >= limit:
            return
        k = len(seq) - 1
        if k == n:
            iv = (seq[-1], n + 1)
            if all(not _crosses(iv, o) for o in sides[k % 2]):
                out.append(seq + [n + 1])
            return
        for a in range(1, n + 1):
            if used[a]:
                continue
            iv = (seq[-1], a)
            if any(_crosses(iv, o) for o in sides[k % 2]):
                continue
            used[a] = True
            seq.append(a)
            sides[k % 2].append(iv)
            rec()
            sides[k % 2].pop()
            seq.pop()
            used[a] = False

    rec()
    return out


_CACHE: dict[int, list[list[int]]] = {}


def sequence_for(n: int, seed: int = 0, alternating: bool = True) -> list[int]:
    """A valid level sequence for n circuits chosen by seed (alternating parity only if asked:
    those are the 'classical-feeling' ones where the walker always swings in/out)."""
    if n not in _CACHE:
        _CACHE[n] = valid_sequences(n, limit=20000)
    seqs = _CACHE[n]
    if alternating:
        alt = [s for s in seqs if all((s[i] + s[i + 1]) % 2 == 1 for i in range(len(s) - 1))]
        seqs = alt or seqs
    rng = np.random.default_rng(seed)
    return list(seqs[int(rng.integers(len(seqs)))])


def _depths(intervals):
    out = []
    for i, a in enumerate(intervals):
        p, q = sorted(a)
        d = 0
        for j, b in enumerate(intervals):
            if i == j:
                continue
            r, s = sorted(b)
            if r <= p and q <= s and (r, s) != (p, q):
                d += 1
        out.append(d)
    return out


def labyrinth(seq, style: str = "square", goal: int = 2, axis: str = "bottom", chamfer: bool = True,
              margin: int = 0, chamfer_c: int | None = None) -> dict:
    n = len(seq) - 2
    R_out = goal + 2 * n + 1  # outer wall radius
    size = 2 * (R_out + margin) + 1
    c = R_out + margin
    yy, xx = np.mgrid[0:size, 0:size]
    dx, dy = xx - c, yy - c
    # rotate the frame so the axis is always "bottom" in (u, v) coordinates
    if axis == "bottom":
        u, v = dx, dy
    elif axis == "top":
        u, v = -dx, -dy
    elif axis == "left":
        u, v = dy, -dx
    else:
        u, v = -dy, dx
    cheb = np.maximum(np.abs(u), np.abs(v))
    l1 = np.abs(u) + np.abs(v)
    if style == "square":
        dist = cheb
    elif style == "octagon":
        cc = goal - 1 if chamfer_c is None else chamfer_c
        dist = np.maximum(cheb, (l1 + cc + 1) // 2)
    else:
        dist = np.rint(np.hypot(u, v)).astype(int)

    def rho(level):
        if level == 0:
            return R_out + 1 + margin
        if level == n + 1:
            return goal
        return goal + 2 * (n - level) + 2

    path = np.zeros((size, size), bool)
    # transitions and bars
    trans = [(seq[k], seq[k + 1], k % 2) for k in range(n + 1)]
    bars = {}
    for side in (0, 1):
        ivs = [(p, q) for p, q, s in trans if s == side]
        for (p, q), d in zip(ivs, _depths(ivs)):
            off = 1 + 2 * d
            bars[(p, q)] = -off if side == 0 else off
    left_end, right_end = {}, {}
    for p, q, s in trans:
        bx = bars[(p, q)]
        for lev in (p, q):
            (left_end if s == 0 else right_end)[lev] = bx
    # rings
    for lev in range(1, n + 1):
        ring = dist == rho(lev)
        lo, hi = left_end[lev], right_end[lev]
        cut = ring & (v > 0) & (u > lo) & (u < hi)
        path |= ring & ~cut

    def y_at(lev, bx):
        r = rho(lev)
        if lev == 0:
            return r
        if lev == n + 1:
            return goal
        col = (dist == r) & (u == bx) & (v > 0)
        vs = v[col]
        return int(vs.max()) if vs.size else r

    for (p, q), bx in bars.items():
        y0, y1 = sorted((y_at(p, bx), y_at(q, bx)))
        path |= (u == bx) & (v >= y0) & (v <= y1)
    goal_m = dist <= goal
    path |= goal_m
    disc = dist <= R_out
    walls = disc & ~path
    if chamfer and style == "square":
        corner = (np.abs(u) == np.abs(v)) & (dist % 2 == (R_out % 2)) & walls & (dist > goal + 1)
        walls &= ~corner
    if style == "octagon":
        # diagonal parts: keep only the outer L1 line of each 2-thick wall staircase (diagonal band)
        diag = (dist > cheb) & walls
        inner_line = diag & ((l1 + (goal - 1 if chamfer_c is None else chamfer_c)) % 2 == 1)
        thin = walls & ~inner_line
        from .morph import label

        if label(thin, 8)[1] == label(walls, 8)[1]:
            walls = thin
    path &= disc
    axis_m = walls & (u == 0) & (v > 0)
    return {"path": path, "walls": walls, "goal": goal_m & disc, "disc": disc, "axis": axis_m,
            "size": size, "seq": list(seq), "centre": (c, c)}


@register_op("labyrinth-fill")
def _labyrinth_fill(mask, n: int = 7, seed: int = -1, style: str = "square", goal: int = 2, axis: str = "bottom",
                    what: str = "walls"):
    """One-axis labyrinth centred in the mask/region (largest that fits). n circuits; seed=-1 =
    classical Cretan (n=7), else a seeded valid level sequence. what=walls|path."""
    H, W = mask.shape
    side = min(H, W)
    n = int(n)
    while n > 1 and 2 * (goal + 2 * n + 1) + 1 > side:
        n -= 1
    seq = CRETAN if (seed < 0 and n == 7) else sequence_for(n, max(seed, 0))
    L = labyrinth(seq, style, goal, axis)
    m = L[what]
    out = np.zeros((H, W), bool)
    s = L["size"]
    y0, x0 = (H - s) // 2, (W - s) // 2
    out[y0:y0 + s, x0:x0 + s] = m
    return out
