"""Morphology on bool masks. ``conn`` is 4 (cross) or 8 (3x3 square).

Note: in gridpaint, diagonal neighbours render as connected (bridges), so 8-connectivity
is the physical notion of "one piece" for material.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def structure(conn: int = 4) -> np.ndarray:
    if conn == 4:
        return ndimage.generate_binary_structure(2, 1)
    if conn == 8:
        return ndimage.generate_binary_structure(2, 2)
    raise ValueError("conn must be 4 or 8")


def dilate(mask, n: int = 1, conn: int = 4) -> np.ndarray:
    if n <= 0:
        return np.asarray(mask, bool).copy()
    return ndimage.binary_dilation(mask, structure(conn), iterations=n)


def erode(mask, n: int = 1, conn: int = 4) -> np.ndarray:
    """Erosion; the canvas border counts as empty."""
    if n <= 0:
        return np.asarray(mask, bool).copy()
    return ndimage.binary_erosion(mask, structure(conn), iterations=n, border_value=0)


def open_(mask, n: int = 1, conn: int = 4) -> np.ndarray:
    return dilate(erode(mask, n, conn), n, conn)


def close(mask, n: int = 1, conn: int = 4) -> np.ndarray:
    """Closing computed on a padded canvas so shapes touching the border are not clipped."""
    m = np.pad(np.asarray(mask, bool), n)
    r = erode(dilate(m, n, conn), n, conn)
    return r[n:-n, n:-n] if n > 0 else r


def fill_holes(mask) -> np.ndarray:
    """Fill background regions not 4-connected to the outside."""
    return ndimage.binary_fill_holes(mask)


def label(mask, conn: int = 8):
    return ndimage.label(mask, structure(conn))


def remove_small(mask, min_size: int = 2, conn: int = 8) -> np.ndarray:
    lab, n = label(mask, conn)
    if n == 0:
        return np.asarray(mask, bool).copy()
    sizes = np.bincount(lab.ravel())
    keep = sizes >= min_size
    keep[0] = False
    return keep[lab]


def keep_largest(mask, conn: int = 8, n: int = 1) -> np.ndarray:
    lab, k = label(mask, conn)
    if k == 0:
        return np.asarray(mask, bool).copy()
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    top = np.argsort(sizes)[::-1][:n]
    return np.isin(lab, top[sizes[top] > 0])


def neighbour_count(mask, conn: int = 8) -> np.ndarray:
    k = structure(conn).astype(np.int32)
    k[1, 1] = 0
    return ndimage.convolve(np.asarray(mask, np.int32), k, mode="constant")


def skeletonize(mask) -> np.ndarray:
    """Zhang-Suen thinning (vectorized numpy). Returns an 8-connected 1-cell-wide skeleton."""
    img = np.pad(np.asarray(mask, bool), 1).astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            P = img
            p2 = P[:-2, 1:-1]; p3 = P[:-2, 2:]; p4 = P[1:-1, 2:]; p5 = P[2:, 2:]
            p6 = P[2:, 1:-1]; p7 = P[2:, :-2]; p8 = P[1:-1, :-2]; p9 = P[:-2, :-2]
            c = P[1:-1, 1:-1]
            nbrs = [p2, p3, p4, p5, p6, p7, p8, p9]
            B = sum(n.astype(np.int32) for n in nbrs)
            seq = nbrs + [p2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.int32) for i in range(8))
            if step == 0:
                c1 = (p2 * p4 * p6) == 0
                c2 = (p4 * p6 * p8) == 0
            else:
                c1 = (p2 * p4 * p8) == 0
                c2 = (p2 * p6 * p8) == 0
            rm = (c == 1) & (B >= 2) & (B <= 6) & (A == 1) & c1 & c2
            if rm.any():
                changed = True
                inner = img[1:-1, 1:-1]
                inner[rm] = 0
        if not changed:
            break
    return img[1:-1, 1:-1].astype(bool)


def skeleton_points(mask) -> tuple[int, int]:
    """(endpoints, junctions) of the skeleton, by 8-neighbour counts (1 and >= 3)."""
    sk = skeletonize(mask)
    nc = neighbour_count(sk, 8)
    return int((sk & (nc == 1)).sum()), int((sk & (nc >= 3)).sum())


def filled_outline(mask, n: int = 1) -> np.ndarray:
    """Everything inside the outline: close gaps of ~n cells (8-conn), then fill holes. Lace whose holes
    open to the outside through 1-cell gaps still yields its full silhouette."""
    m = np.asarray(mask, bool)
    return fill_holes(close(m, n, 8) | m) if n > 0 else fill_holes(m)
