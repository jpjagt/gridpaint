"""Sacred geometry: bagua + taijitu, pixel yantra, fire corona, Monas glyph stacks and the kamea
'magic walk' rose (research-esoteric §3.6, §3.8, §3.12, §3.13; presets P14, P18, P24, P29).

All exact on the grid: pixel circles from (|dx|, |dy|), octilinear triangle edges, D4 folding.
"""

from __future__ import annotations

import math

import numpy as np

from ..ops import composition as C
from ..ops import glyphs as G
from ..ops import masks as M
from ..ops import morph
from ..ops import sigils as S
from . import Param, recipe, register_section
from .sigils import _design, ellipse_outline, lace_in, mandorla, outline

register_section(
    "sacred_geometry", "Sacred geometry",
    "Diagrams that are already exact on graph paper: the eight trigrams around the taijitu, yantra gates and "
    "45-degree triangles, a demoscene flame nimbus, alchemical glyph stacks, and the magic squares' own paths.")


def _centred(h, w):
    y, x = np.mgrid[0:h, 0:w]
    return x - (w - 1) // 2, y - (h - 1) // 2


# ---- P14 Bagua ring around the Taijitu ----------------------------------------------------

@recipe(
    "bagua_taijitu", section="sacred_geometry", title="Bagua ring around the taijitu",
    description="The eight trigrams in Fu Xi (Earlier Heaven) order - complements facing each other, so the ring "
                "is anti-symmetric under a half turn - each on its own plate spoked to a circle around a yin-yang "
                "that is literally two layers. Lace only in the outermost band.",
    params={
        "size": Param(41, 33, 49, 2),
        "lace": Param(True, description="lace band on the outer rim of the plate"),
        "density": Param(0.4, 0.25, 0.55, 0.05),
        "turn": Param(0, 0, 7, 1, description="rotate the trigram order by n eighths"),
    },
    tags=["iching", "bagua", "taijitu", "c2"],
)
def bagua_taijitu(seed, size, lace, density, turn):
    rng = np.random.default_rng(seed)
    H = W = size
    c = (size - 1) // 2
    R_out = c
    r_ring = round(size * 0.22)          # inner circle
    r_tai = r_ring - 2
    R_tri = round(size * 0.36)           # trigram middle line radius
    ring = G.ring_mask(H, W, r_ring)
    disc, yin, yang = S.taijitu(H, W, r_tai, eye=1.0)
    bars = np.zeros((H, W), bool)
    plates = np.zeros((H, W), bool)
    spokes = np.zeros((H, W), bool)
    order = S.FUXI_RING[turn:] + S.FUXI_RING[:turn]
    dirs = [d for _, d in S.FUXI_RING]
    for (name, _), d in zip(order, dirs):
        tm, (tx, ty) = S.trigram_mask(S.TRIGRAMS[name], d)
        if d[0] and d[1]:
            k = round(R_tri / math.sqrt(2))
            px, py = c + d[0] * k, c + d[1] * k
        else:
            px, py = c + d[0] * R_tri, c + d[1] * R_tri
        one = np.zeros((H, W), bool)
        G.place(one, tm, px, py)
        bars |= one
        plate = morph.dilate(morph.close(one, 1, 8) | one, 1, 8)
        plates |= plate
        # spoke from the ring to the plate along the direction
        for t in range(r_ring, R_tri + 6):
            x, y = c + d[0] * t, c + d[1] * t
            if plate[y, x]:
                break
            spokes[y, x] = True
    mid = ring | plates | spokes | yin
    top = bars | (yang & ~morph.dilate(~disc, 0) & S.taijitu(H, W, r_tai, eye=1.0)[2] & _eye(H, W, r_tai, c))
    plate_r = R_out
    base_disc = G.disc_mask(H, W, plate_r)
    if lace:
        band = base_disc & ~G.disc_mask(H, W, plate_r - 3)
        inner = G.disc_mask(H, W, plate_r - 3)
        ln = lace_in(band, rng, "d4", density, anchor=outline(inner))
        base = inner | ln
    else:
        base = base_disc
    notes = ("Fu Xi order (S=Qian at top, complements opposite); orthogonal trigrams as 7-cell capsules (yin split), "
             "diagonal ones as diagonal bands; lines read from the centre out. Taijitu: BASE disc vs MID yin half; "
             "yang eye raised on TOP.")
    return _design({3: base, 2: mid, 1: top}, notes)


