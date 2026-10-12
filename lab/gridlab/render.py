"""Faithful, anti-aliased PNG renderer for gridpaint blob designs.

Blob semantics (per group; layer = union of groups; composite paints highest id first):
- filled cell, quadrant Q: full square if an orthogonal neighbour on Q's side or the diagonal
  neighbour in Q's direction is filled, else a quarter disc (radius half a cell) about the cell centre.
- empty cell, quadrant Q: concave "bridge" (square minus that quarter disc) if both orthogonal
  neighbours on Q's side are filled.

Implementation: per-quadrant type arrays (H, W) index into precomputed (h x h) supersampled stamps,
assembled with a reshape, then box-downsampled to coverage (alpha) for anti-aliasing.

Public API:
- ``render(design, cell_px=16, margin=1, palette=None, background=BG, show_grid=False, layers=None,
  highlight=None, region=None, ghost=None) -> PIL.Image``
- ``layer_alpha(mask_or_groups, cell_px, ss=4) -> float array (H*cell_px, W*cell_px)``
- ``render_layers_panel(design, ...)`` composite + each layer, labelled, side by side
- ``contact_sheet(designs, labels=None, cols=4, cell_px=8, ...)``
- ``layer_colors(design, palette)``
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .model import Design, Group, Rect

BG = "#020817"
PALETTE = ["#b8c6dc", "#8fa5c2", "#6680a6", "#4a5f80", "#3a4c68", "#2c3a52"]
SINGLE_LAYER_COLOR = "#8fa5c2"
TEXT = (200, 210, 225)
TEXT_DIM = (120, 135, 160)
HIGHLIGHT = (255, 170, 60)

# quadrant -> (qy, qx) block position within the cell, orthogonal/diagonal neighbour offsets (dx, dy)
_QUADS = {
    "NW": ((0, 0), (-1, 0), (0, -1), (-1, -1)),
    "NE": ((0, 1), (1, 0), (0, -1), (1, -1)),
    "SW": ((1, 0), (-1, 0), (0, 1), (-1, 1)),
    "SE": ((1, 1), (1, 0), (0, 1), (1, 1)),
}


def hex_rgb(c) -> tuple[int, int, int]:
    if isinstance(c, (tuple, list)):
        return tuple(int(v) for v in c[:3])  # type: ignore
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


@lru_cache(maxsize=32)
def _stamps(h: int) -> dict[str, np.ndarray]:
    """For each quadrant: stamps[type] with types 0 none, 1 full, 2 quarter disc, 3 bridge; shape (4, h, h)."""
    c = np.arange(h) + 0.5
    out = {}
    for name, ((qy, qx), *_rest) in _QUADS.items():
        # distance from the cell centre, which sits at the quadrant's inner corner
        cy = h if qy == 0 else 0
        cx = h if qx == 0 else 0
        dy = c[:, None] - cy
        dx = c[None, :] - cx
        disc = dx * dx + dy * dy <= h * h
        out[name] = np.stack([np.zeros((h, h), bool), np.ones((h, h), bool), disc, ~disc])
    return out


def _neighbours(m: np.ndarray):
    p = np.pad(m, 1)
    H, W = m.shape
    return lambda dx, dy: p[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]


def quadrant_types(cells: np.ndarray) -> dict[str, np.ndarray]:
    """Per quadrant, an (H, W) uint8 array of primitive types (0 none, 1 full, 2 round, 3 bridge)."""
    n = _neighbours(cells)
    out = {}
    for name, (_pos, o1, o2, dg) in _QUADS.items():
        a, b, d = n(*o1), n(*o2), n(*dg)
        t = np.zeros(cells.shape, np.uint8)
        t[cells & (a | b | d)] = 1
        t[cells & ~(a | b | d)] = 2
        t[~cells & a & b] = 3
        out[name] = t
    return out


def group_bitmap(cells: np.ndarray, S: int) -> np.ndarray:
    """Boolean pixel mask (H*S, W*S) of one group's blob shape at S px per cell (S even)."""
    H, W = cells.shape
    h = S // 2
    st = _stamps(h)
    out = np.zeros((H, 2, h, W, 2, h), bool)
    for name, t in quadrant_types(cells).items():
        qy, qx = _QUADS[name][0]
        out[:, qy, :, :, qx, :] = st[name][t].transpose(0, 2, 1, 3)
    return out.reshape(H * S, W * S)


def layer_alpha(groups, cell_px: int, ss: int = 4) -> np.ndarray:
    """Anti-aliased coverage in [0,1], shape (H*cell_px, W*cell_px). ``groups``: mask or list[Group]."""
    if isinstance(groups, np.ndarray):
        groups = [Group("default", groups)]
    S = cell_px * ss
    if S % 2:
        S += ss  # keep even
        ss = S // cell_px
    bm = None
    for g in groups:
        if not g.cells.any():
            continue
        b = group_bitmap(g.cells, S)
        bm = b if bm is None else (bm | b)
    H, W = groups[0].cells.shape
    if bm is None:
        return np.zeros((H * cell_px, W * cell_px), np.float32)
    return bm.reshape(H * cell_px, ss, W * cell_px, ss).mean(axis=(1, 3), dtype=np.float32)


