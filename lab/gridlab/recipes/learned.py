"""Recipes that learn the lace texture from the user's own samples (lab/samples).

- sample_echo_anneal: patch statistics -> symmetric annealing / patch voting in a silhouette band (P1)
- sample_echo_cross:  same + central motif, breathing gap, bridges, derived layer stack (P2)
- wfc_ring:           overlapping-model Wave Function Collapse, symmetric orbits, ring/capsule (P13)

Engines (``method``), all on symmetry orbits so only the quarter is generated:
- ``mrf-raw``: the research prototype: Metropolis on -log p(3x3 patch) + density + 2x2 penalty. Converges
  to crystalline "ladders" (the joint patch energy rewards repeating the most common strokes).
- ``mrf``: refined energy = squared Hamming distance of every 4x4 / 3x5 / 5x3 window to the nearest window
  you drew (texture-optimisation energy), + diagonal-only penalty (fixes the checkerboard drift on straight
  edges), + a smooth random bias field (breaks the vertical periodicity), + density.
- ``vote``: Kwatra texture optimisation: each 5x5 window picks a (temperature-softened) nearest sample
  window, cells take the mean vote, are mirrored and re-thresholded to the density. Most organic.
"""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import composition as C
from ..ops import lace as L
from ..ops import morph
from . import Param, recipe, register_section

register_section(
    "learned", "Learned from your samples",
    "The lace texture is learned from your own drawings: every small window of your lace layers becomes "
    "training data for a symmetric annealer, a patch-voting texture optimiser or wave function collapse.")

METHODS = ["vote", "mrf", "mrf-raw"]


def _mrf_terms(raw: bool, diag: float):
    if raw:
        return [(3, 3, L.patch_model(3, 3).energy_table()), L.block_table(50.0)]
    return [(4, 4, L.patch_model(4, 4).nn_table(1.0, 2.0)), (3, 5, L.patch_model(3, 5).nn_table(1.0, 2.0)),
            (5, 3, L.patch_model(5, 3).nn_table(1.0, 2.0)), L.block_table(30.0), L.diag_only_table(diag)]


