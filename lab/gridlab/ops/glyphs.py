"""Glyph grammar: octilinear strokes, text -> bits/numbers, stroke fonts, asemic scripts,
pixel circles and small sacred primitives (horns, rings, triangles ...).

Everything here is pure numpy and returns bool masks ``[y, x]`` (plus node lists where useful),
so other recipes can combine glyphs with growth (attractors, reserved voids, seeds).

Rasterisation rules (research-esoteric §2): strokes are octilinear (0/45/90/135 deg), 1 cell wide;
diagonal steps render as concave-bridged bands. Distinct strokes keep Chebyshev distance >= 2.

Text helpers
    ``text_seed(text)``            stable 32-bit seed from text (a name -> its piece)
    ``text_bits(text, mode)``      utf8 | vowel | parity bit lists
    ``palindromise(bits, centre)`` w + [c] + reverse(w)
    ``gematria(ch)`` / ``gematria_values(text)``  Latin "Hebrew order" values A..I=1..9, J..R=10..90, S..Z=100..800
Strokes
    ``stroke_cells(p, q)``  octilinear-snapped cells from p to q (Bresenham fallback)
    ``draw_strokes(shape, polylines, origin, scale)``
    ``pixel_ring(r)`` / ``ring_mask(h, w, r, cx, cy)``  clean 8-connected D4-exact pixel circles
    ``square_spiral(...)`` square-spiral hook polyline (leiwen / vèvè scrolls)
Fonts / scripts
    ``LATIN_STROKES``  26 letters on a 3x5 node lattice (pitch 2 -> 5x9 px), ``letter_mask(ch)``
    ``asemic_glyph(rng, ...)`` / ``asemic_alphabet(rng, n)``  invented-script glyphs (§3.7)
    ``word_mask(text)`` text set in the stroke font
Primitives (for Monas stacks, vèvè ...)
    ``prim_*`` functions return (mask, anchor_top, anchor_bottom) style small masks; see ``PRIMITIVES``.

CLI op: ``glyph`` — stamp a word (stroke font) or an asemic glyph centred at the canvas/--region.
"""

from __future__ import annotations

import hashlib
import math

import numpy as np

from . import morph
from .registry import register_op

# ---- text -> numbers ------------------------------------------------------------

VOWELS = set("AEIOUY")


def text_seed(text: str) -> int:
    """Deterministic 32-bit seed from text (case/space-insensitive)."""
    t = "".join(str(text).upper().split())
    return int.from_bytes(hashlib.sha256(t.encode()).digest()[:4], "big")


def text_bits(text: str, mode: str = "utf8") -> list[int]:
    """utf8: bytes MSB first; vowel: 1 per vowel / 0 per consonant; parity: letter ordinal parity."""
    t = str(text)
    if mode == "utf8":
        return [(b >> (7 - i)) & 1 for b in t.encode() for i in range(8)]
    letters = [c for c in t.upper() if c.isalpha()]
    if mode == "vowel":
        return [1 if c in VOWELS else 0 for c in letters]
    if mode == "parity":
        return [(ord(c) - 64) % 2 for c in letters]
    raise ValueError("mode: utf8|vowel|parity")


def palindromise(bits, centre: int | None = None) -> list[int]:
    bits = list(bits)
    return bits + ([centre] if centre is not None else []) + bits[::-1]


