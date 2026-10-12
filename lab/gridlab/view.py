"""ASCII views for LLMs, with coordinate rulers so every cell is unambiguous.

- ``ascii_layer(design, layer_id, region=None)``: '#' filled, '.' empty.
- ``ascii_composite(design, region=None)``: digit of the topmost (lowest id) layer present, '.' empty.
- ``ascii_mask(mask, region=None, on='#', off='.')``: any bool mask.
- ``layers_legend(design)`` / ``groups_info(design)``: compact one-liners.

Rows are labelled with absolute y, columns with a two-row (tens/units) x ruler. Regions are
inclusive (x0, y0, x1, y1) and coordinates stay absolute.
"""

from __future__ import annotations

import numpy as np

from .model import Design, Rect

_LAYER_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"


def _clip_region(shape, region: Rect | None) -> Rect:
    H, W = shape
    if region is None:
        return 0, 0, W - 1, H - 1
    x0, y0, x1, y1 = region
    return max(0, x0), max(0, y0), min(W - 1, x1), min(H - 1, y1)


def grid_text(chars: np.ndarray, x0: int = 0, y0: int = 0) -> str:
    """Render a 2D array of single characters with rulers; (x0, y0) = absolute coord of chars[0,0]."""
    h, w = chars.shape
    ylab = max(2, len(str(y0 + h - 1)))
    pad = " " * (ylab + 1)
    xs = range(x0, x0 + w)
    tens = "".join(str((x // 10) % 10) if (x % 10 == 0 or x == x0) else " " for x in xs)
    units = "".join(str(x % 10) for x in xs)
    lines = [pad + tens.rstrip(), pad + units]
    for j in range(h):
        lines.append(f"{y0 + j:>{ylab}} " + "".join(chars[j]))
    return "\n".join(lines)


def ascii_mask(mask: np.ndarray, region: Rect | None = None, on: str = "#", off: str = ".") -> str:
    x0, y0, x1, y1 = _clip_region(mask.shape, region)
    sub = mask[y0:y1 + 1, x0:x1 + 1]
    return grid_text(np.where(sub, on, off), x0, y0)


def ascii_layer(design: Design, layer_id: int, region: Rect | None = None) -> str:
    return ascii_mask(design.layer(layer_id).mask, region)


def composite_chars(design: Design) -> np.ndarray:
    chars = np.full(design.shape, ".", dtype="<U1")
    for layer in design.layers_bottom_to_top():  # lower ids overwrite -> topmost wins
        chars[layer.mask] = _LAYER_CHARS[layer.id % len(_LAYER_CHARS)]
    return chars


def ascii_composite(design: Design, region: Rect | None = None) -> str:
    x0, y0, x1, y1 = _clip_region(design.shape, region)
    return grid_text(composite_chars(design)[y0:y1 + 1, x0:x1 + 1], x0, y0)


def ascii_diff(a: np.ndarray, b: np.ndarray, region: Rect | None = None) -> str:
    """'+' added in b, '-' removed in b, '#' kept, '.' empty."""
    chars = np.full(a.shape, ".", dtype="<U1")
    chars[a & b] = "#"
    chars[~a & b] = "+"
    chars[a & ~b] = "-"
    x0, y0, x1, y1 = _clip_region(a.shape, region)
    return grid_text(chars[y0:y1 + 1, x0:x1 + 1], x0, y0)


def layers_legend(design: Design) -> str:
    parts = []
    ordered = design.layers_top_to_bottom()
    for i, l in enumerate(ordered):
        role = "top" if i == 0 else ("bottom" if i == len(ordered) - 1 else "mid")
        if len(ordered) == 1:
            role = "only"
        ng = len(l.groups)
        parts.append(f"L{l.id}({role}) {l.count}c" + (f" {ng}g" if ng > 1 else ""))
    return "layers top->bottom: " + ", ".join(parts)


def groups_info(design: Design) -> str:
    lines = []
    for l in design.layers_top_to_bottom():
        gs = ", ".join(f"{g.id}:{int(g.cells.sum())}" for g in l.groups)
        lines.append(f"L{l.id} groups: {gs}")
    return "\n".join(lines)


def header(design: Design, name: str | None = None) -> str:
    bb = design.bbox()
    bbs = "empty" if bb is None else (f"bbox {bb[0]},{bb[1]}..{bb[2]},{bb[3]} centre {(bb[0] + bb[2]) / 2:g},{(bb[1] + bb[3]) / 2:g}"
                                      f" (canvas centre {(design.width - 1) / 2:g},{(design.height - 1) / 2:g})")
    return f"{name or design.id}: {design.width}x{design.height} {bbs} | {layers_legend(design)}"
