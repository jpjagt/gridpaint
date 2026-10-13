"""Engines from ops/mirror_curves.py, ops/stitch.py, ops/labyrinth.py."""

import numpy as np

from gridlab.ops import labyrinth as LB
from gridlab.ops import mirror_curves as MC
from gridlab.ops import morph
from gridlab.ops import stitch as ST


def test_plaited_mat_gcd():
    for m, n in [(3, 3), (4, 6), (5, 7), (2, 6)]:
        c = MC.MirrorCurve(MC.dot_set("rect", m, n))
        assert c.count() == np.gcd(m, n)
        assert sum(len(lp) for lp in c.loops()) == 4 * m * n


def test_sikku_single_thread_and_alternation():
    cv = MC.search(MC.dot_set("diamond", 7), "rot4", 3)
    assert cv.count() == 1
    for style in "ABC":
        r = MC.rasterize(cv, style)
        assert morph.label(r.curve, 8)[1] == 1
        if style != "C":
            assert not (r.curve[:-1, :-1] & r.curve[1:, :-1] & r.curve[:-1, 1:] & r.curve[1:, 1:]).any()
        assert (r.over <= r.curve).all()


def test_hitomezashi_d4_and_no_blocks():
    a = ST.sym_word("text", 16, "om")
    m = ST.hitomezashi(a, a)
    assert m.shape == (31, 31)
    assert np.array_equal(m, m[:, ::-1]) and np.array_equal(m, m[::-1]) and np.array_equal(m, m.T)
    assert not (m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:] & m[1:, 1:]).any()


def test_labyrinths():
    assert LB.is_valid(LB.CRETAN)
    assert len(LB.valid_sequences(7)) == 42
    for style in ("square", "octagon"):
        L = LB.labyrinth(LB.CRETAN, style, 3)
        assert morph.label(L["walls"], 8)[1] == 1
        assert morph.label(L["path"], 4)[1] == 1
