"""Symmetry ops on bool masks (H, W) indexed [y, x]. Axes are through the canvas centre.

Two families:
- *copy* ops (``mirror``, ``symmetrize_d2``, ``symmetrize_d4``, ``rot_sym``): one fundamental
  region is kept and copied onto the rest ("draw one quadrant, mirror it").
- ``symmetry_or`` / ``symmetry_and``: OR / AND of the mask with all its images under a group.

Axis naming: ``axis='x'`` mirrors left<->right (symmetric about the vertical centre line),
``axis='y'`` mirrors top<->bottom, ``'xy'`` both (D2), ``'diag'`` about the main diagonal
(x=y, square only), ``'anti'`` about the anti-diagonal (square only).
"""

from __future__ import annotations

import numpy as np

KEEP_DEFAULTS = {"x": "left", "y": "top", "xy": "tl", "diag": "upper", "anti": "upper"}


def _idx(shape):
    H, W = shape
    return np.mgrid[0:H, 0:W]


def _require_square(mask, what):
    if mask.shape[0] != mask.shape[1]:
        raise ValueError(f"{what} needs a square mask, got {mask.shape[1]}x{mask.shape[0]} (use --region or op resize)")


def _reflect(m: np.ndarray, axis: int, c: float, keep_low: bool) -> np.ndarray:
    """Reflect about index-coordinate c along numpy axis (1 = x, 0 = y); the low (or high)
    side is kept; cells whose source falls outside the array become empty."""
    n = m.shape[axis]
    idx = np.arange(n)
    src = np.rint(2 * c - idx).astype(int)
    replace = (idx > c) if keep_low else (idx < c)
    valid = (src >= 0) & (src < n)
    taken = np.take(m, np.clip(src, 0, n - 1), axis=axis)
    shape = [1, 1]
    shape[axis] = n
    rep = replace.reshape(shape)
    ok = valid.reshape(shape)
    return np.where(rep, taken & ok, m)


def mirror(mask: np.ndarray, axis: str = "x", keep: str | None = None,
           cx: float | None = None, cy: float | None = None) -> np.ndarray:
    """Copy one half onto the other.
    axis x: keep left|right; y: keep top|bottom; xy: keep tl|tr|bl|br;
    diag: keep upper (x>y, top-right triangle) | lower; anti: keep upper (top-left) | lower.
    cx / cy: axis position in cell coords (7 = through column 7, 7.5 = between 7 and 8);
    default = canvas centre ((W-1)/2, (H-1)/2). Must be integer or .5."""
    m = np.asarray(mask, bool)
    H, W = m.shape
    keep = keep or KEEP_DEFAULTS[axis]
    cx = (W - 1) / 2 if cx is None else float(cx)
    cy = (H - 1) / 2 if cy is None else float(cy)
    if axis == "x":
        if keep not in ("left", "right"):
            raise ValueError("axis x: keep left|right")
        return _reflect(m, 1, cx, keep == "left")
    if axis == "y":
        if keep not in ("top", "bottom"):
            raise ValueError("axis y: keep top|bottom")
        return _reflect(m, 0, cy, keep == "top")
    if axis == "xy":
        if keep not in ("tl", "tr", "bl", "br"):
            raise ValueError("axis xy: keep tl|tr|bl|br")
        m = mirror(m, "x", "left" if keep[1] == "l" else "right", cx=cx)
        return mirror(m, "y", "top" if keep[0] == "t" else "bottom", cy=cy)
    if axis == "diag":
        _require_square(m, "diag mirror")
        src = (X < Y) if keep == "upper" else (X > Y)
        return np.where(src, m.T, m)
    if axis == "anti":
        _require_square(m, "anti-diagonal mirror")
        a = m[::-1, ::-1].T
        s = X + Y
        src = (s > W - 1) if keep == "upper" else (s < W - 1)
        return np.where(src, a, m)
    raise ValueError(f"unknown axis {axis!r} (x|y|xy|diag|anti)")


def symmetrize_d2(mask: np.ndarray, keep: str = "tl") -> np.ndarray:
    """Mirror-symmetric in x and y; content comes from quadrant ``keep``."""
    return mirror(mask, "xy", keep)


def symmetrize_d4(mask: np.ndarray) -> np.ndarray:
    """Full square symmetry (8 images). Content comes from the top-left octant
    (top-left quadrant, on/above the diagonal x >= y)."""
    m = np.asarray(mask, bool)
    _require_square(m, "symmetrize_d4")
    N = m.shape[0]
    Y, X = _idx(m.shape)
    i = np.minimum(Y, N - 1 - Y)
    j = np.minimum(X, N - 1 - X)
    a, b = np.minimum(i, j), np.maximum(i, j)
    return m[a, b]


def rot_sym(mask: np.ndarray, n: int = 2) -> np.ndarray:
    """Rotational symmetry. n=2: the top half (plus left half of an odd middle row) is
    copied rotated 180 deg. n=4 (square): the top-left quadrant is copied rotated 90/180/270."""
    m = np.asarray(mask, bool)
    H, W = m.shape
    Y, X = _idx(m.shape)
    if n == 2:
        cy, cx = (H - 1) / 2, (W - 1) / 2
        src = (Y > cy) | ((Y == cy) & (X > cx))
        return np.where(src, m[::-1, ::-1], m)
    if n == 4:
        _require_square(m, "rot_sym n=4")
        N = H
        dom = lambda y, x: (y <= (N - 1) / 2) & (x < N / 2) & ~((y == (N - 1) / 2) & (x == (N - 1) / 2))
        ry, rx = Y.copy(), X.copy()
        out_y, out_x = Y.copy(), X.copy()
        found = dom(Y, X)
        for _ in range(3):
            ry, rx = rx, N - 1 - ry  # rotate 90
            hit = ~found & dom(ry, rx)
            out_y[hit], out_x[hit] = ry[hit], rx[hit]
            found |= hit
        return m[out_y, out_x]
    raise ValueError("rot_sym supports n=2 or n=4")


def images(mask: np.ndarray, kind: str) -> list[np.ndarray]:
    """All images of mask under a symmetry group: x, y, d2 (=xy), rot2, rot4, diag, d4."""
    m = np.asarray(mask, bool)
    if kind == "x":
        return [m, m[:, ::-1]]
    if kind == "y":
        return [m, m[::-1, :]]
    if kind in ("d2", "xy"):
        return [m, m[:, ::-1], m[::-1, :], m[::-1, ::-1]]
    if kind == "rot2":
        return [m, m[::-1, ::-1]]
    if kind == "rot4":
        _require_square(m, "rot4")
        return [np.rot90(m, k) for k in range(4)]
    if kind == "diag":
        _require_square(m, "diag")
        return [m, m.T]
    if kind == "d4":
        _require_square(m, "d4")
        r = [np.rot90(m, k) for k in range(4)]
        return r + [x.T for x in r]
    raise ValueError(f"unknown symmetry kind {kind!r} (x|y|d2|rot2|rot4|diag|d4)")


def symmetry_or(mask: np.ndarray, kind: str = "d2") -> np.ndarray:
    return np.logical_or.reduce(images(mask, kind))


def symmetry_and(mask: np.ndarray, kind: str = "d2") -> np.ndarray:
    return np.logical_and.reduce(images(mask, kind))
