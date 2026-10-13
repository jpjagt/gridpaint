"""Compact, LLM-oriented text description of a design (``gl describe FILE``).

Per layer: silhouette class (best IoU fit of capsule/oval/circle/diamond/rect/shield, or ring), bbox,
symmetry in words, density bucket, pieces/holes, notable features (rim/frame, central motif, groups).
Then relations between layers (inside / covers centre / rings around / support). Code-only heuristics.
"""

from __future__ import annotations

import numpy as np

from . import metrics as MX
from .model import Design, mask_bbox
from .ops import masks as M
from .ops import morph


def _iou(a, b) -> float:
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def hull(m: np.ndarray, n: int = 1) -> np.ndarray:
    """Filled silhouette: close small gaps, fill holes."""
    return morph.fill_holes(morph.close(m, n, 8))


def is_strokes(m: np.ndarray) -> bool:
    """No solid 2x2 block anywhere (1-cell strokes)."""
    b = m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]
    return bool(m.any()) and not b.any()


def silhouette(m: np.ndarray) -> tuple[str, float]:
    bb = mask_bbox(m)
    if bb is None:
        return "empty", 0.0
    x0, y0, x1, y1 = bb
    sub = m[y0:y1 + 1, x0:x1 + 1]
    h, w = sub.shape
    if h * w <= 4:
        return "dot" if sub.sum() <= 2 else "speck", 1.0
    hl = hull(sub)
    if is_strokes(sub) and morph.label(sub, 8)[1] == 1 and MX.count_holes(sub) <= 1:
        e, _j = morph.skeleton_points(sub)
        name = {0: "loop", 1: "line/curve", 2: "line/curve", 3: "T/Y figure", 4: "cross/X figure"}.get(e)
        if name:
            return name, 1.0
    aspect = max(h, w) / max(1, min(h, w))
    fits = {
        "oval" if aspect > 1.15 else "circle": M.ellipse(h, w),
        "capsule": M.capsule(h, w),
        "diamond": M.diamond(h, w),
        "rect": np.ones((h, w), bool),
        "shield": M.shield(h, w),
    }
    if aspect >= 3:
        fits["bar"] = np.ones((h, w), bool)
        fits.pop("rect")
    scores = {k: _iou(hl, v) for k, v in fits.items()}
    best = max(scores, key=scores.get)
    # ring: the material leaves a big open centre (not just lace holes)
    filled = hull(sub, 2)
    centre = np.zeros_like(sub)
    centre[h // 3:h - h // 3, w // 3:w - w // 3] = True
    if centre.any() and (sub & centre).sum() / centre.sum() < 0.08 and (filled & centre).mean() > 0.9:
        base = best if best in ("circle", "oval", "diamond", "rect") else "oval"
        return f"{base} ring", scores[best]
    if scores[best] < 0.62:
        return ("scattered" if morph.label(sub, 8)[1] > 3 else "irregular"), scores[best]
    return best, scores[best]


STROKE_NAMES = {"loop", "line/curve", "T/Y figure", "cross/X figure"}


def sym_words(s: dict) -> str:
    t = 0.9
    x, y, r2, r4, dg = s["x"] >= t, s["y"] >= t, s["rot180"] >= t, s["rot90"] >= t, s["diag"] >= t
    if x and y and r4:
        return "4-fold (d4: mirrors + quarter turn)"
    if r4:
        return "4-fold rotational (no mirrors)"
    if x and y:
        return "mirror L-R and T-B (d2)"
    if x:
        return "mirror L-R" + (" (T-B differs)" if s["y"] < 0.75 else " (T-B nearly)")
    if y:
        return "mirror T-B" + (" (L-R differs)" if s["x"] < 0.75 else " (L-R nearly)")
    if r2:
        return "2-fold rotational only"
    if dg:
        return "diagonal mirror only"
    best = max(("L-R", s["x"]), ("T-B", s["y"]), ("rot180", s["rot180"]), key=lambda kv: kv[1])
    return f"asymmetric (best {best[0]} {best[1]:.2f})"


def density_word(cells: int, hull_cells: int) -> str:
    f = cells / max(1, hull_cells)
    word = ("solid" if f > 0.85 else "dense" if f > 0.6 else "medium" if f > 0.4 else "lacy" if f > 0.22 else "airy/sparse")
    return f"{word} ({f:.2f} of its outline)"


def features(m: np.ndarray, holes: int) -> list[str]:
    out = []
    hl = hull(m)
    if not hl.any():
        return out
    rim = hl & ~morph.erode(hl, 1, 8)
    if (rim.sum() >= 8 and (m & rim).sum() / rim.sum() > 0.8 and m.sum() > 1.3 * rim.sum()
            and morph.label(m & rim, 8)[1] <= 2):
        out.append("closed rim/frame")
    bb = mask_bbox(m)
    x0, y0, x1, y1 = bb
    h, w = y1 - y0 + 1, x1 - x0 + 1
    if min(h, w) >= 7:
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ry, rx = max(1, h // 5), max(1, w // 5)
        c = np.zeros_like(m)
        c[int(cy - ry + 0.5):int(cy + ry) + 1, int(cx - rx + 0.5):int(cx + rx) + 1] = True
        lab, n = morph.label(m, 8)
        ids = set(np.unique(lab[c & m])) - {0}
        if ids:
            if any(not (lab == i)[rim].any() for i in ids):
                out.append("separate central motif")
            elif (m & c).sum() / c.sum() > 0.5:
                out.append("solid centre")
        else:
            out.append("open centre")
    if holes:
        out.append(f"{holes} holes")
    iso = int((m & (morph.neighbour_count(m, 8) == 0)).sum())
    if iso:
        out.append(f"{iso} isolated cells")
    return out


def relations(d: Design) -> list[str]:
    ordered = d.layers_top_to_bottom()
    masks = {l.id: l.mask for l in ordered}
    hulls = {k: hull(m, 2) for k, m in masks.items()}
    out = []
    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            ma, mb = masks[a.id], masks[b.id]
            if not ma.any() or not mb.any():
                continue
            inside = (ma & hulls[b.id]).sum() / ma.sum()
            over = (ma & mb).sum() / ma.sum()
            parts = []
            if b is ordered[i + 1]:
                parts.append(f"support {over:.2f}")
            if inside > 0.97:
                parts.append(f"inside L{b.id}'s outline")
            elif inside < 0.3:
                parts.append(f"mostly outside L{b.id}'s outline ({inside:.2f})")
            else:
                parts.append(f"{inside:.0%} inside L{b.id}'s outline")
            # ring-around: b is ring-like and a sits in b's open centre
            hole_b = hulls[b.id] & ~mb
            if (ma & hole_b).sum() / ma.sum() > 0.6 and not (ma & mb).any():
                parts.append(f"floats in L{b.id}'s opening (L{b.id} rings around it)")
            ba, bb = mask_bbox(ma), mask_bbox(mb)
            if ba and bb:
                ca = ((ba[0] + ba[2]) / 2, (ba[1] + ba[3]) / 2)
                cb = ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
                if abs(ca[0] - cb[0]) <= 0.5 and abs(ca[1] - cb[1]) <= 0.5:
                    parts.append("concentric")
                else:
                    parts.append(f"offset {ca[0] - cb[0]:+g},{ca[1] - cb[1]:+g} from L{b.id} centre")
                area = (ba[2] - ba[0] + 1) * (ba[3] - ba[1] + 1) / ((bb[2] - bb[0] + 1) * (bb[3] - bb[1] + 1))
                parts.append(f"bbox {area:.0%} of L{b.id}'s")
            if b is ordered[i + 1] or (i == 0 and b is ordered[-1]):
                out.append(f"L{a.id} vs L{b.id}: " + ", ".join(parts))
    return out


def describe(d: Design, name: str | None = None) -> str:
    ordered = d.layers_top_to_bottom()
    union = d.union_mask()
    sil, fit = silhouette(union)
    lines = [f"{name or d.id}: {d.width}x{d.height}, {len(ordered)} layer(s) (L{ordered[0].id} top .. L{ordered[-1].id} bottom)"
             + (f", title {d.title!r}" if d.title and d.title != (name or '').removesuffix('.json') else "")]
    n_empty = sum(1 for l in ordered if not l.mask.any())
    if union.any():
        um = MX.mask_metrics(union, skeleton=False)
        lines.append(f"overall: {sil} silhouette (fit {fit:.2f}), {sym_words(um['sym'])}, "
                     f"{um['comps8']} piece(s)" + (f"; {n_empty} empty layer(s)" if n_empty else ""))
        note = None
        bb = d.bbox()
        if bb and (bb[0] + bb[2] != d.width - 1 or bb[1] + bb[3] != d.height - 1):
            note = f"material centre {(bb[0] + bb[2]) / 2:g},{(bb[1] + bb[3]) / 2:g} is off the canvas centre " \
                   f"{(d.width - 1) / 2:g},{(d.height - 1) / 2:g} (symmetry ops: --centre / `op FILE center`)"
        if note:
            lines.append("note: " + note)
    for i, l in enumerate(ordered):
        m = l.mask
        role = "top" if i == 0 else "bottom" if i == len(ordered) - 1 else "mid"
        if not m.any():
            lines.append(f"L{l.id} ({role}): empty")
            continue
        mm = MX.mask_metrics(m, skeleton=False)
        x0, y0, x1, y1 = mm["bbox"]
        s, f = silhouette(m)
        feats = features(m, mm["holes"])
        ng = sum(1 for g in l.groups if g.cells.any())
        if ng > 1:
            feats.append(f"{ng} connectivity groups (blobs don't bridge across groups)")
        lines.append(
            f"L{l.id} ({role}): {s} (fit {f:.2f}), bbox {x0},{y0}..{x1},{y1} ({x1 - x0 + 1}x{y1 - y0 + 1}), {mm['cells']}c, "
            f"{'1-cell strokes' if is_strokes(m) and s in STROKE_NAMES else density_word(mm['cells'], int(hull(m).sum()))}; {sym_words(mm['sym'])}; {mm['comps8']} piece(s)"
            + (f"; {', '.join(feats)}" if feats else ""))
    lines += relations(d)
    return "\n".join(lines[:25])
