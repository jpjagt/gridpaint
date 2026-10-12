"""Core data model: Design / Layer / Group.

Conventions (see docs/architecture.md):
- numpy masks are bool arrays indexed ``a[y, x]`` with shape ``(H, W)``; y grows downward.
- Layer ids follow gridpaint: lower id = physically higher (top). Bottom/back plate = highest id.
- A layer holds >= 1 group; groups only scope blob connectivity (rendering). The layer's
  material is the union of its groups (``Layer.mask``).
- Rectangles/regions in this API are **inclusive**: ``(x0, y0, x1, y1)``.
"""

from __future__ import annotations

import copy as _copy
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Union

import numpy as np

Rect = tuple[int, int, int, int]  # inclusive x0, y0, x1, y1
MaskOrGroups = Union[np.ndarray, list["Group"]]


def _as_mask(a, shape: tuple[int, int] | None = None) -> np.ndarray:
    m = np.asarray(a, dtype=bool)
    if m.ndim != 2:
        raise ValueError(f"mask must be 2D, got shape {m.shape}")
    if shape is not None and m.shape != shape:
        raise ValueError(f"mask shape {m.shape} != design shape {shape}")
    return m


@dataclass
class Group:
    """A connectivity group: cells only blob-merge with cells of the same group."""

    id: str
    cells: np.ndarray  # bool (H, W)

    def __post_init__(self):
        self.cells = _as_mask(self.cells)

    def copy(self) -> "Group":
        return Group(self.id, self.cells.copy())


@dataclass
class Layer:
    id: int
    groups: list[Group] = field(default_factory=list)

    @staticmethod
    def from_mask(layer_id: int, mask: np.ndarray, group_id: str = "default") -> "Layer":
        return Layer(int(layer_id), [Group(group_id, _as_mask(mask).copy())])

    @property
    def mask(self) -> np.ndarray:
        """Union of all groups (the physical material of this layer)."""
        if not self.groups:
            raise ValueError(f"layer {self.id} has no groups")
        out = self.groups[0].cells.copy()
        for g in self.groups[1:]:
            out |= g.cells
        return out

    @property
    def shape(self) -> tuple[int, int]:
        return self.groups[0].cells.shape

    def group(self, gid: str, create: bool = False) -> Group:
        for g in self.groups:
            if g.id == gid:
                return g
        if not create:
            raise KeyError(f"layer {self.id} has no group {gid!r} (has {[g.id for g in self.groups]})")
        g = Group(gid, np.zeros(self.shape, dtype=bool))
        self.groups.append(g)
        return g

    @property
    def default(self) -> Group:
        """The 'default' group (created if missing; requires >= 1 existing group for the shape)."""
        return self.group("default", create=True)

    def set_mask(self, mask: np.ndarray) -> None:
        """Replace all groups by a single 'default' group holding ``mask``."""
        self.groups = [Group("default", _as_mask(mask).copy())]

    def merge_groups(self) -> None:
        self.set_mask(self.mask)

    def copy(self) -> "Layer":
        return Layer(self.id, [g.copy() for g in self.groups])

    @property
    def count(self) -> int:
        return int(self.mask.sum())


def _groups_from(value: MaskOrGroups, shape: tuple[int, int] | None = None) -> list[Group]:
    if isinstance(value, Layer):
        return [g.copy() for g in value.groups]
    if isinstance(value, list) and (not value or isinstance(value[0], Group)):
        return [Group(g.id, _as_mask(g.cells, shape).copy()) for g in value]
    return [Group("default", _as_mask(value, shape).copy())]