def gematria(ch: str) -> int:
    """Latin in Hebrew order: A..I = 1..9, J..R = 10..90, S..Z = 100..800. Non-letters -> 0."""
    c = ch.upper()
    if not ("A" <= c <= "Z"):
        return 0
    i = ord(c) - 65
    return (i % 9 + 1) * 10 ** (i // 9)


def gematria_values(text: str) -> list[int]:
    return [gematria(c) for c in str(text) if c.isalpha()]


def reduce_to(v: int, n2: int) -> int:
    """Agrippa reduction: drop zeros (v // 10) until v <= n2 (and >= 1)."""
    v = int(v)
    while v > n2:
        v = v // 10 if v % 10 == 0 else (v % n2 or n2)
    return max(1, v)


# ---- strokes ----------------------------------------------------------------------

def line_cells(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    """Bresenham 8-connected, endpoints included."""
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
    return pts


def is_octilinear(p, q) -> bool:
    dx, dy = q[0] - p[0], q[1] - p[1]
    return dx == 0 or dy == 0 or abs(dx) == abs(dy)


def stroke_cells(p, q, octi: bool = True) -> list[tuple[int, int]]:
    """Cells from p to q. With ``octi`` a non-octilinear segment is drawn as straight + diagonal +
    straight runs (a chamfered dog-leg, symmetric under reversal) instead of a Bresenham staircase."""
    (x0, y0), (x1, y1) = p, q
    if not octi or is_octilinear(p, q):
        return line_cells(x0, y0, x1, y1)
    dx, dy = x1 - x0, y1 - y0
    k = min(abs(dx), abs(dy))
    sx, sy = int(np.sign(dx)), int(np.sign(dy))
    rest = max(abs(dx), abs(dy)) - k  # straight part, split evenly around the diagonal (reversal-symmetric)
    ax = (sx, 0) if abs(dx) > abs(dy) else (0, sy)
    a = rest // 2
    p1 = (x0 + ax[0] * a, y0 + ax[1] * a)
    p2 = (p1[0] + k * sx, p1[1] + k * sy)
    pts = line_cells(x0, y0, *p1) + line_cells(*p1, *p2)[1:] + line_cells(*p2, x1, y1)[1:]
    return pts


def draw_strokes(shape, polylines, origin=(0, 0), scale: int = 1, octi: bool = True,
                 out: np.ndarray | None = None) -> np.ndarray:
    """Rasterise polylines (lists of (x, y) node coords) scaled by ``scale`` and offset by origin."""
    H, W = shape
    m = np.zeros((H, W), bool) if out is None else out
    ox, oy = origin
    for pl in polylines:
        pts = [(int(ox + scale * x), int(oy + scale * y)) for x, y in pl]
        if len(pts) == 1:
            x, y = pts[0]
            if 0 <= x < W and 0 <= y < H:
                m[y, x] = True
        for a, b in zip(pts, pts[1:]):
            for x, y in stroke_cells(a, b, octi):
                if 0 <= x < W and 0 <= y < H:
                    m[y, x] = True
    return m


def to_supercover(m: np.ndarray) -> np.ndarray:
    """Make diagonal-only links 4-connected (stronger strokes): for each diagonal pair with both
    orthogonal corners empty, fill one corner (the lower one)."""
    m = np.asarray(m, bool).copy()
    H, W = m.shape
    for y in range(H - 1):
        for x in range(W):
            for dx in (-1, 1):
                if 0 <= x + dx < W and m[y, x] and m[y + 1, x + dx] and not m[y, x + dx] and not m[y + 1, x]:
                    m[y + 1, x] = True
    return m


# ---- pixel circles ---------------------------------------------------------------

def ring_mask(h: int, w: int, r: float, cx: float | None = None, cy: float | None = None,
              clean: bool = True) -> np.ndarray:
    """Pixel circle: cells with round(hypot) == r, corner-redundant cells removed (D4-exact
    around an integer centre). Renders as diagonal bands + short capsules."""
    cx = (w - 1) / 2 if cx is None else cx
    cy = (h - 1) / 2 if cy is None else cy
    y, x = np.mgrid[0:h, 0:w]
    ax, ay = np.abs(x - cx), np.abs(y - cy)
    m = np.rint(np.hypot(ax, ay)) == round(r)
    if not clean:
        return m
    return _clean_ring(m, ax, ay)


def _clean_ring(m, ax, ay):
    m = m.copy()
    H, W = m.shape
    # canonical key per cell for orbit-wise removal
    key = np.round(np.maximum(ax, ay) * 1000 + np.minimum(ax, ay), 3)
    for k in np.unique(key[m]):
        cells = np.argwhere(m & (key == k))
        ok = []
        for yy, xx in cells:
            hor = [(yy, xx + d) for d in (-1, 1) if 0 <= xx + d < W and m[yy, xx + d]]
            ver = [(yy + d, xx) for d in (-1, 1) if 0 <= yy + d < H and m[yy + d, xx]]
            ok.append(len(hor) == 1 and len(ver) == 1)
        if cells.size and all(ok):
            before = morph.label(m, 8)[1]
            trial = m.copy()
            trial[cells[:, 0], cells[:, 1]] = False
            if morph.label(trial, 8)[1] == before:
                m = trial
    return m


def pixel_ring(r: int) -> np.ndarray:
    s = 2 * r + 1
    return ring_mask(s, s, r)


def disc_mask(h: int, w: int, r: float, cx=None, cy=None) -> np.ndarray:
    cx = (w - 1) / 2 if cx is None else cx
    cy = (h - 1) / 2 if cy is None else cy
    y, x = np.mgrid[0:h, 0:w]
    return np.rint(np.hypot(x - cx, y - cy)) <= r


# ---- spirals / hooks ---------------------------------------------------------------

def square_spiral(x: int, y: int, length: int, turns: int = 2, pitch: int = 2, dir0=(1, 0),
                  cw: bool = True) -> list[tuple[int, int]]:
    """Polyline of a square spiral hook starting at (x, y) heading ``dir0``; segment lengths
    L, L, L-p, L-p, ... (``turns`` full quarter-turn pairs). Turning clockwise (screen) if cw."""
    pts = [(x, y)]
    d = dir0
    L = length
    seg = 0
    while L >= 1 and seg < 2 * turns + 1:
        x, y = x + d[0] * L, y + d[1] * L
        pts.append((x, y))
        d = (-d[1], d[0]) if cw else (d[1], -d[0])
        seg += 1
        if seg % 2 == 0:
            L -= pitch
    return pts


# ---- Latin stroke font (3x5 nodes; node (c, r) -> px (2c, 2r)) ------------------------

LATIN_STROKES: dict[str, list[list[tuple[int, int]]]] = {
    "A": [[(0, 4), (0, 1), (1, 0), (2, 1), (2, 4)], [(0, 2), (2, 2)]],
    "B": [[(0, 0), (0, 4), (1, 4), (2, 3), (1, 2), (0, 2)], [(0, 0), (1, 0), (2, 1), (1, 2)]],
    "C": [[(2, 0), (1, 0), (0, 1), (0, 3), (1, 4), (2, 4)]],
    "D": [[(0, 0), (0, 4), (1, 4), (2, 3), (2, 1), (1, 0), (0, 0)]],
    "E": [[(2, 0), (0, 0), (0, 4), (2, 4)], [(0, 2), (1, 2)]],
    "F": [[(2, 0), (0, 0), (0, 4)], [(0, 2), (1, 2)]],
    "G": [[(2, 0), (1, 0), (0, 1), (0, 3), (1, 4), (2, 4), (2, 2), (1, 2)]],
    "H": [[(0, 0), (0, 4)], [(2, 0), (2, 4)], [(0, 2), (2, 2)]],
    "I": [[(0, 0), (2, 0)], [(1, 0), (1, 4)], [(0, 4), (2, 4)]],
    "J": [[(2, 0), (2, 3), (1, 4), (0, 3)]],
    "K": [[(0, 0), (0, 4)], [(2, 0), (0, 2), (2, 4)]],
    "L": [[(0, 0), (0, 4), (2, 4)]],
    "M": [[(0, 4), (0, 0), (1, 1), (2, 0), (2, 4)]],
    "N": [[(0, 4), (0, 0), (2, 2)], [(2, 0), (2, 4)]],
    "O": [[(1, 0), (0, 1), (0, 3), (1, 4), (2, 3), (2, 1), (1, 0)]],
    "P": [[(0, 4), (0, 0), (1, 0), (2, 1), (1, 2), (0, 2)]],
    "Q": [[(1, 0), (0, 1), (0, 3), (1, 4), (2, 3), (2, 1), (1, 0)], [(1, 3), (2, 4)]],
    "R": [[(0, 4), (0, 0), (1, 0), (2, 1), (1, 2), (0, 2)], [(1, 2), (2, 3), (2, 4)]],
    "S": [[(2, 0), (1, 0), (0, 1), (2, 3), (1, 4), (0, 4)]],
    "T": [[(0, 0), (2, 0)], [(1, 0), (1, 4)]],
    "U": [[(0, 0), (0, 3), (1, 4), (2, 3), (2, 0)]],
    "V": [[(0, 0), (0, 2), (1, 3), (1, 4)], [(2, 0), (2, 2), (1, 3)]],
    "W": [[(0, 0), (0, 4), (1, 3), (2, 4), (2, 0)]],
    "X": [[(0, 0), (0, 1), (2, 3), (2, 4)], [(2, 0), (2, 1), (0, 3), (0, 4)]],
    "Y": [[(0, 0), (0, 1), (1, 2), (2, 1), (2, 0)], [(1, 2), (1, 4)]],
    "Z": [[(0, 0), (2, 0), (2, 1), (0, 3), (0, 4), (2, 4)]],
}


def letter_mask(ch: str, pitch: int = 2, flip_x: bool = False, flip_y: bool = False) -> np.ndarray:
    """One letter on the 3x5 node lattice -> (4*pitch+1, 2*pitch+1) mask."""
    strokes = LATIN_STROKES[ch.upper()]
    if flip_x:
        strokes = [[(2 - x, y) for x, y in pl] for pl in strokes]
    if flip_y:
        strokes = [[(x, 4 - y) for x, y in pl] for pl in strokes]
    return draw_strokes((4 * pitch + 1, 2 * pitch + 1), strokes, scale=pitch)


def word_mask(text: str, pitch: int = 2, gap: int = 2) -> np.ndarray:
    letters = [c for c in str(text).upper() if c in LATIN_STROKES]
    if not letters:
        return np.zeros((4 * pitch + 1, 1), bool)
    lw = 2 * pitch + 1
    W = len(letters) * lw + (len(letters) - 1) * gap
    m = np.zeros((4 * pitch + 1, W), bool)
    for i, c in enumerate(letters):
        x = i * (lw + gap)
        m[:, x:x + lw] |= letter_mask(c, pitch)
    return m


def spare_letters(text: str, max_n: int = 5, keep_vowels: bool = False) -> list[str]:
    """Austin Osman Spare reduction: uppercase, drop vowels, drop repeats (keep first)."""
    out = []
    for c in str(text).upper():
        if c in LATIN_STROKES and (keep_vowels or c not in "AEIOU") and c not in out:
            out.append(c)
    if not out:  # all vowels: keep them
        out = list(dict.fromkeys(c for c in str(text).upper() if c in LATIN_STROKES))
    return out[:max_n]


# ---- asemic glyph grammar ---------------------------------------------------------

def _segments_cross(a, b, c, d) -> bool:
    """Two unit diagonal segments forming an X (share no node, same unit square)."""
    if {a, b} & {c, d}:
        return False
    if abs(a[0] - b[0]) == 1 and abs(a[1] - b[1]) == 1 and abs(c[0] - d[0]) == 1 and abs(c[1] - d[1]) == 1:
        box1 = (min(a[0], b[0]), min(a[1], b[1]))
        box2 = (min(c[0], d[0]), min(c[1], d[1]))
        return box1 == box2
    return False


def _d4_images(pl_set, n):
    """All D4 images of a set of node-segments on an n x n node lattice (canonical form)."""
    imgs = []
    for t in range(8):
        def f(p, t=t):
            x, y = p
            if t & 1:
                x = n - 1 - x
            if t & 2:
                y = n - 1 - y
            if t & 4:
                x, y = y, x
            return (x, y)
        imgs.append(frozenset(frozenset((f(a), f(b))) for a, b in pl_set))
    return imgs


def asemic_glyph(rng, nodes: int = 3, kmin: int = 3, kmax: int = 5, radical=None, hang: bool = False,
                 tries: int = 400):
    """One glyph: a polyline through k distinct nodes of an ``nodes x nodes`` lattice, unit
    octilinear steps, <= 1 X-crossing, bbox spanning >= 2 nodes each way.
    ``radical``: optional starting node list reused across glyphs (language feel).
    ``hang``: glyph must touch the top node row and have no horizontal segment on it
    (so it can hang from a headline, Devanagari-style).
    Returns list of segments [((x0,y0),(x1,y1)), ...] in node coords, or None."""
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)]
    for _ in range(tries):
        k = int(rng.integers(kmin, kmax + 1))
        if radical:
            path = list(radical)
        else:
            path = [(int(rng.integers(0, nodes)), int(rng.integers(0, nodes)))]
        while len(path) < k:
            x, y = path[-1]
            opts = [(x + dx, y + dy) for dx, dy in dirs
                    if 0 <= x + dx < nodes and 0 <= y + dy < nodes and (x + dx, y + dy) not in path]
            if not opts:
                break
            # prefer continuing straight a bit (calligraphic flow)
            if len(path) >= 2 and rng.random() < 0.35:
                px, py = path[-2]
                st = (2 * x - px, 2 * y - py)
                if st in opts:
                    path.append(st)
                    continue
            path.append(opts[int(rng.integers(len(opts)))])
        if len(path) < kmin:
            continue
        segs = list(zip(path, path[1:]))
        crosses = sum(_segments_cross(*segs[i], *segs[j]) for i in range(len(segs)) for j in range(i + 1, len(segs)))
        if crosses > 1:
            continue
        xs = [p[0] for p in path]
        ys = [p[1] for p in path]
        if max(xs) - min(xs) < 1 or max(ys) - min(ys) < 1 or (max(xs) - min(xs) + max(ys) - min(ys)) < 3:
            continue
        if hang:
            if min(ys) != 0:
                continue
            if any(a[1] == 0 and b[1] == 0 for a, b in segs):
                continue
            if sum(1 for p in path if p[1] == 0) > 1:
                continue
        return segs
    return None


