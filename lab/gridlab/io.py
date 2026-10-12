"""Load/save designs: gridlab-design JSON, gridpaint-selection JSON, clipboard (macOS).

- ``design_to_dict`` / ``design_from_dict``: gridlab-design v1 (see docs/architecture.md).
- ``selection_to_dict`` / ``design_from_selection``: gridpaint editor clipboard format.
- ``load_any(src)``: src is a path, ``'-'`` (stdin) or ``'clipboard'``; format auto-detected.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from .model import Design, Group, Layer

HISTORY_KEY = "history"


# ---- points <-> masks ---------------------------------------------------

def mask_to_points(mask: np.ndarray, dx: int = 0, dy: int = 0) -> list[str]:
    ys, xs = np.nonzero(mask)
    order = np.lexsort((ys, xs))  # sort by x then y (stable, readable)
    return [f"{int(xs[i]) - dx},{int(ys[i]) - dy}" for i in order]


def parse_point(p: str) -> tuple[int, int]:
    x, y = p.split(",")
    return int(x), int(y)


def points_to_mask(points, width: int, height: int, dx: int = 0, dy: int = 0) -> np.ndarray:
    m = np.zeros((height, width), bool)
    for p in points:
        x, y = parse_point(p) if isinstance(p, str) else p
        x, y = x + dx, y + dy
        if 0 <= x < width and 0 <= y < height:
            m[y, x] = True
    return m


def _groups_to_json(groups: list[Group], dx: int = 0, dy: int = 0) -> list[dict]:
    return [{"id": g.id, "points": mask_to_points(g.cells, dx, dy)} for g in groups]


def _groups_from_json(gs: list[dict], w: int, h: int, dx: int = 0, dy: int = 0) -> list[Group]:
    groups = [Group(str(g.get("id", "default")), points_to_mask(g.get("points", []), w, h, dx, dy)) for g in gs]
    return groups or [Group("default", np.zeros((h, w), bool))]


# ---- gridlab-design -----------------------------------------------------

def design_to_dict(d: Design, include_history: bool = False, include_frames: bool = True) -> dict:
    out = {
        "type": "gridlab-design",
        "version": 1,
        "id": d.id,
        "title": d.title,
        "recipe": d.recipe,
        "params": d.params,
        "seed": d.seed,
        "tags": list(d.tags),
        "notes": d.notes,
        "width": d.width,
        "height": d.height,
        "layers": [{"id": l.id, "groups": _groups_to_json(l.groups)} for l in d.layers_bottom_to_top()],
    }
    if include_frames and d.frames:
        out["frames"] = [
            {"label": lab, "layers": [{"id": k, "groups": _groups_to_json(gs)} for k, gs in sorted(fl.items(), key=lambda kv: -kv[0])]}
            for lab, fl in d.frames
        ]
    if include_history and d.history:
        out[HISTORY_KEY] = d.history
    return out


def design_from_dict(obj: dict) -> Design:
    if obj.get("type") == "gridpaint-selection":
        return design_from_selection(obj)
    if obj.get("type") not in (None, "gridlab-design"):
        raise ValueError(f"not a gridlab-design: type={obj.get('type')!r}")
    w, h = int(obj["width"]), int(obj["height"])
    layers = [Layer(int(l["id"]), _groups_from_json(l.get("groups", []), w, h)) for l in obj.get("layers", [])]
    frames = [
        (f.get("label", str(i)), {int(l["id"]): _groups_from_json(l.get("groups", []), w, h) for l in f.get("layers", [])})
        for i, f in enumerate(obj.get("frames", []) or [])
    ]
    return Design(
        width=w, height=h, layers=layers, id=obj.get("id", "design"), title=obj.get("title", ""),
        recipe=obj.get("recipe", "manual"), params=obj.get("params", {}) or {}, seed=obj.get("seed"),
        tags=list(obj.get("tags", []) or []), notes=obj.get("notes", "") or "", frames=frames,
        history=list(obj.get(HISTORY_KEY, []) or []),
    )


def save_design(d: Design, path: str | Path, include_history: bool = True) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(design_to_dict(d, include_history=include_history), separators=(",", ":")))
    return path


def load_design(path: str | Path) -> Design:
    return design_from_dict(json.loads(Path(path).read_text()))


# ---- gridpaint-selection ------------------------------------------------

def design_from_selection(obj: dict, **meta) -> Design:
    """Selection points are relative to bounds min; the design canvas is the bounds box
    (grown if points fall outside it). Groups are preserved."""
    data = obj["data"]
    b = data.get("bounds") or {}
    pts = [parse_point(p) for l in data["layers"] for g in l.get("groups", []) for p in g.get("points", [])]
    if not pts and not b:
        raise ValueError("empty selection")
    xs = [p[0] for p in pts] or [0]
    ys = [p[1] for p in pts] or [0]
    bw = int(b.get("maxX", 0)) - int(b.get("minX", 0)) + 1 if b else 1
    bh = int(b.get("maxY", 0)) - int(b.get("minY", 0)) + 1 if b else 1
    ox, oy = -min(0, min(xs)), -min(0, min(ys))
    w = max(bw, max(xs) + 1) + ox
    h = max(bh, max(ys) + 1) + oy
    layers = [Layer(int(l["layerId"]), _groups_from_json(l.get("groups", []), w, h, ox, oy)) for l in data["layers"]]
    meta.setdefault("recipe", "sample")
    return Design(width=w, height=h, layers=layers, **meta)


def selection_to_dict(d: Design, trim: bool = True) -> dict:
    """gridpaint-selection JSON. With ``trim`` the bounds are the union bbox of all material."""
    bb = d.bbox() if trim else None
    if bb is None:
        bb = (0, 0, d.width - 1, d.height - 1)
    x0, y0, x1, y1 = bb
    return {
        "type": "gridpaint-selection",
        "version": "2.0.0",
        "data": {
            "layers": [
                {"layerId": l.id, "groups": _groups_to_json([g for g in l.groups if g.cells.any()] or l.groups[:1], x0, y0)}
                for l in d.layers_bottom_to_top()
            ],
            "bounds": {"minX": x0, "minY": y0, "maxX": x1, "maxY": y1},
            "timestamp": int(time.time() * 1000),
        },
    }


def to_selection_json(d: Design, trim: bool = True) -> str:
    return json.dumps(selection_to_dict(d, trim), separators=(",", ":"))


# ---- clipboard / generic -----------------------------------------------

def copy_to_clipboard(text: str) -> None:
    subprocess.run(["pbcopy"], input=text.encode(), check=True)


def read_clipboard() -> str:
    return subprocess.run(["pbpaste"], capture_output=True, check=True).stdout.decode()


def loads_any(text: str) -> Design:
    obj = json.loads(text)
    t = obj.get("type")
    if t == "gridpaint-selection":
        return design_from_selection(obj)
    if t in ("gridlab-design", None) and "layers" in obj:
        return design_from_dict(obj)
    raise ValueError(f"unrecognised JSON type {t!r} (expected gridlab-design or gridpaint-selection)")


def load_any(src: str | Path) -> Design:
    """Load from a path, '-' (stdin) or 'clipboard'. Detects the format."""
    s = str(src)
    if s == "-":
        return loads_any(sys.stdin.read())
    if s == "clipboard":
        return loads_any(read_clipboard())
    d = loads_any(Path(s).read_text())
    if d.recipe == "sample" and d.id == "design":
        d.id = Path(s).stem
    return d
