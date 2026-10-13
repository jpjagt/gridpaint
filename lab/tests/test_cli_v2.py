"""CLI v2 features: provenance/meta, per-file output paths, selections, layer booleans, dry-run, sheet/frames,
stamp fixes, variant sweeps, lattice/scale/fill-holes, describe, symmetry centring, ask details, group deltas."""

import json
from pathlib import Path

import numpy as np
import pytest

from gridlab.cli import main
from gridlab.io import load_design
from gridlab.model import Design
from gridlab.ops.registry import apply_op
from gridlab.selection import parse_sel

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


def run(capsys, *argv):
    rc = main([str(a) for a in argv])
    out = capsys.readouterr()
    return rc, out.out + out.err


@pytest.fixture
def ws(tmp_path, capsys):
    f = tmp_path / "m.json"
    assert run(capsys, "import", SAMPLES / "multi_1.json", f, "--title", "relic")[0] == 0
    return f


def blank(w=21, h=21, ids=(2, 1)):
    return Design.empty(w, h, list(ids))


# ---- 1. metadata & provenance -------------------------------------------------------

def test_meta_and_export_provenance(ws, tmp_path, capsys):
    assert load_design(ws).title == "relic"
    run(capsys, "op", ws, "dilate", "--layer", "2")
    rc, out = run(capsys, "meta", ws, "--tags", "a,b", "--append-notes", "hello")
    assert rc == 0 and "provenance (2 steps" in out
    d = load_design(ws)
    assert d.tags == ["a", "b"] and d.notes == "hello" and d.provenance[-1] == "op FILE dilate --layer 2"
    out_p = tmp_path / "e.json"
    run(capsys, "export", ws, "--format", "design", "--out", out_p)
    obj = json.loads(out_p.read_text())
    assert obj["provenance"] == ["import multi_1.json", "op FILE dilate --layer 2"]
    assert "recipe: import multi_1.json ; op FILE dilate" in obj["notes"] and "history" not in obj
    run(capsys, "undo", ws)
    assert load_design(ws).provenance == ["import multi_1.json"]


def test_pick_records_chain(tmp_path, capsys):
    f = tmp_path / "n.json"
    run(capsys, "new", f, "--size", "15x15", "--layers", "1")
    run(capsys, "draw", f, "--layer", "1", "ring", "7,7", "6,6")
    rc, out = run(capsys, "variants", f, f"op {f} dilate n={{1,2}} --layer 1")
    run1 = tmp_path / "n.variants" / "run1"
    assert rc == 0 and (run1 / "v2.json").exists() and (run1 / "sheet.png").exists(), out
    rc, out = run(capsys, "pick", run1 / "v2.json", f, "--clean")
    assert rc == 0 and not run1.exists()
    d = load_design(f)
    assert "n=2" in d.provenance[-1] and "dilate n=2" in d.provenance[-1]
    assert "dilate n=2" in d.history[-1]["op"]


# ---- 2. output paths -----------------------------------------------------------------

def test_outputs_next_to_file_and_runs_numbered(tmp_path, capsys):
    sub = tmp_path / "a"
    f = sub / "x.json"
    run(capsys, "new", f, "--size", "9x9")
    rc, out = run(capsys, "show", f)
    assert rc == 0 and (sub / "x.png").exists()
    run(capsys, "render", f)
    assert (sub / "x.render.png").exists()
    for _ in range(2):
        assert run(capsys, "variants", f, f"op {f} fill shape=ellipse --layer 1", "--seeds", "1")[0] == 0
    assert (sub / "x.variants" / "run1" / "v1.json").exists() and (sub / "x.variants" / "run2" / "v1.json").exists()
    od = tmp_path / "out"
    rc, out = run(capsys, "variants", "symmetric_noise", "--seeds", "1", "--out-dir", od)
    assert rc == 0 and (od / "symmetric_noise.variants" / "run1" / "v1.json").exists()


# ---- 3. selections ---------------------------------------------------------------------