def glyph_mask(segs, nodes: int = 3, pitch: int = 2, dot=None) -> np.ndarray:
    s = (nodes - 1) * pitch + 1
    m = draw_strokes((s, s), [[a, b] for a, b in segs], scale=pitch)
    if dot is not None:
        m[dot[1] * pitch, dot[0] * pitch] = True
    return m


def _free_dot(segs, nodes, pitch, rng):
    """A node whose cell is Chebyshev >= 2 from every stroke cell (isolated diacritic dot)."""
    m = glyph_mask(segs, nodes, pitch)
    near = morph.dilate(m, 1, 8)
    cands = [(x, y) for x in range(nodes) for y in range(nodes) if not near[y * pitch, x * pitch]]
    if not cands:
        return None
    return cands[int(rng.integers(len(cands)))]


def asemic_alphabet(rng, n: int = 16, nodes: int = 3, n_radicals: int = 3, radical_p: float = 0.35,
                    dot_p: float = 0.2, hang: bool = False):
    """Alphabet of ``n`` glyphs distinct under D4. Returns list of dicts {segs, dot}."""
    radicals = []
    for _ in range(n_radicals):
        g = asemic_glyph(rng, nodes, 2, 2, hang=False)
        if g:
            radicals.append([g[0][0], g[0][1]])
    seen = set()
    out = []
    attempts = 0
    while len(out) < n and attempts < n * 60:
        attempts += 1
        rad = radicals[int(rng.integers(len(radicals)))] if radicals and rng.random() < radical_p else None
        segs = asemic_glyph(rng, nodes, 3, 5, radical=rad, hang=hang)
        if segs is None:
            continue
        canon = min(_d4_images(segs, nodes), key=lambda s: sorted(tuple(sorted(e)) for e in s))
        key = tuple(sorted(tuple(sorted(e)) for e in canon))
        if key in seen:
            continue
        seen.add(key)
        dot = _free_dot(segs, nodes, 2, rng) if (not hang and rng.random() < dot_p) else None
        out.append({"segs": segs, "dot": dot})
    return out


