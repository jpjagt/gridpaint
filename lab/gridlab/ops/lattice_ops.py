"""Lattice fills, integer upscaling, layer masks and layer booleans.

- ``lattice``: diagonal (quatrefoil lace), ortho, dot, diamond-bead lattices with pitch/phase.
- ``scale``: nearest-neighbour integer upscale of the design (canvas grows) or of some layers (canvas kept).
- ``clip-to-layer``: keep only target cells over / inside / outside another layer.
- ``layer_bool``: and/or/sub/xor of two layers into a third (used by ``gl layer FILE bool``).
"""

from __future__ import annotations

import numpy as np

from ..model import Design, Group, Layer, mask_bbox
from . import morph
from .registry import register_op

LATTICE_KINDS = ("diag", "diag1", "diag2", "ortho", "dots", "diamonds", "checker")


def lattice_mask(h: int, w: int, kind: str = "diag", pitch: int = 4, phase: int = 0, phase2: int = -1,
                 ox: int = 0, oy: int = 0) -> np.ndarray:
    """Lattice over an (h, w) window whose top-left has absolute coords (ox, oy) (phases are absolute)."""
    p = max(2, int(pitch))
    q = phase if phase2 < 0 else phase2
    y, x = np.mgrid[0:h, 0:w]
    x, y = x + ox, y + oy
    if kind == "diag":  # both diagonals: renders as quatrefoil lace
        return ((x + y - phase) % p == 0) | ((x - y - q) % p == 0)
    if kind == "diag1":  # '/' strands
        return (x + y - phase) % p == 0
    if kind == "diag2":  # '\' strands
        return (x - y - q) % p == 0
    if kind == "ortho":
        return ((x - phase) % p == 0) | ((y - q) % p == 0)
    if kind == "dots":
        return ((x - phase) % p == 0) & ((y - q) % p == 0)
    if kind == "diamonds":  # 4-cell diagonal diamonds (render as rings) centred on a diagonal lattice
        out = np.zeros((h, w), bool)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            out |= (((x - dx - phase) % p == 0) & ((y - dy - q) % p == 0))
        return out
    if kind == "checker":
        return (x + y - phase) % 2 == 0
    raise ValueError(f"lattice kind: {'|'.join(LATTICE_KINDS)}")


