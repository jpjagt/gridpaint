"""Mirror curves: one engine for kolam (pulli / sikku), lusona, Celtic knotwork and Lunda designs.

Model (Gerdes / Jablan / Mercat; research-esoteric §3.1). A set of *dots* on a lattice (bool
array ``dots[r, c]``). Every dot is circled by 4 quarter-arcs (NE, NW, SW, SE) joining its 4 edge
midpoints. A midpoint between two adjacent dots A|B (``h[r, c]``: (r,c)|(r,c+1); ``v[r, c]``:
(r,c) over (r+1,c)) has a state:

- ``X`` (0) crossing: strands go straight through
- ``S`` (1) separating wall (perpendicular to AB): A's two arcs join, B's two join
- ``T`` (2) transferring wall (parallel to AB): the upper (left) arcs of A and B join, and the lower

Border midpoints are always closed. All-X on an m x n rectangle gives gcd(m, n) loops.
States are invariant under D4, so symmetric curves assign one state per *orbit* of midpoints.

Python API
----------
- ``dot_set(kind, rows, cols)``: rect | diamond | circle | cross | octagon | capsule | ring
- ``MirrorCurve(dots, h=None, v=None)``: ``.count()`` (#closed loops), ``.loops()`` (arc index lists in
  traversal order), ``.labels()``, ``.lunda()`` (2R x 2C binary design), ``.copy()``
- ``midpoint_orbits(dots, sym)`` -> list of orbits (each a list of ("h"|"v", r, c));
  sym in none|x|y|d2|rot2|rot4|d4
- ``search(dots, sym, rng, target=1, weights=(wX, wS, wT), fixed=None, iters=None)`` -> MirrorCurve
  (sikku search: descend to ``target`` loops, then random-walk inside the target class)
- ``rasterize(curve, style="A"|"B"|"C", border="pointed"|"flat", margin=None)`` -> ``Raster`` with
  ``.curve`` (bool mask), ``.dots`` (pulli cells), ``.over`` (over/under bridge cells, 3 per crossing),
  ``.crossings``, ``.walls``, ``.loops`` (per-loop masks), ``.dot_px`` (dot -> pixel), ``.shape``

  Style A: diagonal, pitch 4, dotless (compact lace; canvas 4n+1+2*margin).
  Style B: diagonal, pitch 6, room for pulli dots (canvas 6n+1+...).
  Style C: lattice rotated 45 degrees, pitch 4: orthogonal strands, '+' crossings, chamfered
  walls (woven-band / Celtic look). A lattice diamond becomes a pixel square in style C.
- ``lunda_lace(curve, mode)`` -> mask on the style-A pixel grid (Lunda design as a plate or lace).
- ``rotated_dots_for(h, w, shape)``: lattice dot set whose style-C image fills a pixel silhouette.

CLI ops: ``kolam-fill`` (single-loop kolam fitted inside the mask), ``lunda-fill``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import gcd

import numpy as np

from . import masks as M
from .registry import register_op

X, S, T = 0, 1, 2
STATE_NAMES = "XST"
NE, NW, SW, SE = 0, 1, 2, 3
# arc ends: each quarter-arc touches two midpoints of its dot
ARC_ENDS = {NE: ("N", "E"), NW: ("N", "W"), SW: ("W", "S"), SE: ("S", "E")}


# ---------------------------------------------------------------------------- dot sets

def dot_set(kind: str, rows: int, cols: int | None = None) -> np.ndarray:
    """Dot lattice shapes. ``diamond`` with rows=7 gives the classic 1-3-5-7-5-3-1."""
    cols = rows if cols is None else cols
    r, c = np.mgrid[0:rows, 0:cols]
    cy, cx = (rows - 1) / 2, (cols - 1) / 2
    dy, dx = r - cy, c - cx
    ry, rx = max(cy, 0.5), max(cx, 0.5)
    if kind == "rect":
        return np.ones((rows, cols), bool)
    if kind == "diamond":
        return np.abs(dx) / rx + np.abs(dy) / ry <= 1.0 + 1e-9
    if kind == "circle":
        return (dx / (rx + 0.5)) ** 2 + (dy / (ry + 0.5)) ** 2 <= 1.0
    if kind == "octagon":
        cut = max(1, round(min(rows, cols) / 3.4))
        return np.abs(dx) + np.abs(dy) <= rx + ry - cut + 1e-9
    if kind == "cross":
        a = max(1, rows // 6)
        b = max(1, cols // 6)
        return (np.abs(dx) <= b + 0.01) | (np.abs(dy) <= a + 0.01)
    if kind == "capsule":
        return (np.abs(dx / (rx + 0.5)) ** 3 + np.abs(dy / (ry + 0.5)) ** 3) <= 1.0
    if kind == "ring":
        d = np.maximum(np.abs(dx) / rx, np.abs(dy) / ry)
        return d >= 0.45
    raise ValueError("dot_set kind: rect|diamond|circle|octagon|cross|capsule|ring")


def dots_from_rows(counts: list[int]) -> np.ndarray:
    """Centred rows of dots, e.g. [1,3,5,7,5,3,1] (each count must have the parity of max)."""
    w = max(counts)
    out = np.zeros((len(counts), w), bool)
    for i, n in enumerate(counts):
        a = (w - n) // 2
        out[i, a:a + n] = True
    return out


# ---------------------------------------------------------------------------- curve

def _arc(C: int, r: int, c: int, q: int) -> int:
    return (r * C + c) * 4 + q


class MirrorCurve:
    def __init__(self, dots: np.ndarray, h: np.ndarray | None = None, v: np.ndarray | None = None):
        self.dots = np.asarray(dots, bool)
        R, C = self.dots.shape
        self.h = np.zeros((R, max(C - 1, 0)), np.int8) if h is None else np.asarray(h, np.int8).copy()
        self.v = np.zeros((max(R - 1, 0), C), np.int8) if v is None else np.asarray(v, np.int8).copy()
        self._hmask = self.dots[:, :-1] & self.dots[:, 1:]
        self._vmask = self.dots[:-1, :] & self.dots[1:, :]
        self._border = self._border_links()

    def copy(self) -> "MirrorCurve":
        return MirrorCurve(self.dots, self.h, self.v)

    @property
    def shape(self):
        return self.dots.shape

    def internal_midpoints(self) -> list[tuple[str, int, int]]:
        out = [("h", int(r), int(c)) for r, c in zip(*np.nonzero(self._hmask))]
        out += [("v", int(r), int(c)) for r, c in zip(*np.nonzero(self._vmask))]
        return out

    def state(self, mp) -> int:
        k, r, c = mp
        return int((self.h if k == "h" else self.v)[r, c])

    def set_state(self, mp, s: int) -> None:
        k, r, c = mp
        (self.h if k == "h" else self.v)[r, c] = s

    # -- links: pairs of (arc, end) joined at a midpoint. end index 0/1 per ARC_ENDS.
    def _border_links(self):
        R, C = self.dots.shape
        d = self.dots
        L = []
        for r, c in zip(*np.nonzero(d)):
            r, c = int(r), int(c)
            a = lambda q: _arc(C, r, c, q)  # noqa: E731
            if not (c + 1 < C and d[r, c + 1]):
                L.append(((a(NE), 1), (a(SE), 1)))
            if not (c - 1 >= 0 and d[r, c - 1]):
                L.append(((a(NW), 1), (a(SW), 0)))
            if not (r - 1 >= 0 and d[r - 1, c]):
                L.append(((a(NE), 0), (a(NW), 0)))
            if not (r + 1 < R and d[r + 1, c]):
                L.append(((a(SW), 1), (a(SE), 0)))
        return L

    def links(self):
        R, C = self.dots.shape
        L = list(self._border)
        for r, c in zip(*np.nonzero(self._hmask)):
            r, c = int(r), int(c)
            s = self.h[r, c]
            ANE, ASE = (_arc(C, r, c, NE), 1), (_arc(C, r, c, SE), 1)
            BNW, BSW = (_arc(C, r, c + 1, NW), 1), (_arc(C, r, c + 1, SW), 0)
            if s == X:
                L += [(ANE, BSW), (ASE, BNW)]
            elif s == S:
                L += [(ANE, ASE), (BNW, BSW)]
            else:
                L += [(ANE, BNW), (ASE, BSW)]
        for r, c in zip(*np.nonzero(self._vmask)):
            r, c = int(r), int(c)
            s = self.v[r, c]
            ASW, ASE = (_arc(C, r, c, SW), 1), (_arc(C, r, c, SE), 0)
            BNW, BNE = (_arc(C, r + 1, c, NW), 0), (_arc(C, r + 1, c, NE), 0)
            if s == X:
                L += [(ASE, BNW), (ASW, BNE)]
            elif s == S:
                L += [(ASW, ASE), (BNW, BNE)]
            else:
                L += [(ASW, BNW), (ASE, BNE)]
        return L

    def arcs(self) -> list[int]:
        R, C = self.dots.shape
        return [_arc(C, int(r), int(c), q) for r, c in zip(*np.nonzero(self.dots)) for q in range(4)]

    def count(self) -> int:
        """Number of closed loops (union-find over arcs)."""
        parent = {}

        def find(a):
            while parent.get(a, a) != a:
                pa = parent.get(a, a)
                parent[a] = parent.get(pa, pa)
                a = parent[a]
            return a

        n = 4 * int(self.dots.sum())
        comps = n
        for (a, _), (b, _) in self.links():
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
                comps -= 1
        return comps

    def partner(self) -> dict:
        P = {}
        for e1, e2 in self.links():
            P[e1] = e2
            P[e2] = e1
        return P

    def loops(self) -> list[list[tuple[int, int]]]:
        """Each loop as a list of (arc, entry_end) in traversal order."""
        P = self.partner()
        seen = set()
        out = []
        for a0 in self.arcs():
            if a0 in seen:
                continue
            loop = []
            a, e_in = a0, 0
            while True:
                seen.add(a)
                loop.append((a, e_in))
                nxt = P[(a, 1 - e_in)]
                a, e_in = nxt
                if a == a0:
                    break
            out.append(loop)
        return out

    def labels(self) -> dict[int, int]:
        return {a: i for i, lp in enumerate(self.loops()) for a, _ in lp}

    def lunda(self) -> np.ndarray:
        """Lunda design (2R x 2C, bool): quarter-arcs numbered along each loop, colour = parity."""
        R, C = self.dots.shape
        out = np.zeros((2 * R, 2 * C), bool)
        for lp in self.loops():
            for i, (a, _) in enumerate(lp):
                cell, q = divmod(a, 4)
                r, c = divmod(cell, C)
                px = 2 * c + (1 if q in (NE, SE) else 0)
                py = 2 * r + (1 if q in (SE, SW) else 0)
                out[py, px] = (i % 2) == 0
        return out

    def summary(self) -> str:
        sts = [self.state(m) for m in self.internal_midpoints()]
        n = max(1, len(sts))
        return (f"{int(self.dots.sum())} dots, {self.count()} loop(s), "
                f"X {sts.count(X) / n:.0%} S {sts.count(S) / n:.0%} T {sts.count(T) / n:.0%}")


# ---------------------------------------------------------------------------- symmetry orbits

def _sym_ops(sym: str, H2: int, W2: int):
    fx = lambda y, x: (y, W2 - 1 - x)  # noqa: E731
    fy = lambda y, x: (H2 - 1 - y, x)  # noqa: E731
    tr = lambda y, x: (x, y)  # noqa: E731
    rot = lambda y, x: (x, H2 - 1 - y)  # noqa: E731
    r2 = lambda y, x: (H2 - 1 - y, W2 - 1 - x)  # noqa: E731
    sq = H2 == W2
    anti = lambda y, x: (W2 - 1 - x, H2 - 1 - y)  # noqa: E731
    table = {"diag": [tr, anti] if sq else [r2], "tr": [tr] if sq else [],"none": [], "x": [fx], "y": [fy], "d2": [fx, fy], "rot2": [r2],
             "rot4": [rot] if sq else [r2], "d4": [fx, fy, tr] if sq else [fx, fy]}
    if sym not in table:
        raise ValueError("sym: none|x|y|d2|rot2|rot4|d4|diag|tr")
    return table[sym]


def _to_doubled(mp):
    k, r, c = mp
    return (2 * r, 2 * c + 1) if k == "h" else (2 * r + 1, 2 * c)


def _from_doubled(y, x):
    if y % 2 == 0 and x % 2 == 1:
        return ("h", y // 2, (x - 1) // 2)
    if y % 2 == 1 and x % 2 == 0:
        return ("v", (y - 1) // 2, x // 2)
    return None


def dots_symmetry(dots: np.ndarray) -> str:
    d = np.asarray(dots, bool)
    sx, sy = np.array_equal(d, d[:, ::-1]), np.array_equal(d, d[::-1])
    if sx and sy and d.shape[0] == d.shape[1] and np.array_equal(d, d.T):
        return "d4"
    if sx and sy:
        return "d2"
    if np.array_equal(d, d[::-1, ::-1]):
        return "rot2"
    return "x" if sx else ("y" if sy else "none")


def midpoint_orbits(dots: np.ndarray, sym: str = "d2") -> list[list[tuple[str, int, int]]]:
    curve = MirrorCurve(dots)
    mps = set(curve.internal_midpoints())
    R, C = curve.shape
    ops = _sym_ops(sym, 2 * R - 1, 2 * C - 1)
    seen = set()
    orbits = []
    for mp in sorted(mps):
        if mp in seen:
            continue
        orb = {mp}
        stack = [mp]
        while stack:
            y, x = _to_doubled(stack.pop())
            for f in ops:
                img = _from_doubled(*f(y, x))
                if img is not None and img in mps and img not in orb:
                    orb.add(img)
                    stack.append(img)
        seen |= orb
        orbits.append(sorted(orb))
    return orbits


# ---------------------------------------------------------------------------- search

def search(dots: np.ndarray, sym: str = "d2", rng=None, target: int | None = 1,
           weights=(0.55, 0.25, 0.20), fixed: dict | None = None, iters: int | None = None,
           init: int = X, walk: float = 1.0, on_change=None) -> MirrorCurve:
    """Sikku search over orbit states. ``fixed`` maps midpoint -> state (its orbit is pinned).
    target=None: just random states by weights. Returns the best curve found (fewest loops above
    target if the target is unreachable). ``walk`` scales the random walk after hitting target.
    ``on_change(curve, count)`` is called whenever the loop count drops (for growth frames)."""
    rng = np.random.default_rng(rng)
    curve = MirrorCurve(dots)
    orbits = midpoint_orbits(dots, sym)
    fixed = dict(fixed or {})
    pinned = set()
    for i, orb in enumerate(orbits):
        st = init
        for mp in orb:
            if mp in fixed:
                st = fixed[mp]
                pinned.add(i)
        for mp in orb:
            curve.set_state(mp, st)
    free = [i for i in range(len(orbits)) if i not in pinned]
    w = np.asarray(weights, float)
    w = w / w.sum()
    if target is None or not free:
        for i in free:
            s = int(rng.choice(3, p=w))
            for mp in orbits[i]:
                curve.set_state(mp, s)
        return curve
    c = curve.count()
    if on_change is not None:
        on_change(curve.copy(), c)
    K = iters or max(200, 30 * len(free))
    hit = c == target
    walk_left = int(K * 0.5 * walk)
    for _ in range(K * 3):
        i = free[int(rng.integers(len(free)))]
        old = curve.state(orbits[i][0])
        s = int(rng.choice(3, p=w))
        if s == old:
            continue
        for mp in orbits[i]:
            curve.set_state(mp, s)
        c2 = curve.count()
        if (hit and c2 == target) or (not hit and (c2 < c or (c2 == c and rng.random() < 0.5))):
            if on_change is not None and c2 < c:
                on_change(curve.copy(), c2)
            c = c2
            if c == target:
                hit = True
        else:
            for mp in orbits[i]:
                curve.set_state(mp, old)
        if hit:
            walk_left -= 1
            if walk_left <= 0:
                break
    return curve


# ---------------------------------------------------------------------------- rasterisation

@dataclass
class Raster:
    shape: tuple[int, int]
    curve: np.ndarray
    dots: np.ndarray
    over: np.ndarray
    crossings: np.ndarray
    walls: np.ndarray
    loops: list[np.ndarray] = field(default_factory=list)
    dot_px: dict = field(default_factory=dict)
    style: str = "A"


_MIDS = {
    "A": {"N": (0, -2), "E": (2, 0), "S": (0, 2), "W": (-2, 0)},
    "B": {"N": (0, -3), "E": (3, 0), "S": (0, 3), "W": (-3, 0)},
    "C": {"N": (2, -2), "E": (2, 2), "S": (-2, 2), "W": (-2, -2)},
}
_ARCS = {
    "A": {NE: [(1, -1)], NW: [(-1, -1)], SW: [(-1, 1)], SE: [(1, 1)]},
    "B": {NE: [(1, -2), (2, -1)], NW: [(-1, -2), (-2, -1)], SW: [(-2, 1), (-1, 2)], SE: [(1, 2), (2, 1)]},
    "C": {NE: [(2, -1), (2, 0), (2, 1)], NW: [(1, -2), (0, -2), (-1, -2)],
          SW: [(-2, -1), (-2, 0), (-2, 1)], SE: [(-1, 2), (0, 2), (1, 2)]},
}


def _pitch(style):
    return 6 if style == "B" else 4


def dot_pixel(style: str, r: int, c: int) -> tuple[int, int]:
    """Un-offset pixel of lattice dot (r, c)."""
    if style == "C":
        return 4 * (c - r), 4 * (c + r)
    p = _pitch(style)
    return p * c, p * r


def _arm(style, dpx, q, mid_rel):
    """The arc cell of arc q nearest to the midpoint (absolute)."""
    cells = _ARCS[style][q]
    best = min(cells, key=lambda d: max(abs(d[0] - mid_rel[0]), abs(d[1] - mid_rel[1])))
    return dpx[0] + best[0], dpx[1] + best[1]


def rasterize(curve: MirrorCurve, style: str = "A", border: str = "pointed", margin: int | None = None,
              over_len: int = 1) -> Raster:
    style = style.upper()
    R, C = curve.shape
    rad = 3 if style == "B" else 2
    margin = 0 if margin is None else margin
    pos = {(int(r), int(c)): dot_pixel(style, int(r), int(c)) for r, c in zip(*np.nonzero(curve.dots))}
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    ox, oy = rad + margin - min(xs), rad + margin - min(ys)
    pos = {k: (x + ox, y + oy) for k, (x, y) in pos.items()}
    W = max(xs) - min(xs) + 2 * (rad + margin) + 1
    H = max(ys) - min(ys) + 2 * (rad + margin) + 1
    add, rem = set(), set()
    over, cross, walls = set(), set(), set()
    mids = _MIDS[style]
    for (r, c), (x, y) in pos.items():
        for q in range(4):
            for dx, dy in _ARCS[style][q]:
                add.add((x + dx, y + dy))

    def unit(a, b):
        return (int(np.sign(b[0] - a[0])), int(np.sign(b[1] - a[1])))

    # internal midpoints
    for kind, r, c in curve.internal_midpoints():
        s = curve.state((kind, r, c))
        A = pos[(r, c)]
        if kind == "h":
            B = pos[(r, c + 1)]
            a_side, b_side = "E", "W"
            a_q, b_q = (NE, SE), (NW, SW)
            over_pair = (SE, NW)
        else:
            B = pos[(r + 1, c)]
            a_side, b_side = "S", "N"
            a_q, b_q = (SW, SE), (NW, NE)
            over_pair = (SW, NE)
        m = (A[0] + mids[a_side][0], A[1] + mids[a_side][1])
        u = unit(A, B)
        p = (-u[1], u[0])
        if s == X:
            add.add(m)
            cross.add(m)
            ca = _arm(style, A, over_pair[0], mids[a_side])
            cb = _arm(style, B, over_pair[1], mids[b_side])
            seg = {ca, m, cb}
            if over_len > 1:
                d = unit(ca, cb)
                for k in range(2, over_len + 1):
                    seg |= {(m[0] + k * d[0], m[1] + k * d[1]), (m[0] - k * d[0], m[1] - k * d[1])}
            over |= seg
            continue
        walls.add(m)
        if style == "C":
            for q in a_q:
                rem.add(_arm(style, A, q, mids[a_side]))
            for q in b_q:
                rem.add(_arm(style, B, q, mids[b_side]))
        v = u if s == S else p
        add.add((m[0] - v[0], m[1] - v[1]))
        add.add((m[0] + v[0], m[1] + v[1]))
    # border midpoints
    d = curve.dots
    for (r, c), A in pos.items():
        for side, (dr, dc), qs in (("E", (0, 1), (NE, SE)), ("W", (0, -1), (NW, SW)),
                                   ("N", (-1, 0), (NE, NW)), ("S", (1, 0), (SW, SE))):
            rr, cc = r + dr, c + dc
            if 0 <= rr < R and 0 <= cc < C and d[rr, cc]:
                continue
            m = (A[0] + mids[side][0], A[1] + mids[side][1])
            if border == "pointed":
                add.add(m)
            else:
                u = unit(A, m)
                if style == "C":
                    for q in qs:
                        rem.add(_arm(style, A, q, mids[side]))
                    add.add((m[0] - u[0], m[1] - u[1]))
                elif style == "B":
                    add.add((m[0] - u[0], m[1] - u[1]))
                else:
                    add.add((m[0] - (u[0] if u[1] == 0 else 0), m[1] - (u[1] if u[0] == 0 else 0)))
    cells = add - rem

    def to_mask(pts):
        mk = np.zeros((H, W), bool)
        for x, y in pts:
            if 0 <= x < W and 0 <= y < H:
                mk[y, x] = True
        return mk

    curve_m = to_mask(cells)
    dots_m = to_mask(pos.values())
    # per-loop masks: map raster cells to loops via arcs (arc cells + adjacent midpoint cells)
    labels = curve.labels()
    loop_masks = [np.zeros((H, W), bool) for _ in range(max(labels.values()) + 1)] if labels else []
    for (r, c), A in pos.items():
        for q in range(4):
            lid = labels[_arc(C, r, c, q)]
            for dx, dy in _ARCS[style][q]:
                pt = (A[0] + dx, A[1] + dy)
                if pt in cells:
                    loop_masks[lid][pt[1], pt[0]] = True
    # assign non-arc cells (midpoints, wall stencils) to the loop of an 8-neighbour
    rest = curve_m & ~np.any(loop_masks, axis=0) if loop_masks else curve_m
    for y, x in zip(*np.nonzero(rest)):
        for lm in loop_masks:
            if lm[max(0, y - 1):y + 2, max(0, x - 1):x + 2].any():
                lm[y, x] = True
                if (x, y) not in cross:
                    break
    return Raster((H, W), curve_m, dots_m, to_mask(over) & curve_m, to_mask(cross), to_mask(walls),
                  loop_masks, pos, style)


# ---------------------------------------------------------------------------- Lunda on the pixel grid

def lunda_lace(curve: MirrorCurve, mode: str = "lace", margin: int = 0) -> np.ndarray:
    """Lunda design drawn on a (4C+1 [+2m]) x (4R+1 [+2m]) grid aligned with style A (pitch 4).
    Unit (kx, ky) has face pixel (2kx+1, 2ky+1); edge/vertex pixels sit between units.
    mode='lace': black units + edges between adjacent black units + vertices joining diagonal
                 black pairs (a 1-cell lace with no 2x2 blocks).
    mode='plate': material everywhere except white units (and edges between adjacent white units):
                 a perforated plate whose channels are the white design.
    mode='blocks': black units as 2x2-ish blocks (vertex/edge pixels set if any adjacent unit black)."""
    L = curve.lunda()
    inside = np.kron(curve.dots, np.ones((2, 2), bool))
    h2, w2 = L.shape
    H, W = 2 * h2 + 1, 2 * w2 + 1
    out = np.zeros((H, W), bool)
    blk = L & inside
    wht = ~L & inside
    Lp = np.pad(blk, 1)
    Wp = np.pad(wht, 1)
    for Y in range(H):
        for Xx in range(W):
            if Y % 2 == 1 and Xx % 2 == 1:
                ky, kx = (Y - 1) // 2, (Xx - 1) // 2
                if mode == "plate":
                    out[Y, Xx] = inside[ky, kx] and not wht[ky, kx]
                else:
                    out[Y, Xx] = blk[ky, kx]
                continue
            # neighbouring units in padded coords
            if Y % 2 == 1:  # vertical edge between units (ky, kx-1) and (ky, kx)
                ky, kx = (Y - 1) // 2 + 1, Xx // 2
                a, b = (ky, kx), (ky, kx + 1)
                units = [a, b]
            elif Xx % 2 == 1:
                ky, kx = Y // 2, (Xx - 1) // 2 + 1
                units = [(ky, kx), (ky + 1, kx)]
            else:
                ky, kx = Y // 2, Xx // 2
                units = [(ky, kx), (ky, kx + 1), (ky + 1, kx), (ky + 1, kx + 1)]
            bs = [bool(Lp[u]) for u in units]
            ws = [bool(Wp[u]) for u in units]
            if mode == "lace":
                if len(units) == 2:
                    out[Y, Xx] = all(bs)
                else:
                    out[Y, Xx] = (bs[0] and bs[3] and not bs[1] and not bs[2]) or \
                                 (bs[1] and bs[2] and not bs[0] and not bs[3])
            elif mode == "plate":
                ins = [bool(np.pad(inside, 1)[u]) for u in units]
                if len(units) == 2:
                    out[Y, Xx] = any(ins) and not all(ws)
                else:
                    out[Y, Xx] = any(ins) and not ((ws[0] and ws[3]) or (ws[1] and ws[2]))
            else:
                out[Y, Xx] = any(bs)
    if margin:
        out = np.pad(out, margin)
    return out


# ---------------------------------------------------------------------------- helpers

def rotated_dots_for(h: int, w: int, shape: np.ndarray | None = None, margin: int = 0) -> tuple[np.ndarray, tuple[int, int]]:
    """Lattice dot set for style C whose dots (at pixels (4(c-r), 4(c+r)) + offset) lie inside
    ``shape`` (default: full h x w canvas) with their ring (radius 2) inside too.
    Returns (dots, (ox, oy)) where pixel = dot_pixel + (ox, oy)."""
    shape = np.ones((h, w), bool) if shape is None else np.asarray(shape, bool)
    from scipy import ndimage

    inner = ndimage.binary_erosion(np.pad(shape, 1), np.ones((5, 5), bool))[1:-1, 1:-1]
    cx, cy = (w - 1) // 2, (h - 1) // 2
    n = (h + w) // 4 + 2
    pts = []
    for r in range(-n, n + 1):
        for c in range(-n, n + 1):
            x, y = cx + 4 * (c - r), cy + 4 * (c + r)
            if 0 <= x < w and 0 <= y < h and inner[y, x]:
                pts.append((r, c))
    if not pts:
        return np.zeros((1, 1), bool), (cx, cy)
    r0 = min(p[0] for p in pts)
    c0 = min(p[1] for p in pts)
    R = max(p[0] for p in pts) - r0 + 1
    C = max(p[1] for p in pts) - c0 + 1
    dots = np.zeros((R, C), bool)
    for r, c in pts:
        dots[r - r0, c - c0] = True
    ox, oy = cx + 4 * (c0 - r0) - 4 * 0, cy + 4 * (c0 + r0)
    return dots, (ox, oy)


def plaited_loops(m: int, n: int) -> int:
    """All-X m x n rectangle: number of loops = gcd(m, n)."""
    return gcd(m, n)


def place(raster_mask: np.ndarray, H: int, W: int) -> np.ndarray:
    """Centre a raster mask on an H x W canvas (crop/pad symmetrically)."""
    h, w = raster_mask.shape
    out = np.zeros((H, W), bool)
    y0, x0 = (H - h) // 2, (W - w) // 2
    sy0, sx0 = max(0, -y0), max(0, -x0)
    dy0, dx0 = max(0, y0), max(0, x0)
    hh, ww = min(h - sy0, H - dy0), min(w - sx0, W - dx0)
    out[dy0:dy0 + hh, dx0:dx0 + ww] = raster_mask[sy0:sy0 + hh, sx0:sx0 + ww]
    return out


def fit_dots(mask: np.ndarray, style: str = "A") -> tuple[np.ndarray, int, int]:
    """Largest lattice dot set (style A/B) whose rings fit inside ``mask``; centred on the
    mask's canvas. Returns (dots, x_offset_of_dot0, y_offset_of_dot0)."""
    H, W = mask.shape
    p = _pitch(style)
    rad = 3 if style == "B" else 2
    from scipy import ndimage

    inner = ndimage.binary_erosion(np.pad(mask, rad), np.ones((2 * rad + 1, 2 * rad + 1), bool))[rad:-rad, rad:-rad]
    cx, cy = (W - 1) / 2, (H - 1) / 2
    # choose lattice phase so that dots are symmetric about the canvas centre when possible
    nx = int((W - 1 - 2 * rad) // p) + 1
    ny = int((H - 1 - 2 * rad) // p) + 1
    x0 = int(round(cx - (nx - 1) * p / 2))
    y0 = int(round(cy - (ny - 1) * p / 2))
    dots = np.zeros((ny, nx), bool)
    for r in range(ny):
        for c in range(nx):
            x, y = x0 + p * c, y0 + p * r
            if 0 <= x < W and 0 <= y < H and inner[y, x]:
                dots[r, c] = True
    return dots, x0, y0


def kolam_in_mask(mask: np.ndarray, style: str = "A", sym: str = "auto", seed: int = 0,
                  target: int = 1, weights=(0.55, 0.25, 0.2), border: str = "pointed") -> np.ndarray:
    """Single-loop (sikku) kolam fitted inside a mask, drawn at the mask's own coordinates."""
    from scipy import ndimage

    mask = np.asarray(mask, bool)
    H, W = mask.shape
    dots, x0, y0 = fit_dots(mask, style)
    if not dots.any():
        return np.zeros_like(mask)
    lab, n = ndimage.label(dots)
    if n > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        dots = lab == sizes.argmax()
    if sym == "auto":
        sym = dots_symmetry(dots)
    curve = search(dots, sym, seed, target=target, weights=weights)
    ras = rasterize(curve, style, border)
    rad = 3 if style == "B" else 2
    p = _pitch(style)
    r0 = int(np.nonzero(curve.dots.any(1))[0][0])
    c0 = int(np.nonzero(curve.dots.any(0))[0][0])
    # raster has dot (r0, c0)'s bbox corner at rad; place so lattice matches
    ox = x0 + p * c0 - rad
    oy = y0 + p * r0 - rad
    out = np.zeros_like(mask)
    h, w = ras.curve.shape
    for y, x in zip(*np.nonzero(ras.curve)):
        X_, Y_ = x + ox, y + oy
        if 0 <= X_ < W and 0 <= Y_ < H:
            out[Y_, X_] = True
    return out


@register_op("kolam-fill")
def _kolam_fill(mask, style: str = "A", seed: int = 0, loops: int = 1, mode: str = "replace", wx: float = 0.55):
    """Single-thread kolam (mirror curve) fitted inside the mask (pitch 4 style A, 6 style B,
    rotated C not supported here). loops = target loop count; wx = crossing weight (rest walls).
    mode=replace|or|xor-outline."""
    ws = ((1 - wx) * 0.55, (1 - wx) * 0.45)
    k = kolam_in_mask(mask, style if style.upper() in "AB" else "A", "auto", seed, loops, (wx, *ws))
    if mode == "or":
        return mask | k
    return k


@register_op("lunda-fill")
def _lunda_fill(mask, seed: int = 0, mode: str = "lace"):
    """Lunda design (Gerdes) of a single-loop mirror curve, fitted in the mask, mode=lace|plate|blocks."""
    H, W = mask.shape
    dots, x0, y0 = fit_dots(np.asarray(mask, bool), "A")
    if not dots.any():
        return np.zeros_like(mask)
    curve = search(dots, dots_symmetry(dots), seed, target=1)
    lu = lunda_lace(curve, mode)
    out = np.zeros_like(mask, dtype=bool)
    ox, oy = x0 - 2, y0 - 2
    for y, x in zip(*np.nonzero(lu)):
        if 0 <= x + ox < W and 0 <= y + oy < H:
            out[y + oy, x + ox] = True
    return out & np.asarray(mask, bool) if mode != "plate" else out
