import numpy as np
import pytest

from gridlab.model import Design
from gridlab.ops import ca, morph
from gridlab.ops import layering as LY
from gridlab.ops.registry import apply_op
from gridlab.recipes import run_recipe

MINE = ["life_like", "life_lace", "folded_rule", "margolus", "crystal_sigil", "truchet_sparse", "kogin_rosette",
        "name_sigil", "layer_composer", "terraced_relief"]


@pytest.mark.parametrize("name", MINE)
def test_recipe_runs_symmetric(name):
    d = run_recipe(name, {}, 1)
    assert d.layers and any(l.count for l in d.layers)
    for l in d.layers:
        m = l.mask
        assert np.array_equal(m, m[:, ::-1]), f"{name} L{l.id} not mirror-x symmetric"
    if d.frames:
        assert {k for k in d.frames[-1][1]} == set(d.layer_ids)


def test_sym_thin_keeps_symmetry_and_topology():
    m = ca.silhouette("capsule", 21, 13)
    rng = np.random.default_rng(0)
    blob = ca.run_life(ca.sym_noise(rng, m.shape, 0.6, "d2", m), "coral", 5, m)
    th = ca.sym_thin(blob, "d2")
    assert np.array_equal(th, th[:, ::-1]) and np.array_equal(th, th[::-1, :])
    assert morph.label(th, 8)[1] == morph.label(blob, 8)[1]
    assert ca.blocks_2x2(ca.break_2x2(th)).sum() == 0


def test_insert_above_renumbers():
    d = Design.from_masks({1: np.eye(5, dtype=bool), 2: np.ones((5, 5), bool)})
    LY.insert_above(d, 1, np.zeros((5, 5), bool))
    assert d.layer_ids == [1, 2, 3] and d.layer(2).count == 5 and d.layer(3).count == 25


def test_layer_ops():
    d = run_recipe("life_lace", {}, 2)
    d = apply_op(d, "derive-backplate", None, mode="laced")
    assert len(d.layers) == 2
    d = apply_op(d, "junction-dots", [1])
    d = apply_op(d, "contrast-layer", [2], motif="cross")
    assert len(d.layers) == 4
