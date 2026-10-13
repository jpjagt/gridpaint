import numpy as np

from gridlab.ops import composition as C
from gridlab.ops import lace as L
from gridlab.ops import morph
from gridlab.recipes import run_recipe


def test_lace_clean_removes_blocks_and_keeps_symmetry():
    m = np.zeros((9, 9), bool)
    m[2:5, 2:5] = True
    m = C.symmetrize(m, "d2")
    out = L.lace_clean(m, min_size=1)
    assert not L.blocks2x2(out).any()
    assert C.detect_sym(out) in ("d2", "d4")


def test_connect_and_motifs():
    m = np.zeros((11, 11), bool)
    m[1, 1] = m[1, 9] = m[9, 1] = m[9, 9] = m[5, 5] = True
    assert morph.label(C.connect(m, max_len=8), 8)[1] == 1
    for name in C.MOTIFS:
        mot = C.motif(name, 15, 11, 6, 4)
        assert mot.any() and np.array_equal(mot, mot[:, ::-1])


def test_broken_mirror_changes_one_thing():
    m = run_recipe("diagonal_maze", {}, 2).layers[0].mask
    out = L.broken_mirror(m, 3, "worm")
    assert 0 < (out ^ m).sum() <= 6


def test_recipes_deterministic_and_symmetric():
    for r in ("sample_echo_anneal", "sample_echo_cross", "wfc_ring", "worm_lace", "diagonal_maze", "void_lace"):
        a, b = run_recipe(r, {}, 1), run_recipe(r, {}, 1)
        for la, lb in zip(a.layers, b.layers):
            assert np.array_equal(la.mask, lb.mask)
            assert np.array_equal(la.mask, la.mask[:, ::-1])
        assert a.frames
