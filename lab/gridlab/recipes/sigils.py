"""Sigils & scripts: kamea sigils, Spare monograms, geomancy, Ogham, bindrunes, square Kufic,
vèvè-style scaffolds and asemic tablets (research-esoteric §3.3-3.7, §3.11, presets P6-P30).

Layer ids: 1 = top. Roles: BASE (highest id, plate), MID (drawing/route), TOP (symbol core),
CROWN (4-layer stacks only). Shared helpers (``lace_in``, ``mandorla``, ``ellipse_outline``)
are imported by recipes/sacred_geometry.py too.
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import composition as C
from ..ops import draw as D
from ..ops import glyphs as G
from ..ops import masks as M
from ..ops import morph
from ..ops import sigils as S
from . import Param, recipe, register_section

register_section(
    "sigils", "Sigils & scripts",
    "Names and questions become routes and marks: kamea sigils, Spare monograms, geomantic shields, Ogham "
    "spines, bindrunes, square Kufic seals and invented scripts. The symbol is the skeleton; lace only frames it.")

WORDS = ["AGIEL", "ZAZEL", "LUX", "NOX", "SOPHIA", "AMOR", "VITA", "ANIMA", "LUNA", "STELLA", "FIDES", "IGNIS"]


# ---- shared helpers -------------------------------------------------------------------

def lace_in(free: np.ndarray, rng, sym: str = "d2", density: float = 0.4, fixed: np.ndarray | None = None,
            connect_to: np.ndarray | None = None, method: str = "coral", scale: float = 0.3,
            seed_p: float = 0.15, max_orth: int = 2, max_n8: int = 3, anchor: np.ndarray | None = None) -> np.ndarray:
    """Lace inside ``free``. method=coral: lace-rule invasion percolation (no 2x2, <= max_orth
    orthogonal / max_n8 neighbours) on symmetric fbm+white resistance, seeded on the free region's
    edge and next to ``fixed`` (so it grows off frames/halos) - the samples' tendril look.
    method=learned: ops.lace patch annealing (denser, swiss-cheese at large sizes).
    ``anchor``: grow only off these cells (lace-rule checked against them; result touches them).
    ``connect_to``: keep only lace touching it (after short bridges)."""
    from ..ops import fields as F
    from ..ops import growth_ops as GO

    free = np.asarray(free, bool)
    H, W = free.shape
    kind = sym if sym in ("d2", "d4", "x", "none") else "d2"
    fixed = np.zeros_like(free) if fixed is None else np.asarray(fixed, bool) & ~free
    if method == "learned":
        from ..ops import lace as L

        terms = [(3, 3, L.patch_model(3, 3).energy_table(1.0)), (4, 4, L.patch_model(4, 4).energy_table(0.35)),
                 L.block_table(30.0), L.checker_table(1.5)]
        g, _ = L.anneal(free, fixed, kind if kind != "none" else "d2", terms, density=density, sweeps=60,
                        rng=rng, n_frames=1, t0=4.0, t1=1.0)
        g = L.lace_clean(g & free, 3, kind)
    else:
        res = F.sym_noise(H, W, scale, kind if kind in ("d2", "d4", "x") else "none",
                          seed=int(rng.integers(1 << 30)), white=0.6)
        if anchor is not None and np.asarray(anchor, bool).any():
            # grow off the anchor (frame / halo / motif): everything stays connected to it
            anc = np.asarray(anchor, bool)
            near = free & morph.dilate(anc, 1, 8) & (rng.random((H, W)) < seed_p * 1.5)
            seeds = anc | (GO.sym_or(near, kind) & free if kind != "none" else near)
            g = GO.invasion_percolation(seeds, free | anc, res, int(anc.sum() + seeds.sum() + free.sum() * density),
                                        kind if kind != "none" else "x", max_orth, max_n8)
            g = g & free
            g = GO.connect_to(g, anc, kind if kind != "none" else "x")
        else:
            edge = free & (M.offset_outline(free, 0) | morph.dilate(fixed, 1, 8))
            seeds = edge & (rng.random((H, W)) < seed_p)
            seeds = GO.sym_or(seeds, kind) & free if kind != "none" else seeds
            g = GO.invasion_percolation(seeds, free, res, int(free.sum() * density), kind if kind != "none" else "x",
                                        max_orth, max_n8)
        g = GO.lace_clean(g, kind if kind != "none" else "x") if kind != "none" else morph.remove_small(g, 3)
    if connect_to is not None:
        ct = np.asarray(connect_to, bool)
        g2 = C.connect(g | ct, free | ct, kind if kind != "none" else "none", max_len=3)
        lab, _ = morph.label(g2, 8)
        keep = np.unique(lab[ct & (lab > 0)])
        g = g2 & np.isin(lab, keep) & ~ct
    return g


def mandorla(h: int, w: int) -> np.ndarray:
    """Vesica piscis (pointed vertical oval) of width w, height h: intersection of two discs."""
    d = (h * h - w * w) / (4 * w) if h > w else 0.0
    R = d + w / 2
    dx, dy = C.centred(h, w)
    return (np.hypot(dx - d, dy) <= R + 0.01) & (np.hypot(dx + d, dy) <= R + 0.01)


def ellipse_outline(h: int, w: int, rx: float, ry: float, cx=None, cy=None) -> np.ndarray:
    cx = (w - 1) / 2 if cx is None else cx
    cy = (h - 1) / 2 if cy is None else cy
    return D.ellipse(np.zeros((h, w), bool), cx, cy, rx, ry, filled=False)


def outline(mask: np.ndarray) -> np.ndarray:
    """Thin inner boundary (8-connected ring of the mask's edge cells)."""
    return mask & ~morph.erode(np.pad(mask, 1), 1, conn=4)[1:-1, 1:-1]


def _design(layers: dict, notes: str, frames=None) -> Design:
    d = Design.from_masks({k: np.asarray(v, bool) for k, v in layers.items()})
    d.notes = notes
    if frames:
        d.frames = frames
    return d


def _transform(a: np.ndarray, t: int) -> np.ndarray:
    """One of the 8 D4 transforms of a square array."""
    a = np.rot90(a, t % 4)
    return a.T if t >= 4 else a


# ---- P6 Kamea Seal ------------------------------------------------------------------------

@recipe(
    "kamea_seal", section="sigils", title="Kamea seal",
    description="A name traced through a planetary magic square (Agrippa): Latin gematria, zeros dropped until "
                "the number fits, a ring where the route starts and a bar where it ends. BASE is the square as a "
                "grille (frame + compartment lattice + the route's shadow) - the map; MID the route; TOP the marks.",
    params={
        "planet": Param("saturn", choices=list(S.KAMEAS)),
        "name": Param("", description="word to trace (empty = a word chosen by seed)"),
        "seal": Param(True, description="bilateral seal: OR the mirror image"),
        "size": Param(29, 17, 45, 2),
        "plate": Param("grille", choices=["grille", "disc", "square"]),
        "start": Param("ring2", choices=["ring", "ring2", "dot"]),
        "turn": Param(True, description="seed also rotates/reflects the square (Agrippa's sigils appear rotated)"),
    },
    tags=["sigil", "kamea", "d1"],
)
def kamea_seal(seed, planet, name, seal, size, plate, start, turn):
    rng = np.random.default_rng(seed)
    word = name or WORDS[seed % len(WORDS)]
    n = S.KAMEAS[planet]
    sq = S.kamea(planet)
    t = int(rng.integers(8)) if (turn and seed) else 0
    sq = _transform(sq, t)
    vals = S.name_numbers(word, n)
    where = {int(sq[r, c]): (r, c) for r in range(n) for c in range(n)}
    orig = S.kamea(planet)
    remap = [int(orig[where[v]]) for v in vals]  # same geometry as tracing on the turned square
    r = S.sigil_trace(word, planet, size, seal=seal, values=remap, start=start)
    line, marks = r["line"], r["marks"]
    H = W = size
    route = line | marks
    if plate == "grille":
        k = r["k"]
        span = k * n
        o = (size - span) // 2
        frame = np.zeros((H, W), bool)
        frame[o:o + span + 1, o:o + span + 1] = True
        frame = outline(frame)
        base = frame | (r["lattice"]) | morph.dilate(route, 1, 8)
        base = C.connect(base, None, "x" if seal else "none", max_len=3)
    elif plate == "disc":
        base = M.circle(H, W, r=size / 2)
        for x, y in r["centres"]:
            base[y, x] = False
    else:
        base = C.silhouette("roundrect", H, W)
        base &= ~r["lattice"] | morph.dilate(route, 1, 8)
    notes = (f"'{word}' -> gematria {G.gematria_values(word)} -> reduced on the {planet} square (n={n}) "
             f"{r['values']}; D4 turn {t}; route{' + mirror' if seal else ''}; start {start}, end bar. "
             f"BASE {plate}.")
    d = _design({3: base, 2: route, 1: marks}, notes)
    d.title = f"Kamea seal · {planet} · {word}"
    return d


# ---- P8 Spare Monogram Reliquary --------------------------------------------------------

@recipe(
    "spare_reliquary", section="sigils", title="Spare monogram reliquary",
    description="Austin Osman Spare's method: strip a desire to its unique consonants, overlay them in an "
                "octilinear stroke font (seeded flips), optionally mirror into a mute glyph - then house it like "
                "a relic: a plate inside an elliptic halo, coral lace grown off the halo inside a vesica.",
    params={
        "text": Param("I WILL BE WHOLE", description="the statement of intent"),
        "width": Param(25, 15, 31, 2), "height": Param(39, 23, 45, 2),
        "pitch": Param(3, 2, 3, 1, description="stroke-font node pitch (2 -> 5x9 glyph, 3 -> 7x13)"),
        "letters": Param(3, 2, 5, 1),
        "mirror": Param(True),
        "density": Param(0.35, 0.2, 0.6, 0.05),
        "band": Param(3, 2, 8, 1, description="lace band depth"),
    },
    tags=["sigil", "monogram", "d1", "lace"],
)
def spare_reliquary(seed, text, width, height, pitch, letters, mirror, density, band):
    rng = np.random.default_rng(seed)
    H, W = height, width
    mono = S.spare_monogram(text, seed=seed, pitch=pitch, max_letters=letters, mirror=mirror)
    g = mono["mask"]
    top = np.zeros((H, W), bool)
    G.place(top, g, W // 2, H // 2)
    sil = mandorla(H, W)
    gh, gw = g.shape
    rx, ry = gw / 2 + 1.5, gh / 2 + 1.5
    halo = ellipse_outline(H, W, rx, ry) & sil
    halo_fill = morph.fill_holes(halo)
    frame = outline(sil)
    z = C.zones(sil, band=band + 1, gap=0)
    free = z["band"] & ~frame & ~morph.dilate(halo_fill, 1, 8)
    lace = lace_in(free, rng, "d2", density, anchor=frame)
    # spokes: the axis columns/rows from the halo to the lace band (calm gap otherwise)
    spokes = np.zeros((H, W), bool)
    cx, cy = W // 2, H // 2
    spokes[:, cx] = True
    spokes &= sil & ~halo_fill & ~morph.dilate(frame | lace, 0, 8)
    lab, _ = morph.label(spokes | halo, 8)
    mid = frame | halo | lace | spokes
    from ..ops import lace as L
    mid = L.lace_clean(mid, 3, "d2", keep=halo | frame)
    # BASE: a second, independent lace under the first (the samples stack lace on lace) + halo plate
    under = lace_in(free | (spokes & ~halo_fill), rng, "d2", min(0.6, density + 0.08), anchor=frame | halo_fill)
    base = frame | under | morph.dilate(halo_fill, 1, 8) | spokes
    base = L.lace_clean(base, 3, "d2", keep=halo_fill | frame)
    notes = (f"'{text}' -> consonants {''.join(mono['letters'])} overlaid (3x5 stroke font, pitch {pitch}, seeded "
             f"flips{', mirrored' if mirror else ''}); halo ellipse; coral lace (lace-rule invasion percolation) "
             f"grown off frame and halo inside a vesica. BASE = lace shadow + halo plate.")
    return _design({3: base, 2: mid, 1: top}, notes)


# ---- P12 Geomantic Shield ------------------------------------------------------------------

def _roundrect(h, w):
    m = np.ones((h, w), bool)
    for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        m[y, x] = False
    return m


@recipe(
    "geomantic_shield", section="sigils", title="Geomantic shield",
    description="A full geomantic chart cast from a question: Mothers -> Daughters (transpose) -> Nieces, "
                "Witnesses and the Judge by XOR. Nieces, Witnesses and Judge stand as figures on plates in an "
                "inverted pyramid (the heraldic shield) hung in an open shield frame; Mothers and Daughters form "
                "a frieze of small figures above. The Judge rises on a fourth layer.",
    params={
        "question": Param("what grows in the dark", description="the question (seeds the Mothers)"),
        "frieze": Param(False, description="Mothers + Daughters as a frieze of small figures above (busier)"),
        "frame": Param("shield", choices=["shield", "none"]),
    },
    tags=["geomancy", "oracle", "4-layer"],
)
def geomantic_shield(seed, question, frieze, frame):
    chart = S.geomantic_chart(S.mothers_from_text(question, seed))
    W = 37
    fr_h = 9 if frieze else 0
    y0 = 3 + fr_h + (1 if frieze else 0)
    rows = [chart["nieces"][::-1], [chart["left_witness"], chart["right_witness"]], [chart["judge"]]]
    H = y0 + 3 * 9 + 2 + 5
    H += 1 - H % 2
    sil = M.shield(H, W, shoulder=0.45 if frieze else 0.3, point=0.45)
    comp = np.zeros((H, W), bool)
    figs = np.zeros((H, W), bool)
    judge = np.zeros((H, W), bool)
    links = np.zeros((H, W), bool)
    cxs = []
    for ri, row in enumerate(rows):
        n = len(row)
        span = n * 7 + (n - 1) * 1
        x0 = (W - span) // 2
        yy = y0 + ri * 10
        cxs.append([x0 + i * 8 + 3 for i in range(n)])
        for i, bits in enumerate(row):
            xx = x0 + i * 8
            comp[yy:yy + 9, xx:xx + 7] |= _roundrect(9, 7)
            f = S.figure_mask(bits)
            figs[yy + 1:yy + 8, xx + 1:xx + 6] |= f
            if ri == 2:
                judge[yy + 1:yy + 8, xx + 1:xx + 6] |= f
            if i < n - 1:
                links[yy + 4, xx + 7] = True
    # pyramid links: each lower plate hangs from the two plates above (one cell across the 1-row gap)
    for ri in range(2):
        yb = y0 + ri * 10 + 9
        for cx in cxs[ri + 1]:
            for dx in (-2, 2):
                links[yb, cx + dx] = True
    mid = comp | links
    top = figs.copy()
    plate_fr = np.zeros((H, W), bool)
    if frieze:
        figs8 = list(chart["daughters"][::-1]) + list(chart["mothers"][::-1])
        span = 8 * 3 + 7
        x0 = (W - span) // 2
        for i, bits in enumerate(figs8):
            f = S.figure_mask(bits, "bars", 3)
            top[4:11, x0 + i * 4:x0 + i * 4 + 3] |= f
        plate_fr[3:12, x0 - 1:x0 + span + 1] = _roundrect(9, span + 2)
        mid |= plate_fr
        for cx in cxs[0]:
            mid[12, cx] = True
    base = morph.dilate(mid, 1, 8)
    if frame == "shield":
        fr = outline(sil)
        base |= fr
        # hang the plates from the frame: short horizontal arms at the rows' mid-heights
        for ri in range(3):
            yy = y0 + ri * 10 + 4
            row = base[yy]
            xs = np.nonzero(fr[yy])[0]
            if len(xs) >= 2:
                lo, hi = xs.min(), xs.max()
                inner = np.nonzero(morph.dilate(mid, 1, 8)[yy])[0]
                if len(inner):
                    base[yy, lo:inner.min()] = True
                    base[yy, inner.max():hi + 1] = True
        if frieze:
            yy = 7
            xs = np.nonzero(fr[yy])[0]
            inner = np.nonzero(morph.dilate(mid, 1, 8)[yy])[0]
            if len(xs) >= 2 and len(inner):
                base[yy, xs.min():inner.min()] = True
                base[yy, inner.max():xs.max() + 1] = True
        base &= sil
    notes = (f"Judge {chart['names']['judge']} {chart['judge']}; nieces {chart['nieces']}; witnesses "
             f"L{chart['left_witness']} R{chart['right_witness']}. Odd = one bar, even = split bar; read right "
             f"to left. Frieze: daughters 4..1, mothers 4..1.")
    d = _design({4: base, 3: mid, 2: top, 1: judge}, notes)
    d.title = f"Geomantic shield · {chart['names']['judge']}"
    return d


# ---- P13 Geomantic Layer Code -----------------------------------------------------------

@recipe(
    "geomantic_layers", section="sigils", title="Geomantic layer code",
    description="The four rows of one geomantic figure (fire, air, water, earth) switch the four physical layers: "
                "odd = one ring, even = a pair of kissing rings, shrinking upward. The stack is the figure.",
    params={
        "question": Param("", description="cast the Judge from this question (empty = use 'figure')"),
        "figure": Param("cast", choices=["cast"] + sorted(set(S.FIGURES.values())),
                        description="cast = the Judge of a chart cast from the seed"),
        "fill": Param("plates", choices=["plates", "lace", "rings", "none"]),
    },
    tags=["geomancy", "4-layer"],
)
def geomantic_layers(seed, question, figure, fill):
    rng = np.random.default_rng(seed)
    if question or figure == "cast":
        bits = S.geomantic_chart(S.mothers_from_text(question or f"seed {seed}", seed))["judge"]
    else:
        bits = next(b for b, n in S.FIGURES.items() if n == figure)
    name = S.FIGURES[tuple(bits)]
    H, W = 23, 25
    radii = [4, 6, 8, 10]  # fire (top) .. earth (base)
    layers = {}
    for li, (b, r) in enumerate(zip(bits, radii)):
        m = np.zeros((H, W), bool)
        if b:
            cs, rr = [(W // 2, H // 2)], r
        else:
            rr = max(2, (r + 1) // 2 + 1)
            cs = [(W // 2 - rr, H // 2), (W // 2 + rr, H // 2)]
        for cx, cy in cs:
            disc = G.disc_mask(H, W, rr, cx, cy)
            if fill == "lace" and rr >= 5:
                ring = G.ring_mask(H, W, rr, cx, cy)
                inner = disc & ~ring
                m |= ring | lace_in(inner, rng, "d2", 0.35, anchor=ring)
            elif fill == "plates":
                m |= disc
                if rr >= 4:
                    m &= ~G.ring_mask(H, W, rr - 2, cx, cy)  # engraved groove
                    m |= disc & ~G.disc_mask(H, W, rr - 1, cx, cy)
                    # keep the groove bridged on the axes so the plate stays one piece
                    m[cy, cx - rr:cx + rr + 1] |= disc[cy, cx - rr:cx + rr + 1]
                if li == 0 and rr >= 2:
                    m[cy, cx] = False  # pierced centre on the top layer
            elif fill == "rings":
                m |= G.ring_mask(H, W, rr, cx, cy)
                m[cy, cx] = True
            else:
                m |= disc
        layers[li + 1] = m
    notes = f"{name} {tuple(bits)} (head=fire=top .. feet=earth=base): 1 -> single ring, 0 -> kissing pair."
    d = _design(layers, notes)
    d.title = f"Geomantic layers · {name}"
    return d


# ---- P15 Ogham Spine ----------------------------------------------------------------------

@recipe(
    "ogham_spine", section="sigils", title="Ogham spine",
    description="The wearer's name in Ogham on the pendant's spine (read bottom to top): B-aicme short bars, "
                "H-aicme long bars, M-aicme rising chevrons, vowels as dot pairs - the same 'spine with bars' "
                "the user draws, but personal. Learned lace on both sides.",
    params={
        "name": Param("LUNA"),
        "width": Param(17, 11, 23, 2),
        "band": Param(4, 2, 7, 1, description="lace band depth from the edge"),
        "style": Param("symmetric", choices=["symmetric", "true"]),
        "density": Param(0.42, 0.15, 0.6, 0.01),
        "gap": Param(1, 0, 2, 1, description="breathing gap between lace and script"),
        "max_letters": Param(5, 2, 9, 1),
    },
    tags=["ogham", "script", "lace", "d1"],
)
def ogham_spine(seed, name, width, band, style, density, gap, max_letters):
    rng = np.random.default_rng(seed)
    letters = S.ogham_letters(name)[:max_letters]
    txt = "".join(l[0] for l in letters) or "A"
    og = S.ogham_spine(txt, style, gap=3)
    g = og["mask"]
    if style == "true":
        g = g | g[:, ::-1]
    H = g.shape[0] + 6
    H += 1 - H % 2
    W = width
    sil = C.silhouette("capsule", H, W)
    top = np.zeros((H, W), bool)
    G.place(top, g, W // 2, H // 2)
    from ..ops import lace as L
    band_z = C.zones(sil, band=band, gap=0)["band"]
    free = (sil & ~morph.dilate(top, gap, 8) if gap else sil & ~top) & band_z
    lace = lace_in(free, rng, "d2", density)
    mid = L.lace_clean(lace | top, 3, "d2", keep=top)
    mid = C.connect(mid, sil, "d2", max_len=gap + 3)
    band_b = C.zones(sil, band=band + 1, gap=0)["band"] & ~morph.dilate(top, 1, 8)
    under = lace_in(band_b, rng, "d2", min(0.6, density + 0.05))
    base = L.lace_clean(under | morph.dilate(top, 1, 8) & sil, 3, "d2", keep=top)
    base = C.connect(base, sil, "d2", max_len=3)
    notes = f"'{name}' -> Ogham {' '.join(og['letters'])} ({style}); lace = coral (lace-rule invasion percolation on symmetric noise) in an edge band, D2; BASE = a second, independent lace + the script's shadow (lace on lace, like the samples)."
    return _design({3: base, 2: mid, 1: top}, notes)


# ---- P16 Bindrune Reliquary -----------------------------------------------------------------

@recipe(
    "bindrune_reliquary", section="sigils", title="Bindrune reliquary",
    description="Two or three runes bound on one stave, mirrored into perfect symmetry, set inside a halo "
                "with coral (lace-rule invasion growth) outside it.",
    params={
        "runes": Param("", description="comma list (e.g. 'fehu,algiz'); empty = from name or seed"),
        "name": Param("", description="initials -> runes (max 3)"),
        "width": Param(17, 15, 25, 2), "height": Param(31, 25, 41, 2),
        "density": Param(0.38, 0.2, 0.5, 0.02),
        "halo": Param("roundrect", choices=["roundrect", "ellipse"]),
    },
    tags=["rune", "bindrune", "d2", "coral"],
)
def bindrune_reliquary(seed, runes, name, width, height, density, halo):
    rng = np.random.default_rng(seed)
    names = [r.strip() for r in runes.split(",") if r.strip() in S.RUNES]
    if not names:
        if name:
            names = S.runes_for_text(name)
        else:
            pool = [r for r in S.RUNES if r not in ("isa",)]
            names = list(rng.choice(pool, size=2, replace=False))
    br = S.bindrune(names, 2, True)
    g = br["mask"]
    H, W = height, width
    sil = C.silhouette("capsule", H, W)
    top = np.zeros((H, W), bool)
    G.place(top, g, W // 2, H // 2)
    gh, gw = g.shape
    if halo == "ellipse":
        hf = M.ellipse(H, W, rx=gw / 2 + 2.2, ry=gh / 2 + 2.2)
    else:
        hf = np.zeros((H, W), bool)
        G.place(hf, C.superellipse(gh + 4, gw + 4, 4.0), W // 2, H // 2)
    ring = outline(hf)
    free = sil & ~hf & ~outline(sil)
    coral = lace_in(free, rng, "d2", density, anchor=ring, seed_p=0.2)
    mid = coral | ring
    base = morph.close(morph.dilate(mid, 1, 8), 1) & sil | hf
    notes = f"bindrune {'+'.join(names)} on a shared stave, mirrored; halo {halo}; coral = invasion percolation (lace rule, D2)."
    d = _design({3: base, 2: mid, 1: top}, notes)
    d.title = f"Bindrune · {'+'.join(names)}"
    return d


# ---- P17 Kufic Pinwheel Seal -------------------------------------------------------------------

@recipe(
    "kufic_pinwheel", section="sigils", title="Kufic pinwheel seal",
    description="Square-Kufic grammar as a hard rule - no 2x2 window all ink or all void - annealed under "
                "quarter-turn symmetry from concentric squares into a pinwheel of meanders: a word you can't "
                "quite read. Toothed frame, raised ascenders.",
    params={
        "size": Param(21, 15, 31, 2),
        "sym": Param("c4", choices=["c4", "d4"]),
        "steps": Param(5000, 1000, 12000, 500),
        "turns": Param(0.15, 0.0, 0.6, 0.05, description="penalty per turn cell (higher = longer straight runs)"),
    },
    tags=["kufic", "c4", "anneal"],
)
def kufic_pinwheel(seed, size, sym, steps, turns):
    n = size - 6
    n -= (n + 1) % 2
    res = S.kufic_seal(n, seed, sym, steps, w_turn=turns)
    H = W = size
    o = (size - n) // 2
    seal = np.zeros((H, W), bool)
    seal[o:o + n, o:o + n] = res["mask"]
    asc = np.zeros((H, W), bool)
    asc[o:o + n, o:o + n] = res["ascenders"]
    y, x = np.mgrid[0:H, 0:W]
    c = (size - 1) // 2
    cheb = np.maximum(np.abs(x - c), np.abs(y - c))
    frame = cheb == c
    along = np.where(np.abs(y - c) >= np.abs(x - c), x, y)
    corners = (np.abs(x - c) == c - 1) & (np.abs(y - c) == c - 1)
    teeth = (cheb == c - 1) & ((along - c) % 2 == 0) & ~corners
    # quarter-turn bridges across the moat (pinwheel: off-axis), joining teeth to the seal's rim
    br = np.zeros((H, W), bool)
    hn = (n - 1) // 2
    bx = c + 2 if (2 % 2 == 0) else c + 1
    for yy in range(1, c - hn):
        br[yy, bx] = True
    br = br | np.rot90(br, 1) | np.rot90(br, 2) | np.rot90(br, 3)
    if sym == "d4":
        br |= br[:, ::-1]
    mid = seal | frame | teeth | br
    base = C.silhouette("roundrect", H, W)
    frames = [(lab, {3: base, 2: np.pad(f, o) | frame | teeth | br}) for lab, f in res["frames"]]
    frames[-1] = ("final", {3: base, 2: mid, 1: asc})
    notes = (f"{n}x{n} Kufic seal: Metropolis on {sym} orbits, hard balanced-window rule (every 2x2 has 1-3 ink), "
             f"energy = T-junctions + pieces + turns + dead ends; starts as concentric squares. Toothed frame, "
             f"quarter-turn moat bridges; TOP = longest vertical runs.")
    return _design({3: base, 2: mid, 1: asc}, notes, frames)


# ---- P28 Vèvè Scaffold with the One Mark ----------------------------------------------------

def _hook(m, x, y, dirx, length, turns, down: bool):
    """Square-spiral scroll starting at bar end (x, y) heading outward-then-curling."""
    cw = (dirx > 0) == down
    pts = G.square_spiral(x, y, length, turns, 2, (0, 1 if down else -1), cw=cw)
    return G.draw_strokes(m.shape, [pts], out=m)


@recipe(
    "veve_scaffold", section="sigils", title="Vèvè scaffold with the one mark",
    description="A pole-centred ground-drawing grammar (inspired by the structure of vèvè, not copying any "
                "lwa's sign): a central pole, decreasing crossbars, square-spiral scrolls at the bar ends, diagonal "
                "flourishes, finishing points scattered along the outer contour - and one deliberate asymmetric mark.",
    params={
        "width": Param(25, 17, 33, 2), "height": Param(35, 25, 45, 2),
        "bars": Param(2, 1, 3, 1),
        "turns": Param(1, 1, 3, 1, description="scroll turns"),
        "dots": Param(3, 2, 6, 1, description="finishing-point spacing along the contour"),
        "mark": Param(True, description="the one deliberate break of symmetry"),
    },
    tags=["veve", "grammar", "d1", "broken-mirror"],
)
def veve_scaffold(seed, width, height, bars, turns, dots, mark):
    rng = np.random.default_rng(seed)
    H, W = height, width
    cx = W // 2
    m = np.zeros((H, W), bool)
    y_top, y_bot = 3, H - 4
    m[y_top:y_bot + 1, cx] = True
    # crossbars: positions and half-lengths (decreasing upward)
    span = y_bot - y_top
    ys = sorted(int(v) for v in rng.choice(np.arange(y_top + 4, y_bot - 5, 2), size=bars, replace=False))
    half_max = (W - 1) // 2 - 4
    halves = sorted([int(rng.integers(max(3, half_max - 5), half_max + 1)) for _ in ys])
    halves = [h - (h % 2) for h in halves]
    nodes = [(cx, y_top), (cx, y_bot)]
    for yb, hb in zip(ys, halves):
        m[yb, cx - hb:cx + hb + 1] = True
        down = bool(rng.integers(2))
        L = int(rng.integers(3, 5))
        for sgn in (-1, 1):
            ex = cx + sgn * hb
            _hook(m, ex, yb, sgn, L, turns, down)
            nodes.append((ex, yb))
        # flourish: a diagonal 'S' from the pole to the bar, inside the bar's span
        if hb >= 6 and rng.random() < 0.7:
            k = int(rng.integers(3, 5))
            dy = -1 if rng.random() < 0.5 else 1
            for sgn in (-1, 1):
                x0, y0 = cx + sgn * 2, yb + dy * 2
                pts = [(x0 + sgn * t, y0 + dy * t) for t in range(k)]
                for x, y in pts:
                    if 0 <= y < H:
                        m[y, x] = True
    # crown / foot: a small diamond on top, a short foot bar
    top_r = 2
    for t in range(top_r + 1):
        for sgn in (-1, 1):
            m[y_top - 0 + t - top_r if y_top - top_r + t >= 0 else 0, cx + sgn * t] |= False
    G.place(m, G.pixel_ring(2), cx, y_top + 0) if rng.random() < 0.5 else None
    m[y_bot, cx - 2:cx + 3] = True
    m = m | m[:, ::-1]
    from ..ops import lace as L
    m = L.lace_clean(m, 1, "x")
    drawing = m.copy()
    # finishing points on the contour of dilate(drawing, 2)
    cont = outline(morph.dilate(drawing, 2, 8)) & ~morph.dilate(drawing, 1, 8)
    pts = []
    taken = np.zeros_like(cont)
    order = sorted(map(tuple, np.argwhere(cont & (np.arange(W)[None, :] <= cx))), key=lambda p: (p[0], p[1]))
    for yy, xx in order:
        if not morph.dilate(taken, dots - 1, 8)[yy, xx]:
            taken[yy, xx] = True
    taken |= taken[:, ::-1]
    taken &= ~morph.dilate(drawing, 1, 8)
    dots_m = taken & ~morph.dilate(taken & ~taken, 0)
    mid = drawing | dots_m
    top = np.zeros_like(m)
    top[y_top:y_bot + 1, cx] = True
    for yb, hb in zip(ys, halves):
        top[yb, cx - hb:cx + hb + 1] = True
    if mark:
        yb, hb = ys[0], halves[0]
        side = 1 if rng.random() < 0.5 else -1
        mx = cx + side * int(rng.integers(3, max(4, hb - 1)))
        for t in (-1, 0, 1):
            mid[yb + t, mx + t] = True
        mid[yb, mx] = True
    base = morph.close(morph.dilate(drawing, 2, 8), 2) & np.ones_like(m)
    notes = (f"pole + {bars} crossbars (half-lengths {halves}), {turns}-turn square-spiral scrolls, diagonal "
             f"flourishes, finishing points every ~{dots} cells on contour(dilate(drawing, 2)); "
             f"{'one diagonal mark breaks the mirror on the upper bar.' if mark else 'no break.'} "
             f"Grammar-generated homage; not a specific lwa's vèvè.")
    return _design({3: base, 2: mid, 1: top}, notes)


# ---- P30 Asemic Codex Tablet ---------------------------------------------------------------------

@recipe(
    "asemic_codex", section="sigils", title="Asemic codex tablet",
    description="A fragment of a language that never existed: an alphabet of 16 octilinear glyphs (3x3 node "
                "lattice, <= 1 crossing, shared radicals, unique under D4) hung from headlines like Devanagari, "
                "three rows in a framed tablet, the centre glyph raised in a cartouche.",
    params={
        "cols": Param(5, 3, 7, 2), "rows": Param(3, 1, 4, 1),
        "palindrome": Param(True, description="each row reads the same mirrored (glyphs mirrored too)"),
        "nodes": Param(3, 3, 4, 1),
    },
    tags=["asemic", "script", "glyph"],
)
def asemic_codex(seed, cols, rows, palindrome, nodes):
    rng = np.random.default_rng(seed)
    alpha = asemic = G.asemic_alphabet(rng, 16, nodes, hang=True)
    gs = (nodes - 1) * 2 + 1  # glyph size
    gap = 1
    row_h = 1 + gs + 2  # headline + glyph + gap
    Wt = cols * gs + (cols - 1) * gap
    W = Wt + 6
    H = rows * row_h + 5
    W += 1 - W % 2
    H += 1 - H % 2
    x0 = (W - Wt) // 2
    plate = C.silhouette("roundrect", H, W)
    frame = outline(plate)
    mid = frame.copy()
    top = np.zeros((H, W), bool)
    cr, cc = rows // 2, cols // 2
    for r in range(rows):
        yh = 3 + r * row_h
        mid[yh, x0 - 1:x0 + Wt + 1] = True
        # headline joins the frame at both ends
        mid[yh, 1:x0] = True
        mid[yh, x0 + Wt:W - 1] = True
        seq = [int(rng.integers(len(alpha))) for _ in range(cols)]
        if palindrome:
            seq = seq[: (cols + 1) // 2] + seq[: cols // 2][::-1]
        for c, gi in enumerate(seq):
            g = G.glyph_mask(alpha[gi]["segs"], nodes, 2)
            if palindrome and c > cols // 2:
                g = g[:, ::-1]
            gx = x0 + c * (gs + gap)
            if r == cr and c == cc:
                top[yh + 1:yh + 1 + gs, gx:gx + gs] |= g
                # cartouche: rounded box around the centre glyph on MID
                box = np.zeros((H, W), bool)
                box[yh + 1:yh + gs + 2, gx - 1:gx + gs + 1] = True
                mid |= outline(box) & ~morph.dilate(top, 0, 8)
            mid[yh + 1:yh + 1 + gs, gx:gx + gs] |= g
    from ..ops import lace as L
    mid = L.lace_clean(mid, 1, "none", keep=frame)
    base = plate
    notes = (f"alphabet of {len(alpha)} glyphs on a {nodes}x{nodes} node lattice (octilinear unit steps, <= 1 "
             f"crossing, radicals reused, D4-unique, hanging from the headline); {rows}x{cols} tablet"
             f"{', palindromic rows' if palindrome else ''}; centre glyph raised.")
    return _design({3: base, 2: mid, 1: top}, notes)
