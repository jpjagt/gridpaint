"""Layer composition: derive the other laser-cut layers from one (lace) layer.

Pure mask functions (used by recipes/layering.py and others):
  backplate, skeleton_layer, junction_points, junction_dots, erode_terraces, height_levels, scalar_field,
  spine_motif, prune_nested, insert_above, insert_below.

Registered design ops (CLI / AI editor) - each derives new layers from --layer and inserts them in
the stack (lower id = physically higher):
  derive-backplate, derive-skeleton, junction-dots, erode-up, height-threshold, contrast-layer.
"""

from __future__ import annotations

import numpy as np

from ..model import Design, Layer
from . import ca, masks as M, morph, symmetry
from .registry import register_op


# ---- stack helpers -------------------------------------------------------------------

def insert_above(design: Design, lid: int, mask: np.ndarray) -> int:
    """Insert a new layer directly above layer `lid` (it takes id `lid`; lid and lower layers shift +1)."""
    for l in design.layers:
        if l.id >= lid:
            l.id += 1
    design.layers.append(Layer.from_mask(lid, mask))
    design.layers.sort(key=lambda l: l.id)
    return lid


def insert_below(design: Design, lid: int, mask: np.ndarray) -> int:
    for l in design.layers:
        if l.id > lid:
            l.id += 1
    design.layers.append(Layer.from_mask(lid + 1, mask))
    design.layers.sort(key=lambda l: l.id)
    return lid + 1


def _sym_of(m: np.ndarray) -> str:
    """Strongest symmetry the mask actually has (d4, d2, x or none)."""
    if m.shape[0] == m.shape[1] and np.array_equal(m, m.T) and np.array_equal(m, m[:, ::-1]):
        return "d4"
    if np.array_equal(m, m[:, ::-1]) and np.array_equal(m, m[::-1, :]):
        return "d2"
    if np.array_equal(m, m[:, ::-1]):
        return "x"
    return "none"


# ---- mask derivations ----------------------------------------------------------------

def hull(mask: np.ndarray, grow: int = 1, close_n: int = 2) -> np.ndarray:
    """Silhouette hull: dilate, close, fill holes."""
    return morph.fill_holes(morph.close(morph.dilate(mask, grow, 4), close_n, 4))


def backplate(mask: np.ndarray, grow: int = 1, mode: str = "solid", rim: int = 2, sym: str | None = None) -> np.ndarray:
    """A supporting plate under `mask`.
    solid  = close(dilate(mask)) - follows the lace, keeps its big holes
    hull   = filled silhouette hull
    laced  = hull with windows: a `rim`-wide rim + the dilated mask, so it is light but supports everything
    lace   = laced plate thinned to 1-cell strokes (a lace backplate)"""
    sym = sym or _sym_of(mask)
    if mode == "solid":
        out = morph.close(morph.dilate(mask, grow, 4), 1, 4)
    elif mode == "hull":
        out = hull(mask, grow)
    elif mode in ("laced", "lace"):
        h = hull(mask, max(grow, 1)) if grow else hull(mask, 0, 1)
        out = h & ((h & ~morph.erode(h, rim, 4)) | morph.dilate(mask, grow, 4))
        if mode == "lace":
            out = ca.sym_thin(out, sym) | (h & ~morph.erode(h, 1, 4))
            out = ca.lace_clean(out, sym, min_size=4)
    else:
        raise ValueError("mode: solid|hull|laced|lace")
    return symmetry.symmetry_or(out, sym) if sym not in ("none",) else out


def skeleton_layer(mask: np.ndarray, close_n: int = 1, prune: int = 2, sym: str | None = None) -> np.ndarray:
    """Backbone of a layer: close small gaps, thin symmetrically, prune short spurs."""
    sym = sym or _sym_of(mask)
    src = morph.close(mask, close_n, 8) if close_n else mask
    sk = ca.sym_thin(src, sym)
    sk = ca.prune_spurs(sk, prune)
    sk = morph.remove_small(sk, 3, 8)
    return sk & morph.dilate(mask, 1, 8)


