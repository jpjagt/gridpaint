"""Lace grammar: learned patch statistics, symmetric annealing, cleanup and scoring.

- ``PatchModel(ph, pw)`` / ``patch_model(ph, pw)``: log-probabilities of every ph x pw binary
  patch, counted on the lace layers of ``lab/samples`` (layers without 2x2 blocks, D4-augmented,
  additive smoothing). ``codes(g)`` gives the code of every (zero-padded) patch anchor.
- ``anneal(...)``: symmetric Metropolis annealing on orbits (see ``composition.orbit_map``) of a
  sum of patch-energy terms + density + 2x2-block penalty. Vectorised: orbits are greedily
  coloured so that orbits in one colour class never share a patch, then a whole class is
  proposed/accepted at once. Returns the grid and snapshots (frames).
- ``lace_clean(mask)``: break 2x2 blocks without disconnecting (simple-point test, symmetric),
  remove dust. Registered op ``lace-clean``.
- ``lace_score(mask) -> dict``: grammar metrics (blocks, diag-only ratio, degree histogram,
  pieces, dust, density) + scalar ``score`` in 0..1 (1 = sample-like lace).
- ``broken_mirror(mask, seed)``: exactly one deliberate asymmetric edit. Registered op
  ``broken-mirror``.
"""

from __future__ import annotations

import functools
import math
from pathlib import Path

import numpy as np

from . import composition as C
from . import morph
from .registry import register_op

SAMPLES = Path(__file__).resolve().parents[2] / "samples"


# ---- samples ---------------------------------------------------------------------------

def blocks2x2(m: np.ndarray) -> np.ndarray:
    """Bool (H-1, W-1): top-left anchors of solid 2x2 blocks."""
    m = np.asarray(m, bool)
    return m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]


@functools.lru_cache(maxsize=1)
def lace_samples() -> tuple[np.ndarray, ...]:
    """Unique trimmed lace layers (no 2x2 blocks, >= 20 cells) from lab/samples/*.json."""
    from ..io import load_any

    out, seen = [], set()
    for p in sorted(SAMPLES.glob("*.json")):
        d = load_any(p)
        for layer in d.layers:
            m = layer.mask
            if m.sum() < 20 or blocks2x2(m).any():
                continue
            ys, xs = np.nonzero(m)
            m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            key = m.tobytes() + bytes(m.shape)
            if key not in seen:
                seen.add(key)
                out.append(m)
    return tuple(out)


def d4_images(m: np.ndarray) -> list[np.ndarray]:
    ims = []
    for k in range(4):
        r = np.rot90(m, k)
        ims += [r, r[:, ::-1]]
    return ims


# ---- patch model ------------------------------------------------------------------------

def patch_codes(g: np.ndarray, ph: int, pw: int) -> np.ndarray:
    """Code of every ph x pw window of the zero-padded grid; anchor (i, j) covers rows
    i-(ph-1)..i, i.e. shape (H+ph-1, W+pw-1). Bit k*pw+l = cell (k, l) of the window."""
    g = np.asarray(g, np.int64)
    H, W = g.shape
    gp = np.pad(g, ((ph - 1, ph - 1), (pw - 1, pw - 1)))
    Ah, Aw = H + ph - 1, W + pw - 1
    code = np.zeros((Ah, Aw), np.int64)
    for k in range(ph):
        for l in range(pw):
            code |= gp[k:k + Ah, l:l + Aw] << (k * pw + l)
    return code


