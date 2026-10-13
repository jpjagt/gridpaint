"""Cellular automata recipes: Life-like rules (raw + refined lace), folded 1D rules as frames,
Margolus block CA, and 'crystal sigils' (single-seed growth rules with a no-2x2 constraint)."""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import ca, masks as M, morph, symmetry
from . import Param, recipe, register_section

register_section(
    "automata", "Cellular automata",
    "Local rules iterated on a symmetric start inside a silhouette. Raw CA output is blobby or "
    "architectural; thinning + the lace grammar turns it into tendrils. Frames show each generation.")

RULE_NAMES = list(ca.RULES)


def set_frames(d: Design, frames: list) -> Design:
    """Attach frames given as [(label, {layer_id: mask})] (normalised like Design.__post_init__)."""
    from ..model import _groups_from

    d.frames = [(str(lab), {int(k): _groups_from(v, d.shape) for k, v in fl.items()}) for lab, fl in frames]
    return d


def frames_from(hist: list, layer_id: int = 1, max_frames: int = 16, label: str = "gen", extra: dict | None = None,
                final: dict | None = None) -> list:
    """Subsample a list of masks into <= max_frames frames; last frame == `final` layers (if given)."""
    n = len(hist)
    if n == 0:
        return []
    idx = sorted(set(np.linspace(0, n - 1, min(n, max_frames)).round().astype(int).tolist()))
    out = [(f"{label} {i}", {layer_id: hist[i], **(extra or {})}) for i in idx]
    if final is not None:
        out.append(("final", final))
    return out


