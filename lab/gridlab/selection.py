"""Cell selections ("--sel" specs) -> bool masks, plus helpers to confine an edit to a selection.

Grammar (no spaces needed; `|` = union, `&` = intersection, `&` binds tighter, `not:` negates a term):

    rect:x0,y0,x1,y1        inclusive rectangle (same as --region)
    circle:cx,cy,r          cells whose centre is within r of (cx, cy)
    ring:cx,cy,r0,r1        r0 <= distance <= r1
    half:x<10 | half:y>=7   half-plane (ops < <= > >=); half:left|right|top|bottom = about the canvas centre
    wedge:a0,a1[,cx,cy]     sector, degrees clockwise from 12 o'clock (0 = up, 90 = right), about the
                            canvas centre (or cx,cy); a0 -> a1 clockwise, may wrap (wedge:315,45 = top)
    layer:ID                cells of a layer
    inside:ID               everything inside a layer's outline (1-cell gaps closed, holes filled)
    expr:x+y>20             numpy expression of x, y, cx, cy (canvas centre), r (distance to centre),
                            a (angle, same convention as wedge); no & or | inside (use separate terms)
    all                     every cell

Example: ``circle:12,12,8&not:circle:12,12,4|layer:1`` (= annulus, plus everything on layer 1).
"""

from __future__ import annotations

import re

import numpy as np

from .model import Design


class SelError(ValueError):
    pass


def _nums(s: str, n_min: int, n_max: int, what: str) -> list[float]:
    try:
        v = [float(t) for t in s.split(",") if t != ""]
    except ValueError:
        raise SelError(f"{what}: expected numbers, got {s!r}")
    if not (n_min <= len(v) <= n_max):
        raise SelError(f"{what}: expected {n_min}{'' if n_min == n_max else '-' + str(n_max)} numbers, got {s!r}")
    return v


def _grid(d: Design):
    y, x = np.mgrid[0:d.height, 0:d.width]
    return x.astype(float), y.astype(float), (d.width - 1) / 2, (d.height - 1) / 2


def _angle(x, y, cx, cy):
    """Degrees clockwise from up (y grows down), in [0, 360)."""
    return np.degrees(np.arctan2(x - cx, -(y - cy))) % 360


def term_mask(term: str, d: Design) -> np.ndarray:
    term = term.strip()
    if not term:
        raise SelError("empty selection term")
    if term.startswith("not:"):
        return ~term_mask(term[4:], d)
    if term in ("all", "*"):
        return np.ones(d.shape, bool)
    kind, _, arg = term.partition(":")
    x, y, ccx, ccy = _grid(d)
    if kind == "rect":
        x0, y0, x1, y1 = _nums(arg, 4, 4, "rect")
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        return (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
    if kind == "circle":
        cx, cy, r = _nums(arg, 3, 3, "circle:cx,cy,r")
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9
    if kind == "ring":
        cx, cy, r0, r1 = _nums(arg, 4, 4, "ring:cx,cy,r0,r1")
        dd = (x - cx) ** 2 + (y - cy) ** 2
        return (dd >= r0 * r0 - 1e-9) & (dd <= r1 * r1 + 1e-9)
    if kind == "half":
        named = {"left": f"x<{ccx}", "right": f"x>{ccx}", "top": f"y<{ccy}", "bottom": f"y>{ccy}"}
        arg = named.get(arg, arg)
        m = re.fullmatch(r"([xy])\s*(<=|>=|<|>)\s*(-?[\d.]+)", arg)
        if not m:
            raise SelError(f"half: expected x<N, y>=N or left|right|top|bottom, got {arg!r}")
        v = x if m.group(1) == "x" else y
        c = float(m.group(3))
        return {"<": v < c, "<=": v <= c, ">": v > c, ">=": v >= c}[m.group(2)]
    if kind == "wedge":
        vals = _nums(arg, 2, 4, "wedge:a0,a1[,cx,cy]")
        a0, a1 = vals[0] % 360, vals[1] % 360
        cx, cy = (vals[2], vals[3]) if len(vals) == 4 else (ccx, ccy)
        a = _angle(x, y, cx, cy)
        sel = (a >= a0) & (a <= a1) if a0 <= a1 else (a >= a0) | (a <= a1)
        if vals[1] - vals[0] >= 360:
            sel[:] = True
        return sel
    if kind in ("layer", "inside"):
        try:
            m = d.layer(int(arg)).mask
        except (KeyError, ValueError):
            raise SelError(f"{kind}: no layer {arg!r} (layers {d.layer_ids})")
        if kind == "inside":
            from .ops.morph import filled_outline
            m = filled_outline(m)
        return m.copy()
    if kind == "expr":
        env = {"x": x, "y": y, "cx": ccx, "cy": ccy, "r": np.hypot(x - ccx, y - ccy), "a": _angle(x, y, ccx, ccy),
               "abs": np.abs, "np": np, "W": d.width, "H": d.height}
        if re.search(r"__|import|lambda", arg):
            raise SelError("expr: not allowed")
        try:
            out = eval(arg, {"__builtins__": {}}, env)  # noqa: S307 - local CLI, numpy-only namespace
        except Exception as e:
            raise SelError(f"expr {arg!r}: {e}")
        return np.broadcast_to(np.asarray(out, bool), d.shape).copy()
    raise SelError(f"unknown selection term {term!r} (rect|circle|ring|half|wedge|layer|inside|expr|all, not:, & and |)")


def parse_sel(spec: str | None, d: Design) -> np.ndarray | None:
    """Selection spec -> bool mask (H, W); None for an empty spec."""
    if spec is None or not str(spec).strip():
        return None
    out = np.zeros(d.shape, bool)
    for alt in str(spec).replace(" ", "").split("|"):
        m = np.ones(d.shape, bool)
        for t in alt.split("&"):
            m &= term_mask(t, d)
        out |= m
    return out


def region_sel(region, d: Design) -> np.ndarray:
    x0, y0, x1, y1 = region
    m = np.zeros(d.shape, bool)
    m[max(0, y0):y1 + 1, max(0, x0):x1 + 1] = True
    return m


def confine(before: Design, after: Design, sel: np.ndarray) -> Design:
    """Return ``after`` with every cell outside ``sel`` restored to its ``before`` state (per layer, per group).
    Layers/groups created by the edit keep only their in-selection cells. The canvas size must not change."""
    if before.shape != after.shape:
        raise SelError("this edit changes the canvas size; it cannot be confined to a selection (drop --sel)")
    out = after.copy()
    for layer in out.layers:
        bl = before.layer(layer.id) if before.has_layer(layer.id) else None
        seen = set()
        for g in layer.groups:
            seen.add(g.id)
            prev = None
            if bl is not None:
                prev = next((bg.cells for bg in bl.groups if bg.id == g.id), None)
            prev = np.zeros(out.shape, bool) if prev is None else prev
            g.cells = np.where(sel, g.cells, prev)
        if bl is not None:
            for bg in bl.groups:
                if bg.id not in seen and (bg.cells & ~sel).any():
                    layer.groups.append(type(bg)(bg.id, bg.cells & ~sel))
    for bl in before.layers:  # layers removed by the edit keep their cells outside the selection
        if not out.has_layer(bl.id) and (bl.mask & ~sel).any():
            nl = bl.copy()
            for g in nl.groups:
                g.cells = g.cells & ~sel
            out.layers.append(nl)
    out.layers.sort(key=lambda l: l.id)
    return out