class PatchModel:
    def __init__(self, ph: int = 3, pw: int = 3, eps: float = 0.05, samples=None):
        self.ph, self.pw = ph, pw
        n = 1 << (ph * pw)
        counts = np.zeros(n, np.float64)
        for s in (samples if samples is not None else lace_samples()):
            for im in d4_images(np.pad(s, 2)):
                counts += np.bincount(patch_codes(im, ph, pw).ravel(), minlength=n)
        counts += eps
        self.logp = np.log(counts / counts.sum())
        self.counts = counts
        self._nn: dict = {}

    def energy_table(self, weight: float = 1.0) -> np.ndarray:
        """-weight * log p, shifted so the empty patch costs 0."""
        e = -weight * self.logp
        return e - e[0]

    def conditional_table(self, weight: float = 1.0, cy: int | None = None, cx: int | None = None) -> np.ndarray:
        """-weight * log p(centre bit | other bits of the window): a pseudo-likelihood term with
        no built-in 'cost of existing' (unlike the joint table)."""
        cy = self.ph // 2 if cy is None else cy
        cx = self.pw // 2 if cx is None else cx
        bit = 1 << (cy * self.pw + cx)
        codes = np.arange(len(self.counts))
        other = codes ^ bit
        p = self.counts / (self.counts + self.counts[other])
        return -weight * np.log(p)

    def nn_table(self, weight: float = 1.0, power: float = 1.5) -> np.ndarray:
        """weight * (Hamming distance from each code to the nearest code seen in the samples)^power.
        Every locally sample-like window costs 0; novel windows cost by how far they are from
        anything you drew (texture-optimisation energy, Kwatra et al. 2005)."""
        key = (weight, power)
        if key not in self._nn:
            self._nn[key] = weight * _nn_dist(self.counts > 0.5, self.ph * self.pw).astype(float) ** power
        return self._nn[key]

    def ll(self, g) -> float:
        return float(self.logp[patch_codes(g, self.ph, self.pw)].sum())


_POP16 = np.array([bin(i).count("1") for i in range(1 << 16)], np.uint8)


def _nn_dist(seen: np.ndarray, nbits: int) -> np.ndarray:
    """For every code, min popcount(code ^ s) over seen codes s (cached on disk under work/.cache)."""
    import hashlib

    cache = SAMPLES.parent / "work" / ".cache"
    h = hashlib.sha1(np.packbits(seen).tobytes()).hexdigest()[:12]
    f = cache / f"nn{nbits}-{h}.npy"
    if f.exists():
        return np.load(f)
    codes = np.arange(1 << nbits, dtype=np.int64)
    s = np.nonzero(seen)[0].astype(np.int64)
    out = np.full(len(codes), 255, np.uint8)
    for i in range(0, len(s), 64):
        x = codes[:, None] ^ s[None, i:i + 64]
        d = _POP16[x & 0xFFFF]
        if nbits > 16:
            d = d + _POP16[(x >> 16) & 0xFFFF]
        out = np.minimum(out, d.min(1))
    try:
        cache.mkdir(parents=True, exist_ok=True)
        np.save(f, out)
    except OSError:
        pass
    return out


@functools.lru_cache(maxsize=16)
def patch_model(ph: int = 3, pw: int = 3, eps: float = 0.05) -> PatchModel:
    return PatchModel(ph, pw, eps)


def block_table(weight: float) -> tuple[int, int, np.ndarray]:
    t = np.zeros(16)
    t[15] = weight
    return 2, 2, t


def checker_table(weight: float) -> tuple[int, int, np.ndarray]:
    """Penalty on 2x4 / 4x2-ish diagonal staircases is done with 3x3 perfect checkers."""
    t = np.zeros(512)
    t[0b101010101] = weight
    t[0b010101010] = weight
    return 3, 3, t


def diag_only_table(weight: float) -> tuple[int, int, np.ndarray]:
    """Penalty per diagonal-only cell (centre on, no orthogonal neighbour, >= 1 diagonal one):
    counters the 'checkerboard drift' of patch models on straight runs."""
    codes = np.arange(512)
    b = lambda k: (codes >> k) & 1  # noqa: E731
    centre = b(4) == 1
    orth = b(1) | b(3) | b(5) | b(7)
    diag = b(0) | b(2) | b(6) | b(8)
    return 3, 3, np.where(centre & (orth == 0) & (diag == 1), weight, 0.0)


