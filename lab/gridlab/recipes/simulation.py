"""Simulation recipes: slime mould (physarum), reaction-diffusion, smoothing CA, pulsing mould.

Continuous simulations run on a 2-4x finer grid inside the silhouette, are mirror-averaged every
step, then downsampled, thresholded and thinned to 1-cell lace.
"""

from __future__ import annotations

import math

import numpy as np

from ..model import Design
from ..ops import masks as M
from ..ops import morph
from ..ops import growth_ops as G
from ..ops.fields import downsample, sym_noise, upsample_mask
from . import Param, recipe, register_section

register_section(
    "simulation", "Simulations",
    "Processes that run in time: slime-mould agents feeding between a motif and its frame, "
    "Gray-Scott reaction-diffusion in a band, a smoothing cave CA thinned to veins, and a mould "
    "that pulses out and retracts, leaving tide rings. Frames show the process.")


def _odd(n: int) -> int:
    return n if n % 2 else n + 1


def _design(layers, frames: G.Frames, notes: str, n: int = 16) -> Design:
    return Design.from_masks(layers, notes=notes, frames=frames.out(n, final=layers))


# ---------------------------------------------------------------------------------------------
# 4. Physarum feeding
# ---------------------------------------------------------------------------------------------

def _frame_nodes(sil, n, rng, kind):
    """n food points per quadrant on the rim (mirrored)."""
    h, w = sil.shape
    dist = M.distance_from_edge(sil)
    rim = sil & (dist < 1.5)
    q = np.argwhere(rim)
    q = q[(q[:, 1] <= w // 2) & (q[:, 0] <= h // 2)]
    out = np.zeros_like(sil)
    if len(q) == 0 or n <= 0:
        return out
    # spread: pick from evenly spaced angular slots
    ang = np.arctan2(h // 2 - q[:, 0], w // 2 - q[:, 1])
    order = np.argsort(ang)
    slots = np.array_split(order, n)
    for sl in slots:
        if len(sl):
            y, x = q[sl[rng.integers(len(sl))]]
            for a, b in G.orbit(int(x), int(y), w, h, kind):
                out[b, a] = True
    return out


@recipe(
    "physarum_feeding", section="simulation", title="Physarum feeding",
    description="Jeff Jones' slime-mould model: agents sense, turn toward and deposit trail on a 4x finer "
                "grid; food sits at the cross ends and at points on the frame, so the mould grows tubes that "
                "link motif to frame. Trail mirror-averaged each step, then pooled, thresholded and thinned.",
    params={
        "width": Param(15, 9, 41, 2), "height": Param(25, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "oval", "octagon", "shield"]),
        "motif": Param("cross", choices=["cross", "lorraine", "spine", "dot", "none"]),
        "food": Param("nodes", choices=["nodes", "frame", "motif"], description="where the frame-side food is"),
        "nodes": Param(3, 1, 5, 1, description="food points per quadrant on the frame"),
        "agents": Param(0.35, 0.1, 1.0, 0.05, description="agents per hi-res pixel"),
        "steps": Param(80, 40, 600, 10),
        "sensor_angle": Param(45.0, 10, 80, 5),
        "turn_angle": Param(45.0, 10, 80, 5),
        "sensor_dist": Param(6.0, 2, 12, 0.5, description="in hi-res pixels (4 = one cell)"),
        "decay": Param(0.2, 0.02, 0.5, 0.02),
        "wiggle": Param(0.4, 0.0, 1.2, 0.05, description="random heading jitter (radians): 0 = clean Steiner tubes"),
        "keep": Param(0.5, 0.1, 0.7, 0.02, description="share of the silhouette kept as trail before thinning"),
        "prune": Param(1, 0, 6, 1, description="shave dangling tendrils this many cells (0 = hairy)"),
        "layers": Param(3, 1, 3, 1),
    },
    tags=["simulation", "physarum", "mould", "d2"])
def physarum_feeding(seed, width, height, shape, motif, food, nodes, agents, steps, sensor_angle, turn_angle,
                     sensor_dist, decay, wiggle, keep, prune, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    s = 4
    sil = G.silhouette(shape, w, h)
    kind = "x" if shape == "shield" else "d2"
    dist = M.distance_from_edge(sil)
    rim = sil & (dist < 1.5)
    cx, cy = w // 2, h // 2
    mot = np.zeros((h, w), bool)
    av = max(2, int(h * 0.22))
    ah = max(1, int(w * 0.2))
    if motif in ("cross", "spine", "lorraine"):
        mot[cy - av:cy + av + 1, cx] = True
        if motif == "cross":
            mot[cy, cx - ah:cx + ah + 1] = True
        if motif == "lorraine":
            by = cy - max(1, av // 2)
            mot[by, cx - ah:cx + ah + 1] = True
            if kind == "d2":
                mot = G.sym_or(mot, "y")
    elif motif == "dot":
        mot[cy, cx] = True
    mot &= sil & (dist >= 2.5)
    ends = G.tips(mot) | (mot if motif == "dot" else np.zeros_like(mot))
    if food == "frame":
        fside = rim
    elif food == "motif":
        fside = np.zeros_like(sil)
    else:
        fside = _frame_nodes(sil, nodes, rng, kind)
    food_m = ends | fside | (mot if food == "motif" else np.zeros_like(mot))
    allowed_hi = upsample_mask(sil, s)
    # frame-side food is spread thin when it is the whole rim, so it does not swamp the motif food
    fw = min(1.0, 4.0 * max(1, nodes) / max(1, int(fside.sum())))
    food_hi = upsample_mask(ends | (mot if food == "motif" else np.zeros_like(mot)), s) * 1.0 \
        + upsample_mask(fside, s) * fw
    spawn = None
    fr = G.Frames()
    lid = layers

    def extract(trail, thin=True):
        t = downsample(trail, s, "mean")
        net = G.sym_and(t > np.quantile(t[sil & ~food_m], 1 - keep), kind) & sil
        net |= food_m | mot
        thick = G.connect_to(net, food_m | mot, kind)
        if not thin:
            return thick, thick
        sk = morph.skeletonize(thick) | mot | food_m
        sk = G.sym_or(sk, kind) & thick
        sk = G.prune_spurs(sk, 2, keep=food_m | mot)
        sk = G.break_blocks(sk, kind, protect=mot | food_m)
        sk = G.smooth_corners(sk, kind, keep=mot)
        sk = G.prune_spurs(sk, prune, keep=mot)
        sk = G.connect_to(sk, food_m | mot, kind)
        return thick, sk

    def snap(trail):
        _, sk = extract(trail)
        fr.add("", {lid: sk})

    trail = G.physarum(allowed_hi, food_hi, rng, n_agents=int(agents * allowed_hi.sum()), steps=steps,
                       sa=math.radians(sensor_angle), ra=math.radians(turn_angle), so=sensor_dist,
                       decay=decay, kind=kind, spawn=spawn, food_amt=10.0, wiggle=wiggle,
                       snap_every=max(1, steps // 14), on_snap=snap)
    thick, net = extract(trail)
    for i, (lab, fl) in enumerate(fr.items):
        fr.items[i] = (f"t={(i + 1) * max(1, steps // 14)}", fl)
    out = {lid: net | (rim if food == "frame" else np.zeros_like(net))}
    if layers >= 2:
        out[1] = mot if mot.any() else (G.tips(net) | G.junctions(net))
    if layers >= 3:
        # middle: the net's busiest tubes = trail above a higher quantile, thinned, + motif
        t = downsample(trail, s, "mean")
        strong = G.sym_and(t > np.quantile(t[sil], 1 - keep * 0.45), kind) & net
        out[2] = G.connect_to(strong | mot, mot if mot.any() else food_m, kind) | mot
    return _design(out, fr,
                   f"Jones physarum: {int(agents * allowed_hi.sum())} agents on a {s}x grid, sensor angle "
                   f"{sensor_angle}deg, turn {turn_angle}deg, decay {decay}; food at the motif ends + frame {food}; "
                   f"trail mirror-averaged each step, mean-pooled, top {keep:.0%} kept, thinned, spurs pruned. "
                   "Bottom = network, middle = its busiest tubes, top = motif.")


# ---------------------------------------------------------------------------------------------
# 5. Gray-Scott band
# ---------------------------------------------------------------------------------------------

REGIMES = {
    "coral": (0.0545, 0.062),
    "mitosis": (0.0367, 0.0649),
    "worms": (0.078, 0.061),
    "maze": (0.029, 0.057),
    "spots": (0.03, 0.062),
}


@recipe(
    "gray_scott_band", section="simulation", title="Gray-Scott band",
    description="Gray-Scott reaction-diffusion on a 4x grid with no-flux edges; the kill rate rises past an "
                "outer band so the pattern dies out and the interior stays calm. One field, thresholded at 2-3 levels, gives nested "
                "layers: the wide coral at the bottom, its cores above.",
    params={
        "width": Param(15, 9, 41, 2), "height": Param(25, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "oval", "octagon", "ring"]),
        "regime": Param("coral", choices=list(REGIMES)),
        "band": Param(0.0, 0, 12, 0.5, description="pattern only within this distance of the edge; 0 = everywhere"),
        "spots": Param(10, 1, 40, 1, description="seed spots per quadrant"),
        "steps": Param(3000, 500, 8000, 250),
        "scale": Param(4, 2, 4, 1, description="sim resolution per cell"),
        "diffusion": Param(0.12, 0.06, 0.3, 0.01, description="Du (Dv = Du/2): larger = bigger features"),
        "fill": Param(0.42, 0.2, 0.6, 0.02, description="bottom layer fill of the band"),
        "layers": Param(2, 1, 3, 1),
        "thin": Param(False, description="thin the bottom layer to 1-cell lace"),
        "calm": Param("cut", choices=["cut", "fade"],
                      description="interior: cut the full pattern to the band, or raise the kill rate so it dies out"),
    },
    tags=["simulation", "reaction-diffusion", "d2"])
def gray_scott_band(seed, width, height, shape, regime, band, spots, steps, scale, diffusion, fill, layers, thin,
                    calm):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    if shape == "ring":
        w = h = max(w, h)
    s = scale
    sil = G.silhouette(shape, w, h, ring_thickness=max(band, 2))
    kind = "d4" if (shape == "ring" and w == h) else "d2"
    dist = M.distance_from_edge(sil)
    bandm = sil & (dist <= band + 0.01) if band > 0 else sil.copy()
    hi = upsample_mask(sil, s)
    # calm interior: the kill rate rises smoothly past the band, so the pattern dies out organically
    f, k = REGIMES[regime]
    if band > 0 and calm == "fade":
        dist_hi = M.distance_from_edge(hi) / s
        ramp = np.clip((dist_hi - band) / 1.5, 0, 1)
        k = k + (0.075 - k) * ramp
    # many small mirrored seed spots in the band
    seeds_hi = np.zeros_like(hi)
    q = np.argwhere(upsample_mask(bandm, s))
    H2, W2 = hi.shape
    for i in rng.choice(len(q), size=min(spots * 4, len(q)), replace=False):
        y, x = q[i]
        sp = np.zeros_like(hi)
        sp[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
        seeds_hi |= sp
    seeds_hi = G.sym_or(seeds_hi, kind) & hi
    fr = G.Frames()
    snaps = []
    V = G.gray_scott(hi, seeds_hi, f, k, diffusion, diffusion / 2, steps, kind, rng,
                     snap_every=max(1, steps // 14), on_snap=lambda v: snaps.append(v.copy()))

    def layers_from(Vh):
        v = downsample(Vh, s, "mean") * bandm
        if v.max() <= 1e-6:
            z = np.zeros_like(bandm)
            return {i: z for i in range(1, layers + 1)}
        vals = v[bandm]
        t0 = np.quantile(vals, 1 - fill)
        bottom = G.sym_and(v > t0, kind) & bandm
        if thin:
            bottom = G.sym_or(morph.skeletonize(bottom), kind) & bottom
            bottom = G.break_blocks(bottom, kind)
        bottom = morph.remove_small(bottom, 3)
        out = {layers: bottom}
        if layers >= 2:
            t1 = np.quantile(vals, 1 - fill * (0.45 if layers == 2 else 0.6))
            mid = G.sym_and(v > t1, kind) & bottom
            out[layers - 1] = morph.remove_small(mid, 2)
        if layers >= 3:
            t2 = np.quantile(vals, 1 - fill * 0.25)
            out[1] = morph.remove_small(G.sym_and(v > t2, kind) & out[2], 2)
        return out

    for i, v in enumerate(snaps):
        fr.add(f"t={(i + 1) * max(1, steps // 14)}", layers_from(v))
    out = layers_from(V)
    return _design(out, fr,
                   f"Gray-Scott f={f}, k={REGIMES[regime][1]} ('{regime}'), Du={diffusion}, {steps} steps on a {s}x grid, "
                   f"no-flux edges, kill rate ramps up past a {band}-cell band; mirror-averaged every 200 steps; mean-pooled, "
                   f"bottom = top {fill:.0%} of V{' thinned' if thin else ''}, upper layers = higher thresholds.")


# ---------------------------------------------------------------------------------------------
# 6. Cave skeleton
# ---------------------------------------------------------------------------------------------

@recipe(
    "cave_skeleton", section="simulation", title="Cave skeleton",
    description="Symmetric noise at 2x resolution smoothed by a majority-rule CA into rounded caves, then "
                "Zhang-Suen thinned: the medial lines form closed mould cells. The pre-thinning blobs are "
                "the backplate.",
    params={
        "width": Param(15, 9, 41, 2), "height": Param(25, 11, 51, 2),
        "shape": Param("capsule", choices=["capsule", "oval", "octagon", "shield", "lozenge"]),
        "density": Param(0.48, 0.3, 0.65, 0.01),
        "iters": Param(4, 1, 10, 1),
        "band": Param(0.0, 0, 10, 0.5, description="0 = whole silhouette, else only this outer band"),
        "invert": Param(True, description="thin the gaps (walls between caves, closed loops; default) instead of the blobs (raw: blob backplate + medial lines)"),
        "spurs": Param(0, 0, 6, 1, description="prune dangling ends this many times"),
        "layers": Param(2, 1, 2, 1),
    },
    tags=["simulation", "ca", "skeleton", "d2"])
def cave_skeleton(seed, width, height, shape, density, iters, band, invert, spurs, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = G.silhouette(shape, w, h)
    kind = "x" if shape == "shield" else "d2"
    dist = M.distance_from_edge(sil)
    area = sil & ((dist <= band) if band > 0 else True)
    s = 2
    hi = upsample_mask(area, s)
    H2, W2 = hi.shape
    noise = rng.random((H2, W2)) < density
    noise = _sym_hi(noise, kind)
    fr = G.Frames()
    lid = layers
    blobs_hi = G.majority_ca(noise, hi, iters, 5, 4, kind,
                             on_snap=lambda m: fr.add("ca", {lid: downsample(m, s, "any") & area}))
    src = (hi & ~blobs_hi) if invert else blobs_hi
    sk_hi = morph.skeletonize(src)
    sk = downsample(sk_hi, s, "any") & area
    sk = G.sym_or(morph.skeletonize(sk), kind) & sk
    sk = G.prune_spurs(sk, spurs)
    sk = G.lace_clean(sk, kind, 3)
    blobs = downsample(blobs_hi, s, "mean") >= 0.5
    blobs = G.sym_and(blobs, kind) & area
    out = {lid: sk}
    if layers >= 2 and not invert:
        back = morph.remove_small(blobs | sk, 4)
        out = {2: back, 1: sk & back}
        lid = 2
    elif layers >= 2:
        # walls between caves at the bottom; their junction knots as dots on top
        out = {2: sk, 1: G.sym_or(G.junctions(sk) | (sk & (morph.neighbour_count(sk, 8) >= 4)), kind) & sk}
        lid = 2
    fr.add("thinned", {lid: sk} if layers == 1 else {2: out[2], 1: out[1]})
    for i, (lab, fl) in enumerate(fr.items[:-1]):
        fr.items[i] = (f"ca {i + 1}", fl)
    return _design(out, fr,
                   f"Noise p={density} at 2x, {iters} majority-rule CA steps (on if >=5 of 9) -> rounded caves; "
                   f"Zhang-Suen thinning of the {'gaps' if invert else 'blobs'}, OR-pooled to 1x, rethinned, "
                   f"spurs pruned {spurs}x. Bottom = smoothed blobs, top = skeleton.")


def _sym_hi(m, kind):
    """Symmetrise a 2x hi-res mask by copying the top-left quadrant (exact pixel mirror)."""
    H, W = m.shape
    out = m.copy()
    if kind in ("x", "d2"):
        out[:, W - W // 2:] = out[:, :W // 2][:, ::-1]
    if kind == "d2":
        out[H - H // 2:, :] = out[:H // 2, :][::-1]
    return out


# ---------------------------------------------------------------------------------------------
# 8. Pulsing mould (own idea): grow outward, retract, leave tide rings
# ---------------------------------------------------------------------------------------------

@recipe(
    "pulse_mould", section="simulation", title="Pulsing mould",
    description="A mould that breathes: each pulse it creeps outward (lace-rule invasion growth) to a new "
                "radius, then retracts, keeping only its main veins and the tide mark where the front "
                "stalled. Repeated pulses leave concentric broken rings tied together by veins, like a sigil.",
    params={
        "size": Param(29, 15, 45, 2),
        "shape": Param("circle", choices=["circle", "capsule", "octagon"]),
        "pulses": Param(3, 2, 6, 1),
        "growth": Param(0.45, 0.2, 0.7, 0.05, description="fill of each pulse's annulus before retracting"),
        "vein": Param(4, 2, 20, 1, description="veins kept = branches carrying >= this many cells"),
        "tide": Param(1.2, 0.6, 2.5, 0.1, description="width of the kept tide mark"),
        "scale": Param(0.25, 0.05, 1.0, 0.05),
        "motif": Param("cross", choices=["cross", "dot", "ring"]),
        "link": Param(False, description="also keep the paths that fed each tide mark (no floating rings)"),
        "layers": Param(3, 1, 3, 1),
    },
    tags=["simulation", "growth", "mould", "rings", "d4"])
def pulse_mould(seed, size, shape, pulses, growth, vein, tide, scale, motif, link, layers):
    rng = np.random.default_rng(seed)
    n = _odd(size)
    if shape == "circle":
        w = h = n
        sil = M.circle(h, w)
        kind = "d4"
    else:
        w, h = _odd(int(n * 0.66)), n
        sil = G.silhouette(shape, w, h)
        kind = "d2"
    cx, cy = w // 2, h // 2
    y, x = np.mgrid[0:h, 0:w]
    dist_e = M.distance_from_edge(sil)
    # normalised "radius" 0 at centre, 1 at the rim, following the silhouette
    rad = 1 - dist_e / dist_e.max()
    mot = np.zeros((h, w), bool)
    if motif == "cross":
        a = max(1, min(w, h) // 10)
        mot[cy - a:cy + a + 1, cx] = True
        mot[cy, cx - a:cx + a + 1] = True
    elif motif == "ring":
        r = np.hypot(x - cx, y - cy)
        mot = G.sym_or(morph.skeletonize(np.abs(r - 1.6) < 0.75), kind)
    else:
        mot[cy, cx] = True
    res = sym_noise(h, w, scale, kind, white=0.5, seed=seed)
    struct = mot.copy()
    age = np.where(mot, 0, -1)
    fr = G.Frames()
    lid = layers
    r0 = rad[mot].max() if mot.any() else 0
    rings = np.zeros_like(sil)
    veins_all = mot.copy()
    for p in range(1, pulses + 1):
        r_k = r0 + (1 - r0) * p / pulses
        allowed = sil & (rad <= r_k + 1e-9) & (dist_e >= 1)
        ann = allowed & (rad > r0 + (1 - r0) * (p - 1) / pulses)
        target = int(struct.sum() + growth * ann.sum())
        age_p = np.where(struct, 0, -1)
        grown = G.invasion_percolation(struct, allowed, res + rng.random(res.shape) * 0.0, target, kind,
                                       1, 3, snap_every=max(1, int(growth * ann.sum()) // 16),
                                       on_snap=lambda m: fr.add(f"pulse {p} grow", {lid: m}), age=age_p)
        fr.add(f"pulse {p} grown", {lid: grown})
        # retract: keep main veins (big subtrees) and the stalled front (tide mark)
        veins = G.trunk(grown, age_p, vein, kind) | struct
        edge_k = grown & ~struct & (np.abs(rad - r_k) * dist_e.max() <= tide)
        kept = veins | edge_k | (G.ancestors(grown, age_p, edge_k) if link else False)
        kept = G.sym_and(kept, kind)
        kept = G.break_blocks(kept, kind, protect=struct)
        kept = morph.remove_small(kept, 3)
        rings |= edge_k & kept
        veins_all |= G.trunk(grown, age_p, vein * 2, kind) & kept
        struct = kept | mot
        fr.add(f"pulse {p} retract", {lid: struct})
    final = G.connect_to(G.lace_clean(struct, kind, 3, protect=mot) | mot, mot, kind) | mot
    out = {lid: final}
    if layers >= 2:
        out[1] = mot
    if layers >= 3:
        out[2] = G.connect_to((veins_all & final) | mot, mot, kind) | mot
    return _design(out, fr,
                   f"{pulses} pulses: lace-rule invasion growth (noise resistance) out to a new radius, then "
                   f"retraction keeping only veins (subtrees >= {vein} cells) and the tide mark at the front. "
                   "Bottom = all that is left, middle = veins, top = motif.", n=24)
