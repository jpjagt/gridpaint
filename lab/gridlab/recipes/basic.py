"""Basic example recipes proving the pipeline."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..model import Design
from ..ops import masks, morph, symmetry
from . import Param, recipe, register_section

SAMPLES = Path(__file__).resolve().parents[2] / "samples"

register_section("basic", "Basics", "The baseline every other section has to beat: mirrored random cells in a capsule. Symmetry alone is not enough - this is what 'too random' looks like.")


@recipe("sample_echo", section="basic", title="Sample echo",
        description="Loads samples/<name>.json unchanged (the user's reference design).",
        params={"name": Param("multi_1", choices=["multi_1", "multi_2", "single_1", "single_2", "single_ring"])},
        tags=["sample"])
def sample_echo(seed: int, name: str) -> Design:
    from ..io import load_any

    d = load_any(SAMPLES / f"{name}.json")
    d.recipe = "sample_echo"
    d.id = "design"
    return d


@recipe("symmetric_noise", section="basic", title="Symmetric noise",
        description="Random cells inside a capsule, mirrored D2 (left/right + top/bottom). "
                    "Optional cleanup removes isolated specks.",
        params={
            "width": Param(15, 5, 61, 1),
            "height": Param(23, 5, 61, 1),
            "density": Param(0.45, 0.05, 0.95, 0.05),
            "cleanup": Param(True),
            "layers": Param(1, 1, 3, 1, description="stack this many layers, each eroded support of the one above"),
        },
        tags=["noise", "d2"])
def symmetric_noise(seed: int, width: int, height: int, density: float, cleanup: bool, layers: int) -> Design:
    rng = np.random.default_rng(seed)
    shape = masks.capsule(height, width)
    m = (rng.random((height, width)) < density) & shape
    m = symmetry.symmetrize_d2(m)
    if cleanup:
        m = morph.remove_small(m, 3)
    out = {layers: m}
    # upper layers: thinner subsets sitting on the layer below
    cur = m
    for lid in range(layers - 1, 0, -1):
        cur = symmetry.symmetrize_d2(morph.skeletonize(cur) & (rng.random(cur.shape) < 0.8)) & cur
        out[lid] = cur
    return Design.from_masks(out)