def layer_colors(design: Design, palette: Sequence | None = None) -> dict[int, tuple[int, int, int]]:
    """Colour by rank from the top (lowest id = palette[0]); a single layer uses SINGLE_LAYER_COLOR."""
    ids = [l.id for l in design.layers_top_to_bottom()]
    if palette is None:
        if len(ids) == 1:
            return {ids[0]: hex_rgb(SINGLE_LAYER_COLOR)}
        palette = PALETTE
    return {lid: hex_rgb(palette[min(i, len(palette) - 1)]) for i, lid in enumerate(ids)}


@lru_cache(maxsize=8)
def font(size: int = 11):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # old Pillow
        return ImageFont.load_default()


def _crop_design(design: Design, region: Rect | None) -> tuple[Design, int, int]:
    if region is None:
        return design, 0, 0
    x0, y0, x1, y1 = region
    return design.copy().crop(x0, y0, x1, y1), x0, y0


def render(
    design: Design,
    cell_px: int = 16,
    margin: int = 1,
    palette: Sequence | None = None,
    background=BG,
    show_grid: bool = False,
    layers: Iterable[int] | None = None,
    highlight: Rect | None = None,
    region: Rect | None = None,
    ghost: Iterable[int] | None = None,
    ghost_alpha: float = 0.28,
    ss: int = 4,
) -> Image.Image:
    """Render to an RGB image.

    show_grid: faint cell grid (brighter every 5) + coordinate rulers (absolute coords, labels every 5).
    layers: subset of layer ids to draw (colours still by rank in the full design).
    ghost: layer ids drawn translucent (e.g. the layer below, to judge support).
    highlight: inclusive rect (absolute coords) outlined in orange.
    region: inclusive rect to render (coordinates on rulers stay absolute).
    """
    colors = layer_colors(design, palette)
    d, ox, oy = _crop_design(design, region)
    if margin:
        d = d.copy().pad(margin, margin, margin, margin)
        ox, oy = ox - margin, oy - margin
    want = set(design.layer_ids if layers is None else [int(i) for i in layers])
    ghosts = set(int(i) for i in (ghost or []))
    H, W = d.shape
    img = np.empty((H * cell_px, W * cell_px, 3), np.float32)
    img[:] = hex_rgb(background)
    for layer in d.layers_bottom_to_top():
        if layer.id not in want and layer.id not in ghosts:
            continue
        a = layer_alpha(layer.groups, cell_px, ss)
        if layer.id not in want:
            a = a * ghost_alpha
        col = np.array(colors[layer.id], np.float32)
        img += (col - img) * a[..., None]
    im = Image.fromarray(np.clip(img + 0.5, 0, 255).astype(np.uint8), "RGB")
    if show_grid:
        im = _grid_and_rulers(im, cell_px, ox, oy, highlight)
    elif highlight is not None:
        _draw_highlight(ImageDraw.Draw(im), highlight, cell_px, ox, oy, 0, 0)
    return im


def _draw_highlight(dr, rect, cell_px, ox, oy, gx, gy):
    x0, y0, x1, y1 = rect
    dr.rectangle(
        [gx + (x0 - ox) * cell_px, gy + (y0 - oy) * cell_px, gx + (x1 - ox + 1) * cell_px - 1, gy + (y1 - oy + 1) * cell_px - 1],
        outline=HIGHLIGHT, width=2,
    )