def lace_fill(rng, free, fixed, sym, method="vote", density=0.4, sweeps=120, wander=2.0, n_frames=12):
    """Fill ``free`` cells with learned lace; returns (grid, frames). Shared by the recipes here."""
    H, W = free.shape
    bias = -wander * L.smooth_field((H, W), rng, 2.5, sym) if wander > 0 else None
    if method == "vote":
        return L.texture_optimize(free, fixed, sym, n=5, iters=max(10, sweeps // 4), density=density, rng=rng,
                                  n_frames=n_frames, bias=None if bias is None else bias)
    raw = method == "mrf-raw"
    return L.anneal(free, fixed, sym, _mrf_terms(raw, 1.0), density=density, sweeps=sweeps, rng=rng,
                    t0=2.0 if raw else 3.0, t1=0.05 if raw else 0.2, lam_d=200 if raw else 100,
                    n_frames=n_frames, bias=None if raw else bias)


def _sym_for(w: int, h: int, sym: str) -> str:
    if sym == "auto":
        return "d4" if w == h else "d2"
    if sym == "d4" and w != h:
        return "d2"
    return sym


@recipe(
    "sample_echo_anneal", section="learned", title="Sample echo",
    description="Lace learned from your samples grown inside a silhouette band; only the quarter is free, the rest "
                "is mirrored. method=vote (patch voting, most organic), mrf (refined annealing), mrf-raw (the naive "
                "3x3 annealer: crystallises into ladders). Frames show the texture settling as T drops.",
    params={
        "width": Param(13, 7, 41, 2), "height": Param(23, 7, 41, 2),
        "silhouette": Param("capsule", choices=list(C.SILHOUETTES)),
        "method": Param("vote", choices=METHODS),
        "band": Param(5, 1, 12, 1, description="lace band depth from the edge (cells)"),
        "frame": Param(False, description="thin solid outline + 1-cell gap around the lace"),
        "density": Param(0.34, 0.2, 0.6, 0.02),
        "wander": Param(0.7, 0.0, 5.0, 0.1, description="strength of the smooth random density field (anti-periodicity)"),
        "sym": Param("auto", choices=["auto", "d2", "d4", "x"]),
        "sweeps": Param(100, 20, 400, 10),
        "connected": Param(True, description="join pieces with short mirrored bridges"),
    },
    tags=["learned", "anneal", "d2"],
)
def sample_echo_anneal(seed, width, height, silhouette, method, band, frame, density, wander, sym, sweeps, connected):
    rng = np.random.default_rng(seed)
    sym = _sym_for(width, height, sym)
    sil = C.silhouette(silhouette, height, width)
    z = C.zones(sil, frame=1 if frame else 0, frame_gap=1, band=band, gap=0)
    free = z["band"]
    g, frames = lace_fill(rng, free, np.zeros_like(sil), sym, method, density, sweeps, wander)
    g = L.lace_clean(g, 3, sym)
    if connected:
        g = C.connect(g, free, sym, 4)
    if frame:
        ring = z["frame"]
        g = g | ring
        g = C.connect(g, free | ring, sym, 3)
        frames = [(lab, f | ring) for lab, f in frames]
    frames.append(("clean", g))
    sc = L.lace_score(g)
    d = Design.from_masks({1: g}, frames=[(lab, {1: f}) for lab, f in frames])
    d.notes = (f"{method} on {sym} orbits of a {silhouette} band ({band} deep), density {density}, wander {wander}; "
               f"lace-clean + bridges. diag-only {sc['diag_ratio']}, pieces {sc['pieces']}.")
    return d


# ---- sample echo + cross ---------------------------------------------------------------------

MOTIF_CHOICES = list(C.MOTIFS)


def _bridges(lace, mot, gapzone, sym, rng, n):
    """Add up to ``n`` symmetric single-cell bridges in the gap between motif and lace."""
    out = lace | mot
    cand = []
    for y, x in np.argwhere(gapzone & ~out):
        nb_m = mot[max(0, y - 1):y + 2, max(0, x - 1):x + 2].any()
        nb_l = lace[max(0, y - 1):y + 2, max(0, x - 1):x + 2].any()
        if nb_m and nb_l:
            cand.append((y, x))
    rng.shuffle(cand)
    added = 0
    for y, x in cand:
        if added >= n:
            break
        if out[y, x]:
            continue
        one = np.zeros_like(out)
        one[y, x] = True
        t = out | C.symmetrize(one, sym)
        if not L.blocks2x2(t).any():
            out = t
            added += 1
    return out


@recipe(
    "sample_echo_cross", section="learned", title="Sample echo + cross",
    description="Learned lace around a crisp central motif (cross/spine/star/eye...) with a one-cell breathing gap "
                "and a few bridges, stacked like your multi_1/multi_2: bottom lace, middle lace + motif, top plain motif.",
    params={
        "width": Param(13, 9, 41, 2), "height": Param(23, 9, 41, 2),
        "silhouette": Param("capsule", choices=list(C.SILHOUETTES)),
        "motif": Param("cross", choices=MOTIF_CHOICES),
        "motif_scale": Param(0.7, 0.3, 1.0, 0.05, description="motif half-extent relative to the canvas"),
        "method": Param("vote", choices=METHODS),
        "band": Param(0, 0, 12, 1, description="lace depth from the edge; 0 = fill everything around the motif"),
        "density": Param(0.32, 0.2, 0.6, 0.02),
        "bridges": Param(2, 0, 6, 1, description="symmetric bridge orbits between motif and lace"),
        "layers": Param(3, 1, 3, 1),
        "wander": Param(0.7, 0.0, 5.0, 0.1),
        "sweeps": Param(100, 20, 400, 10),
    },
    tags=["learned", "motif", "layers"],
)
def sample_echo_cross(seed, width, height, silhouette, motif, motif_scale, method, band, density, bridges, layers,
                      wander, sweeps):
    rng = np.random.default_rng(seed)
    sym = "d2"
    sil = C.silhouette(silhouette, height, width)
    ry = max(2, round((height - 1) / 2 * motif_scale))
    rx = max(1, round((width - 1) / 2 * motif_scale))
    # with 3 layers the middle lace is inset by one cell so the bottom lace frames it (like multi_1)
    sil_mid = morph.erode(sil, 1, 8) if layers == 3 else sil
    mot = C.symmetrize(C.motif(motif, height, width, ry, rx), "x") & morph.erode(sil_mid, 1, 4)
    halo = morph.dilate(mot, 1, 8) & ~mot  # breathing gap
    base = C.zones(sil_mid, band=band, gap=0)["band"] if band > 0 else sil_mid
    free = base & ~halo & ~mot
    lace, frames = lace_fill(rng, free, np.zeros_like(sil), sym, method, density, sweeps, wander)
    lace = L.lace_clean(lace, 3, sym)
    mid = _bridges(lace, mot, halo, sym, rng, bridges)
    mid = C.connect(mid, free | halo, sym, 4)
    mid = L.lace_clean(mid, 3, sym, keep=mot)
    if layers == 1:
        out = {1: mid}
        fl = [(lab, {1: f | mot}) for lab, f in frames]
    elif layers == 2:
        out = {1: mot, 2: mid}
        fl = [(lab, {1: mot, 2: f | mot}) for lab, f in frames]
    else:
        # bottom: an independent, slightly denser lace band around the edge (3 deep) + a sparse inner
        # lace, so the two lace layers interleave like multi_1 L3/L4
        zb = C.zones(sil, band=3, gap=0)
        bot, _ = lace_fill(rng, sil & ~morph.dilate(mot, 1, 4), np.zeros_like(sil), sym, method,
                           min(0.5, density + 0.04), max(40, sweeps // 2), wander, n_frames=2)
        bot = L.lace_clean(bot | (zb["band"] & bot), 3, sym)
        bot = C.connect(bot, sil, sym, 4)
        out = {1: mot, 2: mid, 3: bot}
        fl = [(lab, {1: mot, 2: f | mot, 3: bot}) for lab, f in frames]
    fl.append(("final", dict(out)))
    d = Design.from_masks(out, frames=fl)
    d.notes = (f"{motif} clamped in the core with a 1-cell halo; learned lace ({method}, density {density}) "
               f"around it; {bridges} bridge orbits; layers: "
               + {1: "lace+motif", 2: "top motif / lace+motif",
                  3: "top motif / lace+motif / independent bottom lace"}[layers])
    return d


# ---- WFC ---------------------------------------------------------------------------------------

def _patterns(n=3):
    """Unique n x n patterns (D4-augmented samples, zero padded) with counts."""
    counts = {}
    for s in L.lace_samples():
        for im in L.d4_images(np.pad(s, n)):
            H, W = im.shape
            for y in range(H - n + 1):
                for x in range(W - n + 1):
                    k = im[y:y + n, x:x + n].tobytes()
                    counts[k] = counts.get(k, 0) + 1
    keys = sorted(counts)
    pats = np.array([np.frombuffer(k, bool).reshape(n, n) for k in keys])
    w = np.array([counts[k] for k in keys], float)
    return pats, w


_PAT_CACHE = {}


def _wfc_tables(n=3):
    if n in _PAT_CACHE:
        return _PAT_CACHE[n]
    pats, w = _patterns(n)
    P = len(pats)
    idx = {p.tobytes(): i for i, p in enumerate(pats)}
    tf = {
        "fx": np.array([idx[p[:, ::-1].tobytes()] for p in pats]),
        "fy": np.array([idx[p[::-1, :].tobytes()] for p in pats]),
        "t": np.array([idx[p.T.copy().tobytes()] for p in pats]),
    }
    c = n // 2
    compat = {}
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if not (dy or dx):
                continue
            # pattern a at cell p, pattern b at p + (dy, dx): overlap must agree
            A = pats[:, max(0, dy):n + min(0, dy), max(0, dx):n + min(0, dx)].reshape(P, -1)
            B = pats[:, max(0, -dy):n + min(0, -dy), max(0, -dx):n + min(0, -dx)].reshape(P, -1)
            compat[(dy, dx)] = (A[:, None, :] == B[None, :, :]).all(-1)
    bits = pats.reshape(P, -1)
    _PAT_CACHE[n] = (pats, w, tf, compat, bits, c)
    return _PAT_CACHE[n]


def _transform_for(y, x, cy, cx, H, W, sym):
    """Members of the orbit of canonical (cy, cx) with the pattern transform chain to reach them."""
    out = {}
    base = [((cy, cx), [])]
    if sym == "d4":
        base.append(((cx, cy), ["t"]))
    res = []
    for (yy, xx), ch in base:
        res.append(((yy, xx), ch))
        res.append(((yy, W - 1 - xx), ch + ["fx"]))
        res.append(((H - 1 - yy, xx), ch + ["fy"]))
        res.append(((H - 1 - yy, W - 1 - xx), ch + ["fx", "fy"]))
    for p, ch in res:
        out.setdefault(p, ch)
    return out


def wfc_run(can1: np.ndarray, sym: str, rng, n=3, max_tries=40, n_frames=10, temp=1.0, fill=1.0):
    """Orbit-symmetric overlapping WFC. ``can1``: cells allowed to be 1. Returns (grid, frames, tries)."""
    pats, w, tf, compat, bits, c = _wfc_tables(n)
    P = len(pats)
    H, W = can1.shape
    dom = morph.dilate(can1, 1, 8)
    # base allowed: pattern bits that fall on cells that cannot be 1 must be 0
    cp = np.pad(can1, c)
    base = np.zeros((H, W, P), bool)
    for y, x in np.argwhere(dom):
        nb = cp[y:y + n, x:x + n].ravel()
        base[y, x] = ~(bits & ~nb[None, :]).any(1)
    # stabiliser constraints for cells on mirror axes
    for y, x in np.argwhere(dom):
        if x == W - 1 - x:
            base[y, x] &= tf["fx"] == np.arange(P)
        if y == H - 1 - y:
            base[y, x] &= tf["fy"] == np.arange(P)
        if sym == "d4" and x == y:
            base[y, x] &= tf["t"] == np.arange(P)
    orb = C.orbit_map(H, W, sym)
    canon = [(int(y), int(x)) for y, x in np.argwhere(dom & (orb == (np.arange(H)[:, None] * W + np.arange(W)[None, :])))]
    members = {p: _transform_for(0, 0, p[0], p[1], H, W, sym) for p in canon}
    weights = w ** (1.0 / temp) * np.exp(fill * pats[:, c, c] + 0.3 * fill * pats.reshape(len(pats), -1).sum(1))

    def apply_chain(pidx, chain):
        for t in chain:
            pidx = tf[t][pidx]
        return pidx

    def propagate(wave, stack):
        while stack:
            y, x = stack.pop()
            cur = wave[y, x]
            for (dy, dx), M in compat.items():
                ny, nx = y + dy, x + dx
                if not (0 <= ny < H and 0 <= nx < W) or not dom[ny, nx]:
                    continue
                allowed = M[cur].any(0)
                nw = wave[ny, nx] & allowed
                if not nw.any():
                    return False
                if (nw != wave[ny, nx]).any():
                    wave[ny, nx] = nw
                    stack.append((ny, nx))
        return True

    for tri in range(max_tries):
        wave = base.copy()
        if not propagate(wave, [tuple(p) for p in np.argwhere(dom)]):
            raise RuntimeError("WFC: mask infeasible")
        frames = []
        n_orb = len(canon)
        snap_every = max(1, n_orb // max(1, n_frames))
        ok = True
        for step in range(n_orb + 1):
            cnt = wave.sum(-1)
            open_ = [p for p in canon if cnt[p] > 1]
            if not open_:
                break
            ent = np.array([np.log(cnt[p]) + rng.random() * 0.3 for p in open_])
            p = open_[int(ent.argmin())]
            opts = np.nonzero(wave[p])[0]
            pw_ = weights[opts]
            choice = int(opts[rng.choice(len(opts), p=pw_ / pw_.sum())])
            stack = []
            for q, chain in members[p].items():
                k = apply_chain(choice, chain)
                if not wave[q][k]:
                    ok = False
                    break
                wave[q] = False
                wave[q][k] = True
                stack.append(q)
            if not ok or not propagate(wave, stack):
                ok = False
                break
            if step % snap_every == 0:
                frames.append((f"collapse {step}/{n_orb}", _decode(wave, pats, c, dom)))
        if ok:
            g = _decode(wave, pats, c, dom)
            frames.append(("collapsed", g))
            return g, frames, tri + 1
    return None, [], max_tries


def _decode(wave, pats, c, dom):
    """Cell is on if every remaining pattern has its centre on."""
    centre = pats[:, c, c]
    cnt = wave.sum(-1)
    on = (wave & centre[None, None, :]).sum(-1)
    return dom & (cnt > 0) & (on == cnt)


@recipe(
    "wfc_ring", section="learned", title="Learned WFC ring",
    description="Overlapping-model Wave Function Collapse trained on your lace (3x3 patterns, D4-augmented). "
                "Whole symmetry orbits collapse at once so the result is exactly mirrored; crisper than "
                "the annealer.",
    params={
        "size": Param(29, 15, 41, 2, description="canvas (square for ring, width for capsule)"),
        "height": Param(29, 15, 45, 2, description="capsule/oval height (ring ignores)"),
        "shape": Param("ring", choices=["ring", "capsule", "oval"]),
        "band": Param(4, 2, 8, 1),
        "temp": Param(2.0, 0.5, 4.0, 0.1, description="pattern-weight temperature (>1 flattens toward rare patterns)"),
        "fill": Param(2.0, 0.0, 4.0, 0.25, description="bias toward patterns with more ink (counters the empty-pattern majority)"),
        "connected": Param(True),
        "sym": Param("auto", choices=["auto", "d2", "d4"]),
    },
    tags=["learned", "wfc", "d4"],
)
def wfc_ring(seed, size, height, shape, band, temp, fill, connected, sym):
    rng = np.random.default_rng(seed)
    if shape == "ring":
        H = W = size
        sil = C.silhouette("circle", H, W)
    else:
        W, H = size, height
        sil = C.silhouette("capsule" if shape == "capsule" else "oval", H, W)
    sym = ("d4" if H == W else "d2") if sym == "auto" else ("d2" if (sym == "d4" and H != W) else sym)
    can1 = C.zones(sil, band=band, gap=0)["band"]
    g, frames, tries = wfc_run(can1, sym, rng, temp=temp, fill=fill)
    if g is None:
        g = np.zeros_like(can1)
        note = f"WFC failed after {tries} tries"
    else:
        g = L.lace_clean(g, 3, sym)
        if connected:
            g = C.connect(g, can1, sym, 4)
        frames.append(("clean", g))
        note = f"{tries} attempt(s)"
    d = Design.from_masks({1: g}, frames=[(lab, {1: f}) for lab, f in frames])
    d.notes = f"Overlapping WFC (3x3, {len(_wfc_tables()[0])} patterns from samples), {sym} orbit collapse in a {band}-deep {shape} band; {note}."
    return d
