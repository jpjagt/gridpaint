"""Threads: kolam, sona, knots. Mirror-curve recipes (engine: gridlab.ops.mirror_curves).

Every recipe here is the same machine: a dot set, one state (crossing / wall / wall) per symmetric
orbit of midpoints, a search that merges loops until the drawing is a single thread, and one of the
three rasterisations (diagonal pitch 4, diagonal pitch 6 with pulli dots, rotated '+' weave).
Kolam and sona are living traditions: these generate *from the grammar* (dots and one continuous
line), they don't reproduce particular drawings.
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import masks, morph
from ..ops import mirror_curves as MC
from ..ops.stitch import text_seed, text_word
from . import Param, recipe, register_section

register_section(
    "threads", "Threads: kolam, sona, knots",
    "One engine for South-Indian sikku kolam, Chokwe sona/lusona, Lunda designs and Celtic interlace: "
    "a line circles every dot; crossings and walls per symmetric orbit are searched until it is one "
    "unbroken thread. Over/under is real: the over-strands are a separate raised layer.")


def _weights(crossing: float):
    rest = max(0.0, 1.0 - crossing)
    return (crossing, rest * 0.55, rest * 0.45)


def _plate(m: np.ndarray, n: int = 1) -> np.ndarray:
    return morph.fill_holes(morph.dilate(m, n, 4))


def _ids(n: int) -> list[int]:
    """Layer ids bottom -> top for an n-layer stack (top = 1)."""
    return list(range(n, 0, -1))


def _search_frames(dots, sym, seed, weights, style, border, margin, keep: int = 10, **kw):
    snaps = []
    curve = MC.search(dots, sym, seed, 1, weights, on_change=lambda c, n: snaps.append((c, n)), **kw)
    if not snaps or snaps[-1][1] != curve.count():
        snaps.append((curve.copy(), curve.count()))
    else:
        snaps[-1] = (curve.copy(), curve.count())
    idx = sorted(set(np.linspace(0, len(snaps) - 1, min(keep, len(snaps))).round().astype(int)))
    frames = [(f"{snaps[i][1]} loop{'s' if snaps[i][1] != 1 else ''}",
               MC.rasterize(snaps[i][0], style, border, margin)) for i in idx]
    return curve, frames


def dot_grid(curve: MC.MirrorCurve, ras: MC.Raster, kind: str = "grid") -> np.ndarray:
    """The pulli lattice under a raster: straight 1-cell lines between adjacent dots.
    kind=grid (all links) | spine (centre column + every row: a spine with ribs)."""
    from ..ops.draw import line_points

    g = np.zeros(ras.shape, bool)
    R, C = curve.shape
    cols = np.nonzero(curve.dots.any(0))[0]
    cc = (cols.min() + cols.max()) / 2
    for (r, c), (x, y) in ras.dot_px.items():
        g[y, x] = True
        for dr, dc in ((0, 1), (1, 0)):
            if kind == "spine" and dr == 1 and abs(c - cc) > 0.5:
                continue
            q = (r + dr, c + dc)
            if q in ras.dot_px:
                for px, py in line_points(x, y, *ras.dot_px[q]):
                    g[py, px] = True
    return g


# ---------------------------------------------------------------------------- P1 sikku kolam

@recipe("sikku_kolam", section="threads", title="Sikku kolam: the single thread",
        description="Pulli kolam: one unbroken line circling every dot (diamond 1-3-5-7-5-3-1 by default). "
                    "Pitch-6 diagonal raster with real pulli dots; base plate = the loop's own silhouette.",
        params={
            "shape": Param("diamond", choices=["diamond", "rect", "octagon", "circle", "cross"]),
            "dots": Param(7, 3, 11, 1, description="dots across"),
            "sym": Param("rot4", choices=["rot4", "d2", "rot2", "x", "none"]),
            "crossing": Param(0.55, 0.2, 0.9, 0.05, description="weight of crossings vs walls"),
            "pulli": Param("raised", choices=["raised", "void", "mid", "none"]),
            "base": Param("spine", choices=["spine", "grid", "shadow", "plate", "none"],
                          description="grid = the pulli lattice (dot-to-dot lines) the thread is drawn over; "
                                      "shadow = the thread dilated; plate = filled silhouette"),
        },
        tags=["kolam", "mirror-curve", "single-line"])
def sikku_kolam(seed: int, shape: str, dots: int, sym: str, crossing: float, pulli: str, base: str) -> Design:
    d = MC.dot_set(shape, dots)
    if sym in ("rot4",) and d.shape[0] != d.shape[1]:
        sym = "rot2"
    curve, frames = _search_frames(d, sym, seed, _weights(crossing), "B", "pointed", 0)
    ras = frames[-1][1]
    curve_m = ras.curve
    layers: dict[int, np.ndarray] = {}
    stack = []
    if base != "none":
        if base in ("grid", "spine"):
            p = dot_grid(curve, ras, base)
        else:
            p = _plate(curve_m) if base == "plate" else morph.dilate(curve_m, 1, 8)
        if pulli == "void":
            p &= ~ras.dots
        elif pulli == "raised":
            p |= ras.dots
        stack.append(p)
    mid = curve_m | (ras.dots if pulli == "mid" else False)
    stack.append(mid)
    if pulli == "raised":
        stack.append(ras.dots)
    for lid, m in zip(_ids(len(stack)), stack):
        layers[lid] = m
    des = Design.from_masks(layers)
    mid_id = _ids(len(stack))[1 if base != 'none' else 0]
    des.frames = [(lab, {mid_id: r.curve}) for lab, r in frames]
    des.notes = (f"Mirror curve on {int(d.sum())} dots ({shape}), {sym} orbits; sikku search from the all-crossing "
                 f"plait merges loops until one thread remains ({curve.summary()}). Raster B: pitch 6, pulli at "
                 f"Chebyshev 2 from the line.")
    return des


# ---------------------------------------------------------------------------- P2 kolam interlace

@recipe("kolam_interlace", section="threads", title="Kolam interlace: over and under",
        description="The single thread woven over and under itself in physical layers: strict alternation "
                    "(every strand goes over, under, over...). Lunda-plate base, curve, raised over-bridges.",
        params={
            "dots": Param(7, 3, 9, 1),
            "shape": Param("diamond", choices=["rect", "diamond", "octagon", "circle"]),
            "style": Param("C", choices=["C", "A"], description="A diagonal strands, C '+' woven bands"),
            "sym": Param("rot4", choices=["rot4", "rot2", "d2", "none"]),
            "crossing": Param(0.6, 0.3, 0.9, 0.05),
            "bridge": Param(1, 1, 2, 1, description="over-bridge half length"),
            "base": Param("none", choices=["none", "plate", "lunda"]),
        },
        tags=["kolam", "interlace", "over-under"])
def kolam_interlace(seed: int, dots: int, shape: str, style: str, sym: str, crossing: float, bridge: int,
                    base: str) -> Design:
    d = MC.dot_set(shape, dots)
    curve, frames = _search_frames(d, sym, seed, _weights(crossing), style, "pointed", 1)
    ras = MC.rasterize(curve, style, "pointed", 1, over_len=bridge)
    stack = []
    if base != "none":
        plate = _plate(ras.curve)
        if base == "lunda" and style == "A":
            lu = MC.lunda_lace(curve, "plate", margin=1)
            lu = MC.place(lu, *plate.shape)
            plate = plate & (lu | morph.dilate(ras.curve, 1, 8) & ~morph.erode(plate, 2, 4))
            plate = morph.keep_largest(plate, 8)
        stack.append(plate)
    stack += [ras.curve, ras.over]
    ids = _ids(len(stack))
    des = Design.from_masks(dict(zip(ids, stack)))
    des.frames = [(lab, {ids[-2]: r.curve}) for lab, r in frames]
    des.notes = (f"Single-loop mirror curve ({curve.summary()}), raster {style}. Over-strand at each crossing = "
                 "the '/' pair at horizontal midpoints and '\\' at vertical ones, which alternates along every "
                 "loop (verified). Over/under is rotation-symmetric only (a mirror swaps over and under).")
    return des


# ---------------------------------------------------------------------------- P3 lusona + lunda ground

def _lunda_curve(dots, sym, seed, weights, tries: int = 24):
    """Search single-thread curves until one whose Lunda design is mirror (or 180deg) symmetric."""
    best = None
    for t in range(tries):
        cv = MC.search(dots, sym, seed * 1000 + t, 1, weights)
        if cv.count() != 1:
            continue
        lu = MC.lunda_lace(cv, "blocks")
        sym_s = 2 if np.array_equal(lu, lu[:, ::-1]) else (1 if np.array_equal(lu, lu[::-1, ::-1]) else 0)
        one = morph.label(lu, 8)[1] == 1
        score = sym_s + (3 if one else 0)
        if best is None or score > best[0]:
            best = (score, cv)
        if score == 5:
            break
    if best is None:
        return MC.search(dots, "none", seed, 1, weights), 0
    return best[1], best[0] % 3


@recipe("lusona_lunda", section="threads", title="Lusona thread and its Lunda design",
        description="Chokwe sand-drawing logic: a plaited mat of dots made into one thread; walking the thread "
                    "and colouring its quarter-arcs by parity gives a Lunda design (Gerdes), drawn as a two-tone "
                    "piece: blocks plate below, the design's 1-cell skeleton raised on top.",
        params={
            "rows": Param(6, 3, 9, 1),
            "cols": Param(4, 3, 7, 1),
            "sym": Param("x", choices=["x", "d2", "rot2", "none"]),
            "crossing": Param(0.7, 0.3, 0.95, 0.05),
            "show": Param("lunda", choices=["lunda", "thread"],
                          description="lunda = blocks + lace glyph; thread = the lusona over the Lunda plate"),
        },
        tags=["lusona", "lunda", "mirror-curve"])
def lusona_lunda(seed: int, rows: int, cols: int, sym: str, crossing: float, show: str) -> Design:
    d = MC.dot_set("rect", rows, cols)
    curve, score = _lunda_curve(d, sym, seed, _weights(crossing))
    ras = MC.rasterize(curve, "A", "flat", 0)
    blocks = MC.lunda_lace(curve, "blocks")
    lace = MC.lunda_lace(curve, "lace")
    plate = MC.lunda_lace(curve, "plate")
    H, W = blocks.shape
    cur = MC.place(ras.curve, H, W)
    if show == "lunda":
        des = Design.from_masks({2: blocks, 1: lace})
    else:
        des = Design.from_masks({2: plate, 1: cur})
    des.frames = [("thread", {2: cur}), ("lunda blocks", {2: blocks}), ("lunda lace", {1: lace}),
                  ("plate", {2: plate})]
    des.notes = (f"{rows}x{cols} dots: the all-crossing plaited mat has gcd={MC.plaited_loops(rows, cols)} threads; "
                 f"walls are searched until one thread remains ({curve.summary()}), retrying until its Lunda "
                 f"design is {'mirror' if score == 2 else ('180-degree' if score == 1 else 'not')} symmetric.")
    return des


def _frame_knot(cur: np.ndarray, over: np.ndarray, gap: int = 1):
    """Trim to the knot, add a rounded frame at ``gap`` empty cells around its bbox, and join knot
    and frame with straight tabs from the knot's outermost cells nearest each axis."""
    from ..ops.composition import superellipse
    from ..model import mask_bbox

    x0, y0, x1, y1 = mask_bbox(cur)
    pad = gap + 1
    cur = np.pad(cur[y0:y1 + 1, x0:x1 + 1], pad)
    over = np.pad(over[y0:y1 + 1, x0:x1 + 1], pad)
    H, W = cur.shape
    sil = superellipse(H, W, 6.0, rx=W / 2 + 0.45, ry=H / 2 + 0.45)
    ring = masks.offset_outline(sil, 0, 1)
    out = cur | ring
    cx, cy = (W - 1) / 2, (H - 1) / 2
    ys, xs = np.nonzero(cur)
    for axis in (0, 1):
        for sgn in (-1, 1):
            if axis == 0:  # vertical tabs: extreme rows
                ext = ys.min() if sgn < 0 else ys.max()
                cand = xs[ys == ext]
                xb = cand[np.argmin(np.abs(cand - cx))]
                for xx in {int(xb), int(round(2 * cx - xb))}:
                    col = np.nonzero(ring[:, xx])[0]
                    yr = col.min() if sgn < 0 else col.max()
                    a, b = sorted((yr, ext))
                    out[a:b + 1, xx] = True
            else:
                ext = xs.min() if sgn < 0 else xs.max()
                cand = ys[xs == ext]
                yb = cand[np.argmin(np.abs(cand - cy))]
                for yy in {int(yb), int(round(2 * cy - yb))}:
                    row = np.nonzero(ring[yy])[0]
                    xr = row.min() if sgn < 0 else row.max()
                    a, b = sorted((xr, ext))
                    out[yy, a:b + 1] = True
    from ..ops.composition import connect

    out = connect(out, None, "auto", max_len=3)
    return out, over


