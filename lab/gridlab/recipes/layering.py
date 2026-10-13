"""Layer composition recipes: one lace, many stacks. The point of this section is that the *same*
lace reads completely differently depending on how the other laser-cut layers are derived from it."""

from __future__ import annotations

import numpy as np

from ..model import Design
from ..ops import ca, masks as M, morph
from ..ops import layering as LY
from . import RECIPES, Param, recipe, register_section, run_recipe
from .automata import set_frames

register_section(
    "layering", "Layer composition",
    "One lace layer, many stacks. The same source lace (fixed lace_seed) is turned into 2-4 laser-cut layers "
    "by different strategies - backplate, solid spine, backbone skeleton, junction jewels, pruned terraces, "
    "height field, rosette or reliquary. Seeds cycle the strategy, so a row compares compositions, not laces.")

STRATEGIES = ["single", "backplate", "laced_plate", "spine", "skeleton", "jewels", "terraces", "height",
              "contours", "rosette", "reliquary"]
EXCLUDE_SOURCES = {"layer_composer", "terraced_relief", "sample_echo"}


class RecipeChoice(Param):
    """A choice param whose options are all registered recipes (resolved lazily, so recipes from modules
    imported later are included)."""

    def _choices(self):
        return sorted(n for n in RECIPES if n not in EXCLUDE_SOURCES)

    def coerce(self, v):
        v = str(v)
        if v in EXCLUDE_SOURCES or (RECIPES and v not in RECIPES and v != self.default):
            raise ValueError(f"{v!r} is not a usable source recipe; options: {self._choices()}")
        return v

    def to_json(self) -> dict:
        self.choices = self._choices()
        return super().to_json()


def lace_layer(design: Design) -> np.ndarray:
    """The most lace-like layer of a design: many cells, few solid 2x2 blocks."""
    best, bs = None, None
    for l in design.layers:
        m = l.mask
        score = m.sum() - 6 * ca.blocks_2x2(m).sum()
        if bs is None or score > bs:
            best, bs = m, score
    return best


FALLBACK_SOURCE = "life_lace"


def source_lace(source: str, lace_seed: int, margin: int = 2) -> tuple[np.ndarray, Design]:
    try:
        d = run_recipe(source, {}, lace_seed)
    except Exception:  # another module's recipe may be missing/broken: keep the study page alive
        d = run_recipe(FALLBACK_SOURCE, {}, lace_seed)
    m = lace_layer(d)
    m = np.pad(m, margin)
    return m, d


