"""Scalar fields on the grid: smooth noise (value / fbm "perlin-ish"), Worley, symmetric
sampling, field symmetrisation, distance zones and gradient helpers.

All fields are float arrays (H, W) indexed [y, x]. Symmetric variants evaluate a base field at
the *canonical* coordinate of each cell (|dx|, |dy| from the centre; D4 also sorts them), so the
result is exactly mirror-symmetric with no seams.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import masks as M
from .registry import register_op


# ---- noise ------------------------------------------------------------------

def _smoothstep(t):
    return t * t * (3 - 2 * t)


def value_noise(h: int, w: int, scale: float = 0.25, rng=None, seed: int = 0) -> np.ndarray:
    """Smooth value noise in [0, 1]. ``scale`` = lattice frequency in cycles per cell
    (0.25 -> one random lattice value every 4 cells)."""
    rng = np.random.default_rng(seed) if rng is None else rng
    scale = max(scale, 1e-3)
    gh, gw = int(np.ceil(h * scale)) + 2, int(np.ceil(w * scale)) + 2
    lat = rng.random((gh, gw))
    y, x = np.mgrid[0:h, 0:w].astype(float)
    fx, fy = x * scale, y * scale
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = _smoothstep(fx - x0), _smoothstep(fy - y0)
    a = lat[y0, x0] * (1 - tx) + lat[y0, x0 + 1] * tx
    b = lat[y0 + 1, x0] * (1 - tx) + lat[y0 + 1, x0 + 1] * tx
    return a * (1 - ty) + b * ty


def fbm(h: int, w: int, scale: float = 0.2, octaves: int = 3, gain: float = 0.5, rng=None, seed: int = 0) -> np.ndarray:
    """Fractal sum of value noise ("perlin-ish"), normalised to [0, 1]."""
    rng = np.random.default_rng(seed) if rng is None else rng
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, scale * 2 ** o, rng=rng)
        tot += amp
        amp *= gain
    out /= tot
    lo, hi = out.min(), out.max()
    return (out - lo) / (hi - lo + 1e-12)


def worley(h: int, w: int, points, k: int = 2) -> tuple[np.ndarray, ...]:
    """Distances to the nearest / 2nd nearest seed point (F1, F2, ...). points: (N, 2) as (x, y)."""
    pts = np.asarray(points, float).reshape(-1, 2)
    y, x = np.mgrid[0:h, 0:w].astype(float)
    d = np.sqrt((x[..., None] - pts[:, 0]) ** 2 + (y[..., None] - pts[:, 1]) ** 2)
    d.sort(axis=-1)
    return tuple(d[..., i] for i in range(min(k, d.shape[-1])))


def canonical_coords(h: int, w: int, kind: str = "d2"):
    """Integer canonical (cy, cx) offsets per cell for symmetric sampling. kind: none|x|d2|d4."""
    y, x = np.mgrid[0:h, 0:w]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    ay, ax = np.abs(y - cy), np.abs(x - cx)
    if kind == "none":
        return y.astype(float), x.astype(float)
    if kind == "x":
        return y.astype(float), ax
    if kind == "d4":
        return np.maximum(ay, ax), np.minimum(ay, ax)
    return ay, ax


def sym_field(field_fn, h: int, w: int, kind: str = "d2") -> np.ndarray:
    """Sample ``field_fn(H2, W2) -> array`` at canonical coordinates so the result has symmetry
    ``kind``. The base field is generated large enough to cover the canonical domain."""
    cy, cx = canonical_coords(h, w, kind)
    H2, W2 = int(np.ceil(cy.max())) + 2, int(np.ceil(cx.max())) + 2
    if kind == "d4":
        H2 = W2 = max(H2, W2)
    base = field_fn(H2, W2)
    # bilinear lookup (canonical coords may be .5 for even sizes)
    y0, x0 = np.floor(cy).astype(int), np.floor(cx).astype(int)
    ty, tx = cy - y0, cx - x0
    y1, x1 = np.minimum(y0 + 1, H2 - 1), np.minimum(x0 + 1, W2 - 1)
    a = base[y0, x0] * (1 - tx) + base[y0, x1] * tx
    b = base[y1, x0] * (1 - tx) + base[y1, x1] * tx
    return a * (1 - ty) + b * ty


def sym_noise(h: int, w: int, scale: float = 0.25, kind: str = "d2", octaves: int = 2,
              white: float = 0.0, seed: int = 0) -> np.ndarray:
    """Mirror-symmetric fbm noise in [0, 1] plus optional symmetric white noise (weight ``white``)."""
    rng = np.random.default_rng(seed)
    f = sym_field(lambda a, b: fbm(a, b, scale, octaves, rng=rng), h, w, kind)
    if white > 0:
        f = f + white * sym_field(lambda a, b: rng.random((a, b)), h, w, kind)
    lo, hi = f.min(), f.max()
    return (f - lo) / (hi - lo + 1e-12)


# ---- symmetrisation of float fields ------------------------------------------

def symmetrize_field(f: np.ndarray, kind: str = "d2") -> np.ndarray:
    """Average a float field over its images (x | y | d2 | d4 (square) | none)."""
    if kind == "none":
        return f
    if kind == "x":
        return 0.5 * (f + f[:, ::-1])
    if kind == "y":
        return 0.5 * (f + f[::-1])
    g = 0.25 * (f + f[:, ::-1] + f[::-1] + f[::-1, ::-1])
    if kind == "d4" and f.shape[0] == f.shape[1]:
        g = 0.5 * (g + g.T)
    return g


# ---- distance zones / gradients ---------------------------------------------

def zones(silhouette: np.ndarray, band: float = 4, gap: float = 1) -> dict[str, np.ndarray]:
    """Split a silhouette by distance-from-edge into frame (d<1.5), band (d<=band), gap, core."""
    d = M.distance_from_edge(silhouette)
    return {
        "dist": d,
        "frame": silhouette & (d < 1.5),
        "band": silhouette & (d <= band),
        "gap": silhouette & (d > band) & (d <= band + gap),
        "core": silhouette & (d > band + gap),
    }


def gradient(f: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(gx, gy) central differences."""
    gy, gx = np.gradient(f.astype(float))
    return gx, gy