def _grid_and_rulers(im: Image.Image, cell_px: int, ox: int, oy: int, highlight: Rect | None) -> Image.Image:
    W, H = im.size[0] // cell_px, im.size[1] // cell_px
    fnt = font(max(9, min(13, cell_px - 2)))
    gl, gt = 26, 16  # gutters
    out = Image.new("RGB", (im.size[0] + gl + 4, im.size[1] + gt + 4), hex_rgb(BG))
    out.paste(im, (gl, gt))
    ov = Image.new("RGBA", out.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    for i in range(W + 1):
        x = ox + i
        a = 70 if x % 5 == 0 else 26
        px = gl + i * cell_px
        dr.line([(px, gt), (px, gt + H * cell_px)], fill=(150, 170, 200, a), width=1)
    for j in range(H + 1):
        y = oy + j
        a = 70 if y % 5 == 0 else 26
        py = gt + j * cell_px
        dr.line([(gl, py), (gl + W * cell_px, py)], fill=(150, 170, 200, a), width=1)
    out = Image.alpha_composite(out.convert("RGBA"), ov).convert("RGB")
    dr = ImageDraw.Draw(out)
    step = 5 if cell_px >= 7 else 10
    for i in range(W):
        x = ox + i
        if x % step == 0:
            cx = gl + i * cell_px + cell_px / 2
            dr.text((cx, gt - 2), str(x), fill=TEXT, font=fnt, anchor="ms")
            dr.line([(cx, gt - 1), (cx, gt)], fill=TEXT)
    for j in range(H):
        y = oy + j
        if y % step == 0:
            cy = gt + j * cell_px + cell_px / 2
            dr.text((gl - 3, cy), str(y), fill=TEXT, font=fnt, anchor="rm")
    if highlight is not None:
        _draw_highlight(dr, highlight, cell_px, ox, oy, gl, gt)
    return out


def caption(im: Image.Image, text: str, size: int = 13, sub: str | None = None) -> Image.Image:
    """Add a caption bar above the image."""
    fnt = font(size)
    lines = [text] + ([sub] if sub else [])
    bar = 6 + (size + 4) * len(lines)
    tw = max(int(ImageDraw.Draw(im).textlength(t, font=fnt)) for t in lines) + 12
    out = Image.new("RGB", (max(im.size[0], tw), im.size[1] + bar), hex_rgb(BG))
    dr = ImageDraw.Draw(out)
    dr.text((6, 4), text, fill=TEXT, font=fnt)
    if sub:
        dr.text((6, 4 + size + 4), sub, fill=TEXT_DIM, font=font(max(9, size - 2)))
    out.paste(im, ((out.size[0] - im.size[0]) // 2, bar))
    return out


def hstack(images: Sequence[Image.Image], gap: int = 12, bg=BG) -> Image.Image:
    w = sum(i.size[0] for i in images) + gap * (len(images) - 1)
    h = max(i.size[1] for i in images)
    out = Image.new("RGB", (w, h), hex_rgb(bg))
    x = 0
    for i in images:
        out.paste(i, (x, 0))
        x += i.size[0] + gap
    return out


def render_layers_panel(
    design: Design,
    cell_px: int = 14,
    show_grid: bool = True,
    region: Rect | None = None,
    highlight: Rect | None = None,
    ghost_below: bool = True,
    margin: int = 1,
    title: str | None = None,
    cols: int | None = None,
) -> Image.Image:
    """Composite + each layer separately (top layer first), labelled, side by side
    (or wrapped into ``cols`` columns).
    Each single-layer panel shows the layer directly beneath as a translucent ghost (support check)."""
    kw = dict(cell_px=cell_px, show_grid=show_grid, region=region, highlight=highlight, margin=margin)
    panels = [caption(render(design, **kw), title or "composite")]
    ordered = design.layers_top_to_bottom()
    if len(ordered) > 1:
        for i, l in enumerate(ordered):
            below = ordered[i + 1].id if i + 1 < len(ordered) else None
            g = [below] if (ghost_below and below is not None) else None
            label = f"L{l.id}" + (" (top)" if i == 0 else " (bottom)" if i == len(ordered) - 1 else "")
            if g:
                label += f" +ghost L{below}"
            panels.append(caption(render(design, layers=[l.id], ghost=g, **kw), label))
    if not cols or cols >= len(panels):
        return hstack(panels)
    rows = [hstack(panels[i:i + cols]) for i in range(0, len(panels), cols)]
    return vstack(rows)


def vstack(images: Sequence[Image.Image], gap: int = 12, bg=BG) -> Image.Image:
    w = max(i.size[0] for i in images)
    h = sum(i.size[1] for i in images) + gap * (len(images) - 1)
    out = Image.new("RGB", (w, h), hex_rgb(bg))
    y = 0
    for i in images:
        out.paste(i, (0, y))
        y += i.size[1] + gap
    return out


def contact_sheet(
    designs: Sequence[Design],
    labels: Sequence[str] | None = None,
    cols: int = 4,
    cell_px: int = 8,
    show_grid: bool = False,
    margin: int = 1,
    sublabels: Sequence[str] | None = None,
    gap: int = 14,
) -> Image.Image:
    """Grid of rendered designs (same cell_px, so sizes are comparable) with labels."""
    if not designs:
        raise ValueError("no designs")
    tiles = []
    for i, d in enumerate(designs):
        lab = labels[i] if labels else (d.id or str(i))
        sub = sublabels[i] if sublabels else None
        tiles.append(caption(render(d, cell_px=cell_px, show_grid=show_grid, margin=margin), lab, sub=sub))
    cols = max(1, min(cols, len(tiles)))
    rows = (len(tiles) + cols - 1) // cols
    tw = max(t.size[0] for t in tiles)
    th = max(t.size[1] for t in tiles)
    out = Image.new("RGB", (cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap), hex_rgb(BG))
    dr = ImageDraw.Draw(out)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        x, y = gap + c * (tw + gap), gap + r * (th + gap)
        dr.rectangle([x - 3, y - 3, x + tw + 2, y + th + 2], outline=(30, 41, 59))
        out.paste(t, (x, y))
    return out
