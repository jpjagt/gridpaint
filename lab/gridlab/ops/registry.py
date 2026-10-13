"""Op registry used by the CLI (`gridlab op FILE NAME k=v ...`) and others.

Two kinds of ops:
- ``kind="mask"``: ``fn(mask: bool[H, W], **kw) -> bool[H, W]``. Applied to every group of every
  target layer (or one ``group``), optionally restricted to an inclusive ``region`` (the op sees
  the cropped sub-mask, so axes/centres are the region's).
- ``kind="design"``: ``fn(design, layer_ids: list[int], **kw) -> Design`` (may mutate and return
  the given copy). Use for cross-layer things (copy-layer, clip-to-below, trim...).

Any module placed in gridlab/ops/ is auto-imported on first registry use. Register with::

    from gridlab.ops.registry import register_op

    @register_op("my-op")
    def my_op(mask, n: int = 2, conn: int = 8):
        \"\"\"One-line description (shown in `gridlab ops`).\"\"\"
        ...

A mask op may declare an ``origin`` parameter: it then receives the absolute (x, y) of the
sub-mask's top-left (non-zero with --region), to interpret absolute coordinates.
Keyword types are inferred from defaults (int/float/bool/str); parameters without defaults are
parsed as int, then float, else str.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Callable

import numpy as np

from ..model import Design, Rect, paste_mask, _window


@dataclass
class OpSpec:
    name: str
    fn: Callable
    kind: str  # "mask" | "design"
    doc: str
    params: list[inspect.Parameter]

    def signature(self) -> str:
        parts = []
        for p in self.params:
            if p.default is inspect.Parameter.empty:
                parts.append(f"{p.name}=?")
            else:
                parts.append(f"{p.name}={p.default}")
        return " ".join(parts)


OPS: dict[str, OpSpec] = {}


def register_op(name: str, kind: str = "mask", doc: str | None = None):
    def deco(fn):
        sig = inspect.signature(fn)
        skip = 1 if kind == "mask" else 2
        params = [p for p in list(sig.parameters.values())[skip:]
                  if p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL) and p.name not in ("origin", "region")]
        d = (doc or inspect.getdoc(fn) or "").strip()
        prev = OPS.get(name)
        if prev is not None and (prev.fn.__module__, prev.fn.__qualname__) != (fn.__module__, fn.__qualname__):
            raise ValueError(f"op {name!r} already registered by {prev.fn.__module__}; pick another name")
        OPS[name] = OpSpec(name, fn, kind, d, params)
        return fn

    return deco


def get_op(name: str) -> OpSpec:
    _ensure_builtin()
    if name not in OPS:
        import difflib

        close = difflib.get_close_matches(name, OPS.keys(), n=3)
        raise KeyError(f"unknown op {name!r}" + (f"; did you mean {', '.join(close)}?" if close else "; see `gridlab ops`"))
    return OPS[name]


def list_ops() -> list[OpSpec]:
    _ensure_builtin()
    return [OPS[k] for k in sorted(OPS)]


def _convert(v: str, default):
    if isinstance(default, bool):
        return v.lower() in ("1", "true", "yes", "y", "on")
    if isinstance(default, int):
        return int(v)
    if isinstance(default, float):
        return float(v)
    if default is None or default is inspect.Parameter.empty:
        for t in (int, float):
            try:
                return t(v)
            except ValueError:
                pass
        if v.lower() in ("true", "false"):
            return v.lower() == "true"
    return v


def parse_kwargs(spec: OpSpec, items: list[str]) -> dict:
    params = {p.name: p for p in spec.params}
    out = {}
    for it in items:
        if "=" not in it:
            raise ValueError(f"expected k=v, got {it!r}; op {spec.name} takes: {spec.signature()}")
        k, v = it.split("=", 1)
        k = k.replace("-", "_")
        if k not in params:
            raise ValueError(f"op {spec.name} has no param {k!r}; takes: {spec.signature() or '(none)'}")
        out[k] = _convert(v, params[k].default)
    return out


# Ops that assume the input is already symmetric and keep it so: on an off-centre design their
# symmetry axes default to the material centre (union bbox of all layers), not the canvas centre.
PRESERVING_SYM_OPS = {"connect", "sym-thin", "break-2x2", "sym-and", "orbit-clean", "lace-clean", "broken-mirror",
                      "grow-coral", "grow-dla", "physarum-link", "noise-fill", "motif"}
# Ops that *create* symmetry by copying one side: they keep the canvas centre (draw a quadrant, mirror it)
# but warn when the material is off-centre.
COPY_SYM_OPS = {"mirror", "symmetrize", "sym-or"}


def material_window(design: Design) -> Rect | None:
    """Window (possibly extending past the canvas) centred on the material bbox centre, covering the
    whole canvas; None when the material is already centred (or the design is empty)."""
    bb = design.bbox()
    if bb is None:
        return None
    x0, y0, x1, y1 = bb
    W, H = design.width, design.height
    sx, sy = x0 + x1, y0 + y1  # 2 * centre
    if sx == W - 1 and sy == H - 1:
        return None
    # half extents in doubled units so .5 centres stay exact
    hx2 = max(sx, 2 * (W - 1) - sx)
    hy2 = max(sy, 2 * (H - 1) - sy)
    if W == H:  # keep square canvases square (d4/rot4 need it)
        hx2 = hy2 = max(hx2, hy2)
    hx2 += (hx2 - sx) % 2  # same parity as 2*centre -> window exactly centred
    hy2 += (hy2 - sy) % 2
    wx0, wx1 = (sx - hx2) // 2, (sx + hx2 + 1) // 2
    wy0, wy1 = (sy - hy2) // 2, (sy + hy2 + 1) // 2
    return wx0, wy0, wx1, wy1


def centre_note(design: Design) -> str | None:
    bb = design.bbox()
    if bb is None:
        return None
    x0, y0, x1, y1 = bb
    if x0 + x1 == design.width - 1 and y0 + y1 == design.height - 1:
        return None
    return (f"material centre {(x0 + x1) / 2:g},{(y0 + y1) / 2:g} != canvas centre {(design.width - 1) / 2:g},"
            f"{(design.height - 1) / 2:g}")


def apply_op(
    design: Design,
    name: str,
    layers: list[int] | None = None,
    group: str | None = None,
    region: Rect | None = None,
    sel: np.ndarray | None = None,
    centre: str = "auto",
    notes: list[str] | None = None,
    **kwargs,
) -> Design:
    """Apply a registered op to a COPY of design and return it. ``layers=None`` = all layers.

    region: the op sees only that inclusive rect (crop; symmetry axes = region centre).
    sel: bool mask; the op runs normally but cells outside ``sel`` are restored afterwards.
    centre: auto|canvas|material - where symmetry axes go for symmetry ops when no region is given
      (auto: material centre for symmetry-preserving ops, canvas centre + a note for copy ops).
    notes: list that receives human-readable notes (e.g. off-centre warnings)."""
    spec = get_op(name)
    notes = notes if notes is not None else []
    original = design
    d = design.copy()
    ids = d.layer_ids if layers is None else [int(i) for i in layers]
    if spec.kind == "design":
        if region is not None:
            if "region" in inspect.signature(spec.fn).parameters:
                kwargs["region"] = region
            else:  # honour the region by confining the edit to it
                from ..selection import region_sel
                rs = region_sel(region, d)
                sel = rs if sel is None else (sel & rs)
        out = spec.fn(d, ids, **kwargs)
        if sel is not None:
            from ..selection import confine
            out = confine(original, out, sel)
        return out
    wants_origin = "origin" in inspect.signature(spec.fn).parameters
    if region is None and centre != "canvas":
        explicit_axis = any(kwargs.get(k, -1) not in (-1, -1.0, None) for k in ("cx", "cy"))
        note = centre_note(d)
        if note and not explicit_axis:
            if name in PRESERVING_SYM_OPS or centre == "material":
                region = material_window(d)
                notes.append(f"{note}: {name} uses symmetry axes through the material centre (pass --centre canvas to override)")
            elif name in COPY_SYM_OPS:
                notes.append(f"WARNING {note}: {name} mirrors about the CANVAS centre; for the material centre pass "
                             f"--centre material (or cx=/cy=), or run `op FILE center` / `op FILE trim` first")
    for lid in ids:
        layer = d.layer(lid)
        targets = [layer.group(group)] if group else layer.groups
        for g in targets:
            if region is None:
                new = spec.fn(g.cells.copy(), **({"origin": (0, 0)} if wants_origin else {}), **kwargs)
                g.cells = np.asarray(new, bool)
            else:
                x0, y0, x1, y1 = region
                sub = _window(g.cells, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
                extra = {"origin": (x0, y0)} if wants_origin else {}
                new = np.asarray(spec.fn(sub.copy(), **extra, **kwargs), bool)
                g.cells = paste_mask(g.cells, new, x0, y0, mode="replace")
            if g.cells.shape != d.shape:
                raise ValueError(f"op {name} changed mask shape {g.cells.shape}")
    if sel is not None:
        from ..selection import confine
        d = confine(original, d, sel)
    return d


_loaded = False


def _ensure_builtin():
    """Import every module in gridlab.ops so their @register_op decorators run.
    New op modules just need to live in gridlab/ops/ (no manual import needed)."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    import importlib
    import pkgutil

    from .. import ops as _pkg

    for mod in pkgutil.iter_modules(_pkg.__path__):
        if not mod.name.startswith("_"):
            importlib.import_module(f"{_pkg.__name__}.{mod.name}")
