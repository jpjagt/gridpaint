import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

CASE_DIR = Path(__file__).parents[2] / "case-starflower-pendant-short"
STARFLOWER_DXF = (
    CASE_DIR / "dxfs" / "starflower-pendant - starflower-short-footprint - layer-1.dxf"
)


@pytest.fixture(scope="session")
def starflower():
    from footprint import load_footprint

    return load_footprint(STARFLOWER_DXF)


@pytest.fixture(scope="session")
def default_params():
    from params import CaseParams

    return CaseParams(
        footprint_path=STARFLOWER_DXF, case_dir=CASE_DIR, mesh_size=1.0
    )


@pytest.fixture(scope="session")
def plan(default_params, starflower):
    from geometry2d import build_plan

    return build_plan(default_params, starflower)


@pytest.fixture(scope="session")
def surf(default_params, plan):
    from surfaces import Surfaces

    return Surfaces(default_params, plan)
