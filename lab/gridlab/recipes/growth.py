"""Growth recipes: space colonisation, invasion percolation, DLA / dielectric breakdown, ...

All growth adds whole symmetry orbits (D2 / D4), so the process stays symmetric at every step and
every frame. Lace layers obey the grammar (1-cell strokes, no 2x2 blocks, diagonal bridges).
"""

from __future__ import annotations

import math

import numpy as np

from ..model import Design
from ..ops import masks as M
from ..ops import morph
from ..ops import growth_ops as G
from ..ops.fields import sym_noise
from . import Param, recipe, register_section

register_section(
    "growth", "Growth",
    "Things that grow cell by cell from a seed motif: leaf veins reaching for attractors, coral "
    "creeping along cheap noise, frost sticking to a cross. Symmetry is enforced at every step.")

ODD = dict(step=2)


def _odd(n: int) -> int:
    return n if n % 2 else n + 1


def _design(layers: dict[int, np.ndarray], frames: G.Frames | None, notes: str, n_frames: int = 16) -> Design:
    return Design.from_masks(layers, notes=notes,
                             frames=frames.out(n_frames, final=layers) if frames is not None else [])


def _sym_points(pts, w, h, kind):
    """Mirror (x, y) float points into all images."""
    cx, cy = (w - 1) / 2, (h - 1) / 2
    out = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        imgs = {(dx, dy), (-dx, dy), (dx, -dy), (-dx, -dy)}
        if kind == "d4":
            imgs |= {(b, a) for a, b in imgs}
        out += [(cx + a, cy + b) for a, b in imgs]
    return np.array(out, float).reshape(-1, 2)


# ---------------------------------------------------------------------------------------------
# 1. Venation spine: space colonisation from a central column / cross
# ---------------------------------------------------------------------------------------------

@recipe(
    "venation_spine", section="growth", title="Venation spine",
    description="Space colonisation (Runions leaf venation) on the grid: veins grow from a central "
                "spine toward mirrored attractor points scattered in the outer band. Layers: dilated "
                "veins as backplate, the veins, and the spine with dots at vein tips on top.",
    params={
        "width": Param(15, 9, 41, 2), "height": Param(25, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "shield", "oval", "octagon"]),
        "roots": Param("spine", choices=["spine", "cross", "frame"]),
        "band": Param(4.0, 2, 10, 0.5, description="attractors live within this distance of the edge"),
        "attractors": Param(24, 4, 60, 1, description="attractor points per quadrant"),
        "radius": Param(5.0, 3, 14, 0.5, description="attractor influence radius"),
        "kill": Param(1.25, 1, 4, 0.25),
        "layers": Param(3, 1, 3, 1),
        "top": Param("both", choices=["dots", "spine", "both"]),
        "back": Param("trunk", choices=["trunk", "dilate"],
                      description="3 layers: veins under their trunk (trunk) or a dilated backplate under the veins"),
    },
    tags=["growth", "venation", "d2"])
