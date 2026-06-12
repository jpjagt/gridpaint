import numpy as np
import pytest

from conftest import STARFLOWER_DXF
from footprint import load_footprint


def test_loads_starflower_dxf():
    poly = load_footprint(STARFLOWER_DXF)
    minx, miny, maxx, maxy = poly.bounds
    assert np.isclose(maxx - minx, 25.2, atol=0.01)
    assert np.isclose(maxy - miny, 32.4, atol=0.01)
    # normalized: bbox centered at origin
    assert np.isclose(minx + maxx, 0.0, atol=1e-9)
    assert np.isclose(miny + maxy, 0.0, atol=1e-9)
    assert poly.is_valid and poly.area > 100


def test_unsupported_format_raises(tmp_path):
    f = tmp_path / "shape.png"
    f.write_bytes(b"")
    with pytest.raises(ValueError, match="unsupported"):
        load_footprint(f)


def test_svg_roundtrip(tmp_path):
    f = tmp_path / "square.svg"
    f.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
        '<path d="M 0 0 L 10 0 L 10 10 L 0 10 Z"/></svg>'
    )
    poly = load_footprint(f)
    minx, miny, maxx, maxy = poly.bounds
    assert np.isclose(maxx - minx, 10.0, atol=0.1)
    assert np.isclose(maxy - miny, 10.0, atol=0.1)