# ---- primitives for glyph stacks (all D1: symmetric about the vertical centre column) ----

def _canvas(w, h):
    return np.zeros((h, w), bool)


def prim_ring(r: int = 3, dot: bool = False) -> np.ndarray:
    m = pixel_ring(r)
    if dot:
        m[r, r] = True
    return m


def prim_horns(r: int = 3) -> np.ndarray:
    """Crescent opening upward (Mercury / Taurus horns): lower half of a ring."""
    m = pixel_ring(r)
    m[: r, :] = False
    m = m[r:, :]
    return m


def prim_aries(r: int = 2) -> np.ndarray:
    """Two small arcs curling outward from a centre stem (ram's horns), width 4r+1."""
    w = 4 * r + 1
    ring = pixel_ring(r)
    top = ring[: r + 1, :].copy()
    m = np.zeros((r + 1, w), bool)
    m[:, 0:2 * r + 1] |= top
    m[:, 2 * r:4 * r + 1] |= top
    return m


def prim_cross(arm: int = 3, double: bool = False) -> np.ndarray:
    """Equal-armed cross (2*arm+1 square); double: two bars 2 rows apart, the lower one shorter."""
    w = 2 * arm + 1
    m = _canvas(w, w)
    m[:, arm] = True
    if double:
        m[arm - 1, :] = True
        m[arm + 1, 1:w - 1] = True
    else:
        m[arm, :] = True
    return m