# ---- annealing -----------------------------------------------------------------------------

def _colour_orbits(orb: np.ndarray, free: np.ndarray, radius: int, rng) -> list[np.ndarray]:
    """Greedy colouring: orbits in one class have no members within Chebyshev ``radius``."""
    H, W = orb.shape
    ids = np.unique(orb[free])
    rng.shuffle(ids)
    members = {int(i): np.argwhere((orb == i) & free) for i in ids}
    occ: list[np.ndarray] = []
    classes: list[list[int]] = []
    for i in ids:
        mem = members[int(i)]
        placed = False
        for c, o in enumerate(occ):
            ok = True
            for y, x in mem:
                if o[max(0, y - radius):y + radius + 1, max(0, x - radius):x + radius + 1].any():
                    ok = False
                    break
            if ok:
                for y, x in mem:
                    o[y, x] = True
                classes[c].append(int(i))
                placed = True
                break
        if not placed:
            o = np.zeros((H, W), bool)
            for y, x in mem:
                o[y, x] = True
            occ.append(o)
            classes.append([int(i)])
    return [np.array(c) for c in classes]


def anneal(free: np.ndarray, fixed: np.ndarray, sym: str = "d2",
           terms: list[tuple[int, int, np.ndarray]] | None = None,
           density: float = 0.42, lam_d: float = 200.0, sweeps: int = 120,
           t0: float = 2.0, t1: float = 0.05, init_p: float = 0.35, rng=None,
           n_frames: int = 12, init: np.ndarray | None = None,
           cond_terms: list[tuple[int, int, int, int, np.ndarray]] | None = None,
           bias: np.ndarray | None = None):
    """Anneal the ``free`` cells (others keep ``fixed`` values).

    terms: list of (ph, pw, energy_table) evaluated on every window of the grid.
    cond_terms: list of (ph, pw, cy, cx, table) with table = -log p(centre | rest) evaluated only at
    the window centred (cy, cx) on each flipped cell: a Gibbs-like sampler of learned conditionals.
    bias: per-cell energy for being on (negative = attractive); breaks translation-periodicity.
    Energy = sum terms + lam_d * N * (density_free - density)^2.
    Returns (grid, frames[(label, grid)])."""
    rng = np.random.default_rng(rng)
    free = np.asarray(free, bool)
    H, W = free.shape
    orb = C.orbit_map(H, W, sym)
    # an orbit is free only if all its members are free (keeps exact symmetry)
    free = C.symmetrize(free, sym, how="and")
    if terms is None and not cond_terms:
        terms = [(3, 3, patch_model(3, 3).energy_table())]
    terms = terms or []
    cond_terms = cond_terms or []
    radius = max([max(ph, pw) for ph, pw, _ in terms] + [max(ph, pw) for ph, pw, *_ in cond_terms] + [2]) - 1
    classes = _colour_orbits(orb, free, radius, rng)
    N = max(1, int(free.sum()))

    # per-class precomputation
    pre = []
    for ids in classes:
        lut = {int(i): k for k, i in enumerate(ids)}
        cell_local = np.full((H, W), -1, np.int64)
        sel = np.isin(orb, ids) & free
        ys, xs = np.nonzero(sel)
        for y, x in zip(ys, xs):
            cell_local[y, x] = lut[int(orb[y, x])]
        size = np.bincount(cell_local[sel], minlength=len(ids))
        labs = []
        for ph, pw, _ in terms:
            lab = np.full((H + ph - 1, W + pw - 1), -1, np.int64)
            for k in range(ph):
                for l in range(pw):
                    sub = lab[k:k + H, l:l + W]
                    sub[sel] = cell_local[sel]
            labs.append(lab)
        pre.append((sel, cell_local, size, labs, len(ids)))

    g = np.asarray(fixed, bool) & ~free
    if init is not None:
        g = np.where(free, np.asarray(init, bool), g)
    else:
        vals = rng.random(H * W) < init_p
        g = np.where(free, vals[orb], g)
    g = np.where(free, C.symmetrize(g & free, sym, "and") | (g & ~free), g) if init is not None else g

    frames = []
    frame_at = set(np.unique(np.linspace(0, sweeps - 1, max(1, n_frames)).round().astype(int)).tolist())
    ratio = (t1 / t0) ** (1 / max(1, sweeps - 1))
    T = t0
    for s in range(sweeps):
        for ci in rng.permutation(len(pre)):
            sel, cell_local, size, labs, n = pre[ci]
            g2 = g ^ sel
            delta = np.zeros(n)
            for (ph, pw, table), lab in zip(terms, labs):
                d = table[patch_codes(g2, ph, pw)] - table[patch_codes(g, ph, pw)]
                v = lab >= 0
                delta += np.bincount(lab[v], weights=d[v], minlength=n)
            for ph, pw, cy, cx, table in cond_terms:
                code = patch_codes(g, ph, pw)[ph - 1 - cy:ph - 1 - cy + H, pw - 1 - cx:pw - 1 - cx + W][sel]
                bit = 1 << (cy * pw + cx)
                delta += np.bincount(cell_local[sel], weights=table[code ^ bit] - table[code], minlength=n)
            if bias is not None:
                sgn = np.where(g[sel], -1.0, 1.0)
                delta += np.bincount(cell_local[sel], weights=bias[sel] * sgn, minlength=n)
            if lam_d:
                cur = (g & free).sum()
                on = np.bincount(cell_local[sel], weights=g[sel].astype(float), minlength=n)
                dn = size - 2 * on  # +size if off->on, -size if on->off
                e0 = (cur / N - density) ** 2
                e1 = ((cur + dn) / N - density) ** 2
                delta += lam_d * N * (e1 - e0)
            acc = rng.random(n) < np.exp(np.clip(-delta / T, -50, 50))
            flip = sel & acc[np.maximum(cell_local, 0)]
            g = g ^ flip
        if s in frame_at:
            frames.append((f"T={T:.2f}", g.copy()))
        T *= ratio
    return g, frames