# ---------------------------------------------------------------------------- Celtic knot panel

@recipe("celtic_panel", section="threads", title="Celtic knot panel",
        description="Interlace panel: rotated mirror-curve lattice (orthogonal woven bands, '+' crossings, "
                    "chamfered walls) fitted to a rounded panel, held in a frame by 4 axis tabs; true over/under "
                    "as a raised layer.",
        params={
            "width": Param(25, 13, 41, 2),
            "height": Param(33, 13, 49, 2),
            "style": Param("C", choices=["C", "A"]),
            "walls": Param(0.35, 0.0, 0.8, 0.05, description="wall probability in the interior"),
            "loops": Param(1, 1, 6, 1, description="target number of threads (mirror: the minimum reachable)"),
            "sym": Param("mirror", choices=["mirror", "rot2"],
                         description="mirror symmetry forbids a single thread (min ~3 loops); rot2 allows one"),
            "bridge": Param(1, 1, 2, 1),
            "frame": Param(True),
        },
        tags=["celtic", "interlace", "knot"])
def celtic_panel(seed: int, width: int, height: int, style: str, walls: float, loops: int, sym: str,
                 bridge: int, frame: bool) -> Design:
    W, H = width | 1, height | 1
    from ..ops.composition import superellipse

    sil = superellipse(H, W, 5.0, rx=W / 2 + 0.4, ry=H / 2 + 0.4)
    inner_sil = sil
    if style == "C":
        dots, (ox, oy) = MC.rotated_dots_for(H, W, inner_sil)
    else:
        dots, _, _ = MC.fit_dots(inner_sil, "A")
    w = (1 - walls, walls * 0.5, walls * 0.5)
    if sym == "mirror":
        lsym = "diag" if style == "C" else "d2"
    else:
        lsym = "rot2"
    curve = MC.search(dots, lsym, seed, loops, w)
    ras = MC.rasterize(curve, style, "pointed" if style == "C" else "flat", 0, over_len=bridge)
    cur = MC.place(ras.curve, H, W)
    over = MC.place(ras.over, H, W)
    if frame:
        cur, over = _frame_knot(cur, over)
    des = Design.from_masks({2: cur, 1: over})
    des.notes = (f"Celtic interlace = mirror curve ({curve.summary()}) on a {'rotated ' if style == 'C' else ''}"
                 f"lattice fitted to a rounded panel; over/under alternates along each thread.")
    return des


