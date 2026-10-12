import json
import time
from pathlib import Path

import numpy as np
import pytest

from gridlab import metrics as MX
from gridlab import view
from gridlab.io import (design_from_dict, design_to_dict, load_any, loads_any, selection_to_dict)
from gridlab.model import Design, Group, Layer
from gridlab.ops import draw, masks, morph, symmetry
from gridlab.ops.registry import apply_op, list_ops
from gridlab.recipes import list_recipes, run_recipe
from gridlab.render import contact_sheet, group_bitmap, quadrant_types, render, render_layers_panel

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


def mask_from(rows: str) -> np.ndarray:
    return np.array([[c == "#" for c in r] for r in rows.strip().split()], bool)


# ---- model / io ---------------------------------------------------------------

def test_sample_load_preserves_groups_and_bounds():
    d = load_any(SAMPLES / "multi_1.json")
    assert (d.width, d.height) == (16, 24)
    assert d.layer_ids == [2, 3, 4]
    assert [g.id for g in d.layer(4).groups] == ["default", "group-2", "group-3"]
    assert d.layer(2).count == 17


def test_design_json_roundtrip_with_frames():
    m = mask_from("""
    .#.
    ###
    """)
    d = Design.from_masks({2: m, 1: m & False}, id="x", frames=[("t0", {2: m})], seed=3)
    d2 = design_from_dict(json.loads(json.dumps(design_to_dict(d))))
    assert d2.id == "x" and d2.seed == 3 and d2.shape == (2, 3)
    assert np.array_equal(d2.layer(2).mask, m)
    assert d2.frames[0][0] == "t0" and np.array_equal(d2.frames[0][1][2][0].cells, m)


def test_selection_roundtrip_trims_and_keeps_layers():
    d = load_any(SAMPLES / "multi_2.json")
    sel = selection_to_dict(d)
    assert sel["type"] == "gridpaint-selection"
    d2 = loads_any(json.dumps(sel))
    for lid in d.layer_ids:
        assert d2.layer(lid).count == d.layer(lid).count
        assert len(d2.layer(lid).groups) == len(d.layer(lid).groups)


def test_crop_pad_translate_trim():
    d = Design.empty(10, 8, [1])
    d.layer(1).default.cells[3, 4] = True
    assert d.bbox() == (4, 3, 4, 3)
    d.translate(2, 1)
    assert d.bbox() == (6, 4, 6, 4)
    d.trim(1)
    assert d.shape == (3, 3) and d.bbox() == (1, 1, 1, 1)
    d.pad(2, 0, 0, 0)
    assert d.shape == (3, 5) and d.bbox() == (3, 1, 3, 1)


def test_paste_layer_map_and_modes():
    dst = Design.empty(6, 6, [1, 2])
    dst.layer(1).default.cells[:] = True
    src = Design.from_masks({3: np.ones((2, 2), bool)})
    dst.paste(src, 1, 1, {3: 2})
    assert dst.layer(2).count == 4
    dst.paste(Design.from_masks({1: np.zeros((2, 2), bool)}), 0, 0, mode="area")
    assert dst.layer(1).count == 32


# ---- render -------------------------------------------------------------------

def test_quadrant_semantics():
    # diagonal pair -> full quadrants toward each other, bridges in the empty corners
    m = mask_from("""
    #.
    .#
    """)
    t = quadrant_types(m)
    assert t["SE"][0, 0] == 1 and t["NW"][1, 1] == 1  # full towards diagonal neighbour
    assert t["NW"][0, 0] == 2  # rounded where nothing
    assert t["SW"][0, 1] == 3 and t["NE"][1, 0] == 3  # concave bridges in empty cells


def test_single_cell_is_disc():
    bm = group_bitmap(np.array([[True]]), 40)
    area = bm.mean()
    assert abs(area - np.pi / 4) < 0.02


def test_render_speed_and_size():
    rng = np.random.default_rng(0)
    d = Design.from_masks({1: rng.random((50, 50)) < 0.5, 2: rng.random((50, 50)) < 0.5})
    t = time.time()
    im = render(d, cell_px=16, margin=1, show_grid=True)
    assert time.time() - t < 1.0
    assert im.size[0] > 52 * 16


def test_panels_and_contact_sheet():
    d = load_any(SAMPLES / "multi_1.json")
    p = render_layers_panel(d, cell_px=8)
    assert p.size[0] > 4 * 16 * 8
    s = contact_sheet([d, d, d], ["a", "b", "c"], cols=2, cell_px=4)
    assert s.size[0] > 0


# ---- view ----------------------------------------------------------------------

