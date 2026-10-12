import shutil
from pathlib import Path

from gridlab.cli import main
from gridlab.io import load_design

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


def run(capsys, *argv):
    rc = main([str(a) for a in argv])
    out = capsys.readouterr()
    return rc, out.out + out.err


def test_cli_workflow(tmp_path, capsys):
    f = tmp_path / "w.json"
    png = tmp_path / "w.png"
    assert run(capsys, "import", SAMPLES / "multi_1.json", f)[0] == 0
    rc, out = run(capsys, "show", f, "--png", png)
    assert rc == 0 and png.exists() and "composite" in out and "L3 on L4" in out
    rc, out = run(capsys, "set", f, "--layer", "2", "--on", "0,0", "--mirror", "xy")
    assert rc == 0 and "cells 17->21" in out
    rc, out = run(capsys, "stamp", f, "--layer", "2", "--at", "0,0", "--text", "..")
    assert rc == 0 and load_design(f).layer(2).count == 20
    rc, out = run(capsys, "op", f, "dilate", "--layer", "2", "n=1")
    assert rc == 0
    rc, out = run(capsys, "op", f, "nonexistent")
    assert rc == 1 and "unknown op" in out
    rc, out = run(capsys, "undo", f, "-n", "3")
    assert rc == 0 and load_design(f).layer(2).count == 17
    rc, out = run(capsys, "log", f)
    assert "(no history)" in out


def test_cli_new_draw_gen_variants_pick(tmp_path, capsys, monkeypatch):
    import gridlab.cli as cli

    monkeypatch.setattr(cli, "WORK", tmp_path)
    f = tmp_path / "n.json"
    assert run(capsys, "new", f, "--size", "21x21", "--layers", "2,1")[0] == 0
    rc, out = run(capsys, "draw", f, "--layer", "2", "ring", "10,10", "9,9", "--thickness", "2")
    assert rc == 0 and load_design(f).layer(2).count > 0
    rc, out = run(capsys, "gen", f, "symmetric_noise", "width=9", "height=9", "--layer-map", "1:1", "--seed", "3")
    assert rc == 0 and load_design(f).layer(1).count > 0
    rc, out = run(capsys, "variants", f, f"op {f} clear --layer 1; gen {f} symmetric_noise width=9 height=9", "--seeds", "1..3")
    assert rc == 0 and (tmp_path / "n.variants.png").exists(), out
    v2 = tmp_path / "n.v2.json"
    assert v2.exists()
    rc, out = run(capsys, "pick", v2, f, "--clean")
    assert rc == 0 and not v2.exists()
    rc, out = run(capsys, "variants", "symmetric_noise", "density=0.3", "--seeds", "1,2", "--out-dir", tmp_path)
    assert rc == 0 and (tmp_path / "symmetric_noise.v2.json").exists(), out
    rc, out = run(capsys, "export", f, "--out", tmp_path / "sel.json")
    assert rc == 0
    rc, out = run(capsys, "diff", f, tmp_path / "symmetric_noise.v1.json", "-q")
    assert rc == 0
    rc, out = run(capsys, "recipes")
    assert "symmetric_noise" in out
