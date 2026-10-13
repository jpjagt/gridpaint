"""Shared composition helpers: silhouettes, zones, motifs, symmetry orbits, connecting bridges.

Reusable by any recipe (``from gridlab.ops import composition as C``). All masks are bool
``(H, W)`` indexed ``[y, x]``; motifs/silhouettes are centred on the canvas centre
``((W-1)/2, (H-1)/2)`` so odd sizes put a cell row/column on each axis.

Silhouettes  ``silhouette(kind, h, w, **kw)``
    kinds: capsule (superellipse n=3, the samples' cut-corner capsule), oval, stadium,
    octagon (rect with cut corners), roundrect (superellipse n=5), lozenge, shield, circle.

Zones  ``zones(sil, frame=0, frame_gap=1, band=4, gap=1)`` -> dict of masks
    distance transform of the silhouette, outside -> in:
    ``frame`` (thin outline, optional) / ``frame_gap`` (empty) / ``band`` (lace) /
    ``gap`` (breathing, empty) / ``core`` (rest; motif lives here).  Also ``dist``.

Motif library  ``motif(name, h, w, ry, rx, **kw)`` / ``MOTIFS``  (1-cell strokes, D2-symmetric)
    cross    vertical arm ry, horizontal bar rx at ``bar`` (offset from centre, <0 = up)
    spine    vertical line with short rib bars (``ribs`` count, rib half-width ``rib``)
    plus     equal-armed cross with small end serifs (cross potent-ish)
    star     4 orthogonal arms + 4 diagonal-step arms (8-armed star; diagonals = bridges)
    eye      lozenge outline with a centre dot (vesica / "eye")
    lozenge  diamond outline (nested twice when large)
    lorraine spine with two bars (patriarchal cross, like sample multi_2 L3)
    ankh-ish "orb": small ring on top of a cross (``orb``)
``motif_ascii(name, ...)`` for quick looks.

Symmetry orbits  ``orbit_map(h, w, sym)`` -> int array (canonical cell index per cell);
    sym in none|x|y|d2|d4 (d4 needs a square). Generators operate on orbit ids so every edit
    is symmetric. ``symmetrize(mask, sym)`` = OR over images.

Bridges  ``connect(mask, allowed, sym, max_len)`` adds short 8-connected paths through
    ``allowed`` cells (mirrored) until the mask is one 8-connected piece (or no path fits).

Registered CLI ops: ``motif`` (OR a motif at the canvas/--region centre), ``connect``.
"""

from __future__ import annotations

from collections import deque

import numpy as np

from . import masks as M
from . import morph
from .registry import register_op


# ---- coordinates -----------------------------------------------------------------

def centred(h: int, w: int):
    """(dx, dy) arrays relative to the canvas centre."""
    y, x = np.mgrid[0:h, 0:w]
    return x - (w - 1) / 2, y - (h - 1) / 2


# ---- silhouettes -------------------------------------------------------------------

def superellipse(h: int, w: int, n: float = 3.0, rx: float | None = None, ry: float | None = None) -> np.ndarray:
    dx, dy = centred(h, w)
    rx = w / 2 if rx is None else rx
    ry = h / 2 if ry is None else ry
    return np.abs(dx / rx) ** n + np.abs(dy / ry) ** n <= 1.0


def octagon(h: int, w: int, cut: float | None = None) -> np.ndarray:
    dx, dy = centred(h, w)
    cut = max(1.0, round(min(h, w) / 5)) if cut is None else cut
    rx, ry = (w - 1) / 2, (h - 1) / 2
    return (np.abs(dx) + np.abs(dy)) <= rx + ry - cut + 0.01


SILHOUETTES = ("capsule", "oval", "stadium", "octagon", "roundrect", "lozenge", "shield", "circle")


