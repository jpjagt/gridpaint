"""Sigil machines and binary oracles (research-esoteric §3.3-3.7), as a clean python API.

Every builder returns a dict with at least ``mask`` (bool [y, x]) and, where meaningful,
``nodes`` (list of (x, y) "sacred points": sigil vertices, letter centres, figure centres ...)
so growth recipes can use them as seeds / attractors / food, and ``reserved`` voids.

Kameas (planetary magic squares)
    ``KAMEAS`` name -> order, ``kamea(name)`` -> int array (Agrippa's tables for 3,4,5,6,8;
    Siamese construction for the odd orders 7 and 9), ``magic_constant(n)``
    ``name_numbers(text, n)``  Latin gematria + Agrippa reduction
    ``sigil_trace(text, planet, size, ...)``  route through the square: start ring, end bar,
        loops for doubled letters, fork for a doubled first letter; optional bilateral seal.
    ``magic_walk(planet, size)``  trace 1..n^2 (the square's intrinsic path)
    ``kamea_layout(n, size)``  cell centres / compartment lattice
Geomancy / I Ching
    ``FIGURES``, ``mothers_from_text``, ``geomantic_chart(mothers)``, ``figure_mask(bits)``
    ``TRIGRAMS``, ``FUXI_RING``, ``trigram_mask(bits, outward)``, ``taijitu(h, w, r)``
Scripts
    ``ogham_letters(text)``, ``ogham_spine(text, style)``
    ``RUNES``, ``bindrune(names)``, ``runes_for_text(text)``
    ``kufic_seal(size, rng, ...)``  balanced-window (no all-ink / all-void 2x2) C4 annealing
    ``spare_monogram(text)``  unique consonants overlaid in the stroke font
CLI ops: ``sigil-trace``, ``ogham``, ``bindrune``, ``kufic``.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

from . import glyphs as G
from . import morph
from .registry import register_op

# ---- kameas -----------------------------------------------------------------------

KAMEAS = {"saturn": 3, "jupiter": 4, "mars": 5, "sun": 6, "venus": 7, "mercury": 8, "moon": 9}
INTELLIGENCES = {"saturn": "AGIEL", "jupiter": "IOPHIEL", "mars": "GRAPHIEL", "sun": "NAKHIEL",
                 "venus": "HAGIEL", "mercury": "TIRIEL", "moon": "MALKAH"}

_TABLES = {
    3: "4 9 2 / 3 5 7 / 8 1 6",
    4: "4 14 15 1 / 9 7 6 12 / 5 11 10 8 / 16 2 3 13",
    5: "11 24 7 20 3 / 4 12 25 8 16 / 17 5 13 21 9 / 10 18 1 14 22 / 23 6 19 2 15",
    6: "6 32 3 34 35 1 / 7 11 27 28 8 30 / 19 14 16 15 23 24 / 18 20 22 21 17 13 / 25 29 10 9 26 12 / "
       "36 5 33 4 2 31",
    8: "8 58 59 5 4 62 63 1 / 49 15 14 52 53 11 10 56 / 41 23 22 44 45 19 18 48 / 32 34 35 29 28 38 39 25 / "
       "40 26 27 37 36 30 31 33 / 17 47 46 20 21 43 42 24 / 9 55 54 12 13 51 50 16 / 64 2 3 61 60 6 7 57",
}


def magic_constant(n: int) -> int:
    return n * (n * n + 1) // 2


def siamese(n: int) -> np.ndarray:
    """Odd-order magic square: start top-middle, move up-right, if occupied move down."""
    a = np.zeros((n, n), int)
    i, j = 0, n // 2
    for v in range(1, n * n + 1):
        a[i, j] = v
        ni, nj = (i - 1) % n, (j + 1) % n
        if a[ni, nj]:
            ni, nj = (i + 1) % n, j
        i, j = ni, nj
    return a


def doubly_even(n: int) -> np.ndarray:
    a = np.arange(1, n * n + 1).reshape(n, n)
    i, j = np.mgrid[0:n, 0:n]
    sel = (i % 4 == j % 4) | ((i % 4 + j % 4) == 3)
    a[sel] = n * n + 1 - a[sel]
    return a


def kamea(name_or_n) -> np.ndarray:
    n = KAMEAS[name_or_n] if isinstance(name_or_n, str) else int(name_or_n)
    if n in _TABLES:
        a = np.array([[int(v) for v in row.split()] for row in _TABLES[n].split("/")])
    elif n % 2:
        a = siamese(n)
    elif n % 4 == 0:
        a = doubly_even(n)
    else:
        raise ValueError(f"no kamea of order {n}")
    return a


def name_numbers(text: str, n: int) -> list[int]:
    return [G.reduce_to(v, n * n) for v in G.gematria_values(text) if v]


def kamea_layout(n: int, size: int, height: int | None = None):
    """Pixel centres of the n x n compartments on a size x height canvas: returns (k, pos) where
    pos[(row, col)] = (x, y) and k = pixels per compartment."""
    height = size if height is None else height
    k = (min(size, height) - 1) // n
    if k % 2 == 1 and k > 2:  # even k: centres, lattice and dog-leg routes are exactly mirror/C2-symmetric
        k -= 1
    offx = (size - k * n) // 2
    offy = (height - k * n) // 2
    pos = {(r, c): (offx + k * c + k // 2, offy + k * r + k // 2) for r in range(n) for c in range(n)}
    return k, pos, (offx, offy)


def _octi_dir(dx, dy):
    if dx == 0 and dy == 0:
        return (0, -1)
    ang = math.atan2(dy, dx)
    q = round(ang / (math.pi / 4)) % 8
    return [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)][q]


def _route_cells(a, b, style: str):
    if style == "octi":
        return G.stroke_cells(a, b, True)
    return G.line_cells(*a, *b)


def sigil_trace(text: str = "", planet: str = "saturn", size: int = 29, height: int | None = None,
                seal: bool = False, start: str = "ring", style: str = "bresenham", end_len: int = 5,
                values: list[int] | None = None):
    """Trace a word through a kamea.

    Returns dict: mask (line + marks), line, marks (start/end/loop/fork cells), nodes (vertices in
    order, deduplicated), start, end, values, lattice (compartment grid lines), centres (all n^2
    compartment centres) and k (compartment pitch). ``seal`` ORs the horizontal mirror image
    (a bilateral 'insect' seal), mirrored nodes are appended.
    style: bresenham (straight jaggy-free for small slopes) | octi (diagonal then straight dog-legs).
    start: ring (3x3 square ring) | ring2 (radius-2 pixel circle) | dot | none."""
    height = size if height is None else height
    sq = kamea(planet)
    n = sq.shape[0]
    where = {int(sq[r, c]): (r, c) for r in range(n) for c in range(n)}
    k, pos, (ox, oy) = kamea_layout(n, size, height)
    text = text or INTELLIGENCES.get(planet, "AGIEL")
    vals = list(values) if values is not None else name_numbers(text, n)
    if not vals:
        vals = [1]
    # merge repeated consecutive values into 'doubled' flags
    seq, doubled = [], []
    for v in vals:
        if seq and seq[-1] == v:
            doubled[-1] = True
        else:
            seq.append(v)
            doubled.append(False)
    pts = [pos[where[v]] for v in seq]
    H, W = height, size
    line = np.zeros((H, W), bool)
    for a, b in zip(pts, pts[1:]):
        for x, y in _route_cells(a, b, style):
            if 0 <= x < W and 0 <= y < H:
                line[y, x] = True
    if len(pts) == 1:
        line[pts[0][1], pts[0][0]] = True
    marks = np.zeros_like(line)
    # start mark
    sx, sy = pts[0]
    if doubled[0]:  # fork: two short diagonals opening backwards
        d = _octi_dir(*(np.subtract(pts[1], pts[0]) if len(pts) > 1 else (0, -1)))
        back = (-d[0], -d[1])
        for perp in ((-d[1], d[0]), (d[1], -d[0])):
            for t in (1, 2):
                x = sx + t * np.sign(back[0] + perp[0])
                y = sy + t * np.sign(back[1] + perp[1])
                if 0 <= x < W and 0 <= y < H:
                    marks[y, x] = True
    elif start in ("ring", "ring2"):
        rr = 1 if start == "ring" else 2
        if rr > 1:
            ring = G.ring_mask(2 * rr + 1, 2 * rr + 1, rr)
        else:
            ring = np.ones((3, 3), bool)
            ring[1, 1] = False
        for yy, xx in np.argwhere(ring):
            X, Y = sx + xx - rr, sy + yy - rr
            if 0 <= X < W and 0 <= Y < H:
                marks[Y, X] = True
        inner = (np.abs(np.arange(W)[None, :] - sx) < rr) & (np.abs(np.arange(H)[:, None] - sy) < rr)
        if rr > 1:
            inner = np.hypot(np.arange(W)[None, :] - sx, np.arange(H)[:, None] - sy) < rr - 0.5
        line &= ~inner
    elif start == "dot":
        marks[sy, sx] = True
    # loops for doubled letters (not the first)
    for i in range(1, len(pts)):
        if doubled[i]:
            px, py = pts[i]
            d = _octi_dir(px - pts[i - 1][0], py - pts[i - 1][1])
            perp = (-d[1], d[0])
            cx, cy = px + 2 * perp[0], py + 2 * perp[1]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (dx or dy) and 0 <= cx + dx < W and 0 <= cy + dy < H:
                        marks[cy + dy, cx + dx] = True
    # end bar
    ex, ey = pts[-1]
    if len(pts) > 1 and end_len > 0:
        d = _octi_dir(ex - pts[-2][0], ey - pts[-2][1])
        perp = (-d[1], d[0])
        h = end_len // 2
        for t in range(-h, h + 1):
            x, y = ex + t * perp[0], ey + t * perp[1]
            if 0 <= x < W and 0 <= y < H:
                marks[y, x] = True
    mask = line | marks
    nodes = list(dict.fromkeys(pts))
    if seal:
        mask = mask | mask[:, ::-1]
        line = line | line[:, ::-1]
        marks = marks | marks[:, ::-1]
        nodes = nodes + [(W - 1 - x, y) for x, y in nodes if (W - 1 - x, y) not in nodes]
    lattice = np.zeros((H, W), bool)
    for i in range(n + 1):
        x = ox + i * k
        y = oy + i * k
        if 0 <= x < W:
            lattice[oy:min(H, oy + n * k + 1), min(x, W - 1)] = True
        if 0 <= y < H:
            lattice[min(y, H - 1), ox:min(W, ox + n * k + 1)] = True
    return {"mask": mask, "line": line, "marks": marks, "nodes": nodes, "start": pts[0], "end": pts[-1],
            "values": seq, "doubled": doubled, "lattice": lattice, "centres": list(pos.values()), "k": k,
            "n": n, "text": text}


def magic_walk(planet: str = "saturn", size: int = 29, height: int | None = None, closed: bool = False,
               style: str = "bresenham"):
    """Trace 1 -> n^2 through the square (optionally closing n^2 -> 1)."""
    n = KAMEAS[planet]
    vals = list(range(1, n * n + 1)) + ([1] if closed else [])
    r = sigil_trace("x", planet, size, height, start="none", end_len=0, values=vals, style=style)
    return r


# ---- geomancy ---------------------------------------------------------------------

# bits = (head, neck, body, feet); 1 = odd = one point
FIGURES = {
    (1, 1, 1, 1): "Via", (0, 0, 0, 0): "Populus", (1, 0, 0, 0): "Laetitia", (0, 0, 0, 1): "Tristitia",
    (0, 1, 1, 0): "Conjunctio", (1, 0, 0, 1): "Carcer", (1, 1, 0, 0): "Fortuna Minor",
    (0, 0, 1, 1): "Fortuna Major", (1, 0, 1, 1): "Puella", (1, 1, 0, 1): "Puer",
    (0, 1, 0, 0): "Rubeus", (0, 0, 1, 0): "Albus", (1, 0, 1, 0): "Amissio", (0, 1, 0, 1): "Acquisitio",
    (0, 1, 1, 1): "Caput Draconis", (1, 1, 1, 0): "Cauda Draconis",
}


def mothers_from_text(text: str, salt: int = 0) -> list[tuple[int, ...]]:
    rng = np.random.default_rng(G.text_seed(text) + salt)
    bits = rng.integers(0, 2, 16)
    return [tuple(int(b) for b in bits[i * 4:(i + 1) * 4]) for i in range(4)]


def _xor(a, b):
    return tuple(x ^ y for x, y in zip(a, b))


def geomantic_chart(mothers) -> dict:
    M = [tuple(m) for m in mothers]
    D = [tuple(M[j][k] for j in range(4)) for k in range(4)]
    N = [_xor(M[0], M[1]), _xor(M[2], M[3]), _xor(D[0], D[1]), _xor(D[2], D[3])]
    RW = _xor(N[0], N[1])
    LW = _xor(N[2], N[3])
    J = _xor(RW, LW)
    R = _xor(J, M[0])
    return {"mothers": M, "daughters": D, "nieces": N, "right_witness": RW, "left_witness": LW,
            "judge": J, "reconciler": R, "names": {"judge": FIGURES[J]}}


def figure_mask(bits, style: str = "bars", width: int = 5) -> np.ndarray:
    """4-row figure: rows at y = 0,2,4,6. bars: odd = full capsule, even = two capsules with a
    1-cell gap. dots: odd = centre dot, even = two dots at the ends."""
    m = np.zeros((7, width), bool)
    c = width // 2
    for i, b in enumerate(bits):
        y = 2 * i
        if style == "bars":
            if b:
                m[y, :] = True
            else:
                m[y, :c] = True
                m[y, c + 1:] = True
        else:
            if b:
                m[y, c] = True
            else:
                m[y, 0] = m[y, width - 1] = True
    return m


# ---- I Ching ------------------------------------------------------------------------

# bits bottom -> top (1 = yang)
TRIGRAMS = {"qian": (1, 1, 1), "dui": (1, 1, 0), "li": (1, 0, 1), "zhen": (1, 0, 0),
            "xun": (0, 1, 1), "kan": (0, 1, 0), "gen": (0, 0, 1), "kun": (0, 0, 0)}
# Earlier-Heaven (Fu Xi) ring, south drawn at the top, then counter-clockwise on screen
# (top, top-left, left, bottom-left, bottom, bottom-right, right, top-right); complements opposite.
FUXI_RING = [("qian", (0, -1)), ("dui", (-1, -1)), ("li", (-1, 0)), ("zhen", (-1, 1)),
             ("kun", (0, 1)), ("gen", (1, 1)), ("kan", (1, 0)), ("xun", (1, -1))]


def trigram_mask(bits, outward=(0, -1), length: int = 7):
    """Trigram facing the centre: the first (bottom) line is innermost. Orthogonal positions:
    lines of ``length`` cells at pitch 2 (yin = half + gap + half). Diagonal positions:
    diagonal bands of 5 cells at offset 4 (yin = 2 + gap + 2).
    Returns (mask, centre) where centre = (x, y) of the middle line's centre in the mask."""
    ox, oy = outward
    if ox == 0 or oy == 0:
        h = 5
        m = np.zeros((h, length), bool)
        half = length // 2
        for i, b in enumerate(bits):
            y = h - 1 - 2 * i
            m[y, :] = True
            if not b:
                m[y, half] = False
                if length >= 9:
                    m[y, half - 1:half + 2] = False
        # rotate so 'up' = outward
        rot = {(0, -1): 0, (-1, 0): 1, (0, 1): 2, (1, 0): 3}[(ox, oy)]
        m = np.rot90(m, rot)
        return m, (m.shape[1] // 2, m.shape[0] // 2)
    # diagonal: build for outward (1, -1) then flip
    s = 13
    m = np.zeros((s, s), bool)
    c = s // 2
    for i, b in enumerate(bits):
        off = (i - 1) * 2  # line centres at c + (off, -off): (-2, 2), (0, 0), (2, -2)
        cx, cy = c + off, c - off
        for t in range(-2, 3):
            if not b and t == 0:
                continue
            m[cy + t, cx + t] = True
    if ox < 0:
        m = m[:, ::-1]
    if oy > 0:
        m = m[::-1, :]
    return m, (c, c)


def taijitu(h: int, w: int, r: float, cx=None, cy=None, eye: float = 1.0):
    """Returns (disc, yin, yang) masks (yin | yang == disc); eyes are swapped dots of radius ``eye``."""
    cx = (w - 1) / 2 if cx is None else cx
    cy = (h - 1) / 2 if cy is None else cy
    y, x = np.mgrid[0:h, 0:w]
    dx, dy = x - cx, y - cy
    disc = np.hypot(dx, dy) <= r + 0.3
    rs = r / 2
    top = np.hypot(dx, dy + rs) <= rs + 0.3
    bot = np.hypot(dx, dy - rs) <= rs + 0.3
    yang = (dx > 0) | ((dx == 0) & (dy > 0))
    yang = (yang | top) & ~bot
    eye_top = np.hypot(dx, dy + rs) <= eye + 0.3
    eye_bot = np.hypot(dx, dy - rs) <= eye + 0.3
    yang = (yang & ~eye_top) | eye_bot
    yang &= disc
    yin = disc & ~yang
    return disc, yin, yang


# ---- Ogham ----------------------------------------------------------------------------

OGHAM = {"B": ("B", 1), "L": ("B", 2), "F": ("B", 3), "S": ("B", 4), "N": ("B", 5),
         "H": ("H", 1), "D": ("H", 2), "T": ("H", 3), "C": ("H", 4), "Q": ("H", 5),
         "M": ("M", 1), "G": ("M", 2), "NG": ("M", 3), "Z": ("M", 4), "R": ("M", 5),
         "A": ("V", 1), "O": ("V", 2), "U": ("V", 3), "E": ("V", 4), "I": ("V", 5)}
_OGHAM_ALIAS = {"K": "C", "V": "F", "W": "F", "P": "B", "J": "I", "Y": "I", "X": "Z"}


def ogham_letters(text: str) -> list[tuple[str, str, int]]:
    t = "".join(c for c in str(text).upper() if c.isalpha())
    out, i = [], 0
    while i < len(t):
        if t[i:i + 2] == "NG":
            out.append(("NG",) + OGHAM["NG"])
            i += 2
            continue
        c = _OGHAM_ALIAS.get(t[i], t[i])
        if c in OGHAM:
            out.append((t[i],) + OGHAM[c])
        i += 1
    return out


def _ogham_strokes(aicme: str, count: int, style: str):
    """List of (rows, cells-relative-to-spine) for one letter; returns (height, cells[(dx, dy)])."""
    cells = []
    if style == "symmetric":
        pitch = {"B": 2, "H": 2, "M": 3, "V": 2}[aicme]
        for i in range(count):
            y = i * pitch
            if aicme == "B":
                cells += [(-1, y), (1, y)]
            elif aicme == "H":
                cells += [(-2, y), (-1, y), (1, y), (2, y)]
            elif aicme == "M":  # chevron rising outward (algiz twigs) once flipped to read upward
                cells += [(-1, y + 1), (1, y + 1), (-2, y + 2), (2, y + 2)]
            else:  # vowel notch: a pair of isolated dots beside the spine (Chebyshev 2)
                cells += [(-2, y), (2, y)]
        h = (count - 1) * pitch
        return h, cells
    # 'true' ogham: B right, H left, M across diagonal, vowels short across
    pitch = 2 if aicme != "M" else 3
    for i in range(count):
        y = i * pitch
        if aicme == "B":
            cells += [(1, y), (2, y), (3, y)]
        elif aicme == "H":
            cells += [(-1, y), (-2, y), (-3, y)]
        elif aicme == "M":
            cells += [(-2, y + 2), (-1, y + 1), (1, y - 1), (2, y - 2)]
        else:
            cells += [(-1, y), (1, y)]
    return (count - 1) * pitch, cells


def ogham_spine(text: str, style: str = "symmetric", gap: int = 4, cap: int = 2):
    """Name in Ogham on a vertical spine (symmetric style: B = short bars, H = long bars,
    M = rising chevrons, vowels = isolated dot pairs), read bottom -> top. Returns dict: mask, nodes (letter
    centres on the spine), width, height, letters, spine (spine-only mask)."""
    letters = ogham_letters(text) or ogham_letters("A")
    blocks = []
    for lab, aicme, count in letters:
        h, cells = _ogham_strokes(aicme, count, style)
        blocks.append((lab, aicme, h, cells))
    # extents above/below each block (M chevrons reach up 2, beads reach 1)
    def ext(cells):
        ys = [dy for _, dy in cells]
        return min(ys), max(ys)

    total = cap
    placed = []
    y = cap
    for lab, aicme, h, cells in blocks:
        lo, hi = ext(cells)
        y += -lo
        placed.append((lab, y, cells, lo, hi))
        y += hi + gap
    y = y - gap + cap
    Hh = y + 1
    half = 3 if style == "true" else 2
    Ww = 2 * half + 1
    m = np.zeros((Hh, Ww), bool)
    cx = half
    m[:, cx] = True
    nodes = []
    for lab, y0, cells, lo, hi in placed:
        for dx, dy in cells:
            yy = y0 + dy
            if 0 <= yy < Hh and 0 <= cx + dx < Ww:
                m[yy, cx + dx] = True
        nodes.append((cx, y0 + (lo + hi) // 2))
    # read bottom -> top: flip vertically so the first letter is at the bottom
    m = m[::-1]
    nodes = [(x, Hh - 1 - y) for x, y in nodes]
    spine = np.zeros_like(m)
    spine[:, cx] = True
    return {"mask": m, "nodes": nodes, "width": Ww, "height": Hh, "letters": [p[0] for p in placed],
            "spine": spine}


# ---- runes / bindrunes ------------------------------------------------------------------

# node coords on a 5 x 9 box (x 0..4, y 0..8), stave at x = 2; scale 2 -> 9 x 17 px
_STAVE = [(2, 0), (2, 8)]
RUNES = {
    "fehu": [_STAVE, [(2, 4), (4, 2)], [(2, 2), (4, 0)]],
    "thurisaz": [_STAVE, [(2, 2), (4, 4), (2, 6)]],
    "ansuz": [_STAVE, [(2, 0), (4, 2)], [(2, 2), (4, 4)]],
    "raidho": [_STAVE, [(2, 0), (4, 2), (2, 4), (4, 6), (4, 8)]],
    "gebo": [[(0, 2), (4, 6)], [(4, 2), (0, 6)]],
    "wunjo": [_STAVE, [(2, 0), (4, 2), (2, 4)]],
    "nauthiz": [_STAVE, [(0, 3), (4, 5)]],
    "isa": [_STAVE],
    "eihwaz": [_STAVE, [(2, 0), (4, 2)], [(2, 8), (0, 6)]],
    "algiz": [_STAVE, [(2, 4), (0, 2)], [(2, 4), (4, 2)]],
    "tiwaz": [_STAVE, [(2, 0), (0, 2)], [(2, 0), (4, 2)]],
    "berkano": [_STAVE, [(2, 0), (4, 2), (2, 4), (4, 6), (2, 8)]],
    "mannaz": [[(0, 0), (0, 8)], [(4, 0), (4, 8)], [(0, 0), (4, 4)], [(4, 0), (0, 4)]],
    "laguz": [_STAVE, [(2, 0), (4, 2)]],
    "ingwaz": [[(2, 2), (4, 4), (2, 6), (0, 4), (2, 2)]],
    "dagaz": [[(0, 2), (0, 6)], [(4, 2), (4, 6)], [(0, 2), (4, 6)], [(4, 2), (0, 6)]],
    "kenaz": [_STAVE, [(4, 1), (2, 3), (4, 5)]],
    "hagalaz": [[(0, 0), (0, 8)], [(4, 0), (4, 8)], [(0, 2), (4, 6)]],
    "jera": [_STAVE, [(2, 1), (0, 3), (2, 5)], [(2, 3), (4, 5), (2, 7)]],
}
# not offered by default (extremist connotations in some contexts): othala, sowilo (doubled)
_LATIN_RUNE = {"F": "fehu", "U": "wunjo", "T": "tiwaz", "A": "ansuz", "R": "raidho", "K": "kenaz", "C": "kenaz",
               "G": "gebo", "W": "wunjo", "H": "hagalaz", "N": "nauthiz", "I": "isa", "J": "jera", "Y": "eihwaz",
               "P": "berkano", "Z": "algiz", "S": "thurisaz", "B": "berkano", "E": "eihwaz", "M": "mannaz",
               "L": "laguz", "D": "dagaz", "O": "ingwaz", "Q": "kenaz", "V": "fehu", "X": "gebo"}


def runes_for_text(text: str, max_n: int = 3) -> list[str]:
    out = []
    for c in str(text).upper():
        r = _LATIN_RUNE.get(c)
        if r and r not in out:
            out.append(r)
        if len(out) >= max_n:
            break
    return out or ["isa"]


def rune_mask(name: str, scale: int = 2, flip: bool = False) -> np.ndarray:
    pl = RUNES[name]
    if flip:
        pl = [[(4 - x, y) for x, y in p] for p in pl]
    return G.draw_strokes((8 * scale + 1, 4 * scale + 1), pl, scale=scale)


def bindrune(names, scale: int = 2, mirror: bool = True, stave: bool = True):
    """Union of runes on one shared stave (+ mirrorX). Returns dict mask, junctions (cells with
    >= 3 neighbours, the 'nodes'), stave."""
    m = np.zeros((8 * scale + 1, 4 * scale + 1), bool)
    for nm in names:
        m |= rune_mask(nm, scale)
    if stave:
        m[:, 2 * scale] = True
    if mirror:
        m |= m[:, ::-1]
    nc = morph.neighbour_count(m, 8)
    junc = m & (nc >= 3)
    lab, nj = ndimage.label(junc, np.ones((3, 3)))
    nodes = [tuple(int(v) for v in np.rint(ndimage.center_of_mass(junc, lab, i + 1))[::-1]) for i in range(nj)]
    return {"mask": m, "junctions": junc, "nodes": nodes, "n_junctions": nj}


# ---- square Kufic -----------------------------------------------------------------------

def _c4_orbits(n: int) -> np.ndarray:
    ids = np.zeros((n, n), int)
    for y in range(n):
        for x in range(n):
            o = [(x, y), (n - 1 - y, x), (n - 1 - x, n - 1 - y), (y, n - 1 - x)]
            ids[y, x] = min(b * n + a for a, b in o)
    return ids


def _window_ok(g: np.ndarray) -> np.ndarray:
    s = g[:-1, :-1].astype(int) + g[1:, :-1] + g[:-1, 1:] + g[1:, 1:]
    return (s > 0) & (s < 4)


def kufic_seal(size: int = 15, rng=None, sym: str = "c4", steps: int = 6000, density: float = 0.5,
               w_tj: float = 1.0, w_comp: float = 8.0, w_turn: float = 0.15, w_end: float = 0.6,
               frame: bool = True, n_frames: int = 12):
    """Square-Kufic-like seal: every 2x2 window has 1..3 ink cells (hard), C4 (pinwheel) or D4
    orbits; energy prefers few T-junctions, one ink piece, few turns and few dead ends.
    Starts from concentric squares (which satisfy the window rule) and melts them into meanders.
    Returns dict mask, frames [(label, mask)], ascenders (longest vertical runs, C4)."""
    rng = np.random.default_rng(rng)
    n = size
    if sym == "d4":
        from .composition import orbit_map
        orb = orbit_map(n, n, "d4")
    else:
        orb = _c4_orbits(n)
    y, x = np.mgrid[0:n, 0:n]
    c = (n - 1) // 2
    cheb = np.maximum(np.abs(x - c), np.abs(y - c))
    g = (cheb % 2) == (c % 2)  # outermost ring ink
    fixed = cheb == c if frame else np.zeros_like(g)
    ids = np.unique(orb[~fixed])
    members = {int(i): np.argwhere(orb == i) for i in ids}

    def energy(g):
        nb4 = morph.neighbour_count(g, 4)
        tj = int((g & (nb4 >= 3)).sum())
        ends = int((g & (nb4 <= 1)).sum())
        hor = np.zeros_like(g)
        hor[:, 1:-1] = g[:, :-2] & g[:, 2:]
        ver = np.zeros_like(g)
        ver[1:-1, :] = g[:-2, :] & g[2:, :]
        turn = int((g & (nb4 == 2) & ~hor & ~ver).sum())
        comps = ndimage.label(g, np.ones((3, 3)))[1]
        dens = g.mean()
        return w_tj * tj + w_comp * (comps - 1) + w_turn * turn + w_end * ends + 60 * (dens - density) ** 2 * n

    E = energy(g)
    frames = [("concentric", g.copy())]
    T0, T1 = 2.0, 0.05
    snap = max(1, steps // max(1, n_frames - 1))
    for s in range(steps):
        T = T0 * (T1 / T0) ** (s / max(1, steps - 1))
        oid = int(ids[int(rng.integers(len(ids)))])
        cells = members[oid]
        g2 = g.copy()
        g2[cells[:, 0], cells[:, 1]] ^= True
        # local hard check on windows touching the orbit
        ok = True
        for yy, xx in cells:
            sub = g2[max(0, yy - 1):yy + 2, max(0, xx - 1):xx + 2]
            if sub.shape[0] >= 2 and sub.shape[1] >= 2 and not _window_ok(sub).all():
                ok = False
                break
        if not ok:
            continue
        E2 = energy(g2)
        if E2 <= E or rng.random() < math.exp(-(E2 - E) / T):
            g, E = g2, E2
        if (s + 1) % snap == 0:
            frames.append((f"step {s + 1}", g.copy()))
    frames[-1] = ("final", g.copy())
    return {"mask": g, "frames": frames, "ascenders": _ascenders(g, sym)}


def _ascenders(g: np.ndarray, sym: str = "c4") -> np.ndarray:
    """Longest vertical ink run in the top-left quarter (not on the frame), replicated by C4."""
    n = g.shape[0]
    c = (n - 1) // 2
    best, bx, by0, by1 = 0, 0, 0, 0
    for x in range(1, c + 1):
        y = 1
        while y < n - 1:
            if g[y, x]:
                y0 = y
                while y < n - 1 and g[y, x]:
                    y += 1
                if y0 < c + 1 and (y - y0) > best:
                    best, bx, by0, by1 = y - y0, x, y0, y
            y += 1
    a = np.zeros_like(g)
    if best >= 3:
        a[by0:by1, bx] = True
        a = a | np.rot90(a, 1) | np.rot90(a, 2) | np.rot90(a, 3)
        if sym == "d4":
            a = a | a[:, ::-1]
    return a & g


# ---- Spare monogram ----------------------------------------------------------------------

def spare_monogram(text: str, seed: int = 0, pitch: int = 3, mirror: bool = True, max_letters: int = 4,
                   clean: bool = True):
    """Unique consonants of ``text`` drawn in the 3x5 stroke font, overlaid on one centre with
    per-letter seeded flips, OR mirrorX, then 2x2 blocks broken. Returns dict mask, letters, nodes
    (cells where >= 3 strokes meet)."""
    letters = G.spare_letters(text, max_letters)
    rng = np.random.default_rng(G.text_seed(text) + seed)
    m = np.zeros((4 * pitch + 1, 2 * pitch + 1), bool)
    for c in letters:
        m |= G.letter_mask(c, pitch, flip_x=bool(rng.integers(2)), flip_y=bool(rng.integers(2)) and c not in "AVY")
    if mirror:
        m |= m[:, ::-1]
    if clean:
        from .lace import lace_clean
        m = lace_clean(m, 1, "x" if mirror else "none")
    nc = morph.neighbour_count(m, 8)
    nodes = [(int(x), int(y)) for y, x in np.argwhere(m & (nc >= 4))]
    return {"mask": m, "letters": letters, "nodes": nodes}


# ---- CLI ops ------------------------------------------------------------------------------

def _paste_centre(mask, g, mode):
    H, W = mask.shape
    canvas = np.zeros_like(mask)
    G.place(canvas, g, W // 2, H // 2)
    if mode == "replace":
        return canvas
    if mode == "clear":
        return mask & ~canvas
    return mask | canvas


@register_op("sigil-trace")
def _sigil_trace_op(mask, text: str = "", planet: str = "saturn", seal: bool = True, marks: bool = True,
                    walk: bool = False, mode: str = "or"):
    """Trace ``text`` (Latin gematria, Agrippa reduction) through the kamea of ``planet``
    (saturn 3, jupiter 4, mars 5, sun 6, venus 7, mercury 8, moon 9) fitted to the canvas/--region
    (square). seal=true ORs the mirror (bilateral seal); marks = start ring + end bar;
    walk=true traces 1..n^2 instead of a word. mode=or|replace|clear."""
    H, W = mask.shape
    s = min(H, W)
    if walk:
        r = magic_walk(planet, s)
        g = r["mask"] | (r["mask"][:, ::-1] if seal else False)
    else:
        r = sigil_trace(text, planet, s, seal=seal)
        g = r["mask"] if marks else r["line"]
    return _paste_centre(mask, g, mode)


@register_op("ogham")
def _ogham_op(mask, text: str = "AILM", style: str = "symmetric", mode: str = "or"):
    """Write ``text`` in Ogham on a vertical spine centred on the canvas/--region (read bottom->top).
    style=symmetric (B short bars, H long bars, M chevrons, vowels beads) | true (B right, H left,
    M diagonal across, vowels short across)."""
    return _paste_centre(mask, ogham_spine(text, style)["mask"], mode)


@register_op("bindrune")
def _bindrune_op(mask, runes: str = "", text: str = "", scale: int = 2, mirror: bool = True, mode: str = "or"):
    """Bindrune centred on the canvas/--region: runes=comma list (fehu,thurisaz,ansuz,raidho,gebo,
    wunjo,nauthiz,isa,eihwaz,algiz,tiwaz,berkano,mannaz,laguz,ingwaz,dagaz,kenaz,hagalaz,jera)
    or text= (initials mapped to runes, max 3). mirror ORs mirrorX."""
    names = [r.strip() for r in runes.split(",") if r.strip()] or runes_for_text(text or "GIFT")
    return _paste_centre(mask, bindrune(names, scale, mirror)["mask"], mode)


@register_op("kufic")
def _kufic_op(mask, seed: int = 0, sym: str = "c4", steps: int = 4000, mode: str = "replace"):
    """Fill the (square, odd) canvas/--region with a balanced-window square-Kufic seal (no 2x2 all-ink
    or all-void), C4 pinwheel or D4. mode=replace|or."""
    H, W = mask.shape
    n = min(H, W)
    n -= (n + 1) % 2
    g = kufic_seal(n, seed, sym, steps)["mask"]
    return _paste_centre(mask, g, "replace" if mode == "replace" else "or")