def prim_triangle(half: int = 3, up: bool = True, bar: bool = False) -> np.ndarray:
    """45-degree triangle outline (apex angle 90): elements fire/water (+bar = air/earth)."""
    h = half + 1
    w = 2 * half + 1
    m = _canvas(w, h)
    for y in range(h):
        m[y, half - y] = m[y, half + y] = True
    m[h - 1, :] = True
    if bar:
        yb = h // 2 + (0 if h % 2 else 0)
        m[yb, max(0, half - yb - 2):min(w, half + yb + 3)] = True
    if not up:
        m = m[::-1]
    return m


def prim_bar(half: int = 3) -> np.ndarray:
    m = _canvas(2 * half + 1, 1)
    m[0, :] = True
    return m


def prim_stem(n: int = 2) -> np.ndarray:
    return np.ones((n, 1), bool)


def prim_arrow(half: int = 2) -> np.ndarray:
    """Chevron pointing up with a short stem."""
    w = 2 * half + 1
    m = _canvas(w, half + 2)
    for i in range(half + 1):
        m[i, half - i] = m[i, half + i] = True
    m[:, half] = True
    return m


PRIMITIVES = {
    "ring": prim_ring, "horns": prim_horns, "aries": prim_aries, "cross": prim_cross,
    "triangle": prim_triangle, "bar": prim_bar, "arrow": prim_arrow, "stem": prim_stem,
}