def silhouette(kind: str, h: int, w: int, **kw) -> np.ndarray:
    if kind == "capsule":
        return superellipse(h, w, kw.get("n", 3.0))
    if kind == "roundrect":
        return superellipse(h, w, kw.get("n", 5.0))
    if kind == "oval":
        return M.ellipse(h, w)
    if kind == "circle":
        return M.circle(h, w)
    if kind == "stadium":
        return M.capsule(h, w)
    if kind == "octagon":
        return octagon(h, w, kw.get("cut"))
    if kind == "lozenge":
        return M.diamond(h, w, rx=w / 2 + 0.5, ry=h / 2 + 0.5)
    if kind == "shield":
        return M.shield(h, w)
    raise ValueError(f"silhouette kind: {'|'.join(SILHOUETTES)}")


# ---- zones -------------------------------------------------------------------------

def edge_distance(sil: np.ndarray, metric: str = "euclid") -> np.ndarray:
    """Integer 'ring index' from the edge: 1 = outermost ring of cells, 0 outside."""
    if metric == "chebyshev":
        from scipy import ndimage

        d = ndimage.distance_transform_cdt(np.pad(sil, 1), metric="chessboard")[1:-1, 1:-1]
        return d.astype(int)
    d = M.distance_from_edge(sil)
    return np.where(sil, np.maximum(1, np.floor(d + 0.35)), 0).astype(int)


def zones(sil: np.ndarray, frame: int = 0, frame_gap: int = 1, band: int = 4, gap: int = 1,
          metric: str = "euclid") -> dict[str, np.ndarray]:
    """Concentric zones of a silhouette (see module doc). frame=0 -> no frame/frame_gap."""
    d = edge_distance(sil, metric)
    out = {"dist": d, "sil": sil.copy()}
    k = 0
    for name, n in (("frame", frame), ("frame_gap", frame_gap if frame else 0), ("band", band), ("gap", gap)):
        out[name] = (d > k) & (d <= k + n)
        k += n
    out["core"] = d > k
    return out


# ---- motifs --------------------------------------------------------------------------

def _vline(h, w, half_len, x_off=0.0, y_off=0.0):
    dx, dy = centred(h, w)
    return (np.abs(dx - x_off) < 0.75) & (np.abs(dy - y_off) <= half_len + 0.01)


def _hline(h, w, half_len, y_off=0.0, x_off=0.0):
    dx, dy = centred(h, w)
    return (np.abs(dy - y_off) < 0.75) & (np.abs(dx - x_off) <= half_len + 0.01)


def cross(h, w, ry, rx, bar: float | None = None) -> np.ndarray:
    """Latin cross: vertical arm half-length ry, bar half-width rx at offset ``bar`` (default
    -ry/3, i.e. above centre); bar=0 gives a Greek-style cross."""
    bar = -round(ry / 3) if bar is None else bar
    return _vline(h, w, ry) | _hline(h, w, rx, y_off=bar)


def spine(h, w, ry, rx, ribs: int = 2, rib: int = 1) -> np.ndarray:
    """Vertical spine with ``ribs`` pairs of short bars (half-width ``rib``) and a centre bar rx."""
    m = _vline(h, w, ry) | _hline(h, w, rx)
    if ribs > 0:
        for i in range(1, ribs + 1):
            off = round(i * ry / (ribs + 1))
            m |= _hline(h, w, rib, y_off=off) | _hline(h, w, rib, y_off=-off)
    return m


def plus(h, w, ry, rx, serif: int = 1) -> np.ndarray:
    """Cross with equal-ish arms and short perpendicular serifs at the ends."""
    m = _vline(h, w, ry) | _hline(h, w, rx)
    if serif > 0:
        m |= _hline(h, w, serif, y_off=ry) | _hline(h, w, serif, y_off=-ry)
        m |= _vline(h, w, serif, x_off=rx) | _vline(h, w, serif, x_off=-rx)
    return m


def star(h, w, ry, rx, diag: int | None = None) -> np.ndarray:
    """8-armed star: orthogonal arms (ry, rx) + diagonal-step arms of length ``diag``."""
    m = _vline(h, w, ry) | _hline(h, w, rx)
    dx, dy = centred(h, w)
    diag = max(1, round(min(rx, ry) * 0.6)) if diag is None else diag
    on_diag = (np.abs(np.abs(dx) - np.abs(dy)) < 0.6) & (np.abs(dx) <= diag + 0.01) & (np.abs(dx) >= 0.9)
    return m | on_diag


