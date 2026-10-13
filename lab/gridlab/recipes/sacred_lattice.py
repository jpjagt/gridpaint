"""Stitch & lattice: hitomezashi sigils, labyrinths, bitwise mandalas, tocapu friezes, ice-ray windows.

Exact, counted, octilinear systems (research-esoteric §3.2, 3.5, 3.9, 3.13). Engines live in
gridlab.ops.stitch (hitomezashi words, loops, xor fields) and gridlab.ops.labyrinth (level sequences).
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import labyrinth as LB
from ..ops import masks, morph
from ..ops import stitch as ST
from ..ops.draw import line_points
from . import Param, recipe, register_section

register_section(
    "sacred_lattice", "Stitch & lattice",
    "Counted, octilinear sacred systems on the doubled lattice: hitomezashi stitch sigils from a mantra or a "
    "cast hexagram, Cretan and oracle labyrinths from level sequences, XOR mandalas, tocapu friezes and "
    "ice-ray lattices. Exact order, no noise; the blob renderer supplies the softness.")


def _ids(n: int) -> list[int]:
    return list(range(n, 0, -1))


def _no_blocks(m: np.ndarray, sym: str = "d4") -> np.ndarray:
    """Break 2x2 solid blocks orbit-wise (D4 / D2 about the canvas centre)."""
    m = m.copy()
    H, W = m.shape
    for _ in range(H * W):
        b = m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]
        if not b.any():
            break
        y0, x0 = map(int, np.argwhere(b)[0])
        nc = morph.neighbour_count(m, 4)
        cells = [(x0 + i, y0 + j) for j in (0, 1) for i in (0, 1)]
        x, y = max(cells, key=lambda c: (nc[c[1], c[0]], abs(c[0] - (W - 1) / 2) + abs(c[1] - (H - 1) / 2)))
        orb = {(x, y), (W - 1 - x, y), (x, H - 1 - y), (W - 1 - x, H - 1 - y)}
        if sym == "d4" and H == W:
            orb |= {(b_, a) for a, b_ in orb}
        for a, b_ in orb:
            m[b_, a] = False
    return m


# ---------------------------------------------------------------------------- P4 hitomezashi mantra

@recipe("hitomezashi_mantra", section="sacred_lattice", title="Hitomezashi mantra",
        description="A mantra (or a name) folded into two palindromic bit-words; the stitches decide the sigil. "
                    "The stitched field inside a disc, with the closed loops at the centre raised as 'the answer'.",
        params={
            "text": Param("om mani padme hum"),
            "n": Param(15, 9, 21, 2, description="stitch lines per side (canvas 2n+1)"),
            "keep": Param("central", choices=["central", "enclosing", "closed"]),
            "rings": Param(2, 1, 4, 1, description="central loops raised (distinct distances)"),
            "field": Param("disc", choices=["disc", "square", "none"]),
        },
        tags=["hitomezashi", "text", "d4"])
def hitomezashi_mantra(seed: int, text: str, n: int, keep: str, rings: int, field: str) -> Design:
    n = n | 1
    a = ST.sym_word("text", n + 1, text + ("" if seed == 0 else f"#{seed}"))
    st = ST.hitomezashi(a, a)
    H = W = st.shape[0]
    top = ST.loop_islands(st, keep, n_central=rings)
    if not top.any():
        top = ST.loop_islands(st, "closed")
    if field == "none":
        des = Design.from_masks({1: top})
    else:
        r = (H - 1) / 2
        area = masks.circle(H, W, r + 0.5) if field == "disc" else np.ones((H, W), bool)
        ring = masks.offset_outline(area, 0, 1)
        fld = (st & area) | ring
        from ..ops.composition import connect

        fld = connect(morph.keep_largest(fld, 8) | top, area, "d4", max_len=2)
        des = Design.from_masks({2: fld, 1: top})
    des.notes = (f"'{text}' -> XOR-folded UTF-8 bits -> palindrome a = b = {''.join(map(str, a))} (D4). "
                 f"Line j stitched on segments k with (k + a[j]) even; every vertex an L-turn. Raised: {keep} loops.")
    return des


# ---------------------------------------------------------------------------- P5 hexagram oracle

TRIGRAMS = "☷☶☵☴☳☲☱☰"


def _hexagram_mask(bits, width: int = 7) -> np.ndarray:
    """6 lines bottom->top, pitch 2: yang = solid capsule, yin = 3 + gap + 3."""
    m = np.zeros((11, width), bool)
    for i, b in enumerate(bits):
        y = 10 - 2 * i
        m[y, :] = True
        if not b:
            m[y, width // 2] = False
    return m


@recipe("hitomezashi_hexagram", section="sacred_lattice", title="Hitomezashi hexagram oracle",
        description="Cast a hexagram (three coins, seeded); its 6 lines palindromised become the stitch words, "
                    "so each of the 64 hexagrams owns one loop-sigil. Loop above, hexagram bars below, on a capsule.",
        params={
            "cast": Param("seed", choices=["seed", "text"]),
            "text": Param("what is to come"),
            "loops": Param(1, 1, 3, 1, description="enclosing loops kept (more ring loops are added if small)"),
        },
        tags=["hitomezashi", "i-ching", "oracle"])
def hitomezashi_hexagram(seed: int, cast: str, text: str, loops: int) -> Design:
    bits = ST.hexagram_bits(text if cast == "text" else seed)
    w = bits + [1]
    a = ST.palindrome(w)  # 14 lines -> 13 segments, canvas 27
    st = ST.hitomezashi(a, a)
    lab, closed = ST.loops(st)
    from scipy import ndimage

    from ..ops.composition import connect

    objs = ndimage.find_objects(lab)
    c0 = (st.shape[0] - 1) // 2
    enc = []
    for i in closed:
        sl = objs[i - 1]
        w_ = sl[1].stop - sl[1].start
        if sl[0].start < c0 < sl[0].stop - 1 and sl[1].start < c0 < sl[1].stop - 1 and w_ <= 21:
            enc.append((w_, i))
    enc.sort()
    loop = np.isin(lab, [i for _, i in enc[-loops:]]) if enc else np.zeros_like(st)
    k = 1
    while (not loop.any() or np.ptp(np.nonzero(loop.any(0))[0]) < 10) and k <= 4:
        loop = loop | ST.loop_islands(st, "central", radius=9, n_central=k)
        k += 1
    loop = connect(loop, None, "d4", max_len=2)
    ys, xs = np.nonzero(loop)
    lp = loop[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    hx = _hexagram_mask(bits, 7)
    lw = max(lp.shape[1], 11)
    W = lw + 4
    W += 1 - W % 2
    gap = 2
    H = 2 + lp.shape[0] + gap + 2 + hx.shape[0] + 2 + 2
    H += 1 - H % 2
    cx = (W - 1) // 2
    m_loop = np.zeros((H, W), bool)
    y0 = 2
    m_loop[y0:y0 + lp.shape[0], cx - lp.shape[1] // 2:cx - lp.shape[1] // 2 + lp.shape[1]] = lp
    yh = y0 + lp.shape[0] + gap + 1
    hexm = np.zeros((H, W), bool)
    hexm[yh:yh + 11, cx - 3:cx + 4] = hx
    cart_area = np.zeros((H, W), bool)
    cart_area[yh - 2:yh + 13, cx - 5:cx + 6] = True
    cart = masks.offset_outline(cart_area, 0, 1)
    cart[yh - 2, cx - 5] = cart[yh - 2, cx + 5] = cart[yh + 12, cx - 5] = cart[yh + 12, cx + 5] = False
    stem = np.zeros((H, W), bool)
    lys = np.nonzero(m_loop[:, cx])[0]
    if lys.size:
        stem[lys.max():yh - 1, cx] = True
    mid = m_loop | cart | stem
    from ..ops.composition import connect

    mid = connect(mid, None, "x", max_len=3)
    plate = morph.dilate(m_loop | stem, 1, 8) | morph.dilate(cart_area, 1, 8)
    des = Design.from_masks({3: plate, 2: mid, 1: hexm})
    num = int("".join(map(str, bits[::-1])), 2)
    des.notes = (f"Hexagram lines (bottom->top) {''.join(map(str, bits))} (lower {TRIGRAMS[int(''.join(map(str, bits[2::-1])), 2)]}"
                 f", upper {TRIGRAMS[int(''.join(map(str, bits[:2:-1])), 2)]}, binary {num}); stitch words "
                 f"a = b = {''.join(map(str, a))}; the central loop is this hexagram's sigil.")
    return des


# ---------------------------------------------------------------------------- labyrinths

def _labyrinth_design(seq, style, goal, show, chamfer_c=None, plate_on=False):
    L = LB.labyrinth(seq, style, goal, "bottom", chamfer_c=chamfer_c)
    walls, path, disc = L["walls"], L["path"], L["disc"]
    c = L["centre"][0]
    S = L["size"]
    centre = np.zeros((S, S), bool)
    centre[c, c] = True
    goal_motif = morph.dilate(centre, 1, 4) if goal >= 2 else centre
    plate = morph.fill_holes(disc | morph.dilate(walls, 1, 4))
    if show == "walls":
        layers = {2: walls, 1: L["axis"]}
    else:
        thread = path & ~L["goal"] | goal_motif
        thread = morph.keep_largest(thread | morph.dilate(centre, 1, 4), 8)
        layers = {2: thread, 1: goal_motif}
    if plate_on:
        layers[3] = plate
    des = Design.from_masks(layers)
    return des, L


@recipe("cretan_labyrinth", section="sacred_lattice", title="Cretan labyrinth",
        description="The classical 7-circuit labyrinth from its level sequence 0 3 2 1 4 7 6 5 8, walls one "
                    "connected piece hanging off the turning spine. show=path raises the walk itself as the thread.",
        params={
            "style": Param("octagon", choices=["octagon", "square"]),
            "show": Param("path", choices=["path", "walls"]),
            "goal": Param(3, 2, 4, 1),
            "plate": Param(False, description="add a solid back plate"),
        },
        tags=["labyrinth", "cretan", "d1"])
def cretan_labyrinth(seed: int, style: str, show: str, goal: int, plate: bool) -> Design:
    des, L = _labyrinth_design(LB.CRETAN, style, goal, show, plate_on=plate)
    des.notes = ("Level sequence 0 3 2 1 4 7 6 5 8: left U-turns [0,3],[1,2],[4,7],[5,6], right [2,3],[1,4],[6,7],[5,8]; "
                 "nested arcs sit further from the axis. Pitch 2 (1-cell path, 1-cell wall).")
    return des


@recipe("labyrinth_oracle", section="sacred_lattice", title="Labyrinth oracle",
        description="Every seed (or text) chooses a different *valid* one-axis labyrinth: level sequences enumerated "
                    "by DFS with the nested-or-disjoint rule on each side of the axis. Pure architecture.",
        params={
            "circuits": Param(7, 3, 9, 2),
            "text": Param("", description="optional: a name/date chooses the walk instead of the seed"),
            "style": Param("square", choices=["square", "octagon"]),
            "show": Param("walls", choices=["walls", "path"]),
            "plate": Param(False, description="add a solid back plate"),
        },
        tags=["labyrinth", "oracle", "d1"])
def labyrinth_oracle(seed: int, circuits: int, text: str, style: str, show: str, plate: bool) -> Design:
    n = circuits | 1
    s = ST.text_seed(text) if text else seed
    seqs = [q for q in LB.valid_sequences(n) if q != list(range(n + 2))]
    seq = seqs[s % len(seqs)]
    goal = 2 if style == "square" else 3
    des, L = _labyrinth_design(seq, style, goal, show, plate_on=plate)
    des.notes = (f"{n} circuits, level sequence {' '.join(map(str, seq))} (one of {len(seqs)} valid non-trivial walks). "
                 "Transitions alternate left/right of the bottom axis; U-turns on one side nest.")
    return des


# ---------------------------------------------------------------------------- P23 XOR mandala

XOR_CURATED = [("and_zero", 1, 0), ("popcount", 1, 2), ("xor_mod", 3, 0), ("sum_xor_diff", 6, 0),
               ("xor_mod", 5, 1), ("or_mod", 6, 1), ("xor_mod", 7, 0), ("xor_mod", 4, 1),
               ("popcount", 1, 1), ("sum_xor_diff", 4, 0), ("xor_mod", 6, 2), ("xor_square", 7, 0)]


@recipe("xor_mandala", section="sacred_lattice", title="XOR mandala",
        description="Munching-squares arithmetic as a mandala: a bitwise formula at x=|dx|, y=|dy| is D4 for free "
                    "(Sierpinski cross, popcount lattices, xor moire). formula=seeded draws from a curated dozen.",
        params={
            "formula": Param("seeded", choices=["seeded"] + list(ST.XOR_FORMULAS)),
            "k": Param(7, 2, 13, 1),
            "r": Param(0, 0, 12, 1),
            "size": Param(33, 21, 45, 2),
            "core": Param(5, 0, 9, 1, description="radius of the calm core (0 = none)"),
            "base": Param("core", choices=["core", "shadow", "plate", "none"],
                          description="core = a small disc carrying the centre motif only"),
        },
        tags=["bitwise", "mandala", "d4"])
def xor_mandala(seed: int, formula: str, k: int, r: int, size: int, core: int, base: str) -> Design:
    if formula == "seeded":
        formula, k, r = XOR_CURATED[seed % len(XOR_CURATED)]
    S = size | 1
    c = (S - 1) // 2
    yy, xx = np.mgrid[0:S, 0:S]
    d = np.hypot(xx - c, yy - c)
    R_out = c - 1
    f = ST.xor_field(S, S, formula, k, r)
    area = (d <= R_out + 0.5) & (d >= (core + 2.5 if core else 0))
    m = _no_blocks(f & area, "d4")
    rim = np.rint(d) == R_out + 1
    from ..ops.composition import connect

    mid = connect(m | rim, area | rim, "d4", max_len=2)
    mid = morph.remove_small(mid, 4, 8)
    top = np.zeros((S, S), bool)
    if core:
        top = np.rint(d) == core
        top[c, c] = True
        if core >= 4:
            top |= ((xx == c) | (yy == c)) & (d <= core - 2) & (d >= 2)
    layers = {2: mid, 1: top} if core else {1: mid}
    if base != "none":
        if base == "core":
            pl = d <= core + 0.5
        elif base == "plate":
            pl = d <= R_out + 1.5
        else:
            pl = (morph.dilate(mid, 1, 4) | (d <= core + 1.5)) & (d <= R_out + 1.5)
        layers[max(layers) + 1] = pl
    des = Design.from_masks(layers)
    des.notes = (f"on = {formula}(x=|dx|, y=|dy|), k={k}, r={r}; disc r<={R_out} minus a calm core r={core}; "
                 "2x2 blocks broken orbit-wise, pieces joined by short D4 bridges.")
    return des


# ---------------------------------------------------------------------------- P27 tocapu bracelet

_TILES = {
    "fret": ["####", "#...", "#.##", "#..#"],
    "diag": ["#...", ".#..", "..#.", "...#"],
    "checker": ["#.#.", ".#.#", "#.#.", ".#.#"],
    "square": ["####", "#..#", "#..#", "####"],
    "cross": [".#..", "####", ".#..", ".#.."],
    "stair": ["#...", "##..", ".##.", "..##"],
    "dot": ["....", "....", "..#.", "...."],
    "hook": ["###.", "..#.", "#.#.", "###."],
    "void": ["....", "....", "....", "...."],
}


def _tile(name):
    return np.array([[ch == "#" for ch in row] for row in _TILES[name]], bool)


def _tocapu_unit(rng, u: int = 13):
    q = (u - 5) // 2  # quadrant size (4 for u=13), 1-cell breathing gap inside the frame
    unit = np.zeros((u, u), bool)
    unit[0, :] = unit[-1, :] = unit[:, 0] = unit[:, -1] = True
    names = [n for n in _TILES if n != "void"]
    a = names[int(rng.integers(len(names)))]
    b = [n for n in _TILES if n != a][int(rng.integers(len(_TILES) - 1))]
    rule = ["c4", "d2", "c2"][int(rng.integers(3))]
    A = _tile(a)[:q, :q]
    B = _tile(b)[:q, :q]
    if rule == "c4":
        quads = [A, np.rot90(A, -1), np.rot90(A, 2), np.rot90(A, 1)]  # TL, TR, BR, BL
    elif rule == "d2":
        quads = [A, A[:, ::-1], A[::-1, ::-1], A[::-1, :]]
    elif rule == "c2":
        quads = [A, B[:, ::-1], np.rot90(A, 2), np.rot90(B[:, ::-1], 2)]
    o1, o2 = 2, u - 2 - q
    unit[o1:o1 + q, o1:o1 + q] |= quads[0]
    unit[o1:o1 + q, o2:o2 + q] |= quads[1]
    unit[o2:o2 + q, o2:o2 + q] |= quads[2]
    unit[o2:o2 + q, o1:o1 + q] |= quads[3]
    c = u // 2
    centre = rng.integers(3)
    if centre == 0:
        unit[c, c] = True
    elif centre == 1:
        unit[c, c - 1:c + 2] = True
        unit[c - 1:c + 2, c] = True
    return unit, f"{a}/{rule}" + ("" if rule not in ("c2",) else f"+{b}")


def _separator(h: int = 13) -> np.ndarray:
    rows = ["###", "..#", "#.#", "#..", "###", "...", ".#.", "...", "###", "..#", "#.#", "#..", "###"]
    return np.array([[ch == "#" for ch in r] for r in rows[:h]], bool)


@recipe("tocapu_bracelet", section="sacred_lattice", title="Tocapu thunder bracelet",
        description="A frieze of Andean tocapu units (13x13, quadrant grammar: C4 / D2 / C2 / C2-inverted over "
                    "step-fret, stair, checker, cross... primitives; no two units alike) separated by step-fret "
                    "thunder columns. Mirrored about its centre (p2mm feel).",
        params={
            "units": Param(5, 2, 7, 1, description="number of units (odd = a centre unit)"),
            "mirror": Param(True, description="mirror the band about its centre"),
            "top": Param("motifs", choices=["motifs", "frames"], description="what is raised on top"),
        },
        tags=["tocapu", "frieze", "bracelet"])
def tocapu_bracelet(seed: int, units: int, mirror: bool, top: str) -> Design:
    rng = np.random.default_rng(seed)
    u = 13
    made, keys = [], []
    tries = 0
    n_make = (units + 1) // 2 if mirror else units
    while len(made) < n_make and tries < 200:
        tries += 1
        unit, key = _tocapu_unit(rng, u)
        if any(np.array_equal(unit, m) for m in made):
            continue
        made.append(unit)
        keys.append(key)
    seq = made + ([m[:, ::-1] for m in made[:units // 2][::-1]] if mirror else [])
    sep = _separator(u)
    W = u * len(seq) + 3 * (len(seq) - 1) + 2 * 3
    H = u + 2
    frames = np.zeros((H, W), bool)
    motifs = np.zeros((H, W), bool)
    x = 3
    frame_t = np.zeros((u, u), bool)
    frame_t[0, :] = frame_t[-1, :] = frame_t[:, 0] = frame_t[:, -1] = True
    for i, m in enumerate(seq):
        frames[1:1 + u, x:x + u] |= frame_t
        motifs[1:1 + u, x:x + u] |= m & ~frame_t
        x += u
        if i < len(seq) - 1:
            s = sep if i % 2 == 0 else sep[::-1]
            frames[1:1 + u, x:x + 3] |= s
            x += 3
    # rounded end caps: half-ring step frets
    from ..ops.composition import superellipse

    plate = superellipse(H, W, 6.0, rx=W / 2 + 0.4, ry=H / 2 + 0.4)
    ends = np.zeros((H, W), bool)
    ends[1:1 + u, 1] = ends[1:1 + u, W - 2] = True
    ends[1, 1:3] = ends[u, 1:3] = ends[1, W - 3:W - 1] = ends[u, W - 3:W - 1] = True
    frames |= ends
    if top == "frames":
        des = Design.from_masks({3: plate, 2: motifs | frames, 1: frames})
    else:
        des = Design.from_masks({3: plate, 2: frames, 1: motifs})
    des.notes = "units: " + ", ".join(keys) + ". Separators: step-fret thunder columns, alternating handedness."
    return des


# ---------------------------------------------------------------------------- P31 ice-ray shrine window

def _ice_ray(region: np.ndarray, rng, amin: int, max_cuts: int, frames: list | None = None):
    """Stiny ice-ray on cells: repeatedly cut the largest region by an octilinear line through one of its
    cells; accept if both parts are connected and >= amin. Returns the cut-line mask."""
    lines = np.zeros_like(region)
    regions = [region.copy()]
    H, W = region.shape
    dirs = [(1, 0), (0, 1), (1, 1), (1, -1)]
    cuts = 0
    fails = 0
    while cuts < max_cuts and fails < 300 and regions:
        regions.sort(key=lambda r: -int(r.sum()))
        R = regions[0]
        if R.sum() < 2 * amin + 4:
            break
        ys, xs = np.nonzero(R)
        i = int(rng.integers(len(ys)))
        x0, y0 = int(xs[i]), int(ys[i])
        dx, dy = dirs[int(rng.integers(4))]
        cut = np.zeros_like(R)
        for sgn in (1, -1):
            x, y = x0, y0
            while 0 <= x < W and 0 <= y < H and R[y, x]:
                cut[y, x] = True
                x += sgn * dx
                y += sgn * dy
        rest = R & ~cut
        lab, n = morph.label(rest, 4)
        if n != 2:
            fails += 1
            continue
        parts = [lab == k for k in (1, 2)]
        if min(int(p.sum()) for p in parts) < amin:
            fails += 1
            continue
        # avoid slivers: each part must contain a 3x3 block
        if any(not morph.erode(p, 1, 8).any() for p in parts):
            fails += 1
            continue
        regions = regions[1:] + parts
        lines |= cut
        cuts += 1
        if frames is not None:
            frames.append(lines.copy())
    return lines


@recipe("ice_ray_window", section="sacred_lattice", title="Ice-ray shrine window",
        description="Chinese cracked-ice lattice (Stiny's ice-ray grammar, octilinear cuts) in a pointed shrine "
                    "niche, mirrored; a moon gate (pixel circle) is left whole at the centre as a calm focus.",
        params={
            "width": Param(21, 15, 31, 2),
            "height": Param(31, 21, 45, 2),
            "cuts": Param(12, 3, 24, 1, description="cuts on the half"),
            "amin": Param(8, 4, 30, 1, description="minimum facet area (cells)"),
            "moon": Param(5, 0, 7, 1, description="moon ring radius (0 = none)"),
        },
        tags=["ice-ray", "lattice", "window", "d1"])
def ice_ray_window(seed: int, width: int, height: int, cuts: int, amin: int, moon: int) -> Design:
    rng = np.random.default_rng(seed)
    W, H = width | 1, height | 1
    cx = (W - 1) // 2
    yy, xx = np.mgrid[0:H, 0:W]
    # pointed arch: rectangle with a 45-degree gable on top
    sil = (yy >= np.abs(xx - cx)) & (yy <= H - 1)
    cy = (H - 1 + cx) // 2 + 1
    d = np.hypot(xx - cx, yy - cy)
    frame = masks.offset_outline(sil, 0, 1)
    moon_ring = (np.rint(d) == moon) if moon else np.zeros_like(sil)
    reserve = (d <= moon + 1.5) if moon else np.zeros_like(sil)
    inner = sil & ~frame & ~reserve
    half = inner & (xx < cx)
    snaps: list = []
    lines = _ice_ray(half, rng, amin, cuts, snaps)
    lines_full = lines | lines[:, ::-1]
    axis = inner & (xx == cx)
    mid = frame | lines_full | axis | moon_ring
    mid = morph.keep_largest(mid, 8) | moon_ring
    moon_band = ((d <= moon + 1.5) & (d >= moon - 1.5)) if moon else np.zeros_like(sil)
    base = (morph.dilate(frame, 1, 4) & sil) | moon_band | (morph.dilate(axis, 1, 4) & sil & ~(d < moon - 1.5))
    base = morph.keep_largest(base, 8)
    des = Design.from_masks({3: base, 2: mid, 1: moon_ring if moon else axis})
    des.frames = [(f"cut {i + 1}", {2: frame | s | s[:, ::-1] | axis | moon_ring})
                  for i, s in enumerate(snaps)]
    des.notes = (f"Ice-ray: {len(snaps)} octilinear cuts on the left half (each splits one facet into two connected "
                 f"facets >= {amin} cells), mirrored; moon ring r={moon} reserved with a 1-cell moat.")
    return des


# ---------------------------------------------------------------------------- own idea: nested stitch relic

@recipe("hitomezashi_nest", section="sacred_lattice", title="Hitomezashi nest (stacked loops)",
        description="Own idea: hitomezashi words that make concentric closed loops (Thue-Morse, Fibonacci, pi, text); "
                    "all closed loops, grouped by distance from the centre, are dealt to the physical layers so the "
                    "innermost loops stand highest on a bridged bed of all loops.",
        params={
            "word": Param("thue-morse", choices=["thue-morse", "fibonacci", "prime", "pi", "text"]),
            "text": Param("lux"),
            "n": Param(17, 9, 23, 2),
            "offset": Param(0, 0, 8, 1, description="shift into the word (different sigil)"),
            "layers": Param(3, 2, 4, 1),
        },
        tags=["hitomezashi", "nested", "d4"])
def hitomezashi_nest(seed: int, word: str, text: str, n: int, offset: int, layers: int) -> Design:
    n = n | 1
    off = offset + (seed % 7 if seed else 0)
    a = ST.sym_word(word, n + 1, text, seed, offset=off)
    st = ST.hitomezashi(a, a)
    lab, closed = ST.loops(st)
    H, W = st.shape
    c = (H - 1) / 2
    from scipy import ndimage

    from ..ops.composition import connect

    objs = ndimage.find_objects(lab)
    dist = {}
    for i in closed:
        sl = objs[i - 1]
        by = (sl[0].start + sl[0].stop - 1) / 2
        bx = (sl[1].start + sl[1].stop - 1) / 2
        dist[i] = round(float(np.hypot(by - c, bx - c)), 2)
    levels = sorted(set(dist.values()))
    out = {}
    if not levels:
        out[1] = st
    else:
        nl = min(layers, len(levels))
        bins = np.array_split(np.arange(len(levels)), nl)
        acc = np.zeros((H, W), bool)
        for li, bn in enumerate(bins):  # innermost bin -> layer 1 (top)
            lv = {levels[j] for j in bn}
            m = np.isin(lab, [i for i, dd in dist.items() if dd in lv])
            acc |= m
            out[li + 1] = m
        # the bottom layer carries every loop joined into one piece (the others rest on it)
        out[nl] = connect(acc, None, "d4", max_len=2)
    enc = levels
    des = Design.from_masks(out)
    des.notes = (f"word {word} (offset {off}) -> a = b = {''.join(map(str, a))}; {len(enc)} distance rings of closed "
                 f"loops dealt to layers (innermost on top); the bottom layer joins all loops by 1-cell bridges.")
    return des