def initial_state(rng, kind: str, H: int, W: int, sil: np.ndarray, density: float, sym: str) -> np.ndarray:
    dist = M.distance_from_edge(sil)
    if kind == "noise":
        return ca.sym_noise(rng, (H, W), density, sym, sil)
    if kind == "band":
        return ca.sym_noise(rng, (H, W), density, sym, sil & (dist <= 4.5))
    if kind == "core":
        cy, cx = (H - 1) / 2, (W - 1) / 2
        y, x = np.mgrid[0:H, 0:W]
        near = (np.abs(y - cy) <= H / 4) & (np.abs(x - cx) <= W / 4)
        return ca.sym_noise(rng, (H, W), density, sym, sil & near)
    if kind == "seeds":
        # a handful of tiny symmetric plus-shaped seeds
        m = np.zeros((H, W), bool)
        for _ in range(3):
            y, x = rng.integers(1, (H + 1) // 2), rng.integers(1, (W + 1) // 2)
            m[y, x] = True
            if rng.random() < 0.5:
                m[y - 1:y + 2, x] = True
            else:
                m[y, x - 1:x + 2] = True
        return ca.symmetrize(m, sym) & sil
    raise ValueError(kind)


@recipe("life_like", section="automata", title="Life-like CA (raw)",
        description="A Life-like rule (Maze, Mazectric, Coral, Day&Night, Diamoeba, Assimilation, Anneal, ...) "
                    "run for a few generations from symmetric noise inside a silhouette. Raw output: shows what "
                    "each rule 'wants' to make before any lace cleanup.",
        params={
            "rule": Param("maze", choices=RULE_NAMES),
            "width": Param(15, 7, 41, 2),
            "height": Param(23, 7, 41, 2),
            "silhouette": Param("capsule", choices=ca.SILHOUETTES),
            "start": Param("noise", choices=["noise", "band", "core", "seeds"]),
            "density": Param(0.0, 0.0, 0.8, 0.05, description="0 = rule-specific default"),
            "steps": Param(8, 1, 40, 1),
            "sym": Param("d2", choices=["d2", "d4"]),
        },
        tags=["ca", "raw", "d2"])
def life_like(seed: int, rule: str, width: int, height: int, silhouette: str, start: str, density: float,
              steps: int, sym: str) -> Design:
    rng = np.random.default_rng(seed)
    H, W = height, width
    sil = ca.silhouette(silhouette, H, W)
    density = density or ca.RULE_DENSITY.get(rule, 0.4)
    m0 = initial_state(rng, start, H, W, sil, density, sym)
    m, hist = ca.run_life(m0, rule, steps, sil, record=True)
    d = Design.from_masks({1: m})
    set_frames(d, frames_from(hist, 1, 16))
    d.notes = (f"{rule} = {ca.RULES.get(rule, rule)}; {len(hist) - 1} generations from symmetric {start} "
               f"(p={density}) in a {silhouette}. Isotropic rules keep the mirror symmetry for free.")
    return d


def lace_score(m: np.ndarray, sil: np.ndarray, target: float = 0.3) -> float:
    """Heuristic fitness for curation: one piece, moderate fill, some diagonal-only wiggle, few end points."""
    st = ca.lace_stats(m)
    if st["cells"] == 0:
        return -1e9
    fill = st["cells"] / max(1, sil.sum())
    ends = int((m & (morph.neighbour_count(m, 8) == 1)).sum())
    return (-3.0 * abs(fill - target) / target - 0.6 * (st["pieces"] - 1) + 2.0 * min(st["diag_only"], 0.25)
            - 0.02 * ends)


def _life_lace_once(rng, rule, H, W, sil, density, steps, scale, mode, sym, open_edge=False):
    s = scale
    zone_hi = np.kron(sil, np.ones((s, s), bool))
    m0 = ca.sym_noise(rng, zone_hi.shape, density, sym, zone_hi)
    m, hist_hi = ca.run_life(m0, rule, steps, zone_hi, record=True)
    if s > 1:
        pool = lambda a: a.reshape(H, s, W, s).sum(axis=(1, 3)) * 2 >= s * s
    else:
        pool = lambda a: a
    blobs = pool(m) & sil
    if mode == "contour":
        # the outline of the CA's blobs: wiggly closed loops with lots of diagonal steps
        if open_edge:
            # only trace blob edges facing empty cells inside the zone (not the zone boundary itself)
            from scipy import ndimage
            filled = blobs | ~sil
            src = blobs & ~ndimage.binary_erosion(filled, morph.structure(4), border_value=1)
        else:
            src = blobs & ~morph.erode(blobs, 1, 4)
    else:
        src = blobs
    lace = ca.sym_thin(src, sym)
    return lace, [pool(h) for h in hist_hi], blobs


@recipe("life_lace", section="automata", title="Life-like CA → lace",
        description="The refined version: the CA's blobs are traced as outlines (or thinned to skeletons), "
                    "thinned symmetrically to 1-cell strokes, spur-pruned and cleaned by the lace grammar "
                    "(no 2x2 blocks, no dust). Several sub-runs are scored (one piece, ~30% fill, diagonal "
                    "wiggle) and the best is kept. Coral/Day&Night/Stains become mould-like tendrils.",
        params={
            "rule": Param("stains", choices=RULE_NAMES),
            "width": Param(15, 7, 41, 2),
            "height": Param(23, 7, 41, 2),
            "silhouette": Param("capsule", choices=ca.SILHOUETTES),
            "mode": Param("contour", choices=["contour", "skeleton"]),
            "density": Param(0.0, 0.0, 0.8, 0.05, description="0 = rule-specific default"),
            "steps": Param(6, 1, 30, 1),
            "scale": Param(1, 1, 3, 1, description="CA resolution multiplier (pooled by majority)"),
            "band": Param(0, 0, 12, 1, description="keep lace within this distance of the edge (0 = everywhere)"),
            "spurs": Param(1, 0, 4, 1),
            "frame": Param("none", choices=["none", "line", "dashed"]),
            "core": Param("none", choices=["none", "cross", "spine", "dot"]),
            "curate": Param(6, 1, 16, 1, description="sub-runs scored; best kept"),
            "sym": Param("d2", choices=["d2", "d4"]),
        },
        tags=["ca", "lace", "d2"])
def life_lace(seed: int, rule: str, width: int, height: int, silhouette: str, mode: str, density: float, steps: int,
              scale: int, band: int, spurs: int, frame: str, core: str, curate: int, sym: str) -> Design:
    rng = np.random.default_rng(seed)
    H, W = height, width
    sil = ca.silhouette(silhouette, H, W)
    dist = M.distance_from_edge(sil)
    density = density or ca.RULE_DENSITY.get(rule, 0.45)
    has_frame = frame != "none"
    edge = sil & ~morph.erode(sil, 1, 4)
    ca_zone = sil & ~edge if has_frame else sil
    zone = ca_zone & (dist <= band + 0.5) if band else ca_zone
    motif = core_motif(core, H, W, sil, max(band, 3) + 1)
    best = None
    for k in range(curate):
        lace, hist, blobs = _life_lace_once(rng, rule, H, W, ca_zone, density, steps, scale, mode, sym,
                                                open_edge=has_frame)
        lace = ca.prune_spurs(lace & zone, spurs)
        parts = lace.copy()
        ring = edge
        if has_frame:
            if frame == "dashed":
                cy, cx = (H - 1) // 2, (W - 1) // 2
                axis = np.zeros_like(ring)
                axis[:, cx] = True
                axis[cy, :] = True
                ring = ring & morph.dilate(morph.dilate(lace, 1, 8) | axis, 1, 8)
            parts |= ring
        parts |= motif & ~morph.dilate(lace, 1, 4) | motif
        out = ca.lace_clean(parts, sym, min_size=4)
        anchor = (ring if has_frame else np.zeros_like(sil)) | motif
        if anchor.any():
            lab, n = morph.label(out, 8)
            keep = np.unique(lab[anchor & out])
            big = np.nonzero(np.bincount(lab.ravel()) >= 10)[0]
            out &= np.isin(lab, keep[keep > 0]) | (np.isin(lab, big) & (lab > 0))
        sc = lace_score(out, sil)
        if best is None or sc > best[0]:
            best = (sc, out, hist, blobs, lace, k)
    sc, out, hist, blobs, lace, k = best
    d = Design.from_masks({1: out})
    set_frames(d, frames_from(hist, 1, 10) + [("blobs", {1: blobs}), ("traced+thinned", {1: lace}),
                                            ("final", {1: out})])
    d.notes = (f"{rule} ({ca.RULES.get(rule, rule)}) x{scale}, {steps} gens -> {mode} -> symmetric thin -> "
               f"prune {spurs} -> lace grammar; best of {curate} runs (#{k}, score {sc:.2f}); "
               f"frame={frame}, core={core}, band={band or 'all'}.")
    return d


def core_motif(core: str, H: int, W: int, sil: np.ndarray, inset: int) -> np.ndarray:
    m = np.zeros((H, W), bool)
    if core == "none":
        return m
    cy, cx = (H - 1) // 2, (W - 1) // 2
    ry = max(1, (H - 1) // 2 - inset)
    rx = max(1, (W - 1) // 2 - inset)
    if core in ("cross", "spine"):
        m[cy - ry:cy + ry + 1, cx] = True
        if core == "cross":
            arm = max(1, min(rx, ry // 2))
            m[cy, cx - arm:cx + arm + 1] = True
        else:
            for k in (-ry // 2, ry // 2):
                m[cy + k, cx - 1:cx + 2] = True
    elif core == "dot":
        m[cy - 1:cy + 2, cx] = True
        m[cy, cx - 1:cx + 2] = True
    return m & sil


# ---- folded 1D rules ------------------------------------------------------------

SYM_RULES = [90, 150, 18, 182, 22, 54, 126, 94, 50, 105, 129, 165]


@recipe("folded_rule", section="automata", title="Folded rule frame",
        description="A mirror-symmetric elementary CA (rule 90/150/18/...) unrolled inward over concentric "
                    "rings of the silhouette: ring k = generation k. Seeds on the outer ring grow into "
                    "Sierpinski-like lace that stops after `depth` rings, leaving a calm interior (empty or a motif).",
        params={
            "rule": Param(90, choices=SYM_RULES),
            "width": Param(15, 9, 41, 2),
            "height": Param(25, 9, 41, 2),
            "silhouette": Param("capsule", choices=["octagon", "square", "capsule", "oval", "rrect", "diamond"]),
            "depth": Param(3, 2, 12, 1),
            "seeds": Param(2, 1, 8, 1, description="seed cells on the outer ring per fundamental domain"),
            "mix": Param(False, description="random symmetric rule per ring"),
            "frame": Param(True, description="solid outer line"),
            "core": Param("spine", choices=["none", "cross", "spine", "dot", "diamond"]),
        },
        tags=["ca", "frame", "d4"])
def folded_rule(seed: int, rule: int, width: int, height: int, silhouette: str, depth: int, seeds: int, mix: bool,
                frame: bool, core: str) -> Design:
    rng = np.random.default_rng(seed)
    H, W = height, width
    sym = "d4" if H == W and silhouette in ("octagon", "square", "oval", "diamond", "rrect") else "d2"
    sil = ca.silhouette(silhouette, H, W)
    inner = morph.erode(sil, 1, 4) if frame else sil
    rid = ca.peel_rings(inner)
    ring0 = rid == 0
    # seeds on the fundamental part of ring 0
    yy, xx = np.mgrid[0:H, 0:W]
    fund = (yy <= (H - 1) // 2) & (xx <= (W - 1) // 2)
    if sym == "d4":
        fund &= xx >= yy
    ys, xs = np.nonzero(ring0 & fund)
    st = np.zeros((H, W), bool)
    order = np.argsort(xs + 0.0)  # left..right along the top edge of the octant
    picks = rng.choice(len(ys), size=min(seeds, len(ys)), replace=False)
    for i in picks:
        st[ys[i], xs[i]] = True
    st = ca.symmetrize(st, sym) & ring0
    rules = [int(rng.choice(SYM_RULES)) for _ in range(depth)] if mix else None
    lace, hist = ca.folded_rings(inner, rule, st, depth, sym, rules=rules, record=True)
    out = lace.copy()
    if frame:
        out |= sil & ~inner
    mot = _ornament_core(core, H, W, depth + (2 if frame else 1) + 1)
    out |= mot
    out = ca.lace_clean(out, sym, min_size=3)
    d = Design.from_masks({1: out})
    fr = (sil & ~inner) if frame else np.zeros_like(sil)
    set_frames(d, [(f"ring {i}", {1: h | fr}) for i, h in enumerate(hist)] + [("final", {1: out})])
    d.notes = (f"rule {'mix ' + str(rules) if mix else rule} folded over {depth} rings of a {silhouette} "
               f"(centre parent = outward neighbour), {seeds} seeds/quadrant, mirrored each ring; core={core}.")
    return d


def _ornament_core(core: str, H: int, W: int, inset: int) -> np.ndarray:
    m = np.zeros((H, W), bool)
    cy, cx = (H - 1) // 2, (W - 1) // 2
    ry, rx = (H - 1) // 2 - inset, (W - 1) // 2 - inset
    if core == "none" or min(ry, rx) < 1:
        return m
    if core == "cross":
        m[cy - ry:cy + ry + 1, cx] = True
        m[cy, cx - rx:cx + rx + 1] = True
    elif core == "spine":
        m[cy - ry:cy + ry + 1, cx] = True
        m[cy, cx - 1:cx + 2] = True
    elif core == "dot":
        m[cy - 1:cy + 2, cx] = True
        m[cy, cx - 1:cx + 2] = True
    elif core == "diamond":
        r = min(ry, rx)
        y, x = np.mgrid[0:H, 0:W]
        m = (np.abs(y - cy) + np.abs(x - cx)) == r
        m[cy, cx] = True
    return m


# ---- Margolus ----------------------------------------------------------------------

@recipe("margolus", section="automata", title="Margolus melt",
        description="Block CA on alternating 2x2 partitions (Critters / Tron). A bold "
                    "symmetric motif (frame + cross) is 'melted' for a few steps: the reversible rule frays its "
                    "edges into ladders and gliders. Even canvas sizes keep the mirror symmetry exact.",
        params={
            "rule": Param("critters", choices=["critters", "tron"]),
            "width": Param(16, 8, 40, 2),
            "height": Param(24, 8, 40, 2),
            "silhouette": Param("capsule", choices=ca.SILHOUETTES),
            "start": Param("motif", choices=["motif", "noise", "frame"]),
            "density": Param(0.25, 0.05, 0.6, 0.05),
            "steps": Param(12, 2, 40, 2),
            "clean": Param("contour", choices=["raw", "thin", "contour"]),
        },
        tags=["ca", "block", "d2"])
def margolus(seed: int, rule: str, width: int, height: int, silhouette: str, start: str, density: float, steps: int,
             clean: str) -> Design:
    rng = np.random.default_rng(seed)
    H, W = height + height % 2, width + width % 2
    sil = ca.silhouette(silhouette, H, W)
    dist = M.distance_from_edge(sil)
    m = np.zeros((H, W), bool)
    if start in ("motif", "frame"):
        m |= sil & (dist < 2.5) & (dist >= 1.5)
        if start == "motif":
            cy, cx = H // 2, W // 2
            arm = H // 3
            m[cy - arm:cy + arm, cx - 1:cx + 1] = True
            m[cy - 3:cy + 1, cx - W // 4:cx + W // 4] = True
        m |= ca.sym_noise(rng, (H, W), density * 0.3, "d2", sil)
    else:
        m = ca.sym_noise(rng, (H, W), density, "d2", sil)
    m = symmetry.symmetry_or(m, "d2") & sil
    hist = [m.copy()]
    for t in range(steps):
        m = ca.margolus_step(m, t % 2, rule) & sil
        hist.append(m.copy())
    out = m
    if clean != "raw":
        src = (m & ~morph.erode(m, 1, 4)) if clean == "contour" else m
        out = ca.prune_spurs(ca.sym_thin(src, "d2"), 1)
        out = ca.lace_clean(out, "d2", min_size=6, keep=1)
    d = Design.from_masks({1: out})
    set_frames(d, frames_from(hist, 1, 16, "step", final={1: out}))
    d.notes = f"Margolus {rule}, {steps} steps from {start} in an even {W}x{H} {silhouette}" + \
              (f"; {clean} -> symmetric thin -> lace grammar, largest piece orbit." if clean != "raw" else " (raw).")
    return d


# ---- crystal sigils (own idea) ---------------------------------------------------------

SIGIL_RULES = {
    "gnarl": "B1/S12345678",
    "frost": "B1/S012345678",
    "lattice": "B13/S012345678",
    "fern": "B1357/S012345678",
    "thorn": "B12/S012345678",
}


@recipe("crystal_sigil", section="automata", title="Crystal sigil",
        description="Own idea: grow a crystal from a tiny symmetric seed glyph with a 'B1'-family rule (a cell is "
                    "born next to exactly 1/3/... live cells) while forbidding any birth that would close a 2x2 "
                    "block. Cells never die, so growth rings are nested: generations double as layers (old core "
                    "on top, young fringe at the bottom) - an arcane snowflake/sigil.",
        params={
            "rule": Param("gnarl", choices=list(SIGIL_RULES)),
            "size": Param(25, 11, 41, 2),
            "aspect": Param(1.0, 0.5, 1.0, 0.1, description="width/height; <1 gives a capsule"),
            "gens": Param(12, 2, 24, 1),
            "glyph": Param("random", choices=["random", "dot", "bar", "cross", "pair"]),
            "birth_p": Param(0.5, 0.1, 1.0, 0.05, description="chance a permitted birth happens (per orbit, per gen)"),
            "impurity": Param(0.1, 0.0, 0.4, 0.02, description="fraction of cells that never crystallise"),
            "layers": Param(2, 1, 3, 1),
        },
        tags=["ca", "growth", "d4"])
def crystal_sigil(seed: int, rule: str, size: int, aspect: float, gens: int, glyph: str, birth_p: float, impurity: float,
                  layers: int) -> Design:
    rng = np.random.default_rng(seed)
    H = size
    W = max(7, int(round(size * aspect)) | 1)
    sym = "d4" if H == W else "d2"
    sil = ca.silhouette("oval" if H == W else "capsule", H, W)
    cy, cx = (H - 1) // 2, (W - 1) // 2
    m = np.zeros((H, W), bool)
    g = glyph if glyph != "random" else ["dot", "bar", "cross", "pair"][int(rng.integers(4))]
    if g == "dot":
        m[cy, cx] = True
    elif g == "bar":
        m[cy - 1:cy + 2, cx] = True
    elif g == "cross":
        m[cy - 1:cy + 2, cx] = True
        m[cy, cx - 1:cx + 2] = True
    elif g == "pair":
        m[cy - 2, cx] = m[cy + 2, cx] = True
    m = ca.symmetrize(m, sym) if sym == "d4" else symmetry.symmetry_or(m, "d2")
    birth, survive = ca.parse_rule(SIGIL_RULES[rule])
    m0 = m
    best = None
    for attempt in range(6):  # a crystal can choke on its impurities early: retry, keep the largest
        m = m0.copy()
        hist = [m.copy()]
        # random symmetric 'impurities': cells that refuse to crystallise (break the perfect snowflake)
        blocked = ca.sym_noise(rng, (H, W), impurity, sym, sil) & ~morph.dilate(m, 2, 8)
        for _ in range(gens):
            allow = sil & ~blocked & ca.sym_noise(rng, (H, W), birth_p, sym)
            nm = ca.life_step(m, birth, survive, allow | m, no_block=True)
            nm = symmetry.symmetry_and(nm, sym) | m  # births are symmetric already; guard seams
            if np.array_equal(nm, m):
                if np.array_equal(ca.life_step(m, birth, survive, sil & ~blocked, no_block=True) | m, m):
                    break
                continue
            m = nm
            hist.append(m.copy())
        if best is None or m.sum() > best[0].sum():
            best = (m, hist)
        if m.sum() >= 0.15 * sil.sum():
            break
    m, hist = best
    m = ca.lace_clean(m, sym, min_size=3, keep=1)
    hist[-1] = m
    out = {layers: m}
    if layers >= 2:
        # nested growth rings: upper layers are earlier generations (plus their junction stubs)
        picks = np.linspace(0, len(hist) - 1, layers + 1).round().astype(int)[1:-1][::-1]
        for lid, gi in zip(range(layers - 1, 0, -1), picks):
            up = hist[min(len(hist) - 1, max(1, gi))] & m
            out[lid] = morph.keep_largest(up, 8, 1) if up.any() else up
    d = Design.from_masks(out)
    set_frames(d, frames_from(hist, layers, 16, "gen", final=out))
    d.notes = (f"{rule} ({SIGIL_RULES[rule]}) from a '{g}' glyph, {len(hist) - 1} gens, births that would make a "
               f"2x2 block forbidden, births kept with p={birth_p}, {impurity:.0%} symmetric impurities. Layers = nested growth stages.")
    return d