def _eye(H, W, r_tai, c):
    """The yang eye (dot in the yin half)."""
    y, x = np.mgrid[0:H, 0:W]
    return np.hypot(x - c, y - (c - r_tai / 2)) <= 1.3


# ---- P18 Pixel Yantra ------------------------------------------------------------------------

def _bhupura(H, W, R, w, g, lines=3):
    dx, dy = _centred(H, W)
    ax, ay = np.abs(dx), np.abs(dy)
    S0 = (np.maximum(ax, ay) <= R) | ((ax <= w) & (ay <= R + g)) | ((ay <= w) & (ax <= R + g))
    out = np.zeros((H, W), bool)
    cur = S0
    for t in range(lines):
        out |= outline(cur)
        cur = morph.erode(np.pad(cur, 2), 2, conn=8)[2:-2, 2:-2]
    return S0, out, cur


def _triangle(H, W, apex, base, slope, cx=None):
    """45-degree (slope 1) or steeper (slope 2) isosceles triangle outline; apex row ``apex``,
    base row ``base`` (apex < base: points up)."""
    m = np.zeros((H, W), bool)
    cx = (W - 1) // 2 if cx is None else cx
    cy = (H - 1) // 2
    a, b = apex + cy, base + cy
    step = 1 if b > a else -1
    prev = None
    for y in range(a, b + step, step):
        hw = abs(y - a) // slope
        for x in (cx - hw, cx + hw):
            if 0 <= y < H and 0 <= x < W:
                m[y, x] = True
    hw = abs(b - a) // slope
    if 0 <= b < H:
        m[b, max(0, cx - hw):min(W, cx + hw + 1)] = True
    return m