@dataclass
class Design:
    width: int
    height: int
    layers: list[Layer] = field(default_factory=list)
    id: str = "design"
    title: str = ""
    recipe: str = "manual"
    params: dict = field(default_factory=dict)
    seed: int | None = None
    tags: list[str] = field(default_factory=list)
    notes: str = ""
    # frames: list of (label, {layer_id: mask | list[Group]}); normalized to list[Group]
    frames: list[tuple[str, dict[int, list[Group]]]] = field(default_factory=list)
    # CLI edit history (list of dicts); only persisted in workspace files
    history: list[dict] = field(default_factory=list)

    def __post_init__(self):
        self.width = int(self.width)
        self.height = int(self.height)
        for layer in self.layers:
            for g in layer.groups:
                _as_mask(g.cells, self.shape)
        self.layers.sort(key=lambda l: l.id)
        self.frames = [
            (str(label), {int(k): _groups_from(v, self.shape) for k, v in fl.items()})
            for label, fl in self.frames
        ]

    # ---- construction -------------------------------------------------
    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)

    @staticmethod
    def from_masks(masks: Mapping[int, MaskOrGroups], **meta) -> "Design":
        """Build from ``{layer_id: mask | list[Group]}``. All masks must share a shape."""
        if not masks:
            raise ValueError("from_masks needs at least one layer")
        layers = [Layer(int(k), _groups_from(v)) for k, v in masks.items()]
        h, w = layers[0].shape
        return Design(width=w, height=h, layers=layers, **meta)

    @staticmethod
    def empty(width: int, height: int, layer_ids: Iterable[int] = (1,), **meta) -> "Design":
        return Design(width, height, [Layer.from_mask(i, np.zeros((height, width), bool)) for i in layer_ids], **meta)

    # ---- access -------------------------------------------------------
    @property
    def layer_ids(self) -> list[int]:
        return [l.id for l in self.layers]

    def layers_top_to_bottom(self) -> list[Layer]:
        """Physically top first (lowest id first)."""
        return sorted(self.layers, key=lambda l: l.id)

    def layers_bottom_to_top(self) -> list[Layer]:
        """Paint order (highest id first)."""
        return sorted(self.layers, key=lambda l: -l.id)

    def layer(self, layer_id: int, create: bool = False) -> Layer:
        for l in self.layers:
            if l.id == int(layer_id):
                return l
        if not create:
            raise KeyError(f"no layer {layer_id} (layers: {self.layer_ids})")
        l = Layer.from_mask(int(layer_id), np.zeros(self.shape, bool))
        self.layers.append(l)
        self.layers.sort(key=lambda l: l.id)
        return l

    def has_layer(self, layer_id: int) -> bool:
        return int(layer_id) in self.layer_ids

    def remove_layer(self, layer_id: int) -> None:
        self.layers = [l for l in self.layers if l.id != int(layer_id)]

    def masks(self) -> dict[int, np.ndarray]:
        return {l.id: l.mask for l in self.layers}

    def union_mask(self) -> np.ndarray:
        out = np.zeros(self.shape, bool)
        for l in self.layers:
            out |= l.mask
        return out

    def copy(self) -> "Design":
        return Design(
            self.width, self.height, [l.copy() for l in self.layers], self.id, self.title, self.recipe,
            _copy.deepcopy(self.params), self.seed, list(self.tags), self.notes,
            [(lab, {k: [g.copy() for g in gs] for k, gs in fl.items()}) for lab, fl in self.frames],
            _copy.deepcopy(self.history),
        )

    # ---- geometry -----------------------------------------------------
    def _map_cells(self, fn, new_w: int, new_h: int) -> None:
        for l in self.layers:
            for g in l.groups:
                g.cells = fn(g.cells)
        for _, fl in self.frames:
            for gs in fl.values():
                for g in gs:
                    g.cells = fn(g.cells)
        self.width, self.height = new_w, new_h

    def bbox(self, layer_id: int | None = None) -> Rect | None:
        """Inclusive bbox (x0, y0, x1, y1) of all material (or of one layer); None if empty."""
        m = self.layer(layer_id).mask if layer_id is not None else self.union_mask()
        return mask_bbox(m)

    def crop(self, x0: int, y0: int, x1: int, y1: int) -> "Design":
        """In place crop to inclusive rect; area outside the canvas is padded with empty. Returns self."""
        w, h = x1 - x0 + 1, y1 - y0 + 1
        if w <= 0 or h <= 0:
            raise ValueError("empty crop")
        self._map_cells(lambda m: _window(m, x0, y0, w, h), w, h)
        return self

    def pad(self, left: int = 0, top: int = 0, right: int = 0, bottom: int = 0) -> "Design":
        """In place: add empty margin (negative values crop). Returns self."""
        return self.crop(-left, -top, self.width - 1 + right, self.height - 1 + bottom)

    def translate(self, dx: int, dy: int) -> "Design":
        """In place: move all cells by (dx, dy); cells leaving the canvas are dropped. Returns self."""
        self._map_cells(lambda m: shift_mask(m, dx, dy), self.width, self.height)
        return self

    def trim(self, margin: int = 0) -> "Design":
        """In place: crop to the bbox of all material plus ``margin`` cells. Returns self."""
        bb = self.bbox()
        if bb is None:
            return self
        x0, y0, x1, y1 = bb
        return self.crop(x0 - margin, y0 - margin, x1 + margin, y1 + margin)

    def resize(self, width: int, height: int, anchor: str = "center") -> "Design":
        """In place: change canvas size keeping content anchored ('center' or 'topleft')."""
        if anchor == "center":
            x0 = -((width - self.width) // 2)
            y0 = -((height - self.height) // 2)
        else:
            x0 = y0 = 0
        return self.crop(x0, y0, x0 + width - 1, y0 + height - 1)

    def paste(self, src: "Design", x: int = 0, y: int = 0, layer_map: Mapping[int, int] | None = None,
              mode: str = "or") -> "Design":
        """In place: place ``src`` with its top-left at (x, y). ``layer_map`` maps src layer id -> own
        layer id (identity by default; missing layers are created). Groups merge by id.
        mode: 'or' (add), 'replace' (target layers cleared first), 'area' (target layers cleared
        inside the pasted rectangle first). Returns self."""
        layer_map = dict(layer_map or {})
        for sl in src.layers:
            dl = self.layer(layer_map.get(sl.id, sl.id), create=True)
            if mode == "replace":
                for g in dl.groups:
                    g.cells[:] = False
            elif mode == "area":
                box = np.ones(src.shape, bool)
                for g in dl.groups:
                    g.cells = paste_mask(g.cells, box, x, y, "clear")
            elif mode != "or":
                raise ValueError("paste mode: or|replace|area")
            for g in sl.groups:
                dg = dl.group(g.id, create=True)
                dg.cells = paste_mask(dg.cells, g.cells, x, y, "or")
        return self

    def __repr__(self) -> str:
        ls = ", ".join(f"L{l.id}:{l.count}" for l in self.layers_top_to_bottom())
        return f"Design({self.id!r} {self.width}x{self.height} [{ls}])"


# ---- free helpers ------------------------------------------------------

def mask_bbox(m: np.ndarray) -> Rect | None:
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _window(m: np.ndarray, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    """Extract an (h, w) window at (x0, y0) from m, padding outside with False."""
    out = np.zeros((h, w), bool)
    H, W = m.shape
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + w, W), min(y0 + h, H)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = m[sy0:sy1, sx0:sx1]
    return out


def shift_mask(m: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """Shift without wrap-around."""
    H, W = m.shape
    return _window(m, -dx, -dy, W, H)


def paste_mask(dst: np.ndarray, src: np.ndarray, x: int, y: int, mode: str = "or") -> np.ndarray:
    """Return dst with src placed with its top-left at (x, y). mode: or|replace|and|xor|clear."""
    out = dst.copy()
    H, W = dst.shape
    region = _window(dst, x, y, src.shape[1], src.shape[0])
    if mode == "or":
        new = region | src
    elif mode == "replace":
        new = src.copy()
    elif mode == "and":
        new = region & src
    elif mode == "xor":
        new = region ^ src
    elif mode == "clear":
        new = region & ~src
    else:
        raise ValueError(f"unknown paste mode {mode!r}")
    sx0, sy0 = max(x, 0), max(y, 0)
    sx1, sy1 = min(x + src.shape[1], W), min(y + src.shape[0], H)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0:sy1, sx0:sx1] = new[sy0 - y:sy1 - y, sx0 - x:sx1 - x]
    return out
