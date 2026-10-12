"""Shape masks. All return bool arrays of shape (h, w), indexed [y, x].

Centre/radii are in cell units measured between cell centres; defaults fit the shape to the
whole canvas, centred (cx=(w-1)/2, cy=(h-1)/2, rx=w/2, ry=h/2), so edge cells are included.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def _grid(h: int, w: int, cx, cy):
    cx = (w - 1) / 2 if cx is None else cx
    cy = (h - 1) / 2 if cy is None else cy
    y, x = np.mgrid[0:h, 0:w]
    return x - cx, y - cy


def ellipse(h: int, w: int, cx=None, cy=None, rx=None, ry=None) -> np.ndarray:
    dx, dy = _grid(h, w, cx, cy)
    rx = w / 2 if rx is None else rx
    ry = h / 2 if ry is None else ry
    return (dx / max(rx, 1e-9)) ** 2 + (dy / max(ry, 1e-9)) ** 2 <= 1.0


def circle(h: int, w: int, r=None, cx=None, cy=None) -> np.ndarray:
    r = min(h, w) / 2 if r is None else r
    return ellipse(h, w, cx, cy, r, r)


def rect(h: int, w: int, x0: int = 0, y0: int = 0, x1: int | None = None, y1: int | None = None) -> np.ndarray:
    """Filled rect, inclusive corners."""
    m = np.zeros((h, w), bool)
    x1 = w - 1 if x1 is None else x1
    y1 = h - 1 if y1 is None else y1
    m[max(0, y0):y1 + 1, max(0, x0):x1 + 1] = True
    return m


def capsule(h: int, w: int, cx=None, cy=None, length=None, r=None, vertical: bool | None = None) -> np.ndarray:
    """Stadium: points within distance r of a segment along the long axis (vertical if h >= w)."""
    dx, dy = _grid(h, w, cx, cy)
    vertical = (h >= w) if vertical is None else vertical
    if vertical:
        dx, dy = dy, dx
        h, w = w, h
    # now long axis is x
    r = h / 2 if r is None else r
    length = w if length is None else length
    half = max(0.0, length / 2 - r)
    px = np.clip(dx, -half, half)
    return (dx - px) ** 2 + dy ** 2 <= r * r


stadium = capsule


def ring(h: int, w: int, thickness: float = 2, cx=None, cy=None, rx=None, ry=None) -> np.ndarray:
    """Elliptic annulus: ellipse(rx, ry) minus ellipse(rx - thickness, ry - thickness)."""
    rx = w / 2 if rx is None else rx
    ry = h / 2 if ry is None else ry
    outer = ellipse(h, w, cx, cy, rx, ry)
    if rx - thickness <= 0 or ry - thickness <= 0:
        return outer
    return outer & ~ellipse(h, w, cx, cy, rx - thickness, ry - thickness)


def diamond(h: int, w: int, cx=None, cy=None, rx=None, ry=None) -> np.ndarray:
    """Lozenge |dx|/rx + |dy|/ry <= 1."""
    dx, dy = _grid(h, w, cx, cy)
    rx = w / 2 if rx is None else rx
    ry = h / 2 if ry is None else ry
    return np.abs(dx) / rx + np.abs(dy) / ry <= 1.0


lozenge = diamond


def shield(h: int, w: int, shoulder: float = 0.45, point: float = 0.7) -> np.ndarray:
    """Heater shield: full width for the top ``shoulder`` fraction, then tapering to a point.
    ``point`` < 1 makes the flanks bulge (rounder), > 1 makes them straighter/narrower."""
    dx, _ = _grid(h, w, None, None)
    y = np.mgrid[0:h, 0:w][0] + 0.5
    t = np.clip((y / h - shoulder) / max(1e-9, 1 - shoulder), 0, 1)
    half = (w / 2) * (1 - t ** 2) ** 0.5 * (1 - t) ** (0.3 * point)
    return np.abs(dx) <= half + 1e-9


def _pad_edt(mask: np.ndarray) -> np.ndarray:
    return ndimage.distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]


def distance_from_edge(mask: np.ndarray) -> np.ndarray:
    """Euclidean distance (cells) from each inside cell to the nearest outside cell (canvas
    border counts as outside). 0 outside the mask, >= 1 inside."""
    return _pad_edt(mask.astype(bool))


def distance_to_mask(mask: np.ndarray) -> np.ndarray:
    """Euclidean distance from each cell to the nearest mask cell (0 on the mask)."""
    if not mask.any():
        return np.full(mask.shape, np.inf)
    return ndimage.distance_transform_edt(~mask.astype(bool))


def offset_outline(mask: np.ndarray, d: int = 1, thickness: int = 1) -> np.ndarray:
    """A band parallel to the mask edge.
    d >= 1: outside, at (rounded) distance d .. d+thickness-1 from the mask.
    d <= 0: inside, |d| cells in from the edge (d=0 = the mask's own boundary cells)."""
    mask = mask.astype(bool)
    if d >= 1:
        r = np.rint(distance_to_mask(mask))
        return (r >= d) & (r < d + thickness)
    r = np.rint(distance_from_edge(mask))
    k = 1 - d
    return (r >= k) & (r < k + thickness)
