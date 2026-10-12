"""Recipe registry: named, parameterised, seeded generators that return a Design.

Write a recipe in any module inside ``gridlab/recipes/`` (auto-imported)::

    from gridlab.recipes import recipe, Param, register_section
    from gridlab.model import Design

    register_section("growth", "Growth", "Diffusion-limited aggregation, ...")

    @recipe("dla_ring", section="growth", title="DLA ring",
            description="Particles stick to a seed ring", tags=["growth", "d2"],
            params={"size": Param(24, 8, 64, 1), "sym": Param("d2", choices=["none", "d2", "d4"])})
    def dla_ring(seed: int, size: int, sym: str) -> Design:
        rng = np.random.default_rng(seed)
        ...
        return Design.from_masks({1: mask})

``run_recipe(name, params, seed)`` fills defaults, validates/coerces params, then sets
design.id / recipe / params / seed / title / tags (unless the recipe set them).
Layer ids: 1 = top. Frames (growth snapshots) may be set on the returned design.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import pkgutil
from dataclasses import dataclass, field
from typing import Any, Callable

from ..model import Design


@dataclass
class Param:
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    choices: list | None = None
    type: str | None = None  # "int" | "float" | "bool" | "str" | "choice"; inferred if None
    description: str = ""

    def __post_init__(self):
        if self.type is None:
            if self.choices is not None:
                self.type = "choice"
            elif isinstance(self.default, bool):
                self.type = "bool"
            elif isinstance(self.default, int):
                self.type = "int"
            elif isinstance(self.default, float):
                self.type = "float"
            else:
                self.type = "str"

    def coerce(self, v):
        if self.type == "bool":
            return v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes", "on")
        if self.type == "int":
            v = int(round(float(v)))
        elif self.type == "float":
            v = float(v)
        elif self.type == "choice":
            if isinstance(self.default, int) and not isinstance(self.default, bool):
                v = int(v)
            if v not in self.choices:
                raise ValueError(f"{v!r} not in {self.choices}")
            return v
        else:
            return str(v)
        if self.min is not None:
            v = max(v, type(v)(self.min))
        if self.max is not None:
            v = min(v, type(v)(self.max))
        return v

    def to_json(self) -> dict:
        d = {"default": self.default, "type": self.type}
        for k in ("min", "max", "step", "choices"):
            if getattr(self, k) is not None:
                d[k] = getattr(self, k)
        if self.description:
            d["description"] = self.description
        return d


@dataclass
class RecipeSpec:
    name: str
    fn: Callable[..., Design]
    section: str
    title: str
    description: str
    params: dict[str, Param] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"name": self.name, "section": self.section, "title": self.title, "description": self.description,
                "tags": self.tags, "params": {k: p.to_json() for k, p in self.params.items()}}


RECIPES: dict[str, RecipeSpec] = {}
SECTIONS: dict[str, dict] = {}


def register_section(id: str, title: str, description: str = "") -> None:
    SECTIONS[id] = {"id": id, "title": title, "description": description}


def recipe(name: str, section: str = "misc", title: str | None = None, description: str = "",
           params: dict[str, Param] | None = None, tags: list[str] | None = None):
    def deco(fn):
        RECIPES[name] = RecipeSpec(name, fn, section, title or name.replace("_", " ").title(),
                                   description or (fn.__doc__ or "").strip(), dict(params or {}), list(tags or []))
        SECTIONS.setdefault(section, {"id": section, "title": section.replace("_", " ").title(), "description": ""})
        return fn

    return deco


_loaded = False


def _ensure_loaded():
    global _loaded
    if _loaded:
        return
    _loaded = True
    for mod in pkgutil.iter_modules(__path__):
        if not mod.name.startswith("_"):
            importlib.import_module(f"{__name__}.{mod.name}")


def get_recipe(name: str) -> RecipeSpec:
    _ensure_loaded()
    if name not in RECIPES:
        import difflib

        close = difflib.get_close_matches(name, RECIPES.keys(), n=3)
        raise KeyError(f"unknown recipe {name!r}" + (f"; did you mean {', '.join(close)}?" if close else "; see `gridlab recipes`"))
    return RECIPES[name]


def list_recipes() -> list[RecipeSpec]:
    _ensure_loaded()
    return [RECIPES[k] for k in sorted(RECIPES, key=lambda n: (RECIPES[n].section, n))]


def resolve_params(spec: RecipeSpec, params: dict | None) -> dict:
    params = dict(params or {})
    unknown = set(params) - set(spec.params)
    if unknown:
        raise ValueError(f"recipe {spec.name}: unknown params {sorted(unknown)}; has {sorted(spec.params)}")
    return {k: (p.coerce(params[k]) if k in params else p.default) for k, p in spec.params.items()}


def run_recipe(name: str, params: dict | None = None, seed: int = 0) -> Design:
    spec = get_recipe(name)
    resolved = resolve_params(spec, params)
    d = spec.fn(seed=int(seed), **resolved)
    if not isinstance(d, Design):
        raise TypeError(f"recipe {name} returned {type(d).__name__}, expected Design")
    defaults = {k: p.default for k, p in spec.params.items()}
    suffix = ""
    if resolved != defaults:
        suffix = "-" + hashlib.sha1(json.dumps(resolved, sort_keys=True, default=str).encode()).hexdigest()[:6]
    if d.recipe in ("manual", ""):
        d.recipe = name
    d.params = resolved
    d.seed = int(seed)
    if d.id in ("design", ""):
        d.id = f"{name}-s{seed}{suffix}"
    if not d.title:
        d.title = spec.title
    if not d.tags:
        d.tags = list(spec.tags)
    return d