def smooth_field(shape, rng, sigma: float = 2.5, sym: str = "d2") -> np.ndarray:
    """Zero-mean, unit-std low-frequency noise, symmetrised (mean over the symmetry images)."""
    from scipy import ndimage

    f = ndimage.gaussian_filter(rng.normal(size=shape), sigma, mode="reflect")
    ims = C.sym_images(f, sym) if sym != "d4" or shape[0] == shape[1] else [f]
    f = np.mean(ims, axis=0)
    return (f - f.mean()) / (f.std() + 1e-9)


# ---- texture optimisation (patch voting) -------------------------------------------------------

@functools.lru_cache(maxsize=4)
def window_bank(n: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """Unique n x n windows of the D4-augmented, zero-padded lace samples as +-1 rows, and counts."""
    rows = {}
    for s in lace_samples():
        for im in d4_images(np.pad(s, n // 2 + 1)):
            H, W = im.shape
            v = np.lib.stride_tricks.sliding_window_view(im, (n, n)).reshape(-1, n * n)
            for r in v:
                k = r.tobytes()
                rows[k] = rows.get(k, 0) + 1
    keys = list(rows)
    bank = np.array([np.frombuffer(k, bool) for k in keys]).astype(np.float32) * 2 - 1
    return bank, np.array([rows[k] for k in keys], np.float32)


def texture_optimize(free: np.ndarray, fixed: np.ndarray, sym: str = "d2", n: int = 5, iters: int = 30,
                     density: float = 0.42, t0: float = 3.0, t1: float = 0.3, rng=None, init=None,
                     n_frames: int = 12, bias: np.ndarray | None = None, fixed_weight: float = 3.0):
    """Kwatra-style texture optimisation: every n x n window of the output is matched to a (soft-
    randomly chosen, temperature T) nearest window of your samples; cells take the mean vote of
    the windows covering them, are symmetrised, and re-thresholded to the target density.
    Returns (grid, frames)."""
    rng = np.random.default_rng(rng)
    free = C.symmetrize(np.asarray(free, bool), sym, how="and")
    fixed = np.asarray(fixed, bool) & ~free
    H, W = free.shape
    bank, cnt = window_bank(n)
    logc = np.log(cnt)
    r = n // 2
    if init is None:
        noise = rng.random((H, W))
        g = (np.mean(C.sym_images(noise, sym), axis=0) < density) & free | fixed
    else:
        g = (np.asarray(init, bool) & free) | fixed
    centres = np.argwhere(np.pad(free, r)[r:-r or None, r:-r or None] | morph.dilate(free, r, 8))
    cy, cx = centres[:, 0], centres[:, 1]
    oy, ox = np.mgrid[-r:r + 1, -r:r + 1]
    YY = (cy[:, None] + oy.ravel()[None, :]) + r
    XX = (cx[:, None] + ox.ravel()[None, :]) + r
    fp = np.pad(free, r)
    wts = np.where(fp[YY, XX], 1.0, fixed_weight).astype(np.float32)
    frames = []
    ratio = (t1 / t0) ** (1 / max(1, iters - 1))
    T = t0
    nfree = max(1, free.sum())
    snap = set(np.unique(np.linspace(0, iters - 1, max(1, n_frames)).round().astype(int)).tolist())
    for it in range(iters):
        gp = np.pad(g, r).astype(np.float32) * 2 - 1
        X = gp[YY, XX]
        # weighted Hamming distance to every bank window
        D = (wts.sum(1, keepdims=True) - (X * wts) @ bank.T) / 2
        score = -D / max(T, 1e-3) * 2.0 + 0.15 * np.minimum(logc, 2.0)[None, :]
        score += rng.gumbel(size=score.shape).astype(np.float32) * min(1.0, T)
        pick = score.argmax(1)
        votes = np.zeros((H + 2 * r, W + 2 * r), np.float32)
        hits = np.zeros_like(votes)
        np.add.at(votes, (YY, XX), (bank[pick] + 1) / 2)
        np.add.at(hits, (YY, XX), 1.0)
        v = (votes / np.maximum(hits, 1))[r:H + r, r:W + r]
        v = np.mean(C.sym_images(v, sym), axis=0)
        if bias is not None:
            v = v - 0.1 * bias
        v = v + np.mean(C.sym_images(rng.normal(0, 0.05, v.shape), sym), axis=0)  # tie-break
        vals = np.sort(v[free])[::-1]
        k = int(round(density * nfree))
        thr = vals[min(len(vals) - 1, max(0, k))] if len(vals) else 0.5
        newg = np.where(free, v > thr, fixed)
        newg = C.symmetrize(newg & free, sym, how="and") | fixed
        g = newg
        if it in snap:
            frames.append((f"T={T:.2f}", g.copy()))
        T *= ratio
    return g, frames


# ---- cleanup ---------------------------------------------------------------------------------

def _is_simple(m: np.ndarray, y: int, x: int) -> bool:
    """Removing (y, x) keeps its filled 8-neighbours in one 8-connected group (and it is not
    an isolated tip with exactly 1 neighbour -> removing a tip is fine too)."""
    H, W = m.shape
    nb = np.zeros((3, 3), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            yy, xx = y + dy, x + dx
            if (dy or dx) and 0 <= yy < H and 0 <= xx < W:
                nb[dy + 1, dx + 1] = m[yy, xx]
    if nb.sum() <= 1:
        return True
    _, n = morph.label(nb, 8)
    return n == 1


def lace_clean(mask: np.ndarray, min_size: int = 3, sym: str = "auto", keep: np.ndarray | None = None,
               max_iter: int = 200) -> np.ndarray:
    """Remove 2x2 blocks (cell with most orthogonal neighbours whose removal keeps local
    connectivity; mirrored) and pieces smaller than min_size. ``keep`` cells are never removed."""
    m = np.asarray(mask, bool).copy()
    if sym == "auto":
        sym = C.detect_sym(m)
    keep = np.zeros_like(m) if keep is None else np.asarray(keep, bool)
    skip: set[tuple[int, int]] = set()
    for _ in range(max_iter):
        bl = [tuple(map(int, p)) for p in np.argwhere(blocks2x2(m)) if tuple(map(int, p)) not in skip]
        if not bl:
            break
        y0, x0 = bl[0]
        nc4 = morph.neighbour_count(m, 4)
        cands = [(y0 + a, x0 + c) for a in (0, 1) for c in (0, 1) if not keep[y0 + a, x0 + c]]
        if not cands:
            skip.add((y0, x0))
            continue
        cands.sort(key=lambda p: (-_is_simple(m, *p), -nc4[p]))
        y, x = cands[0]
        rm = np.zeros_like(m)
        rm[y, x] = True
        m &= ~(C.symmetrize(rm, sym) & ~keep)
    if min_size > 1:
        m = morph.remove_small(m, min_size, 8) | (m & keep)
    return m


# ---- score -----------------------------------------------------------------------------------

def lace_score(mask: np.ndarray, region: np.ndarray | None = None) -> dict:
    """Grammar metrics; ``score`` 0..1 is a soft match to the sample statistics."""
    m = np.asarray(mask, bool)
    n = int(m.sum())
    if n == 0:
        return {"cells": 0, "score": 0.0, "density": 0.0, "blocks2x2": 0, "diag_only": 0, "diag_ratio": 0.0,
                "deg4": [0] * 5, "pieces": 0, "dust": 0, "isolated": 0}
    nc4 = morph.neighbour_count(m, 4)
    nc8 = morph.neighbour_count(m, 8)
    diag_only = int((m & (nc4 == 0) & (nc8 > 0)).sum())
    lab, pieces = morph.label(m, 8)
    sizes = np.bincount(lab.ravel())[1:]
    dust = int((sizes < 3).sum())
    blocks = int(blocks2x2(m).sum())
    deg = [int((m & (nc4 == k)).sum()) for k in range(5)]
    reg = m.shape if region is None else None
    area = int(np.asarray(region, bool).sum()) if region is not None else int(np.prod(reg))
    dens = n / max(1, area)
    dr = diag_only / n
    s = 1.0
    s *= math.exp(-blocks / 2)
    s *= math.exp(-((dr - 0.2) / 0.12) ** 2)
    s *= math.exp(-dust / 3)
    s *= math.exp(-max(0, pieces - 1) / 6)
    s *= math.exp(-((deg[3] + deg[4]) / n / 0.25) ** 2)
    return {"cells": n, "density": round(dens, 3), "blocks2x2": blocks, "diag_only": diag_only,
            "diag_ratio": round(dr, 3), "deg4": deg, "pieces": int(pieces), "dust": dust,
            "isolated": int((m & (nc8 == 0)).sum()), "score": round(s, 3)}


# ---- broken mirror ---------------------------------------------------------------------------

def _bm_gap(m, rng, off_axis):
    H, W = m.shape
    nc8 = morph.neighbour_count(m, 8)
    tips = np.argwhere(m & off_axis & (nc8 <= 2))
    if not len(tips):
        return None
    m = m.copy()
    y, x = tips[rng.integers(len(tips))]
    for _ in range(3):  # cut a run of up to 3 cells starting at a tip, along the stroke
        m[y, x] = False
        nxt = [(y + a, x + b) for a, b in C.N8 if 0 <= y + a < H and 0 <= x + b < W and m[y + a, x + b]]
        if len(nxt) != 1:
            break
        y, x = nxt[0]
    return morph.remove_small(m, 2, 8)


def _bm_dot(m, rng, off_axis, allowed):
    cand = np.argwhere(~morph.dilate(m, 1, 8) & allowed & off_axis & morph.dilate(m, 2, 8))
    if not len(cand):
        return None
    m = m.copy()
    m[tuple(cand[rng.integers(len(cand))])] = True
    return m


def _bm_worm(m, rng, off_axis, allowed):
    H, W = m.shape
    starts = np.argwhere(m & off_axis)
    rng.shuffle(starts)
    m = m.copy()
    for y, x in starts[:60]:
        cur = (int(y), int(x))
        added = []
        n = int(rng.integers(3, 6))
        heading = C.N8[rng.integers(8)]
        for _ in range(n * 4):
            if len(added) >= n:
                break
            opts = []
            for a, b in C.N8:
                ny, nx = cur[0] + a, cur[1] + b
                if not (0 <= ny < H and 0 <= nx < W) or m[ny, nx] or not allowed[ny, nx] or not off_axis[ny, nx]:
                    continue
                m[ny, nx] = True
                ok = not blocks2x2(m[max(0, ny - 1):ny + 2, max(0, nx - 1):nx + 2]).any()
                touch = int(m[max(0, ny - 1):ny + 2, max(0, nx - 1):nx + 2].sum()) - 1
                m[ny, nx] = False
                if ok and touch <= (3 if not added else 2):
                    w = 2.0 if (a, b) == heading else (1.0 if a and b else 0.7)
                    opts.append(((ny, nx), (a, b), w))
            if not opts:
                break
            ws = np.array([o[2] for o in opts])
            pick = opts[rng.choice(len(opts), p=ws / ws.sum())]
            cur, heading = pick[0], pick[1]
            m[cur] = True
            added.append(cur)
        if len(added) >= 3:
            return m
        for p in added:
            m[p] = False
    return None


def broken_mirror(mask: np.ndarray, seed: int = 0, kind: str = "auto", allowed: np.ndarray | None = None) -> np.ndarray:
    """One deliberate asymmetric edit away from the axes (of the content's bbox): kind=worm (3-5 cell
    tendril grown from the lace), gap (cut a short run from a stroke tip), dot (one extra dot), auto.
    Falls back to the other kinds when the chosen one finds no room. Stays inside the bbox."""
    rng = np.random.default_rng(seed)
    m = np.asarray(mask, bool).copy()
    if not m.any():
        return m
    allowed = np.ones_like(m) if allowed is None else np.asarray(allowed, bool)
    ys, xs = np.nonzero(m)
    inbox = np.zeros_like(m)
    inbox[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
    allowed = allowed & inbox
    yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
    off_axis = (np.abs(xx - (xs.min() + xs.max()) / 2) >= 2) & (np.abs(yy - (ys.min() + ys.max()) / 2) >= 2)
    first = str(rng.choice(["worm", "gap", "dot"], p=[0.6, 0.2, 0.2])) if kind == "auto" else kind
    for k in [first] + [k for k in ("worm", "dot", "gap") if k != first]:
        out = (_bm_worm(m, rng, off_axis, allowed) if k == "worm" else
               _bm_dot(m, rng, off_axis, allowed) if k == "dot" else _bm_gap(m, rng, off_axis))
        if out is not None:
            return out
    return m


# ---- registered ops -----------------------------------------------------------------------------

@register_op("lace-clean")
def _lace_clean_op(mask, min_size: int = 3, sym: str = "auto"):
    """Lace grammar cleanup: break 2x2 solid blocks without disconnecting strokes (mirrored if the
    layer is symmetric), then remove dust pieces < min_size."""
    return lace_clean(mask, min_size, sym)


@register_op("broken-mirror")
def _broken_mirror_op(mask, seed: int = 0, kind: str = "auto"):
    """Exactly one deliberate asymmetric accent: kind=worm (short tendril), gap (cut a tip), dot,
    or auto. Keeps away from the axes. Use on a finished symmetric layer (often the top one)."""
    return broken_mirror(mask, seed, kind)