def test_ascii_rulers_and_composite():
    d = load_any(SAMPLES / "multi_1.json")
    txt = view.ascii_composite(d, region=(5, 10, 12, 12))
    lines = txt.splitlines()
    assert lines[1].strip() == "56789012"
    assert lines[2].startswith("10 ") and len(lines) == 5
    assert "2" in txt  # top layer char visible
    assert view.ascii_layer(d, 2).count("#") == 17


# ---- ops ----------------------------------------------------------------------

def test_mirror_and_symmetry():
    m = np.zeros((5, 6), bool)
    m[1, 0] = True
    r = symmetry.mirror(m, "x")
    assert r[1, 5] and r[1, 0]
    r = symmetry.mirror(m, "x", "right")
    assert not r.any()
    r = symmetry.mirror(m, "x", cx=2)
    assert r[1, 4] and r[1, 0]
    sq = np.zeros((7, 7), bool)
    sq[0, 2] = True
    d4 = symmetry.symmetrize_d4(sq)
    assert d4.sum() == 8
    assert MX.symmetry_scores(d4)["rot90"] == 1.0
    r4 = symmetry.rot_sym(sq, 4)
    assert r4.sum() == 4 and np.array_equal(r4, np.rot90(r4))
    assert symmetry.symmetry_or(m, "d2").sum() == 4


def test_masks_shapes():
    assert masks.ellipse(9, 9)[4].all()
    c = masks.capsule(20, 8)
    assert c[10].all() and not c[0, 0]
    assert masks.ring(15, 15, 2)[7, 7] == False  # noqa: E712
    band = masks.offset_outline(masks.rect(10, 10, 4, 4, 5, 5), 1, 1)
    assert band.sum() == 12 or band.sum() == 16


def test_morph_and_skeleton():
    m = masks.rect(9, 15, 1, 2, 13, 6)
    sk = morph.skeletonize(m)
    assert 0 < sk.sum() < m.sum()
    assert morph.label(sk, 8)[1] == 1
    holes = m.copy()
    holes[4, 7] = False
    assert MX.count_holes(holes) == 1
    assert morph.fill_holes(holes)[4, 7]
    two = m.copy()
    two[0, 0] = True
    assert morph.keep_largest(two)[0, 0] == False  # noqa: E712
    assert morph.remove_small(two, 2).sum() == m.sum()


def test_draw_and_stamp():
    m = np.zeros((10, 10), bool)
    assert draw.line(m, 0, 0, 9, 9).sum() == 10
    assert draw.rect(m, 1, 1, 4, 4).sum() == 12
    s = draw.stamp_ascii(m, "#.#/ # ", (2, 3))
    assert s[3, 2] and s[3, 4] and s[4, 3] and s.sum() == 3
    s2 = draw.stamp_ascii(s, "..", (2, 3), mode="set")
    assert not s2[3, 2]


def test_registry_apply_op_region():
    d = Design.empty(10, 4, [1])
    d.layer(1).default.cells[1, 0] = True
    out = apply_op(d, "mirror", layers=[1], region=(0, 0, 4, 3), axis="x")
    assert out.layer(1).mask[1, 4] and not out.layer(1).mask[1, 9]
    assert d.layer(1).count == 1  # original untouched
    names = {o.name for o in list_ops()}
    assert {"mirror", "dilate", "skeleton", "copy-layer", "clip-to-below"} <= names


# ---- metrics ------------------------------------------------------------------

def test_metrics_support_and_summary():
    lower = masks.rect(10, 10, 2, 2, 7, 7)
    upper = masks.rect(10, 10, 3, 3, 8, 8)
    d = Design.from_masks({1: upper, 2: lower})
    md = MX.design_metrics(d)
    p = md["pairs"][0]
    assert p["upper"] == 1 and p["lower"] == 2
    assert p["support"] == pytest.approx(25 / 36)
    assert 0 < p["support_area"] < 1
    txt = MX.summary_text(d)
    assert "L1 on L2" in txt


# ---- recipes ------------------------------------------------------------------

def test_recipes_run():
    names = [r.name for r in list_recipes()]
    assert "symmetric_noise" in names and "sample_echo" in names
    d = run_recipe("symmetric_noise", {"density": "0.5"}, seed=2)
    assert d.recipe == "symmetric_noise" and d.seed == 2 and d.params["density"] == 0.5
    assert MX.symmetry_scores(d.layer(1).mask)["x"] == 1.0
    assert run_recipe("sample_echo", {}, 0).layer_ids == [2, 3, 4]
    with pytest.raises(ValueError):
        run_recipe("symmetric_noise", {"bogus": 1}, 0)