def test_parse_sel_terms():
    d = blank()
    d.layer(2).default.cells[5:16, 5:16] = True
    d.layer(2).default.cells[8:13, 8:13] = False
    assert parse_sel("rect:0,0,1,1", d).sum() == 4
    c = parse_sel("circle:10,10,2", d)
    assert c[10, 12] and not c[10, 13] and c.sum() == 13
    assert parse_sel("ring:10,10,2,3", d).sum() == parse_sel("circle:10,10,3&not:circle:10,10,1.9", d).sum()
    assert parse_sel("half:x<10", d).sum() == 210 and parse_sel("half:left", d).sum() == 210
    top = parse_sel("wedge:315,45", d)
    assert top[0, 10] and not top[20, 10] and not top[10, 0]
    assert parse_sel("layer:2", d).sum() == 121 - 25
    assert parse_sel("inside:2", d).sum() == 121
    assert parse_sel("inside:2&not:layer:2", d).sum() == 25
    assert parse_sel("rect:0,0,0,0|rect:20,20,20,20", d).sum() == 2
    assert parse_sel("expr:x+y<2", d).sum() == 3
    with pytest.raises(ValueError):
        parse_sel("blob:1", d)


def test_sel_confines_op_set_draw_erase(ws, capsys):
    before = load_design(ws)
    rc, out = run(capsys, "op", ws, "fill", "--layer", "4", "--sel", "half:x<7")
    after = load_design(ws)
    assert rc == 0
    m0, m1 = before.layer(4).mask, after.layer(4).mask
    assert (m0[:, 7:] == m1[:, 7:]).all() and m1[:, :7].all()
    run(capsys, "undo", ws)
    run(capsys, "draw", ws, "--layer", "2", "fill-rect", "0,0", "15,23", "--sel", "circle:7,12,2")
    assert load_design(ws).layer(2).mask.sum() == (before.layer(2).mask | parse_sel("circle:7,12,2", before)).sum()
    rc, out = run(capsys, "erase", ws, "--sel", "circle:7,12,3", "--layer", "2")
    assert rc == 0 and not (load_design(ws).layer(2).mask & parse_sel("circle:7,12,3", before)).any()
    rc, out = run(capsys, "sel", ws, "ring:7,12,4,6&half:y<12")
    assert rc == 0 and "selection" in out and "#" in out


def test_region_honoured_by_design_ops(ws, capsys):
    rc, out = run(capsys, "op", ws, "copy-layer", "--layer", "3", "to=6", "--region", "0,0,7,11")
    d = load_design(ws)
    assert rc == 0 and not d.layer(6).mask[12:, :].any() and not d.layer(6).mask[:, 8:].any()
    assert (d.layer(6).mask == (d.layer(3).mask & parse_sel("rect:0,0,7,11", d))).all()


# ---- 4. layer booleans ------------------------------------------------------------------

def test_layer_bool_and_clip_to_layer(ws, capsys):
    d0 = load_design(ws)
    a, b = d0.layer(3).mask, d0.layer(4).mask
    for op, want in (("and", a & b), ("or", a | b), ("sub", a & ~b), ("xor", a ^ b)):
        assert run(capsys, "layer", ws, "bool", "3", op, "4", "--into", "7")[0] == 0
        assert (load_design(ws).layer(7).mask == want).all(), op
    assert run(capsys, "layer", ws, "add", "9")[0] == 0 and load_design(ws).has_layer(9)
    assert run(capsys, "layer", ws, "rm", "9")[0] == 0
    run(capsys, "op", ws, "clip-to-layer", "src=2", "mode=over", "--layer", "3")
    d = load_design(ws)
    assert not (d.layer(3).mask & ~d.layer(2).mask).any()
    run(capsys, "undo", ws)
    run(capsys, "op", ws, "clip-to-layer", "src=2", "mode=inside", "--layer", "4")
    assert load_design(ws).layer(4).count < b.sum()


# ---- 5. dry-run --------------------------------------------------------------------------