def lozenge(h, w, ry, rx, nested: bool | None = None) -> np.ndarray:
    """Diamond outline (|dx|/rx + |dy|/ry ~= 1), 8-connected one-cell stroke."""
    dx, dy = centred(h, w)

    def ring(a, b):
        full = np.abs(dx) / (a + 0.5) + np.abs(dy) / (b + 0.5) <= 1.0
        return full & ~morph.erode(full, 1, 4)

    m = ring(rx, ry)
    if nested is None:
        nested = min(rx, ry) >= 4
    if nested and rx > 2:
        m |= ring(rx - 2, ry - 2 * ry / rx)
    return m


def eye(h, w, ry, rx) -> np.ndarray:
    """Vesica / eye: lozenge-ish outline (rounded) + a centre dot."""
    dx, dy = centred(h, w)
    full = (np.abs(dx) / (rx + 0.5)) ** 1.5 + (np.abs(dy) / (ry + 0.5)) ** 1.5 <= 1.0
    m = full & ~morph.erode(full, 1, 4)
    m |= (np.abs(dx) < 0.75) & (np.abs(dy) < 0.75)
    return m


def lorraine(h, w, ry, rx) -> np.ndarray:
    """Patriarchal cross: spine with a short upper bar and a longer lower bar."""
    top = -round(ry * 0.45)
    low = -round(ry * 0.05)
    return _vline(h, w, ry) | _hline(h, w, max(1, round(rx * 0.6)), y_off=top) | _hline(h, w, rx, y_off=low)


def orb(h, w, ry, rx) -> np.ndarray:
    """Small ring on top of a cross (orb / ankh-like)."""
    dx, dy = centred(h, w)
    r = max(1.5, rx * 0.6)
    cyo = -ry + r
    ringm = np.abs(np.hypot(dx, dy - cyo) - r) < 0.55
    m = ringm | _vline(h, w, ry - r, y_off=r) | _hline(h, w, rx, y_off=round(r / 2))
    return m


MOTIFS = {"cross": cross, "spine": spine, "plus": plus, "star": star, "eye": eye,
          "lozenge": lozenge, "lorraine": lorraine, "orb": orb}


def motif(name: str, h: int, w: int, ry: float, rx: float, **kw) -> np.ndarray:
    """Motif ``name`` centred on an (h, w) canvas with half-extents (ry, rx). Mirror-symmetric
    in x always and in y for cross(bar=0)/spine/plus/star/eye/lozenge."""
    if name not in MOTIFS:
        raise ValueError(f"motif: {'|'.join(MOTIFS)}")
    return MOTIFS[name](h, w, ry, rx, **kw).astype(bool)


def motif_ascii(name: str, h: int = 15, w: int = 11, ry: float = 6, rx: float = 4, **kw) -> str:
    m = motif(name, h, w, ry, rx, **kw)
    return "\n".join("".join("#" if v else "." for v in row) for row in m)


# ---- symmetry orbits -------------------------------------------------------------------

def orbit_map(h: int, w: int, sym: str = "d2") -> np.ndarray:
    """Canonical cell index (y*w + x of the orbit representative) for each cell."""
    y, x = np.mgrid[0:h, 0:w]
    cx, cy = x.copy(), y.copy()
    if sym in ("x", "d2", "d4"):
        cx = np.minimum(x, w - 1 - x)
    if sym in ("y", "d2", "d4"):
        cy = np.minimum(y, h - 1 - y)
    if sym == "d4":
        if h != w:
            raise ValueError("d4 needs a square canvas")
        a, b = np.minimum(cx, cy), np.maximum(cx, cy)
        cx, cy = a, b
    elif sym not in ("none", "x", "y", "d2"):
        raise ValueError("sym: none|x|y|d2|d4")
    return cy * w + cx