# ---------------------------------------------------------------------------- own idea: thread reliquary

@recipe("thread_reliquary", section="threads", title="Thread reliquary (kolam around a void cross)",
        description="Own idea: the dot set is a capsule with a cross of missing dots, so the single thread must "
                    "circle an empty cross (a meaningful void). A spine-and-bar runs under the thread and shows through the void, carrying a raised cross.",
        params={
            "rows": Param(9, 7, 13, 2),
            "cols": Param(5, 5, 9, 2),
            "style": Param("A", choices=["A", "B"]),
            "crossing": Param(0.6, 0.3, 0.9, 0.05),
            "arm": Param(1, 1, 2, 1, description="cross arm length (dots)"),
        },
        tags=["kolam", "cross", "reserved-void"])
def thread_reliquary(seed: int, rows: int, cols: int, style: str, crossing: float, arm: int) -> Design:
    d = MC.dot_set("capsule", rows, cols)
    cy, cx = rows // 2, cols // 2
    up = rows // 2 - 1
    hole = np.zeros_like(d)
    hole[cy - up + 1:cy + up, cx] = True
    hole[cy - 1, cx - arm:cx + arm + 1] = True
    d &= ~hole
    for t in range(12):
        curve = MC.search(d, "d2" if t < 6 else "x", seed * 100 + t, 1, _weights(crossing))
        if curve.count() == 1:
            break
    ras = MC.rasterize(curve, style, "pointed", 1)
    cur = ras.curve
    H, W = cur.shape
    # the cross lives where the hole dots would be
    p = 6 if style == "B" else 4
    cross = np.zeros_like(cur)
    (r0, c0) = min(ras.dot_px)  # any dot to recover the lattice offset
    x0 = ras.dot_px[(r0, c0)][0] - p * c0
    y0 = ras.dot_px[(r0, c0)][1] - p * r0
    for r, c in zip(*np.nonzero(hole)):
        cross[y0 + p * r, x0 + p * c] = True
    # join the hole dots into a cross of 1-cell strokes
    ys, xs = np.nonzero(cross)
    xc = x0 + p * cx
    cross[ys.min():ys.max() + 1, xc] = True
    yb = y0 + p * (cy - 1)
    cross[yb, x0 + p * (cx - arm):x0 + p * (cx + arm) + 1] = True
    # base: the same cross, extended to run under the whole thread (a spine + bar the thread rests on)
    sil = _plate(cur)
    ys, xs = np.nonzero(sil[:, xc])[0], None
    spine = np.zeros_like(cur)
    spine[ys.min():ys.max() + 1, xc] = True
    row = np.nonzero(sil[yb])[0]
    spine[yb, row.min():row.max() + 1] = True
    spine = morph.dilate(spine, 1, 4) & sil
    des = Design.from_masks({3: spine, 2: cur, 1: cross})
    des.notes = (f"Dots = capsule minus a cross; the sikku search must route one thread around the absent "
                 f"dots ({curve.summary()}). The void cross is reserved; a 1-cell cross rides on top.")
    return des