def test_dry_run_saves_nothing(ws, tmp_path, capsys):
    raw = ws.read_text()
    for argv in (["op", ws, "dilate", "--layer", "3"], ["set", ws, "--layer", "2", "--on", "0,0"],
                 ["draw", ws, "--layer", "2", "line", "0,0", "5,5"], ["layer", ws, "bool", "3", "or", "4"],
                 ["stamp", ws, "--layer", "2", "--at", "0,0", "--text", "##"]):
        rc, out = run(capsys, *argv, "--dry-run")
        assert rc == 0 and ws.read_text() == raw, argv
    run(capsys, "op", ws, "dilate", "--layer", "3")
    raw = ws.read_text()
    rc, out = run(capsys, "undo", ws, "--dry-run")
    assert rc == 0 and ws.read_text() == raw and "would undo" in out
    rc, out = run(capsys, "op", ws, "dilate", "--layer", "3", "--dry-run")
    assert "dry-run" in out and "+" in out and (tmp_path / "m.dryrun.png").exists()


def test_no_change_not_logged(ws, capsys):
    n = len(load_design(ws).history)
    rc, out = run(capsys, "op", ws, "fill-holes", "--layer", "2")
    assert rc == 0 and "no change" in out and len(load_design(ws).history) == n


# ---- 6. sheet & frames ------------------------------------------------------------------

def test_sheet_and_frames(ws, tmp_path, capsys):
    other = tmp_path / "o.json"
    run(capsys, "new", other, "--size", "9x9")
    rc, out = run(capsys, "sheet", ws, other, "--layers", "3")
    assert rc == 0 and (tmp_path / "m.sheet.png").exists()
    fos = tmp_path / "fos.json"
    rc, out = run(capsys, "frames", "dla_reliquary", "--seed", "2", "--as", "layers", "--pick", "1,5,-1", "--out", fos)
    d = load_design(fos)
    assert rc == 0 and d.layer_ids == [1, 2, 3] and d.layer(1).count <= d.layer(3).count, out
    rc, out = run(capsys, "frames", "dla_reliquary", "--seed", "2", "--out", tmp_path / "fr.png")
    assert rc == 0 and (tmp_path / "fr.png").exists()
    rc, out = run(capsys, "frames", "dla_reliquary", "--as", "files", "--pick", "0,-1", "--out", tmp_path / "fd")
    assert rc == 0 and len(list((tmp_path / "fd").glob("f*.json"))) == 2


# ---- 7. stamp ----------------------------------------------------------------------------

def test_stamp_blank_rows_anchor_multi(tmp_path, capsys, monkeypatch):
    import io
    f = tmp_path / "s.json"
    run(capsys, "new", f, "--size", "11x11")
    monkeypatch.setattr("sys.stdin", io.StringIO("\n\n#\n"))
    run(capsys, "stamp", f, "--layer", "1", "--at", "0,0")
    assert load_design(f).layer(1).mask[2, 0]  # leading blank rows kept
    run(capsys, "stamp", f, "--layer", "1", "--at", "5,5", "--anchor", "center", "--text", "###/###/###")
    m = load_design(f).layer(1).mask
    assert m[4:7, 4:7].all() and not m[7, 5]
    run(capsys, "stamp", f, "--layer", "1", "--at", "1,9 9,9", "--text", "#", "--mode", "or")
    m = load_design(f).layer(1).mask
    assert m[9, 1] and m[9, 9]


# ---- 8. variant sweeps -------------------------------------------------------------------

def test_variant_placeholders(tmp_path, capsys):
    f = tmp_path / "v.json"
    run(capsys, "new", f, "--size", "15x15", "--layers", "2,1")
    run(capsys, "draw", f, "--layer", "2", "ring", "7,7", "6,6")
    rc, out = run(capsys, "variants", f, f"op {f} lattice pitch={{3..4}} kind={{diag,ortho}} --layer 1", "--layers", "1")
    assert rc == 0 and out.count("-> ") == 4 and "pitch=4 kind=ortho" in out, out
    rc, out = run(capsys, "variants", "symmetric_noise", "density={0.2,0.4}", "--out-dir", tmp_path)
    assert rc == 0 and "density=0.4" in out and out.count("-> ") == 2


# ---- 9. new ops -----------------------------------------------------------------------------