def junction_points(mask: np.ndarray, where: str = "junctions", min_sep: int = 3, sym: str | None = None,
                    max_points: int = 64) -> np.ndarray:
    """Points on junctions (8-degree >= 3) and/or end points (degree 1) of the layer's skeleton,
    thinned out symmetrically so no two chosen points are closer than min_sep (Chebyshev)."""
    sym = sym or _sym_of(mask)
    sk = ca.sym_thin(mask, sym if sym != "none" else "none")
    nc = morph.neighbour_count(sk, 8)
    cand = np.zeros_like(sk)
    if where in ("junctions", "both"):
        cand |= sk & (nc >= 3)
    if where in ("ends", "both"):
        cand |= sk & (nc == 1)
    H, W = mask.shape
    ys, xs = np.nonzero(cand)
    # prefer high degree, then closeness to the centre (calm, central jewels first)
    order = sorted(zip(ys, xs), key=lambda p: (-nc[p], abs(p[0] - (H - 1) / 2) + abs(p[1] - (W - 1) / 2)))
    chosen = np.zeros_like(sk)
    taken = np.zeros_like(sk)
    for y, x in order:
        if taken[y, x]:
            continue
        orb = ca._orbit_cells(int(y), int(x), (H, W), ca.sym_kind(sym, (H, W)) if sym != "none" else "none")
        if any(taken[p] for p in orb):
            continue
        for p in orb:
            chosen[p] = True
            y0, x0 = max(0, p[0] - min_sep + 1), max(0, p[1] - min_sep + 1)
            taken[y0:p[0] + min_sep, x0:p[1] + min_sep] = True
        if chosen.sum() >= max_points:
            break
    return chosen


def junction_dots(mask: np.ndarray, where: str = "junctions", shape: str = "plus", min_sep: int = 3,
                  sym: str | None = None) -> np.ndarray:
    pts = junction_points(mask, where, min_sep, sym)
    if shape == "dot":
        return pts
    if shape == "plus":
        return morph.dilate(pts, 1, 4)
    if shape == "ring":
        return morph.dilate(pts, 1, 8) & ~pts & ~morph.dilate(pts, 1, 4) | (morph.dilate(pts, 1, 4) & ~pts)
    if shape == "diamond":
        return morph.dilate(pts, 2, 4) & ~morph.dilate(pts, 1, 4)
    raise ValueError("shape: dot|plus|ring|diamond")


def erode_terraces(mask: np.ndarray, n: int = 2, step: int = 2, fill: bool = True, outline: int = 0,
                   conn: int = 4) -> list[np.ndarray]:
    """[level1, level2, ...] successive erosions of the (filled) mask; outline>0 turns each level into a
    band of that width along its own edge (contour-line terraces)."""
    base = morph.fill_holes(mask) if fill else mask.copy()
    out, cur = [], base
    for _ in range(n):
        cur = morph.erode(cur, step, conn)
        cur = morph.open_(cur, 1, 4) if cur.sum() > 8 else cur
        if not cur.any():
            break
        lvl = cur & ~morph.erode(cur, outline, 4) if outline else cur.copy()
        out.append(lvl)
    return out


def scalar_field(region: np.ndarray, kind: str = "distance", seed: int = 0, sym: str = "d2",
                 lace: np.ndarray | None = None) -> np.ndarray:
    """A symmetric scalar field on `region` (0 outside), normalised to [0, 1]:
    distance (from the region edge), radial (from the centre), noise (smoothed symmetric noise
    added to distance), density (local density of `lace`)."""
    from scipy import ndimage

    H, W = region.shape
    d = M.distance_from_edge(region).astype(float)
    if kind == "distance":
        f = d
    elif kind == "radial":
        y, x = np.mgrid[0:H, 0:W]
        f = -np.hypot((y - (H - 1) / 2) / max(H, 1), (x - (W - 1) / 2) / max(W, 1))
    elif kind == "noise":
        rng = np.random.default_rng(seed)
        nz = ndimage.gaussian_filter(rng.standard_normal((H, W)), 2.0)
        nz = np.mean(symmetry.images(nz, ca.sym_kind(sym, (H, W)) if sym != "none" else "x"), axis=0)
        f = d / max(d.max(), 1) + 0.6 * nz / max(np.abs(nz).max(), 1e-9)
    elif kind == "density":
        src = lace if lace is not None else region
        f = ndimage.gaussian_filter(src.astype(float), 1.5) + 0.3 * d / max(d.max(), 1)
    else:
        raise ValueError("field: distance|radial|noise|density")
    f = np.where(region, f, np.nan)
    lo, hi = np.nanmin(f), np.nanmax(f)
    f = (f - lo) / max(hi - lo, 1e-9)
    return np.nan_to_num(f, nan=-1.0)


