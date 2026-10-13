"""Built-in registered ops (see registry.py). Names are kebab-case for the CLI."""

from __future__ import annotations

import numpy as np

from ..model import Design, Layer, mask_bbox, shift_mask
from . import masks as M
from . import morph, symmetry
from .registry import register_op


# ---- symmetry -------------------------------------------------------------

@register_op("mirror")
def _mirror(mask, axis: str = "x", keep: str = "", cx: float = -1.0, cy: float = -1.0, origin=(0, 0)):
    """Copy one half onto the other. axis=x (left<->right, keep=left|right), y (keep=top|bottom),
    xy (keep=tl|tr|bl|br), diag/anti (square; keep=upper|lower). Axis defaults to the canvas
    (or --region) centre; cx=7 / cy=12 put it through that absolute column/row (7.5 = between)."""
    ox, oy = origin
    return symmetry.mirror(mask, axis, keep or None,
                           cx=None if cx < 0 else cx - ox, cy=None if cy < 0 else cy - oy)


@register_op("symmetrize")
def _symmetrize(mask, kind: str = "d2", keep: str = "tl"):
    """Copy a fundamental region to get symmetry kind=d2 (from quadrant keep), d4 (square, from
    top-left octant), rot2 (from top half), rot4 (square, from top-left quadrant)."""
    if kind in ("d2", "xy"):
        return symmetry.symmetrize_d2(mask, keep)
    if kind == "d4":
        return symmetry.symmetrize_d4(mask)
    if kind == "rot2":
        return symmetry.rot_sym(mask, 2)
    if kind == "rot4":
        return symmetry.rot_sym(mask, 4)
    raise ValueError("kind: d2|d4|rot2|rot4")


@register_op("sym-or")
def _sym_or(mask, kind: str = "d2"):
    """OR the mask with its images under kind=x|y|d2|rot2|rot4|diag|d4 (adds, never removes)."""
    return symmetry.symmetry_or(mask, kind)


@register_op("sym-and")
def _sym_and(mask, kind: str = "d2"):
    """AND the mask with its images (keeps only already-symmetric cells)."""
    return symmetry.symmetry_and(mask, kind)


# ---- morphology -------------------------------------------------------------

@register_op("dilate")
def _dilate(mask, n: int = 1, conn: int = 4):
    """Grow by n cells (conn 4 = diamond-ish, 8 = square)."""
    return morph.dilate(mask, n, conn)


@register_op("erode")
def _erode(mask, n: int = 1, conn: int = 4):
    """Shrink by n cells."""
    return morph.erode(mask, n, conn)


@register_op("open")
def _open(mask, n: int = 1, conn: int = 4):
    """Erode then dilate: removes thin bits/spurs."""
    return morph.open_(mask, n, conn)


@register_op("close")
def _close(mask, n: int = 1, conn: int = 4):
    """Dilate then erode: fills small gaps/notches."""
    return morph.close(mask, n, conn)


@register_op("skeleton")
def _skeleton(mask):
    """Thin to a 1-cell-wide 8-connected skeleton (Zhang-Suen). Great for lace/filigree look."""
    return morph.skeletonize(mask)


@register_op("fill-holes")
def _fill_holes(mask, max_size: int = 0):
    """Fill enclosed background regions; max_size=N fills only holes of <= N cells (pinholes), keeping windows."""
    if max_size <= 0:
        return morph.fill_holes(mask)
    from scipy import ndimage

    m = np.asarray(mask, bool)
    holes = morph.fill_holes(m) & ~m
    lab, n = ndimage.label(holes, morph.structure(4))
    if n == 0:
        return m.copy()
    sizes = np.bincount(lab.ravel())
    small = sizes <= max_size
    small[0] = False
    return m | small[lab]


@register_op("remove-small")
def _remove_small(mask, min_size: int = 3, conn: int = 8):
    """Delete connected pieces smaller than min_size cells."""
    return morph.remove_small(mask, min_size, conn)


@register_op("keep-largest")
def _keep_largest(mask, n: int = 1, conn: int = 8):
    """Keep only the n largest connected pieces."""
    return morph.keep_largest(mask, conn, n)


@register_op("outline")
def _outline(mask, d: int = 1, thickness: int = 1, mode: str = "or"):
    """Offset band around the shape: d>=1 outside at distance d, d<=0 inside (0 = own edge).
    mode=or adds it to the mask, mode=replace returns only the band."""
    band = M.offset_outline(mask, d, thickness)
    return band if mode == "replace" else (mask | band)


# ---- simple edits -------------------------------------------------------------

def _shape_mask(shape: str, mask: np.ndarray) -> np.ndarray:
    H, W = mask.shape
    if shape in ("all", "region"):
        return np.ones((H, W), bool)
    if shape == "bbox":
        bb = mask_bbox(mask)
        out = np.zeros((H, W), bool)
        if bb:
            out[bb[1]:bb[3] + 1, bb[0]:bb[2] + 1] = True
        return out
    fn = {"ellipse": M.ellipse, "capsule": M.capsule, "diamond": M.diamond, "shield": M.shield, "rect": M.rect}.get(shape)
    if fn is None:
        raise ValueError("shape: all|bbox|ellipse|capsule|diamond|shield|rect")
    return fn(H, W)


@register_op("invert")
def _invert(mask, within: str = "all"):
    """Invert cells inside a shape fitted to the canvas/--region: within=all|bbox|ellipse|capsule|diamond|shield."""
    s = _shape_mask(within, mask)
    return np.where(s, ~mask, mask)


@register_op("invert-in-mask")
def _invert_in_mask(mask, within: str = "capsule"):
    """Alias of invert with a shape default (capsule)."""
    return _invert(mask, within)