def test_lattice_scale_fill_holes():
    d = blank(21, 21, (1,))
    out = apply_op(d, "lattice", [1], pitch=4)
    m = out.layer(1).mask
    assert m[10, 10] and (m == m[:, ::-1]).all() and (m == m[::-1, :]).all()  # node on centre, symmetric
    d.layer(1).default.cells[3:18, 3:18] = True
    inner = apply_op(d, "lattice", [1], within="mask", pitch=4).layer(1).mask
    assert inner.sum() < 225 and not inner[:3].any()
    s = apply_op(d, "scale", [1], k=2)
    assert s.shape == (42, 42) and s.layer(1).count == 4 * 225
    d2 = blank(15, 15, (2, 1))
    d2.layer(1).default.cells[6:9, 6:9] = True
    s2 = apply_op(d2, "scale", [1], k=2)
    assert s2.shape == (15, 15) and s2.layer(1).count == 36
    m = np.zeros((9, 20), bool)
    m[1:8, 1:8] = True
    m[2:7, 2:7] = False  # 25-cell window
    m[1:6, 10:15] = True
    m[3, 12] = False  # pinhole
    dd = Design.from_masks({1: m})
    assert apply_op(dd, "fill-holes", [1]).layer(1).count == m.sum() + 26
    assert apply_op(dd, "fill-holes", [1], max_size=3).layer(1).count == m.sum() + 1


# ---- 10. describe -------------------------------------------------------------------------

def test_describe(ws, capsys):
    rc, out = run(capsys, "describe", ws)
    lines = out.strip().splitlines()
    assert rc == 0 and len(lines) <= 25
    assert "capsule" in out and "cross" in out and "mirror L-R and T-B" in out and "groups" in out
    assert "L2 vs L3" in out and "inside L3's outline" in out


# ---- editor items: symmetry centring, ask details, group deltas, contrast-layer -----------

def test_symmetric_ops_use_material_centre():
    d = blank(16, 15, (1,))
    m = d.layer(1).default.cells
    m[3:12, 2] = m[3:12, 12] = True  # two bars, symmetric about x=7 (canvas centre 7.5)
    notes = []
    out = apply_op(d, "connect", [1], notes=notes, max_len=12)
    om = out.layer(1).mask
    xs = np.nonzero(om)[1]
    assert notes and "material centre" in notes[0]
    assert xs.min() + xs.max() == 14 and (om[:, :15] == om[:, :15][:, ::-1]).all()
    notes = []
    apply_op(d, "mirror", [1], notes=notes, axis="x")
    assert notes and notes[0].startswith("WARNING")


def test_ask_extract_details():
    from gridlab.assist import Candidate, Step, apply_details, extract_details
    from gridlab.ops.registry import get_op

    det = extract_details("frame on bottom layer, 1-cell gap")
    assert det[0]["kind"] == "gap" and det[0]["value"] == 1
    c = [Candidate("frame", [Step("frame", [4], None, {})])]
    mapped, unhandled = apply_details("frame", get_op("frame"), c, det, {})
    assert c[0].steps[0].kwargs["d"] == 2 and not unhandled
    det = extract_details("small 4-fold motif on a new top layer")
    _, unhandled = apply_details("motif", get_op("motif"), [], det, {})
    assert {"4-fold", "new top layer"} <= set(unhandled)


def test_group_structure_change_reported(ws, capsys):
    rc, out = run(capsys, "op", ws, "merge-groups", "--layer", "3")
    assert rc == 0 and "group structure changed" in out and "groups 3->1" in out


def test_contrast_layer_default_no_merge():
    from gridlab.recipes import run_recipe

    d = run_recipe("life_lace", {}, 2)
    lid = d.layer_ids[-1]
    before = d.layer(lid).count
    out = apply_op(d, "contrast-layer", [lid], motif="cross")
    assert out.layer(lid + 1).count == before  # lace layer untouched


def test_op_docs_only_name_real_params():
    import re

    from gridlab.ops.registry import list_ops

    allowed = {("lattice", "d"), ("xor-fill", "x"), ("xor-fill", "y")}  # other ops / formulas in the text
    bad = []
    for s in list_ops():
        names = {p.name for p in s.params}
        for k in set(re.findall(r"(?<![\w-])([a-z_]+)=", s.doc)):
            if k not in names and (s.name, k) not in allowed:
                bad.append((s.name, k))
    assert not bad