@recipe(
    "pixel_yantra", section="sacred_geometry", title="Pixel yantra",
    description="Bhupura (three nested square lines with T-gates), a circle, an 8- or 16-petal lotus and "
                "interlocked triangles around a bindu: a meditation diagram on graph paper. Triangle edges are "
                "octilinear (or knight-step), so the Sri-Yantra concurrency problem is exact for free.",
    params={
        "size": Param(45, 35, 55, 2),
        "petals": Param(8, choices=[8, 16]),
        "petal_style": Param("outline", choices=["outline", "filled"]),
        "slope": Param(2, 1, 2, 1, description="triangle edge slope: 1 = 45 degrees, 2 = steep knight steps"),
        "triangles": Param(2, 2, 9, 1, description="number of interlocked triangles (2 = shatkona; more = denser)"),
    },
    tags=["yantra", "mandala", "d2"],
)
def pixel_yantra(seed, size, petals, petal_style, slope, triangles):
    rng = np.random.default_rng(seed)
    H = W = size
    c = (size - 1) // 2
    R = c - 3
    S0, bh, inner_sq = _bhupura(H, W, R, w=max(3, size // 12), g=2)
    dx, dy = _centred(H, W)
    rr = np.hypot(dx, dy)
    r_circle = R - 5
    circ = G.ring_mask(H, W, r_circle)
    # lotus (D4-exact: angle folded from |dx|, |dy|)
    r1, r2 = max(5, r_circle - 4), r_circle - 1
    th = np.arctan2(np.abs(dy), np.abs(dx))
    n = petals
    step = 2 * math.pi / n
    off = step / 2 if seed % 2 else 0.0
    phi = np.abs(((th - off) + step / 2) % step - step / 2)
    t = np.clip((rr - r1) / max(1e-9, r2 - r1), 0, 1)
    alpha = (step / 2) * 0.95 * np.sin(math.pi * t) ** 0.7
    pet = (rr >= r1) & (rr <= r2 + 0.3) & (phi <= alpha + 0.02)
    lotus = pet if petal_style == "filled" else outline(pet)
    if petal_style == "filled":
        from ..ops import lace as L
        lotus = L.lace_clean(lotus, 1, "d4")
    # triangles inscribed in r = r1 - 1, shrinking and shifted alternately (Sri-Yantra-like interlock)
    rt = r1 - 1
    tri = np.zeros((H, W), bool)
    levels = []
    k = triangles
    sl = slope
    for i in range(k):
        up = (i % 2 == 0)
        rho = rt * (1 - 0.22 * (i // 2))
        a2 = 1 / sl ** 2 + 1
        b2 = 2 * rho / sl ** 2
        c2 = rho ** 2 / sl ** 2 - rho ** 2
        bb = (-b2 + math.sqrt(b2 * b2 - 4 * a2 * c2)) / (2 * a2)
        shift = (i // 2) * (1 if (i // 2) % 2 else -1) * 2
        apex, base = int(round(-rho)) + shift, int(round(bb)) + shift
        apex -= apex % 2
        base -= base % 2
        if not up:
            apex, base = -apex, -base
        levels.append((apex, base))
        tri |= _triangle(H, W, apex, base, sl)
    from ..ops import lace as L
    tri = L.lace_clean(tri, 2, "x", keep=None)
    bindu = np.zeros((H, W), bool)
    bindu[c, c] = True
    inner_tri = _triangle(H, W, levels[-1][0], levels[-1][1], slope) if levels else bindu
    crown = bindu | (np.zeros_like(bindu))
    mid = bh | circ | lotus
    base = S0.copy()
    top = tri & ~morph.dilate(bindu, 1, 8) | bindu
    notes = (f"bhupura (3 lines, T-gates) around circle r={r_circle}, {petals}-petal lotus r {r1}..{r2} "
             f"({petal_style}), {k} triangles slope {slope} levels {levels}, bindu.")
    return _design({4: base, 3: mid, 2: top, 1: crown}, notes)


# ---- P24 Pentecost Corona ------------------------------------------------------------------------

def _hash01(a, b, seed):
    v = (a * 73856093) ^ (b * 19349663) ^ (seed * 83492791)
    v = (v ^ (v >> 13)) * 1274126177
    return ((v ^ (v >> 16)) & 0xFFFF) / 65535.0


@recipe(
    "pentecost_corona", section="sacred_geometry", title="Pentecost corona",
    description="A demoscene fire effect turned icon nimbus: heat flows outward ring by ring from a source "
                "circle (mean of the inner neighbours, minus decay, plus symmetric noise); only the flame edges "
                "are kept, so the field becomes lace. D4 halo or a D1 flame crown.",
    params={
        "size": Param(35, 25, 45, 2),
        "r0": Param(7, 4, 10, 1, description="source ring radius"),
        "decay": Param(0.09, 0.03, 0.15, 0.01),
        "noise": Param(0.2, 0.0, 0.4, 0.02),
        "sym": Param("d4", choices=["d4", "crown"]),
        "core": Param("cross", choices=["cross", "chirho", "dot", "eye"]),
        "threshold": Param(0.3, 0.1, 0.6, 0.05, description="outermost flame contour level"),
        "rings": Param(2, 1, 4, 1, description="nested flame contours"),
    },
    tags=["fire", "nimbus", "d4", "growth"],
)
def pentecost_corona(seed, size, r0, decay, noise, sym, core, threshold, rings):
    H = W = size
    c = (size - 1) // 2
    dx, dy = _centred(H, W)
    ax, ay = np.abs(dx), np.abs(dy)
    rad = np.rint(np.hypot(dx, dy)).astype(int)
    heat = np.zeros((H, W))
    src = G.ring_mask(H, W, r0)
    heat[rad <= r0] = 1.0
    if sym == "d4":
        ka, kb = np.maximum(ax, ay), np.minimum(ax, ay)
    else:
        ka, kb = ax, dy + c
    nz = np.vectorize(_hash01)(ka, kb, seed)
    # angular flame field: looping noise on the circle, n tongues per quadrant (D4 via folded angle)
    rng = np.random.default_rng(seed)
    th = np.arctan2(np.abs(dy), np.abs(dx)) if sym == "d4" else np.arctan2(dy, np.abs(dx))
    if sym == "d4":
        th = np.minimum(th, math.pi / 2 - th)  # fold to the 1/8 wedge
    tongues = int(rng.integers(2, 4))
    ph = rng.random(3) * 2 * math.pi
    ang = (np.sin(tongues * 4 * th + ph[0]) * 0.6 + np.sin(tongues * 8 * th + ph[1]) * 0.4) * 0.5 + 0.5
    # crown: decay grows towards the bottom, flames rise
    if sym == "crown":
        up = np.arctan2(-dy, ax)  # +pi/2 = up
        dec = decay * (0.6 + 1.6 * (1 - np.sin(up)) / 2) * (0.5 + ang)
    else:
        dec = decay * (0.45 + 1.1 * ang)
    frames = []
    rmax = int(rad.max())
    for r in range(r0 + 1, rmax + 1):
        ys, xs = np.nonzero(rad == r)
        new = []
        for y, x in zip(ys, xs):
            vals = [heat[y + j, x + i] for j in (-1, 0, 1) for i in (-1, 0, 1)
                    if (i or j) and 0 <= y + j < H and 0 <= x + i < W and rad[y + j, x + i] < r]
            v = (np.mean(vals) if vals else 0) - dec[y, x] + noise * (nz[y, x] - 0.5)
            new.append(max(0.0, v))
        for (y, x), v in zip(zip(ys, xs), new):
            heat[y, x] = v
        if r % 2 == 0:
            frames.append(heat.copy())
    kind = "d4" if sym == "d4" else "x"

    def contours(hm):
        out = np.zeros((H, W), bool)
        for lv in levels:
            hot = hm > lv
            out |= hot & ~morph.erode(np.pad(hot, 1), 1, conn=4)[1:-1, 1:-1] & (rad > r0 + 1)
        return out

    levels = [threshold + (0.85 - threshold) * i / max(1, rings - 1) for i in range(rings)][::-1] if rings > 1 \
        else [threshold]
    from ..ops import lace as L
    flames = L.lace_clean(contours(heat) | src, 3, kind, keep=src) & ~src
    mid = C.connect(flames | src, None, kind, max_len=3)
    # core motif inside the source ring
    corem = np.zeros((H, W), bool)
    a = r0 - 2
    if core == "cross":
        corem[c - a:c + a + 1, c] = True
        corem[c, c - a:c + a + 1] = True
    elif core == "chirho":
        corem[c - a:c + a + 1, c] = True
        for t in range(-a + 1, a):
            corem[c + t, c + t] = corem[c + t, c - t] = True
        corem[c - a, c:c + 2] = True
        corem[c - a + 1, c + 2] = True
        corem[c - a + 2, c:c + 2] = True
    elif core == "eye":
        corem |= G.ring_mask(H, W, max(1, a - 1))
        corem[c, c] = True
    else:
        corem[c, c] = True
    top = src | corem
    base = morph.close(morph.dilate(mid, 1, 8), 1) | G.disc_mask(H, W, r0)
    fr = []
    for i, h in enumerate(frames[:: max(1, len(frames) // 10)]):
        fr.append((f"ring {r0 + 2 * (i + 1)}", {2: contours(h) | src, 1: top}))
    fr.append(("final", {3: base, 2: mid, 1: top}))
    notes = (f"radial fire from ring r={r0}: heat = mean(inner neighbours) - decay {decay} + {noise} * hash noise "
             f"({sym}, angular tongue field modulates decay); {rings} nested contour lines from {threshold}; core {core}.")
    return _design({3: base, 2: mid, 1: top}, notes, fr)


# ---- P29 Monas Stack -----------------------------------------------------------------------------

def _connect_stack(parts):
    """Stack parts top->bottom, joining consecutive ones with a 1-2 cell stem on the axis."""
    W = max(p.shape[1] for p in parts)
    W += 1 - W % 2
    cols = []
    for p in parts:
        pad = (W - p.shape[1]) // 2
        q = np.zeros((p.shape[0], W), bool)
        q[:, pad:pad + p.shape[1]] = p
        cols.append(q)
    out = []
    cx = W // 2
    for i, p in enumerate(cols):
        out.append(p)
        if i < len(cols) - 1:
            out.append(np.zeros((1, W), bool))
            out[-1][0, cx] = True
    m = np.vstack(out)
    # make sure the axis stem reaches into each part: extend stems until they hit material
    H = m.shape[0]
    for y in range(H):
        if m[y, cx] and (y + 1 < H) and not m[y + 1, cx] and not m[y + 1].any():
            pass
    # fill axis gaps between consecutive filled axis cells that are separated only by empty rows of a part
    col = m[:, cx]
    ys = np.nonzero(col)[0]
    lab, n = morph.label(m, 8)
    if n > 1:
        for y in range(H):
            if not m[y, cx]:
                m2 = m.copy()
                m2[y, cx] = True
                if morph.label(m2, 8)[1] < n:
                    m, n = m2, morph.label(m2, 8)[1]
    return m


@recipe(
    "monas_stack", section="sacred_geometry", title="Monas stack",
    description="John Dee's hieroglyphic monad and the planetary signs as a grammar: stack 3-4 primitives "
                "(horns, circle, circle+dot, cross, double cross, triangles, bar, Aries horns) on one axis - "
                "new planets, impossible elements, a lost alphabet - in a mandorla with a thin lace band.",
    params={
        "width": Param(19, 15, 25, 2), "height": Param(35, 27, 45, 2),
        "parts": Param(4, 2, 5, 1),
        "monas": Param(False, description="force Dee's monad: horns + circle with dot + cross + Aries"),
        "surround": Param("plain", choices=["plain", "orbit", "lace"]),
        "density": Param(0.4, 0.25, 0.55, 0.05),
    },
    tags=["alchemy", "glyph", "d1"],
)
def monas_stack(seed, width, height, parts, monas, surround, density):
    rng = np.random.default_rng(seed)
    H, W = height, width
    for _ in range(60):
        if monas:
            names = ["horns", "ring_dot", "cross", "aries"]
        else:
            names = []
            if rng.random() < 0.5:
                names.append(str(rng.choice(["horns", "arrow", "tri_up"])))
            names.append(str(rng.choice(["ring", "ring_dot", "ring_dot", "tri_down"])))
            names.append(str(rng.choice(["cross", "double_cross", "cross", "bar"])))
            if len(names) < parts:
                names.append(str(rng.choice(["aries", "tri_down", "bar", "ring", "horns_down"])))
            names = names[:parts]
        r = int(rng.integers(2, 4))
        prims = []
        for nm in names:
            if nm == "horns":
                prims.append(G.prim_horns(r + 1))
            elif nm == "horns_down":
                prims.append(G.prim_horns(r)[::-1])
            elif nm == "ring":
                prims.append(G.prim_ring(r + 1))
            elif nm == "ring_dot":
                prims.append(G.prim_ring(max(3, r + 1), dot=True))
            elif nm == "cross":
                prims.append(G.prim_cross(r + 1))
            elif nm == "double_cross":
                prims.append(G.prim_cross(r + 1, double=True))
            elif nm == "bar":
                prims.append(G.prim_bar(r + 1))
            elif nm == "aries":
                prims.append(G.prim_aries(2))
            elif nm == "arrow":
                prims.append(G.prim_arrow(r))
            elif nm == "tri_up":
                prims.append(G.prim_triangle(r + 1, True))
            elif nm == "tri_down":
                prims.append(G.prim_triangle(r + 1, False))
        g = _connect_stack(prims)
        ratio = g.shape[0] / g.shape[1]
        if 1.4 <= ratio <= 3.2 and g.shape[0] <= H - 10 and g.shape[1] <= W - 6:
            break
    sil = mandorla(H, W)
    top = np.zeros((H, W), bool)
    G.place(top, g, W // 2, H // 2)
    frame = outline(sil)
    plate = morph.dilate(top, 1, 8)
    extra = np.zeros((H, W), bool)
    if surround == "lace":
        z = C.zones(sil, band=3, gap=0)
        extra = lace_in(z["band"] & ~frame & ~morph.dilate(plate, 1, 8), rng, "d2", density, anchor=frame)
    elif surround == "orbit":
        gh, gw = g.shape
        extra = ellipse_outline(H, W, gw / 2 + 2.5, gh / 2 + 2.5) & sil & ~frame
    # the glyph's plate hangs from the frame by the axis (top and bottom)
    axis = np.zeros((H, W), bool)
    axis[:, W // 2] = True
    ys = np.nonzero(top.any(1))[0]
    rows = np.arange(H)
    axis &= sil & ((rows < ys.min())[:, None] | (rows > ys.max())[:, None])
    mid = frame | extra | top | axis
    mid = C.connect(mid, sil, "x", max_len=3)
    base = (morph.dilate(mid, 1, 8) | morph.fill_holes(morph.dilate(top, 1, 8))) & sil
    notes = f"stack {names} (D1 by construction, axis stems); vesica frame, {surround} surround, glyph plate hung on the axis."
    d = _design({3: base, 2: mid, 1: top}, notes)
    d.title = "Monas · " + " + ".join(names)
    return d


# ---- own idea: Magic-walk rose --------------------------------------------------------------------

@recipe(
    "magic_walk_rose", section="sacred_geometry", title="Magic-walk rose (kamea 1..n²)",
    description="Every planetary square has an intrinsic route: visit 1, 2, 3 ... n² in order. Associative squares "
                "(Saturn, Mars, Venus, Moon) give routes that are already symmetric under a half turn; drawn with "
                "octilinear dog-legs and optionally folded by mirrors they become star-roses. Compartment centres "
                "are the raised beads, the frame a pixel circle.",
    params={
        "planet": Param("saturn", choices=list(S.KAMEAS)),
        "sym": Param("none", choices=["none", "x", "d2", "c4"]),
        "size": Param(23, 15, 45, 2),
        "closed": Param(True, description="close the walk n² -> 1"),
        "style": Param("octi", choices=["octi", "bresenham"]),
        "frame": Param("none", choices=["ring", "square", "none"]),
    },
    tags=["kamea", "rose", "c2", "own-idea"],
)
def magic_walk_rose(seed, planet, sym, size, closed, style, frame):
    H = W = size
    n = S.KAMEAS[planet]
    inner = size - 6 if frame != "none" else size
    inner -= 1 - inner % 2
    r = S.magic_walk(planet, inner, closed=closed, style=style)
    w = r["line"]
    t = seed % 8  # seed picks one of the 8 D4 images of the square (8 roses per planet)
    w = np.rot90(w, t % 4)
    if t >= 4:
        w = w.T
    if sym == "c4":
        w = w | np.rot90(w, 1) | np.rot90(w, 2) | np.rot90(w, 3)
    if sym in ("x", "d2"):
        w = w | w[:, ::-1]
    if sym == "d2":
        w = w | w[::-1]
    route = np.zeros((H, W), bool)
    o = (size - inner) // 2
    route[o:o + inner, o:o + inner] = w
    from ..ops import lace as L
    route = L.lace_clean(route, 3, "none")
    beads = np.zeros((H, W), bool)
    k = r["k"]
    for x, y in r["centres"]:
        X, Y = x + o, y + o
        beads[Y, X] = True
    beads = np.rot90(beads, t % 4)
    if t >= 4:
        beads = beads.T
    c = (size - 1) // 2
    mid = route.copy()
    if frame != "none":
        fr = G.ring_mask(H, W, c) if frame == "ring" else outline(C.superellipse(H, W, 5.0))
        # four spokes on the axes from the frame inward to the first route cell (keeps C2/D2 symmetry)
        spokes = np.zeros((H, W), bool)
        for d in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            for t in range(c - 1, 0, -1):
                x, y = c + d[0] * t, c + d[1] * t
                if fr[y, x]:
                    continue
                if morph.dilate(route, 1, 8)[y, x]:
                    spokes[y, x] = True
                    break
                spokes[y, x] = True
        mid |= fr | spokes
    base = morph.dilate(mid, 1, 8)
    top = beads & route
    notes = (f"{planet} square (n={n}) walked 1..{n * n}{' and back to 1' if closed else ''} ({style} segments), "
             f"D4 image {t}, folded {sym}; beads = compartment centres on the route.")
    d = _design({3: base, 2: mid, 1: top}, notes)
    d.title = f"Magic-walk rose · {planet}"
    return d