@register_op("clip")
def _clip(mask, shape: str = "ellipse"):
    """Keep only cells inside a shape fitted to the canvas/--region (ellipse|capsule|diamond|shield|bbox)."""
    return mask & _shape_mask(shape, mask)


@register_op("fill")
def _fill(mask, shape: str = "all"):
    """Turn on all cells of a shape fitted to the canvas/--region (all|ellipse|capsule|diamond|shield)."""
    return mask | _shape_mask(shape, mask)


@register_op("shift")
def _shift(mask, dx: int = 0, dy: int = 0):
    """Move cells by (dx, dy); cells leaving the canvas/region are dropped."""
    return shift_mask(mask, dx, dy)


@register_op("clear")
def _clear(mask):
    """Remove all cells (of the target layers/region)."""
    return np.zeros_like(mask, dtype=bool)


@register_op("flip")
def _flip(mask, axis: str = "x"):
    """Flip (not mirror-copy): axis=x reverses left/right, y top/bottom, rot180, rot90 (square), transpose (square)."""
    if axis == "x":
        return mask[:, ::-1]
    if axis == "y":
        return mask[::-1, :]
    if axis == "rot180":
        return mask[::-1, ::-1]
    if axis == "rot90":
        symmetry._require_square(mask, "rot90")
        return np.rot90(mask, -1)
    if axis == "transpose":
        symmetry._require_square(mask, "transpose")
        return mask.T
    raise ValueError("axis: x|y|rot180|rot90|transpose")


# ---- design-level ops ---------------------------------------------------------

@register_op("copy-layer", kind="design")
def _copy_layer(design: Design, layer_ids, to: int = 0, mode: str = "replace"):
    """Copy the (single) --layer to layer id `to` (created if missing). mode=replace|or. Groups are copied."""
    if len(layer_ids) != 1 or not to:
        raise ValueError("copy-layer needs exactly one --layer and to=ID")
    src = design.layer(layer_ids[0])
    if mode == "replace" or not design.has_layer(to):
        design.remove_layer(to)
        design.layers.append(Layer(int(to), [g.copy() for g in src.groups]))
        design.layers.sort(key=lambda l: l.id)
    else:
        dst = design.layer(to)
        for g in src.groups:
            dg = dst.group(g.id, create=True)
            dg.cells = dg.cells | g.cells
    return design


@register_op("move-layer", kind="design")
def _move_layer(design: Design, layer_ids, to: int = 0):
    """Renumber the single --layer to id `to` (must be free)."""
    if len(layer_ids) != 1 or not to:
        raise ValueError("move-layer needs exactly one --layer and to=ID")
    if design.has_layer(to):
        raise ValueError(f"layer {to} exists; use swap-layers or copy-layer")
    design.layer(layer_ids[0]).id = int(to)
    design.layers.sort(key=lambda l: l.id)
    return design


@register_op("swap-layers", kind="design")
def _swap_layers(design: Design, layer_ids):
    """Swap the contents of exactly two layers: --layer 2,3."""
    if len(layer_ids) != 2:
        raise ValueError("swap-layers needs --layer A,B")
    a, b = design.layer(layer_ids[0]), design.layer(layer_ids[1])
    a.groups, b.groups = b.groups, a.groups
    return design


@register_op("merge-groups", kind="design")
def _merge_groups(design: Design, layer_ids):
    """Collapse all groups of the target layers into 'default' (everything blob-connects)."""
    for lid in layer_ids:
        design.layer(lid).merge_groups()
    return design


@register_op("clip-to-below", kind="design")
def _clip_to_below(design: Design, layer_ids, shrink: int = 0):
    """Physical support: remove cells of each target layer not resting on the layer directly
    below (next higher id), optionally eroding the support by `shrink` cells first."""
    order = [l.id for l in design.layers_top_to_bottom()]
    for lid in layer_ids:
        i = order.index(lid)
        if i + 1 >= len(order):
            continue
        sup = design.layer(order[i + 1]).mask
        if shrink:
            sup = morph.erode(sup, shrink)
        for g in design.layer(lid).groups:
            g.cells = g.cells & sup
    return design


@register_op("support", kind="design")
def _support(design: Design, layer_ids, grow: int = 0):
    """Inverse of clip-to-below: add the target layer's cells (dilated by `grow`) to the layer
    directly below so every upper cell has material beneath it."""
    order = [l.id for l in design.layers_top_to_bottom()]
    for lid in layer_ids:
        i = order.index(lid)
        if i + 1 >= len(order):
            continue
        add = design.layer(lid).mask
        if grow:
            add = morph.dilate(add, grow)
        g = design.layer(order[i + 1]).default
        g.cells = g.cells | add
    return design


@register_op("trim", kind="design")
def _trim(design: Design, layer_ids, margin: int = 1):
    """Crop the canvas to the material bbox plus margin (all layers)."""
    return design.trim(margin)


@register_op("pad", kind="design")
def _pad(design: Design, layer_ids, n: int = 1):
    """Add n empty cells on every side of the canvas (coordinates shift by n)."""
    return design.pad(n, n, n, n)


@register_op("resize", kind="design")
def _resize(design: Design, layer_ids, w: int = 0, h: int = 0, anchor: str = "center"):
    """Change canvas size to w x h, content anchored center|topleft."""
    return design.resize(w or design.width, h or design.height, anchor)


@register_op("center", kind="design")
def _center(design: Design, layer_ids):
    """Translate all material so its bbox is centred on the canvas."""
    bb = design.bbox()
    if bb is None:
        return design
    x0, y0, x1, y1 = bb
    dx = (design.width - 1 - x1 - x0) // 2
    dy = (design.height - 1 - y1 - y0) // 2
    return design.translate(dx, dy)
