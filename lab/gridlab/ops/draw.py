"""Drawing primitives. All take a bool mask and return a NEW mask (input is not modified).
Coordinates are (x, y) cells; rects are inclusive. ``value=False`` erases instead of drawing."""

from __future__ import annotations

import numpy as np

from . import masks as _m


def _set(mask, pts, value=True):
    out = np.asarray(mask, bool).copy()
    H, W = out.shape
    for x, y in pts:
        if 0 <= x < W and 0 <= y < H:
            out[y, x] = value
    return out


def line_points(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    """Bresenham line (8-connected), endpoints included."""
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
    return pts


def line(mask, x0: int, y0: int, x1: int, y1: int, value: bool = True) -> np.ndarray:
    return _set(mask, line_points(x0, y0, x1, y1), value)


def polyline(mask, pts, value: bool = True, closed: bool = False) -> np.ndarray:
    out = np.asarray(mask, bool).copy()
    seq = list(pts) + ([pts[0]] if closed and pts else [])
    for (a, b), (c, d) in zip(seq, seq[1:]):
        out = line(out, a, b, c, d, value)
    if len(seq) == 1:
        out = _set(out, seq, value)
    return out


def rect(mask, x0: int, y0: int, x1: int, y1: int, filled: bool = False, value: bool = True) -> np.ndarray:
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    H, W = np.shape(mask)
    r = _m.rect(H, W, x0, y0, x1, y1)
    if not filled:
        r &= ~_m.rect(H, W, x0 + 1, y0 + 1, x1 - 1, y1 - 1)
    out = np.asarray(mask, bool).copy()
    out[r] = value
    return out


def ellipse(mask, cx: float, cy: float, rx: float, ry: float, filled: bool = True, value: bool = True) -> np.ndarray:
    """Ellipse centred at (cx, cy) with radii (rx, ry) in cells. Outline = thin 8-connected
    boundary (renders as smooth diagonal bands)."""
    H, W = np.shape(mask)
    e = _m.ellipse(H, W, cx, cy, rx + 0.5, ry + 0.5)
    if not filled:
        from .morph import erode
        e &= ~erode(np.pad(e, 1), 1, conn=4)[1:-1, 1:-1]
    out = np.asarray(mask, bool).copy()
    out[e] = value
    return out


def ring(mask, cx: float, cy: float, rx: float, ry: float, thickness: float = 2, value: bool = True) -> np.ndarray:
    H, W = np.shape(mask)
    r = _m.ring(H, W, thickness, cx, cy, rx + 0.5, ry + 0.5)
    out = np.asarray(mask, bool).copy()
    out[r] = value
    return out


def set_points(mask, pts, value: bool = True) -> np.ndarray:
    """pts: iterable of (x, y) or 'x,y' strings."""
    pts = [tuple(int(v) for v in p.split(",")) if isinstance(p, str) else p for p in pts]
    return _set(mask, pts, value)


def parse_ascii(text: str, keep_blank: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Parse '#'/'.'/' ' art -> (on, care). '#','X','x','1','o' = on; '.','0','-','_' = off;
    ' ' = leave unchanged. Rows may be separated by newlines or '/'. Ragged rows are padded
    with "leave unchanged". Common leading indentation is NOT stripped (spaces are meaningful).
    keep_blank: keep leading/trailing blank rows (only ONE trailing newline is dropped), so row
    offsets stay exact; otherwise blank rows at both ends are dropped."""
    if keep_blank:
        if text.endswith("\n"):
            text = text[:-1]
        if text.endswith("\r"):
            text = text[:-1]
        rows = text.replace("/", "\n").split("\n")
    else:
        rows = text.replace("/", "\n").split("\n")
        while rows and not rows[0].strip():
            rows.pop(0)
        while rows and not rows[-1].strip():
            rows.pop()
    if not rows:
        return np.zeros((0, 0), bool), np.zeros((0, 0), bool)
    w = max(1, max(len(r) for r in rows))
    on = np.zeros((len(rows), w), bool)
    care = np.zeros((len(rows), w), bool)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in "#Xx1o@":
                on[y, x] = care[y, x] = True
            elif ch in ".0-_":
                care[y, x] = True
            elif ch == " ":
                pass
            else:
                raise ValueError(f"bad stamp char {ch!r} at row {y} col {x} (use # . or space)")
    return on, care


def stamp_ascii(mask, ascii: str, at: tuple[int, int] = (0, 0), mode: str = "set", keep_blank: bool = False) -> np.ndarray:
    """Stamp ASCII art with its top-left at ``at`` = (x, y).
    mode set: '#' on, '.' off, ' ' unchanged; or: only '#' turn on; and: '.' turn off;
    xor: '#' toggles; clear: '#' turns off."""
    on, care = parse_ascii(ascii, keep_blank)
    out = np.asarray(mask, bool).copy()
    H, W = out.shape
    x0, y0 = at
    for y, x in zip(*np.nonzero(care)):
        X, Y = x0 + x, y0 + y
        if not (0 <= X < W and 0 <= Y < H):
            continue
        v = on[y, x]
        if mode == "set":
            out[Y, X] = v
        elif mode == "or":
            out[Y, X] |= v
        elif mode == "and":
            out[Y, X] &= v
        elif mode == "xor":
            out[Y, X] ^= v
        elif mode == "clear":
            if v:
                out[Y, X] = False
        else:
            raise ValueError(f"unknown stamp mode {mode!r}")
    return out