# ---------------------------------------------------------------------------- name kolam

@recipe("name_kolam", section="threads", title="Name kolam (a threshold for a name)",
        description="Own idea: the dot rows are spelled by the text (palindromised bits -> row widths) and the "
                    "seed comes from the text, so every name has exactly one single-thread kolam.",
        params={
            "text": Param("jeroen"),
            "rows": Param(7, 5, 11, 2),
            "style": Param("B", choices=["A", "B", "C"]),
            "pulli": Param(True),
        },
        tags=["kolam", "text", "talisman"])
def name_kolam(seed: int, text: str, rows: int, style: str, pulli: bool) -> Design:
    half = rows // 2 + 1
    bits = text_word(text, 2 * half)
    widths = []
    for i in range(half):
        v = 1 + 2 * (bits[2 * i] + 2 * bits[2 * i + 1])  # 1,3,5,7
        v = max(v, 1 + 2 * min(i, 3)) if i else max(v, 1)
        widths.append(v)
    widths = widths[:-1] + [max(widths[-1], max(widths))]
    counts = widths + widths[-2::-1]
    d = MC.dots_from_rows(counts)
    s = text_seed(text) + seed
    curve = MC.search(d, "d2", s, 1, _weights(0.55))
    if curve.count() != 1:
        curve = MC.search(d, "x", s, 1, _weights(0.55))
    ras = MC.rasterize(curve, style, "pointed", 0)
    stack = [dot_grid(curve, ras, "spine"), ras.curve]
    if pulli and style == "B":
        stack.append(ras.dots)
    des = Design.from_masks(dict(zip(_ids(len(stack)), stack)))
    des.notes = f"'{text}' -> row widths {counts} -> one thread ({curve.summary()})."
    return des
