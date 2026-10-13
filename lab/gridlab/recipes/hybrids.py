"""Hybrids: ancient exact structures meeting organic growth (research-esoteric §4, §5).

Every recipe = one symbolic skeleton (sigil, glyph, labyrinth, kolam, Tree of Life) + ONE organic
process that is fed by it, aimed at it, or fenced off from it (reserved voids). All emit frames.
Helpers live in ``gridlab.ops.hybrid_ops``.
"""

from __future__ import annotations

import math

import numpy as np

from ..model import Design
from ..ops import glyphs as GL
from ..ops import growth_ops as G
from ..ops import hybrid_ops as H
from ..ops import masks as M
from ..ops import morph
from ..ops import sigils as S
from ..ops.fields import downsample, sym_noise, upsample_mask
from . import Param, recipe, register_section

register_section(
    "hybrids", "Mould meets the sacred",
    "Exact ancient structures - kamea sigils, the Tree of Life, the Cretan labyrinth, kolam threads, "
    "relic windows - handed to living processes: slime mould feeding on the sephirot, lightning aimed at a "
    "glyph, coral that eats a labyrinth but never its path. The symbol is the skeleton, the growth its servant; "
    "watch the frames.")

WORDS = ["AGIEL", "LUX", "NOX", "SOPHIA", "AMOR", "VITA", "ANIMA", "LUNA", "STELLA", "FIDES", "IGNIS", "MATER"]


def _odd(n: int) -> int:
    return n if n % 2 else n + 1


def _design(layers: dict, frames: G.Frames, notes: str, n: int = 18) -> Design:
    layers = {k: np.asarray(v, bool) for k, v in layers.items()}
    shape = next(iter(layers.values())).shape
    items = []
    for lab, fl in frames.out(n, final=layers):  # frames carry exactly the final layer ids
        items.append((lab, {k: (fl[k] if k in fl else np.zeros(shape, bool)) for k in layers}))
    return Design.from_masks(layers, notes=notes, frames=items)


def _outline(sil):
    """1-cell 8-connected inner outline of a silhouette."""
    return sil & ~morph.erode(np.pad(sil, 1), 1, conn=4)[1:-1, 1:-1]


def _word(name: str, seed: int) -> str:
    return name.strip().upper() if name.strip() else WORDS[seed % len(WORDS)]


# =============================================================================================
# P7 Sigil Mycelium
# =============================================================================================

