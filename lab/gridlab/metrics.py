"""Design metrics (per layer and cross-layer) + compact text summary for humans/LLMs.

- ``mask_metrics(mask) -> dict``: cells, bbox, density, comps8/comps4, holes, sym{x,y,rot180,rot90,diag},
  perimeter, edge_ratio, isolated, endpoints, junctions.
- ``design_metrics(design) -> dict``: {"layers": {id: mask_metrics}, "pairs": [cross-layer...]}.
- ``summary_text(design)``: compact report.
- ``compact(design)`` / ``delta_text(before, after)``: tiny per-layer stats used by the CLI.

Symmetry scores are IoU of the layer with its transform about the layer's bbox centre
(rot90/diag pad the bbox to a square first). 1.0 = perfectly symmetric.
Cross-layer "support" = fraction of the upper layer's cells sitting on cells of the layer directly
beneath (higher id). Physically each upper cell should rest on material, so ~1.0 is good.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from .model import Design, mask_bbox
from .ops import morph


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def symmetry_scores(mask: np.ndarray) -> dict[str, float]:
    bb = mask_bbox(mask)
    if bb is None:
        return {k: 1.0 for k in ("x", "y", "rot180", "rot90", "diag")}
    x0, y0, x1, y1 = bb
    m = mask[y0:y1 + 1, x0:x1 + 1]
    h, w = m.shape
    n = max(h, w)
    sq = np.zeros((n, n), bool)
    oy, ox = (n - h) // 2, (n - w) // 2
    sq[oy:oy + h, ox:ox + w] = m
    return {
        "x": _iou(m, m[:, ::-1]),
        "y": _iou(m, m[::-1, :]),
        "rot180": _iou(m, m[::-1, ::-1]),
        "rot90": _iou(sq, np.rot90(sq)),
        "diag": _iou(sq, sq.T),
    }


def count_holes(mask: np.ndarray) -> int:
    """Background regions (4-connected) not touching the canvas border."""
    bg = ~np.pad(mask.astype(bool), 1)
    lab, n = ndimage.label(bg, morph.structure(4))
    return max(0, n - 1) if n else 0  # the padded border region is one component


def perimeter(mask: np.ndarray) -> int:
    p = np.pad(mask.astype(bool), 1)
    c = p[1:-1, 1:-1]
    return int(sum((c & ~p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx]).sum()
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))))


def mask_metrics(mask: np.ndarray, skeleton: bool = True) -> dict:
    m = np.asarray(mask, bool)
    cells = int(m.sum())
    bb = mask_bbox(m)
    out: dict = {"cells": cells, "bbox": bb}
    if bb is None:
        out.update(density=0.0, comps8=0, comps4=0, holes=0, sym=symmetry_scores(m), perimeter=0,
                   edge_ratio=0.0, isolated=0, endpoints=0, junctions=0)
        return out
    x0, y0, x1, y1 = bb
    out["density"] = cells / ((x1 - x0 + 1) * (y1 - y0 + 1))
    out["comps8"] = int(morph.label(m, 8)[1])
    out["comps4"] = int(morph.label(m, 4)[1])
    out["holes"] = count_holes(m)
    out["sym"] = symmetry_scores(m)
    per = perimeter(m)
    out["perimeter"] = per
    out["edge_ratio"] = per / cells
    out["isolated"] = int((m & (morph.neighbour_count(m, 8) == 0)).sum())
    if skeleton:
        e, j = morph.skeleton_points(m)
        out["endpoints"], out["junctions"] = e, j
    return out


def rendered_support(upper, lower, px: int = 6) -> float:
    """Fraction of the upper layer's *rendered blob area* lying over the lower layer's rendered
    area. ``upper``/``lower``: masks or list[Group]. More physical than cell support, since blobs
    bridge diagonals and round corners."""
    from .render import layer_alpha

    a = layer_alpha(upper, px, ss=2) > 0.5
    b = layer_alpha(lower, px, ss=2) > 0.5
    n = a.sum()
    return float((a & b).sum() / n) if n else 1.0


def pair_metrics(upper: np.ndarray, lower: np.ndarray, rendered: bool = True) -> dict:
    u, l = upper.sum(), lower.sum()
    return {
        "support": float((upper & lower).sum() / u) if u else 1.0,
        **({"support_area": rendered_support(upper, lower)} if rendered else {}),
        "unsupported": int((upper & ~lower).sum()),
        "iou": _iou(upper, lower),
        "area_ratio": float(u / l) if l else float("inf"),
    }


def design_metrics(design: Design, skeleton: bool = True) -> dict:
    ordered = design.layers_top_to_bottom()
    masks = {l.id: l.mask for l in ordered}
    pairs = []
    for a, b in zip(ordered, ordered[1:]):
        pm = pair_metrics(masks[a.id], masks[b.id], rendered=False)
        pm["support_area"] = rendered_support(a.groups, b.groups)
        pairs.append({"upper": a.id, "lower": b.id, **pm})
    return {"layers": {lid: mask_metrics(m, skeleton) for lid, m in masks.items()}, "pairs": pairs}


def _sym_str(s: dict) -> str:
    return " ".join(f"{k}={v:.2f}" for k, v in s.items())


def summary_text(design: Design, metrics: dict | None = None) -> str:
    md = metrics or design_metrics(design)
    lines = []
    for lid, m in md["layers"].items():
        if m["bbox"] is None:
            lines.append(f"L{lid}: empty")
            continue
        x0, y0, x1, y1 = m["bbox"]
        lines.append(
            f"L{lid}: {m['cells']}c bbox {x0},{y0}..{x1},{y1} ({x1 - x0 + 1}x{y1 - y0 + 1}) dens {m['density']:.2f} | "
            f"pieces8 {m['comps8']} (4conn {m['comps4']}) holes {m['holes']} isolated {m['isolated']} | "
            f"edge/cell {m['edge_ratio']:.2f} ends {m.get('endpoints', '-')} junc {m.get('junctions', '-')} | "
            f"sym {_sym_str(m['sym'])}"
        )
    for p in md["pairs"]:
        lines.append(
            f"L{p['upper']} on L{p['lower']}: support cells {p['support']:.2f} ({p['unsupported']} cells not over L{p['lower']}), "
            f"rendered area {p['support_area']:.2f} | iou {p['iou']:.2f} area ratio {p['area_ratio']:.2f}"
        )
    return "\n".join(lines)


# ---- compact stats + deltas for CLI ----------------------------------------------

def compact(design: Design) -> dict:
    out = {}
    ordered = design.layers_top_to_bottom()
    for i, l in enumerate(ordered):
        m = l.mask
        s = symmetry_scores(m)
        d = {"cells": int(m.sum()), "pieces": int(morph.label(m, 8)[1]), "holes": count_holes(m),
             "symx": s["x"], "symy": s["y"]}
        if i + 1 < len(ordered):
            d["support"] = pair_metrics(m, ordered[i + 1].mask, rendered=False)["support"]
        out[l.id] = d
    return out


def delta_text(before: dict, after: dict) -> str:
    """One line per layer that changed (or every layer if nothing changed: 'no change')."""
    lines = []
    for lid in sorted(set(before) | set(after)):
        a, b = before.get(lid), after.get(lid)
        if a is None:
            lines.append(f"  L{lid}: new layer, {b['cells']}c")
            continue
        if b is None:
            lines.append(f"  L{lid}: removed")
            continue
        if a == b:
            continue
        parts = [f"cells {a['cells']}->{b['cells']} ({b['cells'] - a['cells']:+d})" if a["cells"] != b["cells"] else f"cells {b['cells']}"]
        for k in ("pieces", "holes"):
            parts.append(f"{k} {a[k]}->{b[k]}" if a[k] != b[k] else f"{k} {b[k]}")
        parts.append(f"symx {b['symx']:.2f} symy {b['symy']:.2f}")
        if "support" in b:
            parts.append(f"support {b['support']:.2f}")
        lines.append(f"  L{lid}: " + ", ".join(parts))
    return "\n".join(lines) if lines else "  (no change)"
