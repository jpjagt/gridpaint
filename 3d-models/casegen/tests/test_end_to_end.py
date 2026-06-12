import shutil
from pathlib import Path

import trimesh

from casegen import main
from conftest import CASE_DIR


def test_end_to_end(tmp_path):
    # copy the case folder so the real output/ dir is untouched by tests
    case = tmp_path / "case"
    shutil.copytree(CASE_DIR, case, ignore=shutil.ignore_patterns("output"))
    toml = case / "case.toml"
    text = toml.read_text().replace("mesh_size = 0.5", "mesh_size = 1.2")
    toml.write_text(text)

    main([str(toml)])

    out = case / "output"
    for name in ("body.stl", "lid.stl", "preview.png", "profile-sections.png"):
        assert (out / name).exists(), name
    for name in ("body.stl", "lid.stl"):
        mesh = trimesh.load(out / name)
        assert mesh.is_watertight, name
        assert mesh.volume > 1000.0, name


def test_preview_only_skips_stl(tmp_path):
    case = tmp_path / "case"
    shutil.copytree(CASE_DIR, case, ignore=shutil.ignore_patterns("output"))
    toml = case / "case.toml"
    text = toml.read_text().replace("mesh_size = 0.5", "mesh_size = 1.2")
    toml.write_text(text)

    main([str(toml), "--preview-only"])

    out = case / "output"
    assert (out / "preview.png").exists()
    assert not (out / "body.stl").exists()