def stack_vertical(parts: list[np.ndarray], gaps: list[int]) -> np.ndarray:
    """Stack centred parts top to bottom; gaps[i] between part i and i+1 (0 = touching, -1 = fuse
    one row, shared cells become junctions)."""
    W = max(p.shape[1] for p in parts)
    if W % 2 == 0:
        W += 1
    H = sum(p.shape[0] for p in parts) + sum(gaps)
    m = np.zeros((max(H, 1), W), bool)
    y = 0
    for i, p in enumerate(parts):
        x = (W - p.shape[1]) // 2
        h = p.shape[0]
        m[y:y + h, x:x + p.shape[1]] |= p
        y += h + (gaps[i] if i < len(gaps) else 0)
    return m


# ---- placement helpers -------------------------------------------------------------

def place(dst: np.ndarray, src: np.ndarray, cx: int, cy: int, mode: str = "or") -> np.ndarray:
    """Paste ``src`` centred at (cx, cy) (src centre = (w//2, h//2))."""
    out = dst
    h, w = src.shape
    x0, y0 = cx - w // 2, cy - h // 2
    H, W = dst.shape
    for yy, xx in np.argwhere(src):
        X, Y = x0 + xx, y0 + yy
        if 0 <= X < W and 0 <= Y < H:
            if mode == "clear":
                out[Y, X] = False
            else:
                out[Y, X] = True
    return out


# ---- CLI op ------------------------------------------------------------------------

@register_op("glyph")
def _glyph_op(mask, text: str = "", kind: str = "word", seed: int = 0, pitch: int = 2, mirror: bool = False,
              mode: str = "or"):
    """Stamp a glyph centred on the canvas/--region. kind=word: ``text`` in the octilinear 3x5
    stroke font; kind=monogram: Spare monogram of ``text`` (unique consonants overlaid);
    kind=asemic: an invented glyph from ``seed`` (or text_seed(text)). mirror=true ORs mirrorX.
    mode=or|replace|clear."""
    H, W = mask.shape
    if kind == "word":
        g = word_mask(text or "A", pitch)
    elif kind == "monogram":
        from .sigils import spare_monogram
        g = spare_monogram(text or "WILL", seed=seed)["mask"]
    elif kind == "asemic":
        rng = np.random.default_rng(seed or text_seed(text))
        segs = asemic_glyph(rng, 3)
        g = glyph_mask(segs, 3, pitch) if segs else np.zeros((1, 1), bool)
    else:
        raise ValueError("kind=word|monogram|asemic")
    if mirror:
        g = g | g[:, ::-1]
    canvas = np.zeros_like(mask)
    place(canvas, g, W // 2, H // 2)
    if mode == "replace":
        return canvas
    if mode == "clear":
        return mask & ~canvas
    return mask | canvas