def laplacian(f: np.ndarray, mode: str = "nearest") -> np.ndarray:
    k = np.array([[0.05, 0.2, 0.05], [0.2, -1.0, 0.2], [0.05, 0.2, 0.05]])
    return ndimage.convolve(f, k, mode=mode)


def upsample_mask(mask: np.ndarray, s: int) -> np.ndarray:
    return np.kron(np.asarray(mask, np.uint8), np.ones((s, s), np.uint8)).astype(bool)


def downsample(f: np.ndarray, s: int, how: str = "mean") -> np.ndarray:
    """Block-reduce a field (H*s, W*s) -> (H, W) by mean / max / any."""
    H, W = f.shape[0] // s, f.shape[1] // s
    b = f[:H * s, :W * s].reshape(H, s, W, s)
    if how == "max":
        return b.max(axis=(1, 3))
    if how == "any":
        return b.any(axis=(1, 3))
    return b.mean(axis=(1, 3))


def threshold_quantile(f: np.ndarray, region: np.ndarray, q: float) -> np.ndarray:
    """f > quantile q of f within region (and inside region)."""
    if not region.any():
        return np.zeros_like(region)
    t = np.quantile(f[region], q)
    return region & (f > t)


# ---- CLI ops ----------------------------------------------------------------

@register_op("noise-fill")
def _noise_fill(mask, scale: float = 0.3, threshold: float = 0.55, kind: str = "d2", ridge: bool = False,
                seed: int = 0):
    """Replace the mask's cells by symmetric fbm noise thresholded inside it (kind none|x|d2|d4).
    ridge=true keeps the thin isoline |n-0.5| < (1-threshold)/2 instead (wiggly lines)."""
    h, w = mask.shape
    k = kind if not (kind == "d4" and h != w) else "d2"
    n = sym_noise(h, w, scale, k, seed=seed)
    sel = (np.abs(n - 0.5) < (1 - threshold) / 2) if ridge else (n > threshold)
    return mask & sel


@register_op("worley-edges")
def _worley_edges(mask, n: int = 6, width: float = 0.9, seed: int = 0):
    """Voronoi-cell edges (Worley F2-F1 < width) of n D2-mirrored random seeds, within the mask."""
    h, w = mask.shape
    rng = np.random.default_rng(seed)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return mask
    pick = rng.choice(len(xs), size=min(n, len(xs)), replace=False)
    pts = []
    for i in pick:
        dx, dy = xs[i] - cx, ys[i] - cy
        pts += [(cx + sx * dx, cy + sy * dy) for sx in (1, -1) for sy in (1, -1)]
    f1, f2 = worley(h, w, pts)
    return mask & ((f2 - f1) < width)
