"""Sigils, glyphs and sacred-geometry recipes: invariants + smoke runs."""

import time

import numpy as np
import pytest

from gridlab.ops import glyphs as G
from gridlab.ops import sigils as S
from gridlab.ops.registry import apply_op
from gridlab.model import Design
from gridlab.recipes import list_recipes, run_recipe


@pytest.mark.parametrize("planet", list(S.KAMEAS))
def test_kameas_are_magic(planet):
    a = S.kamea(planet)
    n = a.shape[0]
    c = S.magic_constant(n)
    assert sorted(a.ravel()) == list(range(1, n * n + 1))
    assert (a.sum(0) == c).all() and (a.sum(1) == c).all()
    assert np.trace(a) == c and np.trace(a[:, ::-1]) == c


def test_gematria_and_reduction():
    assert G.gematria_values("AJS") == [1, 10, 100]
    assert S.name_numbers("AGIEL", 3) == [1, 7, 9, 5, 3]


def test_sigil_trace_nodes_and_seal_symmetry():
    r = S.sigil_trace("LUX", "saturn", 29, seal=True)
    m = r["mask"]
    assert (m == m[:, ::-1]).all()
    assert len(r["nodes"]) >= 2 and r["mask"].any()


def test_magic_walk_c2_for_associative_squares():
    for planet in ("saturn", "mars"):
        m = S.magic_walk(planet, 21, closed=True, style="octi")["line"]
        assert (m == m[::-1, ::-1]).all()


def test_geomantic_chart_judge_even():
    ch = S.geomantic_chart(S.mothers_from_text("question"))
    assert sum(ch["judge"]) % 2 == 0  # even point-total <=> even number of odd rows
    assert ch["daughters"][0] == tuple(m[0] for m in ch["mothers"])


def test_kufic_window_rule():
    g = S.kufic_seal(11, 3, "c4", 1500)["mask"]
    s = g[:-1, :-1].astype(int) + g[1:, :-1] + g[:-1, 1:] + g[1:, 1:]
    assert ((s > 0) & (s < 4)).all()
    assert (g == np.rot90(g)).all()


def test_pixel_ring_is_d4_and_connected():
    from gridlab.ops import morph
    m = G.pixel_ring(6)
    assert (m == m[::-1]).all() and (m == m.T).all()
    assert morph.label(m, 8)[1] == 1


def test_ops_run():
    d = Design.empty(29, 29, (1,))
    for name, kw in [("sigil-trace", {"text": "LUX"}), ("glyph", {"text": "AB"}), ("ogham", {"text": "LUNA"}),
                     ("bindrune", {"runes": "fehu,algiz"}), ("kufic", {"steps": 300})]:
        out = apply_op(d, name, [1], **kw)
        assert out.layer(1).mask.any(), name


MINE = [r.name for r in list_recipes() if r.section in ("sigils", "sacred_geometry")]


@pytest.mark.parametrize("name", MINE)
def test_recipe_runs_fast_and_deterministic(name):
    t = time.time()
    a = run_recipe(name, {}, 3)
    assert time.time() - t < 3.0
    b = run_recipe(name, {}, 3)
    assert a.masks() .keys() == b.masks().keys()
    for k in a.masks():
        assert (a.masks()[k] == b.masks()[k]).all()
    assert 1 <= len(a.layers) <= 4 and a.notes