def auto_phases(design: Design, kind: str, pitch: int) -> tuple[int, int]:
    """Phases that put a lattice node on the material centre (canvas centre if empty), so the lattice is
    mirror-symmetric with the design (exact when the centre is a cell; else as close as the grid allows)."""
    bb = design.bbox()
    if bb is None:
        S, T = design.width - 1, design.height - 1
    else:
        S, T = bb[0] + bb[2], bb[1] + bb[3]  # 2 * centre
    if kind in ("diag", "diag1", "diag2", "checker"):
        a = (S + T) // 2
        return a % pitch, (S - a) % pitch
    return (S // 2) % pitch, (T // 2) % pitch


@register_op("lattice", kind="design")
def _lattice(design: Design, layer_ids, kind: str = "diag", pitch: int = 4, phase: int = -1, phase2: int = -1,
             within: str = "all", mode: str = "auto"):
    """Fill with a lattice (diagonal lattices render as quatrefoil lace, the most native gridpaint texture).
    kind=diag|diag1|diag2|ortho|dots|diamonds|checker, pitch (cells). phase/phase2 = absolute offsets of the two
    line families (-1 = auto: a node on the material centre, so the lattice keeps the design's symmetry).
    within=all (whole canvas; confine with --sel/--region) | mask (only the layer's own cells) | inside (the
    layer's outline incl. holes) | bbox. mode=or|replace|and|auto (auto: replace for within=mask, else or).
    Tip: --sel 'inside:3&not:circle:8,12,3' ; keep a rim with outline d=0."""
    if kind not in LATTICE_KINDS:
        raise ValueError(f"lattice kind: {'|'.join(LATTICE_KINDS)}")
    p = max(2, int(pitch))
    ap, aq = auto_phases(design, kind, p)
    ph = ap if phase < 0 else phase
    q = (aq if phase < 0 else ph) if phase2 < 0 else phase2
    lat = lattice_mask(design.height, design.width, kind, p, ph, q)
    md = mode
    for lid in layer_ids:
        layer = design.layer(lid, create=True)
        m = layer.mask
        if within == "all":
            area = np.ones_like(m)
        elif within == "mask":
            area = m
        elif within == "inside":
            area = morph.filled_outline(m)
        elif within == "bbox":
            area = np.zeros_like(m)
            bb = mask_bbox(m)
            if bb:
                area[bb[1]:bb[3] + 1, bb[0]:bb[2] + 1] = True
        else:
            raise ValueError("within: all|mask|inside|bbox")
        mode_ = ("replace" if within == "mask" else "or") if md == "auto" else md
        if mode_ == "replace":
            new = np.where(area, lat, m)
        elif mode_ == "or":
            new = m | (lat & area)
        elif mode_ == "and":
            new = m & (lat | ~area)
        else:
            raise ValueError("mode: or|replace|and|auto")
        for g in layer.groups:
            g.cells = g.cells & new
        layer.default.cells = layer.default.cells | (new & ~layer.mask)
    return design


def upscale(m: np.ndarray, k: int) -> np.ndarray:
    return np.repeat(np.repeat(np.asarray(m, bool), k, axis=0), k, axis=1)


@register_op("scale", kind="design")
def _scale(design: Design, layer_ids, k: int = 2, keep: bool = False, anchor: str = "center"):
    """Nearest-neighbour integer upscale by k (2, 3...). All layers (default) and keep=false: the whole design
    and canvas grow k times. With a subset --layer or keep=true: those layers are scaled about the centre of
    their joint material bbox (anchor=center) or its top-left (anchor=topleft) inside the same canvas
    (overflow is clipped)."""
    k = int(k)
    if k < 1:
        raise ValueError("scale: k must be an integer >= 1")
    if k == 1:
        return design
    whole = sorted(layer_ids) == sorted(design.layer_ids) and not keep
    if whole:
        for l in design.layers:
            for g in l.groups:
                g.cells = upscale(g.cells, k)
        design.frames = []
        design.width, design.height = design.width * k, design.height * k
        return design
    union = np.zeros(design.shape, bool)
    for lid in layer_ids:
        union |= design.layer(lid).mask
    bb = mask_bbox(union)
    if bb is None:
        return design
    x0, y0, x1, y1 = bb
    if anchor == "topleft":
        tx, ty = x0, y0
    else:
        cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2  # centre in edge coords
        tx = int(round(cx - k * (x1 - x0 + 1) / 2))
        ty = int(round(cy - k * (y1 - y0 + 1) / 2))
    H, W = design.shape
    for lid in layer_ids:
        for g in design.layer(lid).groups:
            big = upscale(g.cells[y0:y1 + 1, x0:x1 + 1], k)
            out = np.zeros((H, W), bool)
            bh, bw = big.shape
            sx0, sy0 = max(0, tx), max(0, ty)
            sx1, sy1 = min(W, tx + bw), min(H, ty + bh)
            if sx1 > sx0 and sy1 > sy0:
                out[sy0:sy1, sx0:sx1] = big[sy0 - ty:sy1 - ty, sx0 - tx:sx1 - tx]
            g.cells = out
    return design


def _layer_area(design: Design, src: int, mode: str) -> np.ndarray:
    m = design.layer(int(src)).mask
    if mode == "over":
        return m
    if mode == "inside":
        return morph.filled_outline(m)
    if mode == "outside":
        return ~morph.filled_outline(m)
    if mode == "not-over":
        return ~m
    raise ValueError("mode: over|inside|outside|not-over")


@register_op("clip-to-layer", kind="design")
def _clip_to_layer(design: Design, layer_ids, src: int = 0, mode: str = "over", grow: int = 0):
    """Mask the --layer(s) by another layer src=ID: mode=over keeps cells on src's cells, inside keeps cells
    within src's outline (holes filled), outside / not-over keep the rest. grow=N dilates the mask first
    (negative erodes). Replaces the copy-layer/fill-holes/clip-to-below/rm idiom."""
    if not src:
        raise ValueError("clip-to-layer needs src=ID")
    area = _layer_area(design, src, mode)
    if grow > 0:
        area = morph.dilate(area, grow)
    elif grow < 0:
        area = morph.erode(area, -grow)
    for lid in layer_ids:
        if lid == int(src) and mode in ("over", "inside"):
            continue
        for g in design.layer(lid).groups:
            g.cells = g.cells & area
    return design


BOOL_OPS = ("and", "or", "sub", "xor")


def layer_bool(design: Design, a: int, op: str, b: int, into: int | None = None) -> Design:
    """In place: layer ``into`` (default a) := A op B. Groups of A are kept (cells clipped to the result);
    cells only from B go to B's groups of the same id (else 'default')."""
    if op not in BOOL_OPS:
        raise ValueError(f"bool op: {'|'.join(BOOL_OPS)}")
    A, B = design.layer(a), design.layer(b)
    ma, mb = A.mask, B.mask
    r = {"and": ma & mb, "or": ma | mb, "sub": ma & ~mb, "xor": ma ^ mb}[op]
    into = a if into is None else int(into)
    groups = [Group(g.id, g.cells & r) for g in A.groups]
    extra = r & ~ma
    if extra.any():
        for bg in B.groups:
            add = bg.cells & extra
            if not add.any():
                continue
            tg = next((g for g in groups if g.id == bg.id), None)
            if tg is None:
                groups.append(Group(bg.id, add))
            else:
                tg.cells = tg.cells | add
    groups = [g for g in groups if g.cells.any()] or [Group("default", np.zeros(design.shape, bool))]
    design.remove_layer(into)
    design.layers.append(Layer(into, groups))
    design.layers.sort(key=lambda l: l.id)
    return design