@recipe(
    "sigil_mycelium", section="hybrids", title="Sigil mycelium",
    description="A name traced through the Mars kamea as a bilateral seal; mould (lace-rule invasion "
                "percolation) is planted at the sigil's vertices and spreads around it, but a 1-cell moat keeps "
                "every stroke legible - the mould touches the sigil only where it feeds, at the vertices.",
    params={
        "name": Param("", description="word to trace (empty = chosen by seed)"),
        "planet": Param("mars", choices=list(S.KAMEAS)),
        "shape": Param("capsule", choices=["capsule", "disc", "shield"]),
        "width": Param(21, 15, 33, 2), "height": Param(31, 17, 41, 2),
        "density": Param(0.4, 0.1, 0.6, 0.02, description="mould fill of its reach zone"),
        "reach": Param(8.0, 2, 14, 0.5, description="mould stays within this distance of the sigil"),
        "taps": Param(1, 1, 3, 1, description="feeding points per sigil vertex"),
        "trunk": Param(5, 2, 20, 1, description="middle layer keeps mould veins carrying >= this many cells"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "sigil", "mould", "d1"])
def sigil_mycelium(seed, name, planet, shape, width, height, density, reach, taps, trunk, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    if shape == "disc":
        w = h = max(w, h)
    word = _word(name, seed)
    sil = G.silhouette({"disc": "oval", "capsule": "capsule", "shield": "shield"}[shape], w, h)
    dist_e = M.distance_from_edge(sil)
    inner = sil & (dist_e >= 1.5)
    sg = S.sigil_trace(word, planet, w, h, seal=True, start="ring2", end_len=3)
    sig = sg["mask"] & sil & (dist_e >= 2.5)
    kind = "x"
    nodes = [p for p in sg["nodes"] if sig[p[1], p[0]]]
    frame = _outline(sil)
    region = sil & ~morph.dilate(frame, 1, 8)
    fr = G.Frames()
    nl = layers

    def snap(m):
        fr.add("", {nl: m | sig | frame, 1: sig})

    fr.add("sigil", {nl: sig | frame, 1: sig})
    age = np.full((h, w), -1)
    age[sig] = 0
    mould, tap = H.moat_coral(sig, region, nodes, rng, kind, density, reach, taps_per_node=taps,
                              snap_every=4, on_snap=snap, age=age)
    mould = G.lace_clean(mould, kind, 3)
    tap = tap & morph.dilate(mould, 1, 8)
    mould = G.connect_to(mould, tap, kind)
    from ..ops import composition as C

    base = C.connect(mould | tap | sig | frame, sil, "x", max_len=4)
    out = {1: sig, nl: base}
    if layers >= 3:
        age2 = np.where(mould | tap | sig, np.maximum(age, 0), -1)
        age2[sig | tap] = 0
        veins = G.trunk(mould | tap | sig, age2, trunk, kind) & mould
        out[2] = G.connect_to(veins | tap | sig, sig, kind)
    for i, (lab, fl) in enumerate(fr.items):
        fr.items[i] = (f"grow {i}" if i else "sigil", fl)
    return _design(out, fr,
                   f"'{word}' -> gematria -> {planet} kamea route, mirrored into a seal. Mould: lace-rule invasion "
                   f"percolation seeded 2 cells off each vertex, forbidden from the 1-cell moat, resistance = noise + "
                   f"distance to the sigil (reach {reach}). Base = petri dish: frame + all mould; middle = sigil + the "
                   "mould's main veins; top = the sigil alone.")


# =============================================================================================
# P19 Tree of Life Physarum
# =============================================================================================

@recipe(
    "tree_of_life_physarum", section="hybrids", title="Tree of Life physarum",
    description="The ten sephirot as food: slime-mould agents (Jones physarum, 4x grid) spawn at the nodes and "
                "discover tubes between them. Dangling hair is pruned until every tube runs node to node - the "
                "slime's own version of the 22 paths. Da'at stays an empty ring.",
    params={
        "pillar": Param(6, 4, 8, 1, description="distance between the pillars (cells)"),
        "level": Param(4, 3, 5, 1, description="distance between the levels (cells)"),
        "agents": Param(0.5, 0.15, 1.0, 0.05, description="agents per hi-res pixel"),
        "steps": Param(120, 60, 500, 20),
        "sensor": Param(6.0, 3, 12, 0.5),
        "decay": Param(0.3, 0.05, 0.5, 0.01),
        "keep": Param(0.45, 0.1, 0.7, 0.02, description="share of the field kept as trail before thinning"),
        "slime": Param(0.35, 0.15, 0.7, 0.02, description="base layer: share of the field kept as the slime body"),
        "daat": Param(True, description="draw Da'at as a hidden (empty) ring"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "physarum", "tree-of-life", "d1"])
def tree_of_life_physarum(seed, pillar, level, agents, steps, sensor, decay, keep, slime, daat, layers):
    rng = np.random.default_rng(seed)
    T = H.tree_of_life(pillar, level, 3)
    w, h = T["w"], T["h"]
    kind = "x"
    sil = G.silhouette("capsule", w, h)
    s = 4
    pts = list(T["nodes"].values())
    nodes_m = H.points_mask((h, w), pts)
    rings = H.node_rings((h, w), pts, 1)
    node_area = morph.dilate(nodes_m, 1, 8)
    if daat:
        dx, dy = T["daat"]
        daat_r = H.node_rings((h, w), [T["daat"]], 1)
    else:
        daat_r = np.zeros((h, w), bool)
    allowed_hi = upsample_mask(sil | node_area, s)
    food_hi = upsample_mask(nodes_m, s).astype(float)
    spawn = upsample_mask(morph.dilate(nodes_m, 1, 8), s)
    fr = G.Frames()

    def body(trail, q):
        t = downsample(trail, s, "mean")
        region = sil & ~node_area
        thr = np.quantile(t[region], 1 - q)
        net = G.sym_and(t > thr, kind) & sil
        return G.connect_to(net | node_area, nodes_m, kind)

    def extract(trail):
        net = body(trail, keep)
        sk = morph.skeletonize(net) | nodes_m
        sk = G.sym_or(sk, kind) & net
        sk &= ~node_area
        sk = sk | rings
        sk = H.prune_to(sk, rings)
        sk = G.break_blocks(sk, kind, protect=rings)
        sk = G.smooth_corners(sk, kind, keep=rings)
        sk = H.prune_to(sk, rings)
        sk = G.connect_to(sk, rings, kind)
        return sk | rings

    snaps = []
    trail = G.physarum(allowed_hi, food_hi, rng, n_agents=int(agents * allowed_hi.sum()), steps=steps,
                       sa=math.radians(40), ra=math.radians(40), so=sensor, decay=decay, kind=kind, spawn=spawn,
                       food_amt=12.0, wiggle=0.3, snap_every=max(1, steps // 14), on_snap=lambda t: snaps.append(t.copy()))
    for i, t in enumerate(snaps):
        sk = extract(t) & ~daat_r
        lay = {2: sk | daat_r, 1: rings | daat_r}
        if layers >= 3:
            lay[3] = (body(t, slime) & morph.dilate(sk, 1, 8)) | sk
        fr.add(f"t={(i + 1) * max(1, steps // 14)}", lay)
    net = extract(trail) & ~daat_r
    paths = net & ~rings
    out = {1: rings | daat_r, 2: net | daat_r}
    if layers >= 3:
        # base = the slime's own body: the trail at a looser threshold, unthinned
        b = body(trail, slime)
        b = morph.close(b, 1, 8) & (sil | node_area)
        b &= morph.dilate(net | daat_r, 1, 8)
        out[3] = G.sym_and(morph.remove_small(b, 6), kind) | net | daat_r
    _, npaths = morph.label(paths, 8)
    return _design(out, fr,
                   f"Jones physarum on a {s}x grid: {int(agents * allowed_hi.sum())} agents spawned at the ten "
                   f"sephirot (food every step), {steps} steps, mirror-averaged. Trail pooled, top {keep:.0%} kept, "
                   "thinned; dangling branches pruned until every tube ends at a node. Top = sephirot rings (+ empty "
                   "Da'at), middle = paths + rings, base = the slime body (looser trail threshold, unthinned).")


# =============================================================================================
# P20 Chiseled paths
# =============================================================================================

@recipe(
    "chiseled_paths", section="hybrids", title="Chiseled paths between sacred points",
    description="Start from a solid plate holding the sacred points (Tree of Life or the eight bagua points "
                "round a centre) and chisel it away cell by cell in noise order, never cutting the points apart. "
                "What remains is a random Steiner root system; a few cells are put back to braid small loops.",
    params={
        "nodes": Param("tree", choices=["tree", "bagua"]),
        "size": Param(31, 21, 41, 2, description="bagua canvas"),
        "scale": Param(0.25, 0.08, 0.6, 0.02, description="noise scale of the chisel order (low = long rivers)"),
        "white": Param(0.35, 0.0, 1.5, 0.05, description="white noise in the order (high = twiggy)"),
        "braid": Param(3, 0, 10, 1, description="loops closed again"),
        "conn": Param(8, choices=[4, 8], description="8 = diagonal slime bands, 4 = orthogonal staircases"),
        "frame": Param(True, description="the frame is a node too: roots anchor to the rim"),
        "relief": Param(0.45, 0.1, 2.0, 0.05, description="base = the plate frozen when it still had this many extra cells (x tree size)"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "chisel", "tree-of-life", "bagua"])
def chiseled_paths(seed, nodes, size, scale, white, braid, conn, frame, relief, layers):
    rng = np.random.default_rng(seed)
    if nodes == "tree":
        T = H.tree_of_life(6, 4, 3)
        w, h = T["w"], T["h"]
        pts = list(T["nodes"].values())
        sil = G.silhouette("capsule", w, h)
        kind = "x"
    else:
        w = h = _odd(size)
        r = w // 2 - 4
        pts = list(H.bagua_nodes(w, r).values())
        sil = M.circle(h, w)
        kind = "d4"
    rings = H.node_rings((h, w), pts, 1)
    terms = [H.node_rings((h, w), [p], 1) for p in pts]
    fr_m = _outline(sil) if frame else np.zeros((h, w), bool)
    if frame:
        terms.append(fr_m)
    gap = sil & morph.dilate(_outline(sil), 1, 8) & ~_outline(sil)
    fill = (sil & ~_outline(sil)) | rings | fr_m
    pr = sym_noise(h, w, scale, kind, white=white, seed=seed) - 1.0 * gap
    fr = G.Frames()
    fr.add("plate", {2: fill, 1: rings})
    hist = []

    def snap(m):
        hist.append(m.copy())
        if len(hist) % 5 == 0:
            fr.add("", {2: m, 1: rings})

    tree, removed = H.chisel(fill, terms, pr, kind, protect=rings | fr_m, conn=conn, on_snap=snap, snap_every=1)
    tree = H.braid(tree, removed, braid, kind)
    tree = G.break_blocks(tree, kind, protect=rings | fr_m)
    fr.items = [(f"chisel {i}" if i else "plate", fl) for i, (lab, fl) in enumerate(fr.items)]
    out = {1: rings, 2: tree}
    if layers >= 3:
        # the base is a fossil of the process: the plate as it was when `relief` of the chiseling was done
        n_tree = int(tree.sum())
        fossil = fill
        for hm in hist:
            if (hm & ~tree).sum() <= relief * n_tree:
                fossil = hm
                break
        fossil = G.sym_and(fossil | tree, kind) & sil
        out[3] = morph.remove_small(fossil, 4) | tree
        fr.add("fossil", {3: out[3], 2: tree, 1: rings})
    return _design(out, fr,
                   f"Chiseling: a plate holding {len(pts)} node rings{' and its frame' if frame else ''}; orbits removed "
                   f"in symmetric-noise order unless the rings would fall apart ({conn}-connectivity), leaving a minimal "
                   f"tree; {braid} cells re-added to close small loops. Top = node rings, middle = tree, base = the plate "
                   f"frozen while it still held {relief:.0%} extra material (a fossil of the process).")


# =============================================================================================
# P10 Overgrown labyrinth
# =============================================================================================

@recipe(
    "overgrown_labyrinth", section="hybrids", title="Overgrown labyrinth",
    description="A Cretan labyrinth in a petri dish: its outer wall is eaten (cells removed by noise, never "
                "splitting it) and coral mould creeps out of the wound into the dish. The walking "
                "path is a reserved void: nothing ever grows in it, so the pilgrimage stays readable.",
    params={
        "circuits": Param(5, choices=[3, 5, 7]),
        "style": Param("square", choices=["square", "octagon", "round"],
                       description="square reads best at pitch 2; round is the raw (noisy) variant"),
        "classical": Param(True, description="the classical 7-circuit sequence (else a seeded valid one)"),
        "decay": Param(0.5, 0.0, 1.0, 0.05, description="erosion strength of the outer wall"),
        "margin": Param(5, 3, 8, 1, description="width of the mould band outside the labyrinth"),
        "density": Param(0.4, 0.1, 0.7, 0.05, description="mould fill of the dish"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "labyrinth", "mould", "reserved-void"])
def overgrown_labyrinth(seed, circuits, style, classical, decay, margin, density, layers):
    from ..ops import labyrinth as LB
    from ..ops import composition as C

    rng = np.random.default_rng(seed)
    seq = LB.CRETAN if (classical and circuits == 7) else LB.sequence_for(circuits, seed)
    L = LB.labyrinth(seq, style, 2, "bottom", margin=margin)
    walls, path, disc = L["walls"], L["path"], L["disc"]
    n = L["size"]
    c = n // 2
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - c, yy - c)
    outer = M.circle(n, n)
    kind = "x" if np.array_equal(walls, walls[:, ::-1]) else "none"
    k2 = kind if kind != "none" else "x"
    frame = _outline(outer)
    goal_ring = walls & (r <= 3.6)
    spine = L["axis"]
    top = goal_ring | spine
    fr = G.Frames()
    fr.add("labyrinth", {3: walls | frame, 2: walls, 1: top})
    # decay: only the outermost wall ring is eaten (inner walls must keep the path readable)
    rim = walls & ~morph.erode(np.pad(disc, 1), 2, 8)[1:-1, 1:-1]
    noise = sym_noise(n, n, 0.35, kind, seed=seed)
    prob = decay * (0.3 + noise) * rim
    eroded = H.erode_connected(walls, prob, rng, kind, protect=~rim,
                               on_snap=lambda m: fr.add("decay", {3: walls | frame, 2: m, 1: top}), snap_every=2,
                               max_frac=0.12)
    # regrowth: coral out of the decayed rim into the dish (never into the path, never onto the frame)
    band = outer & ~disc & ~morph.dilate(frame, 1, 8)
    res = sym_noise(n, n, 0.3, kind, white=0.5, seed=seed + 7)
    target = int(eroded.sum() + density * band.sum())
    grown = G.invasion_percolation(eroded, band, res, target, k2, 1, 3, snap_every=4,
                                   on_snap=lambda m: fr.add("mould", {3: walls | frame | m, 2: m, 1: top}))
    mould = grown & ~eroded
    mould = G.break_blocks(mould, k2) & mould
    mould = morph.remove_small(mould | eroded, 3) & mould
    mid = eroded | mould
    out = {1: top, 2: mid}
    if layers >= 3:
        # the dish remembers the intact walls; mould bridged to the rim of the dish
        out[3] = C.connect(walls | mould | frame, outer & ~path, k2, max_len=3)
    return _design(out, fr,
                   f"Labyrinth {seq} ({style}); reserved void = the walking path. The outer wall is eaten orbit-wise "
                   f"(p = {decay} x noise, never split, max 12%), then lace-rule invasion growth out of it into the dish. "
                   "Top = the turning spine + goal ring, middle = decayed labyrinth + mould, base = intact walls + "
                   "mould + dish rim.", n=20)


# =============================================================================================
# P22 Lichtenberg annunciation
# =============================================================================================

@recipe(
    "lichtenberg_annunciation", section="hybrids", title="Lichtenberg annunciation",
    description="Divine lightning: dielectric breakdown grows down from a halo at the top. The glyph below is "
                "held at full potential and the walls are insulating, so the discharge is drawn to it and the "
                "growth ends when it strikes.",
    params={
        "width": Param(17, 13, 25, 2), "height": Param(41, 25, 45, 2),
        "eta": Param(1.25, 0.5, 4.0, 0.25, description="branching: low = bushy, high = a single bolt"),
        "glyph": Param("cross", choices=["cross", "bindrune", "ring", "monogram"]),
        "halo": Param(4, 3, 6, 1, description="halo radius"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "dbm", "lightning", "d1"])
def lichtenberg_annunciation(seed, width, height, eta, glyph, halo, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = G.silhouette("capsule", w, h)
    cx = w // 2
    hy = halo + 2
    halo_r = GL.ring_mask(h, w, halo, cx, hy)
    halo_d = GL.disc_mask(h, w, halo, cx, hy)
    g = np.zeros((h, w), bool)
    if glyph == "cross":
        gm = GL.prim_cross(2)
        gm[0:2, 2] = True
        gm = np.vstack([gm, np.zeros((2, 5), bool)])
        gm[5:7, 2] = True
    elif glyph == "bindrune":
        gm = S.bindrune(S.runes_for_text(WORDS[seed % len(WORDS)], 2), 1)["mask"]
    elif glyph == "ring":
        gm = GL.prim_ring(2, dot=True)
    else:
        gm = S.spare_monogram(WORDS[seed % len(WORDS)], seed, 2, max_letters=3)["mask"]
    gy = h - 3 - gm.shape[0] // 2 - 1
    GL.place(g, gm, cx, gy)
    g = (g | g[:, ::-1]) & sil
    kind = "x"
    allowed = sil & (M.distance_from_edge(sil) >= 1.5) & ~halo_d & ~morph.dilate(g, 1, 8)
    fr = G.Frames()
    centre = np.zeros((h, w), bool)
    centre[hy, cx] = True
    fr.add("halo", {3: halo_r | g, 2: halo_r | g, 1: g | centre})
    age = np.where(halo_r, 0, -1)
    aura = morph.dilate(g, 1, 8) & ~g
    bolt = H.dbm_target(halo_r, allowed | halo_r, aura, rng, eta, kind, 1, 2, age=age,
                        on_snap=lambda m: fr.add("", {3: m | g, 2: halo_r | g, 1: g | centre}), snap_every=3,
                        stop_dist=1)
    from ..ops import composition as C

    light = bolt & ~halo_r
    # the strike channel: growth ancestry of the cells that reached the glyph's aura
    hit = light & morph.dilate(aura, 1, 8)
    channel = G.ancestors(bolt, age, hit) & light
    channel = G.sym_or(channel, kind) & light
    strike = C.connect(channel | halo_r | g, sil, "x", max_len=3)
    full = C.connect(light | halo_r | g, sil, "x", max_len=3) | strike
    out = {1: g | centre, 2: strike}
    if layers >= 3:
        out[3] = full | halo_d | (morph.dilate(g, 1, 8) & sil)
    else:
        out[2] = full
    fr.items = [(f"t{i}" if i else "halo", fl) for i, (lab, fl) in enumerate(fr.items)]
    fr.add("strike", {k: v for k, v in out.items()})
    return _design(out, fr,
                   f"Aimed dielectric breakdown: phi=0 on the halo cluster, 1 on the glyph's 1-cell aura, no-flux walls; "
                   f"grow a perimeter cell with p ~ phi^{eta} (lace rule, mirrored) until it strikes. Base = the whole "
                   "discharge + halo and glyph plates, middle = only the strike channel (growth ancestry of the hit), "
                   "top = glyph + halo point.")


# =============================================================================================
# P25 DLA monstrance
# =============================================================================================

@recipe(
    "dla_monstrance", section="hybrids", title="DLA monstrance",
    description="A reliquary for an absent relic: the oval window in the middle is a reserved void with a moat. "
                "Around it a collar, and from the collar a crystalline glory grows outward (DLA-like dielectric "
                "breakdown) toward the frame - the monstrance's sunburst, grown rather than drawn.",
    params={
        "width": Param(23, 15, 31, 2), "height": Param(33, 21, 41, 2),
        "window_w": Param(5, 3, 11, 2), "window_h": Param(9, 5, 19, 2),
        "eta": Param(1.5, 0.5, 3.0, 0.25, description="1 = DLA statistics; higher = fewer, longer spikes"),
        "cells": Param(130, 40, 400, 10, description="glory size (cells)"),
        "trunk": Param(4, 2, 20, 1, description="middle layer keeps rays carrying >= this many cells"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "dla", "reliquary", "reserved-void", "d2"])
def dla_monstrance(seed, width, height, window_w, window_h, eta, cells, trunk, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = G.silhouette("capsule", w, h)
    kind = "d2"
    cav = M.ellipse(h, w, rx=window_w / 2, ry=window_h / 2)
    collar = morph.dilate(cav, 2, 8) & ~morph.dilate(cav, 1, 8)
    collar = G.break_blocks(collar, kind)
    frame = _outline(sil)
    gap = morph.dilate(frame, 1, 8) & sil & ~frame
    allowed = sil & ~frame & ~gap & ~morph.dilate(cav, 1, 8)
    age = np.where(collar, 0, -1)
    fr = G.Frames()
    fr.add("relic", {3: frame | collar, 2: collar, 1: collar})
    orbits = max(4, cells // 4)
    glory = H.dbm_target(collar, allowed | collar, gap, rng, eta, kind, 1, 2, max_cells=orbits, stop=False,
                         on_snap=lambda m: fr.add("", {3: frame | m, 2: m, 1: collar}),
                         snap_every=max(1, orbits // 14), age=age)
    glory = G.break_blocks(glory, kind, protect=collar)
    glory = G.connect_to(glory, collar, kind)
    from ..ops import composition as C

    whole = C.connect(glory | frame, sil & ~morph.dilate(cav, 1, 8), kind, max_len=3)
    age = np.where(glory, np.maximum(age, 0), -1)
    rays = G.trunk(glory, age, trunk, kind) | collar
    rays = G.connect_to(rays, collar, kind)
    out = {1: collar, 2: rays}
    if layers >= 3:
        out[3] = whole | rays
    fr.items = [(f"t{i}" if i else "relic", fl) for i, (lab, fl) in enumerate(fr.items)]
    return _design(out, fr,
                   f"Reserved void: a {window_w}x{window_h} oval window, a 1-cell moat, then a collar. From the collar a "
                   f"glory grows by aimed dielectric breakdown (eta={eta}; eta=1 is DLA statistics): Laplace field 0 on the "
                   "glory, 1 just inside the frame, insulating walls; lace rule, D2. Base = frame + glory bridged to it, "
                   f"middle = the glory's main rays (subtrees >= {trunk}), top = the collar round the empty relic.")


# =============================================================================================
# P26 Mandorla skin
# =============================================================================================

GS_REGIMES = {"coral": (0.0545, 0.062), "worms": (0.078, 0.061), "spots": (0.03, 0.062), "maze": (0.029, 0.057)}


def _icon(h, w, cx, cy, kind):
    """Small frontal figure: a pixel-ring head over a spine with a cross-bar (orant) / a plain cross / an eye."""
    m = np.zeros((h, w), bool)
    if kind == "figure":
        GL.place(m, GL.pixel_ring(2), cx, cy - 6)
        m[cy - 3:cy + 7, cx] = True
        m[cy - 1, cx - 2:cx + 3] = True
        m[cy + 7, cx - 1:cx + 2] = True
    elif kind == "cross":
        m[cy - 6:cy + 8, cx] = True
        m[cy - 2, cx - 3:cx + 4] = True
    else:
        GL.place(m, GL.pixel_ring(2), cx, cy)
        m[cy, cx] = True
        m[cy - 6:cy - 3, cx] = True
        m[cy + 4:cy + 7, cx] = True
    return m


@recipe(
    "mandorla_skin", section="hybrids", title="Mandorla skin",
    description="The almond of glory as living skin: Gray-Scott reaction-diffusion runs only in a band just inside "
                "the vesica, so coral grows round a calm icon. The pattern is thresholded at three levels: the full "
                "skin below, its thinned veins above, the figure and the hottest spots on top.",
    params={
        "width": Param(21, 15, 27, 2), "height": Param(35, 25, 45, 2),
        "band": Param(4.0, 2.5, 7, 0.5, description="skin depth (cells from the edge)"),
        "regime": Param("coral", choices=list(GS_REGIMES)),
        "icon": Param("figure", choices=["figure", "cross", "eye"]),
        "steps": Param(2500, 800, 5000, 100),
        "fill": Param(0.45, 0.25, 0.65, 0.02, description="base layer fill of the band"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "reaction-diffusion", "mandorla", "d2"])
def mandorla_skin(seed, width, height, band, regime, icon, steps, fill, layers):
    from .sigils import mandorla

    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    sil = mandorla(h, w)
    kind = "d2"
    dist = M.distance_from_edge(sil)
    frame = _outline(sil)
    skin = sil & (dist > 1.0) & (dist <= band + 1.0)
    cx, cy = w // 2, h // 2
    fig = _icon(h, w, cx, cy, icon) & sil & (dist >= band + 2.5)
    s = 4
    hi = upsample_mask(skin, s)
    seeds_hi = np.zeros_like(hi)
    q = np.argwhere(hi)
    for i in rng.choice(len(q), size=min(40, len(q)), replace=False):
        y, x = q[i]
        seeds_hi[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
    seeds_hi = G.sym_or(seeds_hi, kind) & hi
    f, k = GS_REGIMES[regime]
    snaps = []
    V = G.gray_scott(hi, seeds_hi, f, k, 0.12, 0.06, steps, kind, rng, snap_every=max(1, steps // 14),
                     on_snap=lambda v: snaps.append(v.copy()))
    top_n = 6 if layers >= 3 else 0

    def layers_from(Vh):
        v = downsample(Vh, s, "mean") * skin
        vals = v[skin]
        if vals.max() <= 1e-6:
            return {3: frame | morph.dilate(fig, 1, 8), 2: frame | fig, 1: fig}
        base = G.sym_and(v > np.quantile(vals, 1 - fill), kind) & skin
        base = morph.remove_small(base, 3)
        veins = G.sym_or(morph.skeletonize(base), kind) & base
        veins = G.break_blocks(veins, kind)
        veins = morph.remove_small(veins, 3)
        # hottest spots: local maxima of V above the 90th percentile, kept isolated from the veins' ends
        mx = (v >= np.maximum.reduce([np.roll(np.roll(v, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]))
        hot = G.sym_and(mx & (v > np.quantile(vals, 0.9)) & veins, kind)
        o = {3: base | frame | morph.dilate(fig, 1, 8), 2: veins | frame | fig}
        o[1] = fig | hot
        return o

    fr = G.Frames()
    for i, v in enumerate(snaps):
        fr.add(f"t={(i + 1) * max(1, steps // 14)}", layers_from(v))
    out = layers_from(V)
    if layers == 2:
        out = {2: out[3], 1: out[2]}
        fr.items = [(lab, {2: fl[3], 1: fl[2]}) for lab, fl in fr.items]
    return _design(out, fr,
                   f"Gray-Scott '{regime}' (f={f}, k={k}) on a {s}x grid, alive only in a {band}-cell skin inside the "
                   "vesica (V clamped to 0 elsewhere, no-flux edges), mirror-averaged. Base = skin above the "
                   f"{1 - fill:.0%} quantile + outline + a plate under the icon; middle = thinned skin + outline + icon; "
                   "top = icon + local maxima.")


# =============================================================================================
# P32 Kolam eaten by mould
# =============================================================================================

@recipe(
    "kolam_eaten", section="hybrids", title="Kolam eaten by mould",
    description="The threshold after the rain: a perfect single-thread kolam is washed out where a slime mould's "
                "trail runs strongest (never more than a third of it, never at the crossings), then the slime "
                "regrows from the cut ends along its own trail. The base keeps the memory of the whole loop.",
    params={
        "dots": Param(7, 4, 9, 1, description="dot grid n x n"),
        "shape": Param("diamond", choices=["diamond", "circle", "octagon", "rect"]),
        "eat": Param(0.3, 0.05, 0.45, 0.01, description="max share of the curve washed away"),
        "regrow": Param(0.8, 0.0, 2.5, 0.1, description="regrowth cells per eaten cell"),
        "crossing": Param(0.45, 0.2, 0.9, 0.05, description="share of crossings in the kolam search"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "kolam", "physarum", "mould", "d4"])
def kolam_eaten(seed, dots, shape, eat, regrow, crossing, layers):
    from ..ops import mirror_curves as MC

    rng = np.random.default_rng(seed)
    d = MC.dot_set(shape, dots)
    wx = crossing
    curve = MC.search(d, "d4", seed, 1, (wx, (1 - wx) * 0.55, (1 - wx) * 0.45))
    ras = MC.rasterize(curve, "A", "pointed", 2)
    orig = ras.curve.copy()
    Hh, Ww = orig.shape
    n = max(Hh, Ww)
    if Hh != Ww:
        orig = MC.place(orig, n, n)
    cross = MC.place(ras.crossings, n, n) if ras.crossings.shape != (n, n) else ras.crossings
    over = MC.place(ras.over, n, n) if ras.over.shape != (n, n) else ras.over
    kind = "d4"
    c = n // 2
    s = 3
    allowed_hi = np.ones((n * s, n * s), bool)
    dd = int(round(n * 0.27))
    food = H.points_mask((n, n), [(c - dd, c - dd), (c + dd, c - dd), (c - dd, c + dd), (c + dd, c + dd)])
    food_hi = upsample_mask(morph.dilate(food, 1, 8), s).astype(float)
    protect = cross
    cap = int(eat * orig.sum())
    fr = G.Frames()
    fr.add("kolam", {3: orig, 2: orig})

    def eaten(trail):
        t = downsample(trail, s, "mean")
        t = 0.25 * (t + t[:, ::-1] + t[::-1] + t[::-1, ::-1])
        cand = orig & ~protect
        vals = t[cand]
        if cap <= 0 or vals.size == 0:
            return orig.copy(), t
        thr = max(np.quantile(t[orig], 0.7), np.sort(vals)[::-1][min(cap, vals.size) - 1])
        cut = cand & (t >= thr)
        return morph.remove_small(orig & ~cut, 4) | (orig & protect), t

    snaps = []
    trail = G.physarum(allowed_hi, food_hi, rng, n_agents=int(0.25 * allowed_hi.size), steps=160,
                       sa=math.radians(45), ra=math.radians(45), so=5, decay=0.2, kind=kind,
                       spawn=upsample_mask(morph.dilate(food, 2, 8), s), food_amt=10.0, wiggle=0.4,
                       snap_every=20, on_snap=lambda t: snaps.append(t.copy()))
    for t in snaps:
        e, _ = eaten(t)
        fr.add("rain", {3: orig, 2: e})
    rem, t = eaten(trail)
    cut = orig & ~rem
    ends = rem & morph.dilate(cut, 1, 8)
    allowed = (~morph.dilate(orig, 1, 8) | (morph.dilate(ends, 1, 8) & ~orig)) & ~cut
    allowed &= M.circle(n, n) if shape in ("circle", "octagon", "diamond") else np.ones((n, n), bool)
    tn = (t - t.min()) / (np.ptp(t) + 1e-9)
    res = (1 - tn) + 0.35 * sym_noise(n, n, 0.4, kind, seed=seed)
    target = int(rem.sum() + regrow * cut.sum())
    grown = G.invasion_percolation(rem, allowed, res, target, kind, 1, 2, snap_every=3,
                                   on_snap=lambda m: fr.add("slime", {3: orig | (m & ~rem), 2: m}))
    slime = grown & ~rem
    slime = G.connect_to(slime, ends, kind)
    mid = rem | slime
    # top: the over-bridges of the crossings nearest the centre
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - c, yy - c)
    top = np.zeros((n, n), bool)
    if cross.any():
        rr = np.unique(np.round(r[cross], 3))
        near = cross & (np.round(r, 3) <= rr[min(len(rr) - 1, 0 if (cross & (np.round(r, 3) == rr[0])).sum() >= 4 else 1)])
        top = over & morph.dilate(near, 1, 8)
        top |= near
    out = {2: mid, 1: top}
    if layers >= 3:
        out[3] = orig | slime
    else:
        out = {2: mid | orig, 1: top}
    return _design(out, fr,
                   f"Sikku kolam on a {dots}x{dots} {shape} dot set (D4 orbit search, single loop), style A. Physarum "
                   f"(food at 4 diagonal points, D4) gives a trail field; curve cells under the strongest trail are "
                   f"washed out (>= 70th percentile, max {eat:.0%}, crossings kept); slime regrows from the cut ends by "
                   "lace-rule invasion along the trail. Base = the whole kolam (memory) + slime, middle = eroded kolam "
                   "+ slime, top = the central crossings' over-bridges.")


# =============================================================================================
# P9 The tree writes the name
# =============================================================================================

@recipe(
    "tree_writes_name", section="hybrids", title="The tree writes the name",
    description="Space colonisation (leaf venation) from a root at the foot of the pendant. Most attractors sit on "
                "the strokes of a hidden bindrune made from the name, a few in the margin: the veins grow up and, "
                "without knowing it, spell the sigil. The trunk and glyph-tracing main branches stand on top.",
    params={
        "name": Param("", description="name -> runes (empty = chosen by seed)"),
        "width": Param(19, 15, 27, 2), "height": Param(33, 25, 41, 2),
        "scale": Param(3, 2, 3, 1, description="rune scale (3 = 13x25 glyph)"),
        "per_cell": Param(1, 1, 4, 1, description="attractors per glyph stroke cell"),
        "margin": Param(3, 0, 20, 1, description="extra attractors per side in the margin"),
        "radius": Param(6.0, 3, 10, 0.5),
        "trunk": Param(6, 2, 30, 1, description="top layer keeps branches carrying >= this many cells"),
        "ghost": Param(True, description="base carries the glyph itself (the name beneath the tree)"),
        "clear": Param(False, description="branches keep a cell apart (cleaner, but growth stalls sooner)"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "venation", "rune", "d1"])
def tree_writes_name(seed, name, width, height, scale, per_cell, margin, radius, trunk, ghost, clear, layers):
    rng = np.random.default_rng(seed)
    w, h = _odd(width), _odd(height)
    word = _word(name, seed)
    runes = S.runes_for_text(word, 3)
    br = S.bindrune(runes, scale, mirror=True, stave=True)
    sil = G.silhouette("capsule", w, h)
    dist = M.distance_from_edge(sil)
    inner = sil & (dist >= 1.5)
    cx = w // 2
    glyph = np.zeros((h, w), bool)
    GL.place(glyph, br["mask"], cx, (h - 4) // 2)
    glyph &= inner
    glyph |= glyph[:, ::-1]
    kind = "x"
    root = np.zeros((h, w), bool)
    ys = np.nonzero(inner[:, cx])[0]
    root[ys.max(), cx] = True
    pts = []
    for y, x in np.argwhere(glyph):
        if x > cx:
            continue
        for _ in range(per_cell):
            pts.append((x + rng.uniform(-0.3, 0.3), y + rng.uniform(-0.3, 0.3)))
    gy = np.nonzero(glyph.any(1))[0]
    for y in range(ys.max() - 1, gy.max(), -2):  # the root must first find the glyph: a sparse trail up the axis
        pts.append((cx + rng.uniform(-0.6, 0.6), y + rng.uniform(-0.3, 0.3)))
    band = inner & (dist <= 3.5) & ~morph.dilate(glyph, 1, 8)
    q = np.argwhere(band & (np.arange(w)[None, :] <= cx))
    if len(q) and margin:
        for i in rng.choice(len(q), size=min(margin, len(q)), replace=False):
            pts.append((q[i][1] + rng.uniform(-0.3, 0.3), q[i][0] + rng.uniform(-0.3, 0.3)))
    pts = pts + [(w - 1 - x, y) for x, y in pts]
    att = np.array(pts, float)
    fr = G.Frames()
    fr.add("root", {3: root | (glyph if ghost else root), 2: root, 1: root})
    veins, gen = G.space_colonize(root, inner, att, kind, radius=radius, kill=1.5, max_iter=90, clearance=clear,
                                  max_orth=2, max_n8=3,
                                  on_snap=lambda m: fr.add("", {3: m | (glyph if ghost else m), 2: m, 1: root}))
    veins = G.break_blocks(veins, kind, protect=root)
    gen = np.where(veins, gen, -1)
    main = G.trunk(veins, gen, trunk, kind)
    main = G.connect_to(main, root, kind) | root
    out = {1: main, 2: veins}
    if layers >= 3:
        out[3] = G.connect_to(veins | (glyph if ghost else morph.dilate(veins, 1, 8) & sil), root, kind)
    fr.items = [(f"t{i}" if i else "root", fl) for i, (lab, fl) in enumerate(fr.items)]
    return _design(out, fr,
                   f"'{word}' -> runes {', '.join(runes)} bound on one stave (mirrored). Attractors: {per_cell} per stroke "
                   f"cell + {margin} per side in the margin; Runions space colonisation from the root, radius {radius}, "
                   f"octilinear steps, mirrored. Top = branches carrying >= {trunk} cells, middle = all veins, base = "
                   f"veins {'+ the bindrune as a ghost plate' if ghost else 'dilated'}.")


# =============================================================================================
# P21 Circuit sutra
# =============================================================================================

@recipe(
    "circuit_sutra", section="hybrids", title="Circuit sutra",
    description="Digital monasticism: the 22 paths of the Tree of Life routed like copper traces - octilinear A* "
                "with turn penalties, one cell of clearance, mirrored nets routed once. The sephirot are vias; the "
                "base is a ground pour with isolation moats, so every trace is engraved into the plate.",
    params={
        "pillar": Param(7, 5, 9, 1), "level": Param(5, 4, 6, 1),
        "turn45": Param(1.0, 0.0, 4.0, 0.25, description="cost of a 45-degree bend"),
        "turn90": Param(4.0, 0.0, 10.0, 0.5, description="cost of a 90-degree bend"),
        "order": Param("short", choices=["short", "long", "seeded"], description="net routing order"),
        "jitter": Param(1.5, 0.0, 4.0, 0.25, description="random per-cell cost (seeded): different routes per seed"),
        "pour": Param(True, description="base = ground pour with isolation moats (else a trace shadow)"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "routing", "tree-of-life", "d1"])
def circuit_sutra(seed, pillar, level, turn45, turn90, order, jitter, pour, layers):
    rng = np.random.default_rng(seed)
    T = H.tree_of_life(pillar, level, 3)
    w, h = T["w"], T["h"]
    sil = G.silhouette("capsule", w, h)
    inner = sil & (M.distance_from_edge(sil) >= 1.5)
    cx = w // 2
    nodes = T["nodes"]
    ring = {k: H.node_rings((h, w), [p], 1) for k, p in nodes.items()}
    rings = np.zeros((h, w), bool)
    for m in ring.values():
        rings |= m
    mirror_name = {k: next(k2 for k2, p2 in nodes.items() if p2 == (w - 1 - p[0], p[1])) for k, p in nodes.items()}
    nets = list(T["paths"])

    def length(n):
        (ax, ay), (bx, by) = nodes[n[0]], nodes[n[1]]
        return max(abs(ax - bx), abs(ay - by))

    if order == "short":
        nets.sort(key=length)
    elif order == "long":
        nets.sort(key=lambda n: -length(n))
    else:
        rng.shuffle(nets)
    traces = np.zeros((h, w), bool)
    cost = jitter * sym_noise(h, w, 0.35, "x", white=0.5, seed=seed)
    fr = G.Frames()
    fr.add("vias", {2: rings, 1: rings})
    done, failed = set(), []
    xs = np.arange(w)[None, :].repeat(h, 0)
    for a, b in nets:
        key = frozenset((a, b))
        mkey = frozenset((mirror_name[a], mirror_name[b]))
        if key in done:
            continue
        done |= {key, mkey}
        pa, pb = nodes[a], nodes[b]
        others = rings & ~ring[a] & ~ring[b]
        own = morph.dilate(ring[a] | ring[b], 1, 8)
        passable = inner & ~morph.dilate(others, 1, 8) & ~(morph.dilate(traces, 1, 8) & ~own)
        passable |= ring[a] | ring[b]
        passable[pa[1], pa[0]] = True
        self_mirror = key == mkey
        on_axis = pa[0] == cx and pb[0] == cx
        if on_axis:
            passable &= xs == cx
            path = H.astar(pa, pb, passable, turn45, turn90, goal_mask=ring[b], cost=cost)
        elif self_mirror:
            left = pa if pa[0] < cx else pb
            side = passable & (xs <= cx)
            axis = side & (xs == cx) & ~own
            path = H.astar(left, (cx, left[1]), side | (ring[a] | ring[b]) & (xs <= cx), turn45, turn90, goal_mask=axis,
                           cost=cost)
        else:
            right = pa[0] > cx or pb[0] > cx
            side = passable & ((xs > cx) if right else (xs < cx))
            side |= (ring[a] | ring[b]) | (own & (xs == cx))
            side[pa[1], pa[0]] = True
            path = H.astar(pa, pb, side, turn45, turn90, goal_mask=ring[b], cost=cost)
        if path is None:
            failed.append(f"{a}-{b}")
            continue
        t = H.points_mask((h, w), path) & ~rings
        t[pa[1], pa[0]] = False
        traces |= t | t[:, ::-1]
        fr.add(f"{a}-{b}", {2: traces | rings, 1: rings})
    traces = G.break_blocks(traces, "x", protect=rings)
    mid = traces | rings
    out = {1: rings, 2: mid}
    if layers >= 3:
        if pour:
            holes = H.points_mask((h, w), list(nodes.values()))
            out[3] = (inner & ~morph.dilate(mid, 1, 8)) | mid
            out[3] &= ~holes
        else:
            out[3] = morph.dilate(mid, 1, 8) & sil
    return _design(out, fr,
                   f"Tree of Life ({pillar}x{level} spacing); nets routed {order}-first by octilinear A* (diag 1.41, "
                   f"+{turn45} per 45-degree bend, +{turn90} per 90), 1-cell clearance, left half + axis routed and "
                   f"mirrored. Unroutable: {', '.join(failed) or 'none'}. Top = vias, middle = traces + vias, base = "
                   f"{'ground pour with isolation moats and drill holes' if pour else 'trace shadow'}.", n=24)


# =============================================================================================
# Own idea: the mould excavates a kolam
# =============================================================================================

@recipe(
    "kolam_excavation", section="hybrids", title="The mould remembers the kolam",
    description="A buried single-thread kolam, uncovered by a breathing mould: each pulse the mould creeps "
                "outward (lace-rule invasion growth) and everywhere it touched, the kolam's line surfaces; then it "
                "retracts to its veins and the tide mark where it stalled. The ancient thread is revealed ring by ring.",
    params={
        "dots": Param(5, 3, 7, 1, description="dot grid n x n (diamond / circle sets look best)"),
        "shape": Param("diamond", choices=["diamond", "circle", "rect", "octagon"]),
        "pulses": Param(4, 2, 6, 1),
        "growth": Param(0.25, 0.1, 0.6, 0.05, description="fill of each pulse's annulus before retracting"),
        "vein": Param(4, 2, 20, 1, description="veins kept = branches carrying >= this many cells"),
        "reveal": Param(1, 0, 2, 1, description="the line surfaces within this distance of the mould"),
        "attract": Param(0.15, 0.0, 1.0, 0.05, description="how much the mould prefers the buried line"),
        "layers": Param(3, 2, 3, 1),
    },
    tags=["hybrid", "kolam", "mould", "pulse", "d4"])
def kolam_excavation(seed, dots, shape, pulses, growth, vein, reveal, attract, layers):
    from ..ops import mirror_curves as MC

    rng = np.random.default_rng(seed)
    d = MC.dot_set(shape, dots)
    curve = MC.search(d, "d4", seed, 1, (0.5, 0.28, 0.22))
    ras = MC.rasterize(curve, "A", "pointed", 3)
    n = max(ras.curve.shape)
    K = MC.place(ras.curve, n, n)
    cross = MC.place(ras.crossings, n, n)
    kind = "d4"
    sil = M.circle(n, n)
    c = n // 2
    yy, xx = np.mgrid[0:n, 0:n]
    rad = np.hypot(xx - c, yy - c) / (n / 2)
    dist_e = M.distance_from_edge(sil)
    frame = _outline(sil)
    # the mould starts at the centre (the centre of a kolam is a dot or a crossing; start beside it)
    mot = np.zeros((n, n), bool)
    mot[c, c] = True
    if K[c, c]:
        mot = cross & (rad <= rad[cross].min() + 1e-6) if cross.any() else mot
    struct = mot.copy()
    res = sym_noise(n, n, 0.3, kind, white=0.5, seed=seed) - attract * K  # the mould likes the old rice flour
    fr = G.Frames()
    revealed = np.zeros_like(K)
    veins_all = mot.copy()
    r0 = 0.08
    for p in range(1, pulses + 1):
        r_k = r0 + (1 - r0) * p / pulses
        allowed = sil & (rad <= r_k) & ~morph.dilate(frame, 1, 8)
        ann = allowed & (rad > r0 + (1 - r0) * (p - 1) / pulses)
        target = int(struct.sum() + growth * ann.sum())
        age = np.where(struct, 0, -1)
        grown = G.invasion_percolation(struct, allowed, res, target, kind, 1, 3, age=age,
                                       snap_every=max(1, int(growth * ann.sum()) // 40),
                                       on_snap=lambda m: fr.add(f"pulse {p}", {3: m, 2: revealed | (K & morph.dilate(m, reveal, 8)), 1: mot}))
        revealed |= K & morph.dilate(grown, reveal, 8)
        fr.add(f"pulse {p} grown", {3: grown, 2: revealed, 1: mot})
        vk = G.trunk(grown, age, vein, kind) | struct
        tide = grown & ~struct & (np.abs(rad - r_k) * n / 2 <= 1.2)
        kept = G.sym_and(vk | tide, kind)
        kept = G.break_blocks(kept, kind, protect=struct)
        kept = morph.remove_small(kept, 3)
        veins_all |= kept
        struct = kept | mot
        fr.add(f"pulse {p} retract", {3: struct, 2: revealed, 1: mot})
    from ..ops import composition as C

    # middle: the revealed thread; fragments too small to read are dropped
    mid = morph.remove_small(revealed, 6)
    mould = G.connect_to(G.lace_clean(struct, kind, 3, protect=mot) | mot, mot, kind)
    top = cross & mid & (rad <= 0.45)
    top = (ras and MC.place(ras.over, n, n) & morph.dilate(top, 1, 8)) | top
    out = {1: top | mot, 2: mid}
    if layers >= 3:
        out[3] = C.connect(mould | mid | frame, sil, kind, max_len=3)
    else:
        out[2] = mid | mould
    return _design(out, fr,
                   f"Hidden: a sikku kolam ({dots}x{dots} {shape} dots, D4). {pulses} pulses of lace-rule invasion "
                   "growth (noise resistance, cheaper on the kolam's line) out to a growing radius; every cell within "
                   f"{reveal} of the mould reveals the kolam; retraction keeps only veins and tide marks. Base = mould + "
                   "dish rim, middle = the revealed thread, top = the central crossings' over-bridges.", n=24)