def sym_images(mask: np.ndarray, sym: str) -> list[np.ndarray]:
    """The array and its images under the group (dtype preserved)."""
    m = np.asarray(mask)
    out = [m]
    if sym in ("x", "d2", "d4"):
        out += [i[:, ::-1] for i in out]
    if sym in ("y", "d2", "d4"):
        out += [i[::-1, :] for i in out]
    if sym == "d4":
        out += [i.T for i in out]
    return out


def symmetrize(mask: np.ndarray, sym: str = "d2", how: str = "or") -> np.ndarray:
    ims = sym_images(np.asarray(mask, bool), sym)
    out = ims[0].copy()
    for i in ims[1:]:
        out = (out | i) if how == "or" else (out & i)
    return out


def detect_sym(mask: np.ndarray) -> str:
    """Strongest exact symmetry of the mask about the canvas centre: d4|d2|x|y|none."""
    m = np.asarray(mask, bool)
    sx = np.array_equal(m, m[:, ::-1])
    sy = np.array_equal(m, m[::-1, :])
    if sx and sy and m.shape[0] == m.shape[1] and np.array_equal(m, m.T):
        return "d4"
    if sx and sy:
        return "d2"
    return "x" if sx else ("y" if sy else "none")


# ---- bridges / connectivity ----------------------------------------------------------------

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _bfs_path(mask, allowed, comp_lab, main, max_len):
    """Shortest 8-connected path of allowed empty cells from component ``main`` to any other."""
    H, W = mask.shape
    prev = {}
    q = deque()
    for y, x in zip(*np.nonzero(comp_lab == main)):
        q.append((y, x, 0))
        prev[(y, x)] = None
    while q:
        y, x, dist = q.popleft()
        for dy, dx in N8:
            ny, nx = y + dy, x + dx
            if not (0 <= ny < H and 0 <= nx < W) or (ny, nx) in prev:
                continue
            lab = comp_lab[ny, nx]
            if lab and lab != main:
                path = []
                cur = (y, x)
                while prev[cur] is not None:
                    path.append(cur)
                    cur = prev[cur]
                return path
            if allowed[ny, nx] and not mask[ny, nx] and dist < max_len:
                prev[(ny, nx)] = (y, x)
                q.append((ny, nx, dist + 1))
    return None


def connect(mask: np.ndarray, allowed: np.ndarray | None = None, sym: str = "auto",
            max_len: int = 6, max_iter: int = 40) -> np.ndarray:
    """Add short mirrored 8-connected paths until one 8-connected piece (or no short path)."""
    m = np.asarray(mask, bool).copy()
    allowed = np.ones_like(m) if allowed is None else np.asarray(allowed, bool)
    if sym == "auto":
        sym = detect_sym(m)
    for _ in range(max_iter):
        lab, n = morph.label(m, 8)
        if n <= 1:
            break
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        main = int(sizes.argmax())
        path = _bfs_path(m, allowed, lab, main, max_len)
        if path is None:
            break
        add = np.zeros_like(m)
        for y, x in path:
            add[y, x] = True
        m |= symmetrize(add, sym) & allowed
    return m


# ---- registered ops ---------------------------------------------------------------------

@register_op("motif")
def _motif_op(mask, kind: str = "cross", ry: float = 0.0, rx: float = 0.0, mode: str = "or"):
    """OR a 1-cell-stroke motif centred on the canvas/--region: kind=cross|spine|plus|star|eye|
    lozenge|lorraine|orb; ry/rx = half-extents (0 = fit ~1/3 of the area). mode=or|replace|clear."""
    H, W = mask.shape
    ry = ry or max(2, (H - 1) // 3)
    rx = rx or max(1, (W - 1) // 3)
    m = motif(kind, H, W, ry, rx)
    if mode == "replace":
        return m
    if mode == "clear":
        return mask & ~m
    return mask | m


@register_op("connect")
def _connect_op(mask, max_len: int = 6, sym: str = "auto"):
    """Join pieces with short (mirrored) diagonal/orthogonal paths until one 8-connected piece."""
    return connect(mask, None, sym, max_len)
