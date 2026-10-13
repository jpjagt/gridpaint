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


def apply_op(
    design: Design,
    name: str,
    layers: list[int] | None = None,
    group: str | None = None,
    region: Rect | None = None,
    **kwargs,
) -> Design:
    """Apply a registered op to a COPY of design and return it. ``layers=None`` = all layers."""
    spec = get_op(name)
    d = design.copy()
    ids = d.layer_ids if layers is None else [int(i) for i in layers]
    if spec.kind == "design":
        if region is not None and "region" in inspect.signature(spec.fn).parameters:
            kwargs["region"] = region
        return spec.fn(d, ids, **kwargs)
    wants_origin = "origin" in inspect.signature(spec.fn).parameters
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