def venation_spine(seed, width, height, shape, roots, band, attractors, radius, kill, layers, top, back):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = G.silhouette(shape, w, h)
    kind = "x" if shape == "shield" else "d2"
    dist = M.distance_from_edge(sil)
    inner = sil & (dist >= 1.5)  # keep a 1-cell margin so veins don't hug the edge
    cx, cy = w // 2, h // 2
    root = np.zeros((h, w), bool)
    spine_len = max(2, int((h - 1) / 2 - band + 1))
    if roots in ("spine", "cross"):
        root[cy - spine_len:cy + spine_len + 1, cx] = True
        if roots == "cross":
            by = cy - max(1, spine_len // 3)
            arm = max(1, int((w - 1) / 2 - band + 0.5))
            root[by, cx - arm:cx + arm + 1] = True
            root = G.sym_or(root, "y") if kind == "d2" else root
    else:
        root = sil & (dist < 1.5)
    root &= sil
    # attractors in the band of one quadrant (or half for shield), mirrored
    cand = np.argwhere(sil & (dist <= band) & (dist >= 1.5))
    if kind == "d2":
        cand = cand[(cand[:, 1] <= cx) & (cand[:, 0] <= cy)]
    else:
        cand = cand[cand[:, 1] <= cx]
        attractors *= 2
    pick = cand[rng.choice(len(cand), size=min(attractors, len(cand)), replace=False)]
    pts = [(x + rng.uniform(-0.45, 0.45), y + rng.uniform(-0.45, 0.45)) for y, x in pick]
    if roots == "frame":  # attractors inside instead, veins grow inward from the rim
        cand = np.argwhere(sil & (dist > band))
        cand = cand[(cand[:, 1] <= cx) & (cand[:, 0] <= cy)]
        pick = cand[rng.choice(len(cand), size=min(attractors, len(cand)), replace=False)]
        pts = [(x + rng.uniform(-0.45, 0.45), y + rng.uniform(-0.45, 0.45)) for y, x in pick]
    att = _sym_points(pts, w, h, "d2") if kind == "d2" else np.array(
        [p for x, y in pts for p in ((x, y), (2 * cx - x, y))])
    fr = G.Frames()
    veins, gen = G.space_colonize(root, inner | root, att, kind, radius, kill, max_iter=40, max_n8=3,
                                  on_snap=lambda m: fr.add("", {2: m}))
    veins = G.break_blocks(veins, kind, protect=root)
    veins = morph.remove_small(veins, 3)
    t = G.tips(veins) & ~root
    out = {}
    if layers == 1:
        out = {1: veins}
    else:
        top_m = np.zeros_like(veins)
        if top in ("spine", "both"):
            top_m |= root if roots != "frame" else np.zeros_like(root)
        if top in ("dots", "both") or roots == "frame":
            top_m |= t
        if layers == 2:
            out = {2: veins, 1: top_m}
        elif back == "dilate":
            out = {3: morph.dilate(veins, 1, 4) & sil, 2: veins, 1: top_m}
        else:
            age = np.where(veins, np.maximum(gen, 0), -1)
            age[root & veins] = 0
            tr = G.trunk(veins, age, 4, kind) | (root & veins)
            out = {3: veins, 2: tr, 1: top_m}
    lid = 1 if layers == 1 else (3 if layers == 3 and back == "trunk" else 2)
    lab_frames = G.Frames()
    for i, (lab, fl) in enumerate(fr.items):
        lab_frames.add(f"iter {i + 1}", {lid if layers > 1 else 1: fl[2]})
    return _design(out, lab_frames,
                   f"Space colonisation: {len(att)} mirrored attractors in the outer {band}-cell band pull the "
                   f"nearest vein cell one 8-direction step at a time (radius {radius}, kill {kill}); a step is "
                   "refused if it would make a 2x2 block or touch another vein orthogonally. Top: spine + tip dots.")


# ---------------------------------------------------------------------------------------------
# 2. Coral seeds: invasion percolation on noise, D4 ring
# ---------------------------------------------------------------------------------------------

@recipe(
    "coral_seeds", section="growth", title="Coral seeds",
    description="Invasion percolation in a ring band: from a few seeds per 1/8 wedge the coral always "
                "creeps into the cheapest neighbouring cell of a smooth noise field, but only where the lace "
                "rule allows (no 2x2, at most one orthogonal neighbour). D4 symmetric.",
    params={
        "size": Param(29, 15, 45, 2),
        "thickness": Param(5.0, 2, 10, 0.5, description="ring band thickness"),
        "inset": Param(0.0, 0, 8, 0.5, description="outer radius inset from the canvas edge"),
        "seeds": Param(2, 1, 5, 1, description="seeds per 1/8 wedge"),
        "scale": Param(0.3, 0.05, 1.0, 0.05, description="noise frequency"),
        "white": Param(0.4, 0.0, 2.0, 0.1, description="white-noise share of the resistance"),
        "density": Param(0.40, 0.15, 0.6, 0.025, description="stop at this fill of the band"),
        "strict": Param(2, 2, 4, 1, description="max filled 8-neighbours for a new cell"),
        "layers": Param(2, 1, 3, 1),
        "sym": Param("d4", choices=["d4", "d2"]),
    },
    tags=["growth", "invasion-percolation", "ring", "d4"])
def coral_seeds(seed, size, thickness, inset, seeds, scale, white, density, strict, layers, sym):
    rng = np.random.default_rng(seed)
    n = _odd(size)
    c = (n - 1) / 2
    ro = n / 2 - inset
    ri = ro - thickness
    y, x = np.mgrid[0:n, 0:n]
    r = np.hypot(x - c, y - c)
    band = (r <= ro) & (r >= ri)
    res = sym_noise(n, n, scale, sym, white=white, seed=seed)
    seed_m = np.zeros((n, n), bool)
    rm = (ri + ro) / 2
    for _ in range(seeds):
        a = rng.uniform(0, math.pi / 4)
        rr = rm + rng.uniform(-thickness / 4, thickness / 4)
        sx, sy = int(round(c + rr * math.cos(a))), int(round(c + rr * math.sin(a)))
        for p, q in G.orbit(sx, sy, n, n, sym):
            if band[q, p]:
                seed_m[q, p] = True
    seed_m = G.break_blocks(seed_m, sym)
    target = int(density * band.sum())
    fr = G.Frames()
    lid = 1 if layers == 1 else 2
    step = max(1, target // ((8 if sym == "d4" else 4) * 14))
    coral = G.invasion_percolation(seed_m, band, res, target, sym, 1, strict, snap_every=step,
                                   on_snap=lambda m: fr.add(f"{int(m.sum())} cells", {lid: m}))
    coral = G.lace_clean(coral, sym, 3)
    out = {lid: coral}
    if layers >= 2:
        out[1] = seed_m & coral  # the seeds as jewel dots on top
    if layers >= 3:
        out[3] = morph.close(morph.dilate(coral, 1, 4), 1, 8) & morph.dilate(band, 1, 4)
    return _design(out, fr,
                   f"Invasion percolation: resistance = D4-symmetric fbm noise (scale {scale}) + {white} white noise; "
                   f"from {seeds} seed(s) per 1/8 wedge always grow into the cheapest perimeter cell that keeps "
                   f"<=1 orthogonal and <={strict} 8-neighbours and no 2x2 block; stop at {density:.0%} of the band.")


# ---------------------------------------------------------------------------------------------
# 3. DLA reliquary: DLA / dielectric breakdown from a seed motif inside a silhouette
# ---------------------------------------------------------------------------------------------

def _motif(kind: str, w: int, h: int) -> np.ndarray:
    cx, cy = w // 2, h // 2
    m = np.zeros((h, w), bool)
    if kind == "cross":
        av, ah = max(2, h // 5), max(1, w // 6)
        m[cy - av:cy + av + 1, cx] = True
        m[cy, cx - ah:cx + ah + 1] = True
    elif kind == "ring":
        rr = max(2, min(w, h) // 6)
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.hypot(xx - cx, yy - cy)
        m = (np.rint(d) == rr)
        m = morph.skeletonize(m | (np.abs(d - rr) < 0.5))
        m = G.sym_or(m, "d2")
    elif kind == "spine":
        av = max(2, h // 3)
        m[cy - av:cy + av + 1, cx] = True
    else:  # dot
        m[cy, cx] = True
        for dx, dy in G.N4:
            m[cy + dy, cx + dx] = True
    return m


@recipe(
    "dla_reliquary", section="growth", title="DLA reliquary",
    description="Diffusion-limited aggregation (or dielectric breakdown / Lichtenberg with exponent eta) "
                "grown from a small motif (cross, ring, dot, spine) inside a silhouette; every stick adds a "
                "whole mirror orbit and growth stops at a target fill, so it stays restrained.",
    params={
        "width": Param(17, 9, 41, 2), "height": Param(25, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "oval", "octagon", "shield", "lozenge"]),
        "motif": Param("cross", choices=["cross", "ring", "dot", "spine"]),
        "mode": Param("dla", choices=["dla", "dbm"]),
        "eta": Param(1.5, 0.0, 4.0, 0.25, description="DBM exponent: 0 = Eden blob, 1 = DLA-like, >2 = sparse lightning"),
        "stick": Param(0.4, 0.05, 1.0, 0.05, description="DLA sticking probability (low = fatter coral)"),
        "fill": Param(0.15, 0.05, 0.45, 0.01, description="stop at this fraction of the silhouette"),
        "frame": Param(True, description="add the silhouette outline (backplate gets a rim)"),
        "layers": Param(3, 1, 3, 1),
        "trunk_min": Param(4, 2, 20, 1, description="middle layer keeps branches carrying >= this many cells"),
    },
    tags=["growth", "dla", "dbm", "d2"])
def dla_reliquary(seed, width, height, shape, motif, mode, eta, stick, fill, frame, layers, trunk_min):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = G.silhouette(shape, w, h)
    kind = "x" if shape == "shield" else "d2"
    dist = M.distance_from_edge(sil)
    allowed = sil & (dist >= (2.5 if frame else 1.5))
    mot = _motif(motif, w, h) & allowed
    target = int(fill * sil.sum()) + int(mot.sum())
    fr = G.Frames()
    lid = layers
    rim = sil & (dist < 1.5)
    age = np.where(mot, 0, -1)
    snap = lambda m: fr.add(f"{int(m.sum())} cells", {lid: m | (rim if frame else False)})
    per = 4 if kind == "d2" else 2
    step = max(1, (target - mot.sum()) // (per * 14))
    if mode == "dla":
        cl = G.dla(mot, allowed, target, rng, kind, stick, max_orth=2, max_n8=3,
                   launch=allowed & (dist <= 3.5), snap_every=step, on_snap=snap, age=age)
    else:
        cl = G.dbm(mot, allowed, target, rng, kind, eta, max_orth=1, max_n8=2, snap_every=step, on_snap=snap,
                   age=age)
    cl = G.break_blocks(cl, kind, protect=mot)
    cl = G.connect_to(cl, mot, kind) | mot
    lace = cl | (rim if frame else np.zeros_like(cl))
    out = {lid: lace}
    if layers >= 2:
        out[1] = mot
    if layers >= 3:
        out[2] = G.trunk(cl, np.where(cl, age, -1), trunk_min, kind) | mot
    how = (f"DLA walkers launched near the rim stick with p={stick}" if mode == "dla"
           else f"dielectric breakdown: Laplace potential solved around the cluster, growth chance ~ phi^{eta}")
    return _design(out, fr, f"{how}; seed motif '{motif}'; each event adds a mirror orbit; refuses 2x2 blocks; "
                            f"stops at {fill:.0%} of the {shape}. Layers: cluster (+rim) at the bottom, its trunk (branches carrying many cells) in the middle, the motif on top.")


# ---------------------------------------------------------------------------------------------
# 7. Lichen rim: Eden-style crust growing inward from the frame
# ---------------------------------------------------------------------------------------------

@recipe(
    "lichen_rim", section="growth", title="Lichen rim",
    description="A lichen crust creeping inward from the silhouette's rim: lace-rule invasion growth whose "
                "resistance rises with depth, so the crust is dense at the edge and frays into tendrils "
                "toward a calm centre that holds a small cross.",
    params={
        "width": Param(15, 9, 41, 2), "height": Param(23, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "oval", "octagon", "shield", "circle"]),
        "depth": Param(1.2, 0.2, 4, 0.1, description="how strongly growth prefers the rim"),
        "scale": Param(0.35, 0.05, 1.0, 0.05),
        "fill": Param(0.32, 0.1, 0.6, 0.02, description="fraction of the silhouette to cover"),
        "rim": Param("none", choices=["solid", "dashed", "none"], description="seed frame"),
        "motif": Param(True, description="small cross on a top layer in the calm centre"),
        "strict": Param(3, 2, 4, 1),
    },
    tags=["growth", "eden", "lichen", "d2"])
def lichen_rim(seed, width, height, shape, depth, scale, fill, rim, motif, strict):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    if shape == "circle":
        w = h = max(w, h)
        sil = M.circle(h, w)
        kind = "d4"
    else:
        sil = G.silhouette(shape, w, h)
        kind = "x" if shape == "shield" else "d2"
    dist = M.distance_from_edge(sil)
    edge = sil & (dist < 1.5)
    seed_m = edge.copy()
    if rim == "dashed":
        # keep rim cells in short runs: break by a symmetric noise mask
        n = sym_noise(h, w, 0.5, kind if kind != "x" else "x", seed=seed + 7)
        seed_m &= n > 0.45
        seed_m = morph.remove_small(seed_m, 2)
    elif rim == "none":
        cand = np.argwhere(edge)
        pick = cand[rng.choice(len(cand), size=max(1, len(cand) // 10), replace=False)]
        seed_m = np.zeros_like(edge)
        for y, x in pick:
            for a, b in G.orbit(int(x), int(y), w, h, kind):
                seed_m[b, a] = True
    seed_m = G.sym_and(seed_m, kind)
    if seed_m.sum() < 4:
        seed_m = edge.copy()
    res = sym_noise(h, w, scale, kind, white=0.3, seed=seed) + depth * (dist / max(dist.max(), 1))
    allowed = sil.copy()
    cx, cy = w // 2, h // 2
    mot = np.zeros_like(sil)
    if motif:
        a = max(1, min(w, h) // 7)
        mot[cy - a - 1:cy + a + 2, cx] = True
        mot[cy, cx - a:cx + a + 1] = True
        allowed &= ~morph.dilate(mot, 2, 8)  # breathing gap around the motif
    target = int(fill * sil.sum())
    fr = G.Frames()
    lid = 2 if motif else 1
    per = 8 if kind == "d4" else 4 if kind == "d2" else 2
    crust = G.invasion_percolation(seed_m, allowed, res, target, kind, 1 if strict < 4 else 2, strict,
                                   snap_every=max(1, (target - seed_m.sum()) // (per * 14)),
                                   on_snap=lambda m: fr.add(f"{int(m.sum())} cells", {lid: m}))
    crust = G.lace_clean(crust, kind, 3, protect=seed_m)
    out = {lid: crust}
    if motif:
        out[1] = mot
    return _design(out, fr,
                   f"Lace-rule invasion percolation seeded on a {rim} rim; resistance = symmetric noise + "
                   f"{depth} x depth, so growth hugs the edge and frays inward; stops at {fill:.0%} of the "
                   f"{shape}; a 2-cell breathing gap keeps the centre for the cross.")