def rosette_for(lace: np.ndarray, seed: int) -> np.ndarray:
    """A kogin rosette sized to the calm centre of the lace's hull."""
    from .ornament import kogin_rosette

    H, W = lace.shape
    h = LY.hull(lace, 0, 1)
    d_edge = M.distance_from_edge(h)
    cy, cx = (H - 1) // 2, (W - 1) // 2
    # as big as the narrow axis allows: the rosette overlaps the lace (crisp over organic)
    r = int(max(3, (min(H, W) - 1) // 2 - 3))
    size = 2 * r + 1
    ros = kogin_rosette(seed=seed, size=size, stretch=0, rings=2, gap=3, rays="auto", centre="auto",
                        clip="diamond").layers[0].mask
    out = np.zeros_like(lace)
    y0, x0 = cy - r, cx - r
    out[y0:y0 + size, x0:x0 + size] = ros
    return out & h


def compose(lace: np.ndarray, strategy: str, seed: int = 0) -> tuple[dict[int, np.ndarray], str]:
    """Build a {layer_id: mask} stack (1 = top) from one lace layer."""
    sym = LY._sym_of(lace)
    sym = sym if sym != "none" else "x"
    h = LY.hull(lace, 1)
    if strategy == "single":
        return {1: lace}, "the lace alone (reference)"
    if strategy == "backplate":
        return {1: lace, 2: LY.backplate(lace, 1, "solid", sym=sym)}, \
            "lace over a solid plate that follows it (close(dilate)); the plate shows through every hole"
    if strategy == "laced_plate":
        return {1: lace, 2: LY.backplate(lace, 0, "laced", rim=1, sym=sym)}, \
            "lace over a light plate: the hull's 1-cell rim + material exactly under the lace"
    if strategy == "spine":
        mot = LY.spine_motif(lace, "spine", 1, inset=2)
        mid = lace | (morph.dilate(mot, 1, 4) & LY.hull(lace, 0, 1))
        return {1: mot, 2: mid, 3: LY.backplate(mid, 0, "laced", rim=1, sym=sym)}, \
            "contrast: solid spine on top, carried by a thickened spine inside the lace, light plate below"
    if strategy == "skeleton":
        sk = LY.skeleton_layer(lace, close_n=1, prune=3, sym=sym)
        return {1: sk, 2: lace}, "backbone: the lace's pruned skeleton (after closing small gaps) rides on it"
    if strategy == "jewels":
        dots = LY.junction_dots(lace, "junctions", "plus", min_sep=4, sym=sym) & morph.dilate(lace, 1, 8)
        return {1: dots, 2: lace, 3: LY.backplate(lace, 0, "laced", rim=1, sym=sym)}, \
            "jewel settings: small crosses on the lace's junctions, lace, rim plate"
    if strategy == "terraces":
        l2 = LY.prune_nested(lace, 2)
        l1 = LY.prune_nested(lace, 5) & morph.erode(h, 2, 4)
        l1 = morph.remove_small(l1, 4, 8)
        return {1: l1, 2: l2, 3: lace}, \
            "density gradient: each layer up strips more tendrils (pruned end points), keeping loops - nested"
    if strategy == "height":
        f = LY.scalar_field(LY.hull(lace, 0, 1), "noise", seed, sym)
        lv = LY.height_levels(f, LY.hull(lace, 0, 1), 3)
        layers = [LY.style_level(l, "lace", lace) for l in lv]
        return {3: layers[0], 2: layers[1], 1: layers[2]}, \
            "height field: symmetric noise over the hull, 3 nested levels, each = lace inside + its rim"
    if strategy == "contours":
        ter = LY.erode_terraces(LY.hull(lace, 0, 1), n=2, step=2, outline=1)
        out = {len(ter) + 1: lace}
        for i, t in enumerate(ter):
            out[len(ter) - i] = t
        return out, "contour terraces: eroded hull outlines stacked on the lace like a topographic map"
    if strategy == "rosette":
        ros = rosette_for(lace, seed)
        return {1: ros, 2: lace, 3: LY.backplate(lace | ros, 0, "laced", rim=1, sym=sym)}, \
            "crisp kogin rosette on top of organic lace, light plate below"
    if strategy == "reliquary":
        cross = LY.spine_motif(lace, "cross", 1, inset=4)
        mid = lace | morph.dilate(cross, 1, 4) & LY.hull(lace, 0, 1)
        return {1: cross, 2: mid, 3: LY.backplate(mid, 1, "lace", sym=sym)}, \
            "like the user's multi_1: small plain cross on top, lace + cross bed in the middle, lace plate below"
    raise ValueError(strategy)


@recipe("layer_composer", section="layering", title="Layer composer",
        description="Runs any other recipe to get one lace layer, then derives a 2-4 layer stack with a chosen "
                    "strategy. With strategy=by_seed each seed shows the SAME lace under a different strategy, "
                    "so the gallery row is a lesson in composition. Frames show the stack being built.",
        params={
            "source": RecipeChoice("sample_echo_anneal", type="choice"),
            "lace_seed": Param(3, 1, 50, 1, description="seed of the source recipe (fixed, so seeds vary only the stack)"),
            "strategy": Param("by_seed", choices=["by_seed"] + STRATEGIES),
        },
        tags=["layers", "composition"])
def layer_composer(seed: int, source: str, lace_seed: int, strategy: str) -> Design:
    lace, src = source_lace(source, lace_seed)
    st = strategy
    if st == "by_seed":
        cyc = [s for s in STRATEGIES if s != "single"]
        st = cyc[(seed - 1) % len(cyc)]
    stack, how = compose(lace, st, seed)
    stack = {k: v for k, v in stack.items() if v.any()}
    ids = sorted(stack, reverse=True)
    frames = [("source lace", {max(ids): lace})]
    for i in range(1, len(ids) + 1):
        frames.append((f"+ layer {ids[i - 1]}" if i > 1 else f"layer {ids[0]}",
                       {k: stack[k] for k in ids[:i]}))
    d = Design.from_masks(stack)
    set_frames(d, frames)
    d.trim(1)
    d.title = f"{st.replace('_', ' ')} · {source}"
    d.notes = f"source {source} seed {lace_seed}; strategy {st}: {how}."
    d.tags = ["layers", st]
    return d


@recipe("terraced_relief", section="layering", title="Terraced relief",
        description="A soft relief from one lace: the hull is cut into 3 nested levels by a smooth symmetric "
                    "field; each level up keeps only the lace inside it with more tendrils pruned, plus the "
                    "level's own rim. Upper layers sit exactly on lower lace (nested, fully supported) and read "
                    "as a brighter, calmer core rising out of busier lace.",
        params={
            "source": RecipeChoice("sample_echo_anneal", type="choice"),
            "levels": Param(3, 2, 4, 1),
            "field": Param("distance", choices=["distance", "noise", "radial", "density"]),
            "rims": Param(True, description="outline each level"),
            "prune": Param(1, 0, 6, 1, description="extra tendril pruning per level"),
        },
        tags=["layers", "relief"])
def terraced_relief(seed: int, source: str, levels: int, field: str, rims: bool, prune: int) -> Design:
    lace, _ = source_lace(source, seed)
    sym = LY._sym_of(lace)
    sym = sym if sym != "none" else "x"
    region = LY.hull(lace, 0, 1)
    f = LY.scalar_field(region, field, seed, sym, lace=lace)
    lv = LY.height_levels(f, region, levels)
    stack = {}
    cur = lace
    frames = []
    for i, lvl in enumerate(lv):
        lid = levels - i
        if i:
            cur = LY.prune_nested(cur, prune) if prune else cur
        layer = cur & lvl
        if rims and i:
            rim = lvl & ~morph.erode(lvl, 1, 4)
            # the level's rim, kept where it rests on (or is diagonally next to) the layer below
            layer = layer | (rim & morph.dilate(stack[lid + 1], 1, 8))
        elif rims:
            layer = layer | (lvl & ~morph.erode(lvl, 1, 4))
        layer = morph.remove_small(layer, 3, 8)
        stack[lid] = layer
        frames.append((f"level {i}", dict(stack)))
    stack = {k: v for k, v in stack.items() if v.any()}
    d = Design.from_masks(stack)
    set_frames(d, [(lab, {k: v for k, v in fl.items() if v.any()}) for lab, fl in frames] + [("final", stack)])
    d.trim(1)
    d.notes = (f"lace from {source} seed {seed}; {field} field over the hull -> {levels} nested levels; level i "
               f"keeps lace pruned {prune}x more{' + its rim (where carried)' if rims else ''}.")
    return d
