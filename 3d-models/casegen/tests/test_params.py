from pathlib import Path

from params import CaseParams, load_params


def test_defaults_and_derived():
    p = CaseParams(footprint_path=Path("x.dxf"), case_dir=Path("."))
    assert p.stack_height == 4.0
    assert p.z_eq == p.z_rim + p.slope_drop == 12.0
    assert p.pocket_depth == 4.5
    assert abs(p.floor_z - (6.0 - 0.66 * 4.5)) < 1e-9
    assert abs(p.ceiling_z - (p.floor_z + 4.5)) < 1e-9


def test_load_params_flattens_groups(tmp_path):
    toml = tmp_path / "case.toml"
    toml.write_text(
        '[input]\nfootprint_path = "dxfs/shape.dxf"\n'
        "[shape]\nstack_height = 6.0\n"
        "[profile]\npillow_center_offset = [1.0, -2.0]\n"
    )
    p = load_params(toml)
    assert p.footprint_path == tmp_path / "dxfs/shape.dxf"
    assert p.case_dir == tmp_path
    assert p.stack_height == 6.0
    assert p.pillow_center_offset == (1.0, -2.0)


def test_unknown_key_raises(tmp_path):
    toml = tmp_path / "case.toml"
    toml.write_text('[input]\nfootprint_path = "a.dxf"\nnonsense = 1\n')
    try:
        load_params(toml)
        assert False, "should have raised"
    except TypeError:
        pass