def height_levels(field: np.ndarray, region: np.ndarray, k: int = 3, spread: str = "area") -> list[np.ndarray]:
    """k nested levels L_i = field > t_i (L_0 = region). spread=area picks thresholds so each level keeps
    a similar fraction of the previous one; spread=even uses evenly spaced thresholds."""
    vals = field[region]
    out = [region.copy()]
    for i in range(1, k):
        if spread == "area":
            t = np.quantile(vals, 1 - (0.55 ** i))
        else:
            t = i / k
        lvl = region & (field > t)
        lvl = morph.remove_small(lvl, 3, 8)
        out.append(lvl)
    return out


def spine_motif(mask: np.ndarray, motif: str = "spine", width: int = 1, inset: int = 2) -> np.ndarray:
    """An axis-aligned solid motif sized to the mask's hull: spine (vertical bar + 2 short bars), cross,
    lorraine (2 bars), tau, or star (cross + diagonal steps)."""
    H, W = mask.shape
    h = hull(mask, 0, 1)
    if not h.any():
        return np.zeros_like(mask)
    cy, cx = (H - 1) // 2, (W - 1) // 2
    ys = np.nonzero(h[:, cx])[0]
    xs = np.nonzero(h[cy, :])[0]
    top, bot = (ys.min() + inset, ys.max() - inset) if len(ys) else (cy, cy)
    lef, rig = (xs.min() + inset, xs.max() - inset) if len(xs) else (cx, cx)
    m = np.zeros_like(mask)
    w0, w1 = (width - 1) // 2, width // 2
    m[top:bot + 1, cx - w0:cx + w1 + 1] = True
    half = max(1, (rig - lef) // 2)
    if motif == "cross":
        m[cy - w0:cy + w1 + 1, cx - half:cx + half + 1] = True
    elif motif == "spine":
        q = max(2, (bot - top) // 4)
        b = max(1, half // 2)
        for yy in (cy - q, cy + q):
            m[yy, cx - b:cx + b + 1] = True
        m[cy, cx - half:cx + half + 1] = True
    elif motif == "lorraine":
        q = max(2, (bot - top) // 5)
        for yy, hb in ((cy - q, max(1, half // 2)), (cy + q, half)):
            m[yy, cx - hb:cx + hb + 1] = True
        m = m | m[::-1, :]
    elif motif == "star":
        m[cy, cx - half:cx + half + 1] = True
        r = max(1, half // 2)
        for k in range(1, r + 1):
            for sy in (-1, 1):
                for sx in (-1, 1):
                    m[cy + sy * k, cx + sx * k] = True
    elif motif == "tau":
        m[cy - w0:cy + w1 + 1, cx - half:cx + half + 1] = True
        m[top, cx - 1:cx + 2] = True
        m[bot, cx - 1:cx + 2] = True
    return m & h


def prune_nested(mask: np.ndarray, passes: int, sym: str | None = None) -> np.ndarray:
    """A subset of a lace that keeps its loops and backbone: strip tendrils (end points) `passes` times."""
    out = ca.prune_spurs(mask, passes)
    return morph.remove_small(out, 4, 8)


# ---- registered design ops -------------------------------------------------------------

def _src_mask(design: Design, layer_ids) -> np.ndarray:
    m = np.zeros(design.shape, bool)
    for lid in layer_ids:
        m |= design.layer(lid).mask
    return m


@register_op("derive-backplate", kind="design")
def _derive_backplate(design: Design, layer_ids, grow: int = 1, mode: str = "laced", rim: int = 2):
    """Add a backplate below the target layers (default: all): mode=solid (close(dilate)), hull (filled
    silhouette), laced (hull with windows: rim + dilated layers), lace (laced, thinned to strokes)."""
    m = _src_mask(design, layer_ids)
    bottom = max(l.id for l in design.layers)
    insert_below(design, bottom, backplate(m, grow, mode, rim))
    return design


@register_op("derive-skeleton", kind="design")
def _derive_skeleton(design: Design, layer_ids, close: int = 1, prune: int = 2):
    """Add a layer directly above the single --layer: its symmetric skeleton (gaps closed by `close`,
    spurs pruned `prune` times). Turns a busy lace into a calm backbone that sits on it."""
    if len(layer_ids) != 1:
        raise ValueError("derive-skeleton needs one --layer")
    lid = layer_ids[0]
    insert_above(design, lid, skeleton_layer(design.layer(lid).mask, close, prune))
    return design


@register_op("junction-dots", kind="design")
def _junction_dots(design: Design, layer_ids, where: str = "junctions", shape: str = "plus", min_sep: int = 3):
    """Add a top layer of small jewels on the junctions (where=junctions), end points (ends) or both of the
    --layer's skeleton. shape=dot|plus|ring|diamond; min_sep spaces them out (symmetric)."""
    if len(layer_ids) != 1:
        raise ValueError("junction-dots needs one --layer")
    lid = layer_ids[0]
    m = design.layer(lid).mask
    dots = junction_dots(m, where, shape, min_sep)
    insert_above(design, lid, dots)
    return design


@register_op("erode-up", kind="design")
def _erode_up(design: Design, layer_ids, n: int = 2, step: int = 2, outline: int = 0, fill: bool = True):
    """Stack n terraces above the --layer: each is the filled layer eroded `step` more cells (nested, so
    always supported). outline=1..2 makes each terrace a contour band instead of a solid plateau."""
    if len(layer_ids) != 1:
        raise ValueError("erode-up needs one --layer")
    lid = layer_ids[0]
    levels = erode_terraces(design.layer(lid).mask, n, step, fill, outline)
    for lvl in levels:  # each new one goes above the previous (top-most last)
        insert_above(design, lid, lvl)
    return design


@register_op("height-threshold", kind="design")
def _height_threshold(design: Design, layer_ids, k: int = 3, field: str = "distance", style: str = "solid",
                      seed: int = 0, keep: bool = True):
    """Turn one scalar field over the --layer's hull into k nested layers (field=distance|radial|noise|density,
    style=solid|rim|lace where lace = level ∩ layer ∪ level rim). keep=false replaces the source layer by
    the bottom level."""
    if len(layer_ids) != 1:
        raise ValueError("height-threshold needs one --layer")
    lid = layer_ids[0]
    src = design.layer(lid).mask
    region = hull(src, 0, 1)
    sym = _sym_of(src)
    f = scalar_field(region, field, seed, sym if sym != "none" else "x", lace=src)
    levels = height_levels(f, region, k)
    levels = [style_level(l, style, src) for l in levels]
    if not keep:
        design.layer(lid).set_mask(levels[0])
    for lvl in levels[1:]:
        insert_above(design, lid, lvl)
    return design


def style_level(level: np.ndarray, style: str, lace: np.ndarray) -> np.ndarray:
    if style == "solid":
        return level
    rim = level & ~morph.erode(level, 1, 4)
    if style == "rim":
        return rim
    if style == "lace":
        return (level & lace) | rim
    raise ValueError("style: solid|rim|lace")


@register_op("contrast-layer", kind="design")
def _contrast_layer(design: Design, layer_ids, motif: str = "spine", width: int = 1, merge: bool = True,
                    inset: int = 2):
    """Solid spine over lace: add a layer above the --layer with an axis motif (spine|cross|lorraine|tau|star)
    sized to its hull. merge=true also writes the motif (1 cell wider) into the lace layer so it is carried."""
    if len(layer_ids) != 1:
        raise ValueError("contrast-layer needs one --layer")
    lid = layer_ids[0]
    lace = design.layer(lid)
    mot = spine_motif(lace.mask, motif, width, inset)
    if merge:
        g = lace.default
        g.cells = g.cells | morph.dilate(mot, 1, 4) & hull(lace.mask, 0, 1)
    insert_above(design, lid, mot)
    return design
