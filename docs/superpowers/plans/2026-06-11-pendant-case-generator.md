# Pendant Case Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parametric Python tool (`3d-models/casegen/`) that generates watertight body + lid STL masters for cast pendant cases from a DXF/SVG footprint, per `docs/superpowers/specs/2026-06-11-pendant-case-generator-design.md`.

**Architecture:** All geometry is built as two heightfields (top/bottom z over a 2D plan domain). 2D outlines come from shapely (footprint, pocket, chain trough) and a smooth-min SDF (superellipse + bolt-tab circles → silhouette, extracted via contourpy). The plan domain is triangulated with the `triangle` package (constrained Delaunay, `YY` flags so no Steiner points land on constrained segments), each vertex gets per-region z values, vertical walls are stitched along discontinuity loops, and trimesh assembles/validates watertight STLs.

**Tech Stack:** Python ≥3.11, numpy, shapely 2.x, triangle, trimesh, ezdxf, svgelements, matplotlib, contourpy, pytest, uv.

**Spec deviations (intentional):** `ring_z_top` default raised 13.5 → 14.5 mm so the lid web at the ring seat meets the ≥2 mm rule. The spec's PEP 723 note is superseded by a `pyproject.toml` uv project (works for both `uv run casegen.py …` and `uv run pytest`).

**Working directory for all commands:** `3d-models/casegen/` unless stated otherwise.

---

## File structure

```
3d-models/casegen/
  pyproject.toml      # uv project, deps, package=false
  casegen.py          # CLI entry + validation
  params.py           # CaseParams dataclass + TOML loader
  footprint.py        # DXF/SVG → normalized shapely Polygon
  profiles.py         # f_axis, f_diag, quarter_weight, smoothstep
  geometry2d.py       # PlanGeometry: outlines, SDF, silhouette, polar lookup
  surfaces.py         # Surfaces: z_part, chain carve, dome, belly, lid fns
  meshing.py          # CDT, SoupBuilder, generate_meshes
  preview.py          # preview.png + profile-sections.png
  tests/
    conftest.py       # fixtures (real starflower DXF, shared plan/surfaces)
    test_params.py
    test_footprint.py
    test_profiles.py
    test_geometry2d.py
    test_surfaces.py
    test_meshing.py
    test_end_to_end.py
3d-models/case-starflower-pendant-short/
  case.toml           # parameters for the starflower case
  output/             # generated (gitignored): body.stl, lid.stl, *.png
```

Key shared facts used throughout (derived in `params.py` as properties):
`z_eq = z_rim + slope_drop`, `pocket_depth = stack_height + pocket_clearance_z`,
`floor_z = z_rim − pocket_body_fraction·pocket_depth`, `ceiling_z = floor_z + pocket_depth`.
The lid is generated in the closed-case frame shifted up by `fit_gap` (its rim sits at `z_eq + fit_gap`), then optionally flipped dome-down for export.

---

### Task 1: Project scaffolding

**Files:**
- Create: `3d-models/casegen/pyproject.toml`
- Create: `3d-models/casegen/tests/conftest.py`
- Create: `3d-models/casegen/.gitignore`

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "casegen"
version = "0.1.0"
description = "Parametric cast-case (body+lid) STL generator for laser-cut pendants"
requires-python = ">=3.11"
dependencies = [
    "numpy>=1.26",
    "shapely>=2.0",
    "triangle>=20230923",
    "trimesh>=4.0",
    "ezdxf>=1.1",
    "svgelements>=1.9",
    "matplotlib>=3.8",
    "contourpy>=1.2",
]

[dependency-groups]
dev = ["pytest>=8"]

[tool.uv]
package = false
```

- [ ] **Step 2: Write tests/conftest.py**

Fixtures are session-scoped because plan/mesh construction takes seconds. `mesh_size=1.0` keeps tests fast (production default is 0.5).

```python
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
```

- [ ] **Step 3: Write .gitignore**

```
.venv/
__pycache__/
uv.lock
```

(`output/` dirs are per-case; add `3d-models/case-*/output/` to the repo root `.gitignore` in Task 9.)

- [ ] **Step 4: Verify pytest collects (no tests yet → exit code 5 is expected)**

Run: `cd 3d-models/casegen && uv run pytest tests -v`
Expected: "no tests ran" (exit code 5), and the environment resolves/installs all dependencies without error. If `triangle` fails to build on this machine, STOP and report — the meshing approach depends on it.

- [ ] **Step 5: Commit**

```bash
git add 3d-models/casegen
git commit -m "feat(casegen): scaffold uv project for pendant case generator"
```

---

### Task 2: Parameters module

**Files:**
- Create: `3d-models/casegen/params.py`
- Test: `3d-models/casegen/tests/test_params.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_params.py -v`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'params'`

- [ ] **Step 3: Implement params.py**

```python
"""Case parameters: dataclass with derived values + TOML loader.

All lengths in mm. TOML files use [groups] purely for readability; the
loader flattens them, so keys must match field names exactly.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CaseParams:
    # input
    footprint_path: Path
    case_dir: Path
    # shape
    stack_height: float = 4.0
    # pocket
    pocket_clearance: float = 0.5
    pocket_clearance_z: float = 0.5
    pocket_body_fraction: float = 0.66
    rim_flat_width: float = 1.0
    # plan
    margin_x: float = 9.0
    margin_y: float = 9.0
    n_plan: float = 2.3
    # tabs
    tab_radius: float = 7.0
    tab_offset: float = 2.0
    neck_k: float = 6.0
    # heights
    z_rim: float = 6.0
    slope_drop: float = 6.0
    lid_height: float = 9.0
    belly_depth: float = 16.0
    # profile
    profile_axis_a: float = 2.5
    profile_diag_b: float = 2.2
    quarter_sharpness: float = 1.5
    pillow_center_offset: tuple[float, float] = (0.0, 0.0)
    # side
    p_side: float = 2.5
    q_side: float = 2.5
    # fit
    fit_gap: float = 0.15
    # chain
    chain_width: float = 2.4
    chain_depth: float = 2.0
    trough_offset: float = 3.0
    # bolt
    bolt_hole_d: float = 4.4
    ring_z_top: float = 14.5
    ring_d: float = 11.0
    ring_blend_k: float = 5.0
    funnel_grade: float = 1.2
    nut_recess_d: float = 8.4
    nut_recess_h: float = 3.5
    tab_flat_blend: float = 4.0
    # magnets
    magnets_enabled: bool = False
    # mesh
    mesh_size: float = 0.5
    lid_print_orientation: str = "dome_down"

    @property
    def z_eq(self) -> float:
        return self.z_rim + self.slope_drop

    @property
    def pocket_depth(self) -> float:
        return self.stack_height + self.pocket_clearance_z

    @property
    def floor_z(self) -> float:
        return self.z_rim - self.pocket_body_fraction * self.pocket_depth

    @property
    def ceiling_z(self) -> float:
        return self.floor_z + self.pocket_depth


def load_params(toml_path: str | Path) -> CaseParams:
    toml_path = Path(toml_path)
    raw = tomllib.loads(toml_path.read_text())
    flat: dict = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            flat.update(value)
        else:
            flat[key] = value
    case_dir = toml_path.parent
    flat["footprint_path"] = case_dir / flat["footprint_path"]
    if "pillow_center_offset" in flat:
        flat["pillow_center_offset"] = tuple(flat["pillow_center_offset"])
    return CaseParams(case_dir=case_dir, **flat)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_params.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add params.py tests/test_params.py
git commit -m "feat(casegen): CaseParams dataclass and TOML loader"
```

---

### Task 3: Footprint loader

**Files:**
- Create: `3d-models/casegen/footprint.py`
- Test: `3d-models/casegen/tests/test_footprint.py`

The starflower DXF is a single closed `POLYLINE` (flag 70=1, all bulges 0), extents ≈ 25.2 × 32.4 mm. The loaded polygon is normalized so its bbox center sits at the origin.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_footprint.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'footprint'`

- [ ] **Step 3: Implement footprint.py**

```python
"""Load a pendant footprint outline (DXF or SVG) into a shapely Polygon.

The outline is normalized so its bounding-box center is at the origin.
Only the largest closed outline is used; interior holes are ignored.
DXF (mm units, closed POLYLINE/LWPOLYLINE) is the primary format; SVG is
best-effort (paths are sampled, transforms applied by svgelements, y-axis
kept as-is).
"""

from __future__ import annotations

from pathlib import Path

from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon


def load_footprint(path: str | Path) -> Polygon:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".dxf":
        rings = _dxf_rings(path)
    elif suffix == ".svg":
        rings = _svg_rings(path)
    else:
        raise ValueError(f"unsupported footprint format: {suffix}")

    polys: list[Polygon] = []
    for ring in rings:
        poly = Polygon(ring)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda g: g.area)
        if not poly.is_empty:
            polys.append(poly)
    if not polys:
        raise ValueError(f"no closed outline found in {path}")

    poly = max(polys, key=lambda p: p.area)
    poly = Polygon(poly.exterior)  # drop interior holes
    minx, miny, maxx, maxy = poly.bounds
    return affinity.translate(poly, -(minx + maxx) / 2.0, -(miny + maxy) / 2.0)


def _dxf_rings(path: Path) -> list[list[tuple[float, float]]]:
    import ezdxf

    doc = ezdxf.readfile(str(path))
    rings = []
    for entity in doc.modelspace():
        kind = entity.dxftype()
        if kind == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in entity.get_points()]
            closed = entity.closed
        elif kind == "POLYLINE":
            pts = [
                (v.dxf.location.x, v.dxf.location.y) for v in entity.vertices
            ]
            closed = entity.is_closed
        else:
            continue
        if closed and len(pts) >= 3:
            rings.append(pts)
    return rings


def _svg_rings(path: Path) -> list[list[tuple[float, float]]]:
    from svgelements import SVG, Path as SvgPath, Shape

    rings = []
    for element in SVG.parse(str(path)).elements():
        if not isinstance(element, Shape):
            continue
        svg_path = SvgPath(element)
        if len(svg_path) == 0:
            continue
        length = svg_path.length(error=1e-3)
        n = max(64, int(length))
        pts = []
        for i in range(n):
            point = svg_path.point(i / (n - 1))
            if point is not None:
                pts.append((float(point.real), float(point.imag)))
        if len(pts) >= 3:
            rings.append(pts)
    return rings
```

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_footprint.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add footprint.py tests/test_footprint.py
git commit -m "feat(casegen): DXF/SVG footprint loader with bbox normalization"
```

---

### Task 4: Profile curves

**Files:**
- Create: `3d-models/casegen/profiles.py`
- Test: `3d-models/casegen/tests/test_profiles.py`

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np

from profiles import f_axis, f_diag, quarter_weight, smoothstep


def test_f_axis_endpoints_and_flat_ends():
    a = 2.5
    assert f_axis(0.0, a) == 0.0
    assert f_axis(1.0, a) == 1.0
    assert np.isclose(f_axis(0.5, a), 0.5)
    # sigmoid: zero slope at both ends (finite difference)
    h = 1e-4
    assert (f_axis(h, a) - f_axis(0.0, a)) / h < 0.01
    assert (f_axis(1.0, a) - f_axis(1.0 - h, a)) / h < 0.01


def test_f_diag_steep_start_flat_end():
    b = 2.2
    assert f_diag(0.0, b) == 0.0
    assert f_diag(1.0, b) == 1.0
    h = 1e-4
    # slope at 0 is ~b, slope at 1 is ~0
    assert np.isclose((f_diag(h, b) - 0.0) / h, b, rtol=0.01)
    assert (f_diag(1.0, b) - f_diag(1.0 - h, b)) / h < 0.01


def test_diagonal_above_axis_mid_slope():
    t = 0.35
    assert f_diag(t, 2.2) > f_axis(t, 2.5)


def test_quarter_weight():
    k = 1.5
    assert np.isclose(quarter_weight(0.0, k), 1.0)
    assert np.isclose(quarter_weight(np.pi / 2, k), 1.0)
    assert np.isclose(quarter_weight(np.pi / 4, k), 0.0, atol=1e-9)


def test_smoothstep():
    assert smoothstep(-1.0) == 0.0
    assert smoothstep(2.0) == 1.0
    assert np.isclose(smoothstep(0.5), 0.5)
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'profiles'`

- [ ] **Step 3: Implement profiles.py**

```python
"""Slope profile curves for the pillow parting surface.

All functions are vectorized over numpy arrays and map [0,1] -> [0,1].
- f_axis: "gain" sigmoid — slow start, steep middle, horizontal at t=1.
  Used along the straight horizontal/vertical axes.
- f_diag: steep start (slope b at t=0), horizontal at t=1.
  Used along the diagonals.
- quarter_weight: |cos 2θ|^k blend — 1 on the axes, 0 on the diagonals.
"""

import numpy as np


def f_axis(t, a):
    t = np.clip(np.asarray(t, dtype=float), 0.0, 1.0)
    num = t**a
    return num / (num + (1.0 - t) ** a)


def f_diag(t, b):
    t = np.clip(np.asarray(t, dtype=float), 0.0, 1.0)
    return 1.0 - (1.0 - t) ** b


def quarter_weight(theta, k):
    return np.abs(np.cos(2.0 * np.asarray(theta, dtype=float))) ** k


def smoothstep(x):
    x = np.clip(np.asarray(x, dtype=float), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)
```

Note: `f_axis`/`f_diag`/`smoothstep` return 0-d arrays for scalar input; numpy comparisons in the tests handle that transparently.

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add profiles.py tests/test_profiles.py
git commit -m "feat(casegen): pillow slope profile curves"
```

---

### Task 5: Plan geometry (outlines, SDF, silhouette, polar lookup)

**Files:**
- Create: `3d-models/casegen/geometry2d.py`
- Test: `3d-models/casegen/tests/test_geometry2d.py`

The silhouette is the zero level-set of `smin(superellipse_sdf, circle_sdf_top, circle_sdf_bottom)` extracted with contourpy on a 0.25 mm grid. The superellipse "distance" is the implicit value scaled by `min(a,b)` — approximate, but the t-field only needs monotonicity and an exact zero at the boundary. The silhouette is star-shaped with respect to the origin, so a sorted polar table `R(θ)` gives the normalized radius for the dome/belly.

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np
from shapely.geometry import Point


def test_silhouette_dimensions(plan, default_params):
    p = default_params
    # half-extents: footprint 25.2 x 32.4 -> a=21.6, b=25.2
    assert np.isclose(plan.a, 12.6 + p.margin_x, atol=0.05)
    assert np.isclose(plan.b, 16.2 + p.margin_y, atol=0.05)
    minx, miny, maxx, maxy = plan.silhouette_poly.bounds
    # y extent reaches the tab circles: b + tab_offset + tab_radius
    assert np.isclose(maxy, p.tab_radius + p.tab_offset + plan.b, atol=0.3)
    assert np.isclose(maxx, plan.a, atol=0.3)


def test_sdf_signs(plan):
    assert plan.sdf([[0.0, 0.0]])[0] < -5.0          # deep inside
    assert plan.sdf([[100.0, 0.0]])[0] > 5.0         # far outside
    # near-zero on the extracted silhouette loop
    on_loop = plan.sdf(plan.silhouette_loop[::20])
    assert np.all(np.abs(on_loop) < 0.15)


def test_boundary_radius(plan, default_params):
    p = default_params
    # through the tab: R(pi/2) = b + tab_offset + tab_radius
    expected_top = plan.b + p.tab_offset + p.tab_radius
    assert np.isclose(plan.boundary_radius(np.pi / 2), expected_top, atol=0.3)
    assert np.isclose(plan.boundary_radius(0.0), plan.a, atol=0.3)


def test_containment_chain(plan):
    assert plan.silhouette_poly.contains(plan.slope_inner)
    assert plan.slope_inner.contains(plan.pocket)
    assert plan.pocket.contains(plan.footprint)
    # chain region sits between pocket and silhouette
    assert plan.silhouette_poly.contains(plan.chain_region)
    assert plan.chain_region.intersection(plan.pocket).area < 1e-6


def test_chain_region_is_ring_plus_channel(plan):
    # the trough is an annulus -> region has at least one interior ring
    from shapely.geometry import MultiPolygon, Polygon

    geoms = (
        list(plan.chain_region.geoms)
        if isinstance(plan.chain_region, MultiPolygon)
        else [plan.chain_region]
    )
    assert sum(len(g.interiors) for g in geoms) >= 1


def test_tab_centers(plan, default_params):
    (x0, y0), (x1, y1) = plan.tab_centers
    assert x0 == x1 == 0.0
    assert np.isclose(y0, -y1)
    assert np.isclose(abs(y0), plan.b + default_params.tab_offset)
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_geometry2d.py -v`
Expected: ERROR with `ModuleNotFoundError: No module named 'geometry2d'` (fixture `plan` fails)

- [ ] **Step 3: Implement geometry2d.py**

```python
"""2D plan geometry: pocket/shelf outlines, silhouette SDF + extraction,
polar boundary lookup, chain trough + channel centerlines."""

from __future__ import annotations

from dataclasses import dataclass, field

import contourpy
import numpy as np
from shapely.geometry import LinearRing, LineString, Point, Polygon
from shapely.ops import nearest_points, unary_union

SILHOUETTE_GRID_STEP = 0.25  # mm


@dataclass
class PlanGeometry:
    footprint: Polygon
    pocket: Polygon
    slope_inner: Polygon            # pocket + rim shelf band
    silhouette_loop: np.ndarray     # (N,2) CCW, no repeated last point
    silhouette_poly: Polygon
    a: float
    b: float
    tab_centers: list[tuple[float, float]]
    chain_centerlines: object       # shapely geometry (ring + channel)
    chain_region: object            # (Multi)Polygon carved into body top
    pillow_center: tuple[float, float]
    _theta_table: np.ndarray = field(repr=False, default=None)
    _radius_table: np.ndarray = field(repr=False, default=None)
    _sdf: object = field(repr=False, default=None)

    def sdf(self, points) -> np.ndarray:
        return self._sdf(np.atleast_2d(np.asarray(points, dtype=float)))

    def boundary_radius(self, theta) -> np.ndarray:
        return np.interp(
            np.asarray(theta, dtype=float),
            self._theta_table,
            self._radius_table,
            period=2.0 * np.pi,
        )


def make_sdf(a, b, n_plan, tab_centers, tab_radius, neck_k):
    """Approximate SDF: smooth-min of superellipse and tab circles.

    Negative inside, zero on the silhouette, units ~mm.
    """
    scale = min(a, b)
    centers = np.asarray(tab_centers, dtype=float)

    def sdf(P):
        x, y = P[:, 0], P[:, 1]
        f = (np.abs(x / a) ** n_plan + np.abs(y / b) ** n_plan) ** (
            1.0 / n_plan
        ) - 1.0
        fields = [f * scale]
        for cx, cy in centers:
            fields.append(np.hypot(x - cx, y - cy) - tab_radius)
        D = np.stack(fields)
        m = D.min(axis=0)
        return m - np.log(np.exp(-neck_k * (D - m)).sum(axis=0)) / neck_k

    return sdf


def build_plan(params, footprint: Polygon) -> PlanGeometry:
    minx, miny, maxx, maxy = footprint.bounds
    half_w, half_h = (maxx - minx) / 2.0, (maxy - miny) / 2.0
    a = half_w + params.margin_x
    b = half_h + params.margin_y
    y_tab = b + params.tab_offset
    tab_centers = [(0.0, y_tab), (0.0, -y_tab)]
    sdf = make_sdf(a, b, params.n_plan, tab_centers, params.tab_radius, params.neck_k)

    pocket = footprint.buffer(params.pocket_clearance, join_style="round")
    slope_inner = (
        pocket.buffer(params.rim_flat_width, join_style="round")
        if params.rim_flat_width > 0
        else pocket
    )

    # --- silhouette via marching squares on the SDF grid ---
    pad = 3.0
    x_max = a + pad
    y_max = y_tab + params.tab_radius + pad
    xs = np.linspace(-x_max, x_max, int(np.ceil(2 * x_max / SILHOUETTE_GRID_STEP)) + 1)
    ys = np.linspace(-y_max, y_max, int(np.ceil(2 * y_max / SILHOUETTE_GRID_STEP)) + 1)
    X, Y = np.meshgrid(xs, ys)
    Z = sdf(np.column_stack([X.ravel(), Y.ravel()])).reshape(X.shape)
    lines = contourpy.contour_generator(X, Y, Z).lines(0.0)
    if not lines:
        raise ValueError("silhouette extraction found no zero contour")
    loop = max(
        lines, key=lambda l: Polygon(l).area if len(l) >= 3 else 0.0
    )
    ring = LinearRing(loop).simplify(0.02)
    silhouette_poly = Polygon(ring)
    sil_coords = np.asarray(ring.coords, dtype=float)[:-1]
    if LinearRing(sil_coords).is_ccw is False:
        sil_coords = sil_coords[::-1]

    theta = np.arctan2(sil_coords[:, 1], sil_coords[:, 0])
    radius = np.hypot(sil_coords[:, 0], sil_coords[:, 1])
    order = np.argsort(theta)

    # --- chain trough (stadium ring around the pocket) + channel ---
    trough_ring = (
        pocket.convex_hull.buffer(params.trough_offset, join_style="round")
        .exterior.simplify(0.05)
    )
    pocket_pts = np.asarray(pocket.exterior.coords, dtype=float)
    p_top = tuple(pocket_pts[np.argmax(pocket_pts[:, 1])])
    p_near = nearest_points(Point(p_top), trough_ring)[1]
    channel = LineString([p_top, (p_near.x, p_near.y)])
    chain_centerlines = unary_union([trough_ring, channel])
    chain_region = chain_centerlines.buffer(
        params.chain_width / 2.0, cap_style="round"
    ).difference(pocket)

    c = pocket.centroid
    off = params.pillow_center_offset
    pillow_center = (c.x + off[0], c.y + off[1])

    return PlanGeometry(
        footprint=footprint,
        pocket=pocket,
        slope_inner=slope_inner,
        silhouette_loop=sil_coords,
        silhouette_poly=silhouette_poly,
        a=a,
        b=b,
        tab_centers=tab_centers,
        chain_centerlines=chain_centerlines,
        chain_region=chain_region,
        pillow_center=pillow_center,
        _theta_table=theta[order],
        _radius_table=radius[order],
        _sdf=sdf,
    )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_geometry2d.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add geometry2d.py tests/test_geometry2d.py
git commit -m "feat(casegen): plan geometry with smooth-min silhouette and chain trough"
```

---

### Task 6: Surface heightfields

**Files:**
- Create: `3d-models/casegen/surfaces.py`
- Test: `3d-models/casegen/tests/test_surfaces.py`

All methods take `(N,2)` arrays and return `(N,)` z values, in the closed-case frame (z=0 is the table). Lid functions include the `fit_gap` shift.

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np


def _point_at_t(plan, surf, direction, t_target):
    """Walk from the pillow center along `direction` until the t-field
    reaches t_target (bisection between slope_inner edge and silhouette)."""
    cx, cy = plan.pillow_center
    d = np.asarray(direction, dtype=float)
    d = d / np.hypot(*d)
    lo, hi = 0.0, 80.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        p = np.array([[cx + d[0] * mid, cy + d[1] * mid]])
        if surf._t(p)[0] < t_target:
            lo = mid
        else:
            hi = mid
    return np.array([[cx + d[0] * lo, cy + d[1] * lo]])


def test_z_part_boundary_values(plan, surf, default_params):
    p = default_params
    # inside the shelf band -> z_rim exactly
    inner = np.array([plan.pillow_center])
    assert np.isclose(surf.z_part(inner)[0], p.z_rim)
    # on the silhouette -> z_eq (within contour tolerance)
    on_edge = plan.silhouette_loop[::40]
    assert np.allclose(surf.z_part(on_edge), p.z_eq, atol=0.1)


def test_diagonal_higher_than_axis_at_same_t(plan, surf):
    t = 0.35
    z_axis = surf.z_part(_point_at_t(plan, surf, (1.0, 0.0), t))[0]
    z_diag = surf.z_part(_point_at_t(plan, surf, (1.0, 1.0), t))[0]
    assert z_diag > z_axis + 0.5


def test_chain_carve(plan, surf, default_params):
    p = default_params
    # at a trough centerline point the carve is >= chain_depth
    ring_pt = np.asarray(plan.chain_centerlines.geoms[0].coords)[0:1]
    carve = surf.chain_carve(ring_pt)
    assert carve[0] >= p.chain_depth * 0.99
    # far away: zero
    assert surf.chain_carve(np.array([plan.pillow_center]))[0] == 0.0


def test_body_bottom(plan, surf, default_params):
    p = default_params
    # flat under the center
    assert surf.body_bottom(np.array([[0.0, 0.0]]))[0] == 0.0
    # zero at the tab centers (flat tab underside)
    tabs = np.asarray(plan.tab_centers)
    assert np.allclose(surf.body_bottom(tabs), 0.0, atol=1e-6)
    # equator at the silhouette
    assert np.allclose(
        surf.body_bottom(plan.silhouette_loop[::40]), p.z_eq, atol=0.1
    )


def test_lid_surfaces(plan, surf, default_params):
    p = default_params
    center = np.array([[0.0, 0.0]])
    assert np.isclose(
        surf.lid_top(center)[0], p.z_eq + p.fit_gap + p.lid_height, atol=0.05
    )
    # ring seat: flat at ring_z_top above the tab center
    tabs = np.asarray(plan.tab_centers)
    assert np.allclose(surf.lid_top(tabs), p.ring_z_top, atol=0.1)
    # lid underside above the pillow by ~fit_gap
    pt = _point_at_t(plan, surf, (0.0, 1.0), 0.5)
    gap = surf.lid_bottom(pt)[0] - surf.z_part(pt)[0]
    assert p.fit_gap * 0.99 < gap < p.fit_gap * 2.5
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_surfaces.py -v`
Expected: ERROR with `ModuleNotFoundError: No module named 'surfaces'`

- [ ] **Step 3: Implement surfaces.py**

```python
"""Heightfield functions for body and lid surfaces (closed-case frame)."""

from __future__ import annotations

import numpy as np
import shapely

import profiles


class Surfaces:
    def __init__(self, params, plan):
        self.p = params
        self.plan = plan

    # ----- pillow parting surface ------------------------------------
    def _t(self, P):
        """Normalized slope coordinate: 0 at the shelf edge, 1 at the
        silhouette."""
        P = np.atleast_2d(np.asarray(P, dtype=float))
        d_in = shapely.distance(shapely.points(P), self.plan.slope_inner)
        d_edge = np.maximum(-self.plan.sdf(P), 0.0)
        denom = np.maximum(d_in + d_edge, 1e-9)
        return np.where(d_in <= 0.0, 0.0, d_in / denom)

    def z_part(self, P):
        P = np.atleast_2d(np.asarray(P, dtype=float))
        t = self._t(P)
        cx, cy = self.plan.pillow_center
        theta = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
        w = profiles.quarter_weight(theta, self.p.quarter_sharpness)
        f = w * profiles.f_axis(t, self.p.profile_axis_a) + (
            1.0 - w
        ) * profiles.f_diag(t, self.p.profile_diag_b)
        return self.p.z_rim + self.p.slope_drop * f

    def slope_factor(self, P, h=0.05):
        """sqrt(1 + |grad z_part|^2) via central differences."""
        P = np.atleast_2d(np.asarray(P, dtype=float))
        gx = (self.z_part(P + [h, 0.0]) - self.z_part(P - [h, 0.0])) / (2 * h)
        gy = (self.z_part(P + [0.0, h]) - self.z_part(P - [0.0, h])) / (2 * h)
        return np.sqrt(1.0 + gx**2 + gy**2)

    # ----- chain groove ------------------------------------------------
    def chain_carve(self, P):
        """Vertical carve depth for the chain trough + channel (elliptic U
        cross-section, depth measured perpendicular to the local surface)."""
        P = np.atleast_2d(np.asarray(P, dtype=float))
        s = shapely.distance(shapely.points(P), self.plan.chain_centerlines)
        u = 1.0 - (2.0 * s / self.p.chain_width) ** 2
        carve = self.p.chain_depth * np.sqrt(np.clip(u, 0.0, 1.0))
        out = np.zeros(len(P))
        hit = carve > 0.0
        if np.any(hit):
            out[hit] = carve[hit] * self.slope_factor(P[hit])
        return out

    def body_top(self, P):
        return self.z_part(P) - self.chain_carve(P)

    # ----- outer shell (dome / belly) ----------------------------------
    def _rho(self, P):
        P = np.atleast_2d(np.asarray(P, dtype=float))
        r = np.hypot(P[:, 0], P[:, 1])
        R = self.plan.boundary_radius(np.arctan2(P[:, 1], P[:, 0]))
        return np.clip(r / np.maximum(R, 1e-9), 0.0, 1.0)

    def _shell(self, P, height):
        rho = self._rho(P)
        return height * (1.0 - rho**self.p.p_side) ** (1.0 / self.p.q_side)

    def body_bottom(self, P):
        P = np.atleast_2d(np.asarray(P, dtype=float))
        z = self.p.z_eq - self._shell(P, self.p.belly_depth)
        d_tab = np.min(
            [np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]) for c in self.plan.tab_centers],
            axis=0,
        )
        mask = profiles.smoothstep(
            (d_tab - self.p.tab_radius) / self.p.tab_flat_blend
        )
        return np.maximum(z * mask, 0.0)

    # ----- lid ----------------------------------------------------------
    def lid_bottom(self, P):
        return self.z_part(P) + self.p.fit_gap * self.slope_factor(P)

    def lid_top(self, P):
        P = np.atleast_2d(np.asarray(P, dtype=float))
        z_dome = self.p.z_eq + self.p.fit_gap + self._shell(P, self.p.lid_height)
        fields = [z_dome]
        for cx, cy in self.plan.tab_centers:
            d = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
            fields.append(
                self.p.ring_z_top
                + self.p.funnel_grade * np.maximum(d - self.p.ring_d / 2.0, 0.0)
            )
        D = np.stack(fields)
        k = self.p.ring_blend_k
        m = D.min(axis=0)
        return m - np.log(np.exp(-k * (D - m)).sum(axis=0)) / k
```

Note for the test `test_chain_carve`: `plan.chain_centerlines` is a `GeometryCollection`/`MultiLineString` from `unary_union`; `.geoms[0]` is one of its parts. If `unary_union` merges into a single `LineString` (no intersection), guard with `getattr(g, "geoms", [g])` in the test instead — but ring + touching channel will stay a collection in practice.

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_surfaces.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add surfaces.py tests/test_surfaces.py
git commit -m "feat(casegen): body/lid surface heightfields"
```

---

### Task 7: Meshing

**Files:**
- Create: `3d-models/casegen/meshing.py`
- Test: `3d-models/casegen/tests/test_meshing.py`

Key correctness mechanics:
- `triangle` flags `pq30a{area}YY`: constrained segments are never split, and input vertices keep their indices (they come first in the output), so wall faces built from recorded loop indices share vertices **exactly** with the surface faces — watertightness by construction, no tolerance welding needed beyond exact-duplicate merging.
- Per-region z arrays are evaluated once for ALL vertices; faces pick their region's array. Vertices on a discontinuity loop thus appear at two different heights (one per region) and the wall strip closes the gap.
- Rim snap: vertices of the outer silhouette loop are forced to exactly `z_eq` (body top AND bottom) / `z_eq + fit_gap` (lid top AND bottom) so top and bottom surfaces weld shut at the rim (each half closes with a ~90° wedge, not a knife edge).

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np
import pytest

from meshing import generate_meshes


@pytest.fixture(scope="module")
def meshes(default_params, plan, surf):
    return generate_meshes(default_params, plan, surf)


def test_body_watertight_and_oriented(meshes):
    body, _ = meshes
    assert body.is_watertight
    assert body.is_winding_consistent
    assert body.volume > 1000.0


def test_lid_watertight_and_oriented(meshes):
    _, lid = meshes
    assert lid.is_watertight
    assert lid.is_winding_consistent
    assert lid.volume > 1000.0


def test_body_extents(meshes, default_params, plan):
    body, _ = meshes
    p = default_params
    (minx, miny, minz), (maxx, maxy, maxz) = body.bounds
    assert np.isclose(minz, 0.0, atol=1e-6)
    assert np.isclose(maxz, p.z_eq, atol=0.05)
    assert np.isclose(maxx - minx, 2 * plan.a, atol=0.5)
    expected_y = 2 * (plan.b + p.tab_offset + p.tab_radius)
    assert np.isclose(maxy - miny, expected_y, atol=0.5)


def test_lid_extents_dome_down(meshes, default_params):
    # exported orientation: flipped, resting on the dome, z starts at 0
    _, lid = meshes
    p = default_params
    (_, _, minz), (_, _, maxz) = lid.bounds
    assert np.isclose(minz, 0.0, atol=1e-6)
    # height = dome apex (z_eq+gap+lid_height) minus lowest underside point
    # (the pocket ceiling), in the unflipped frame:
    expected = (p.z_eq + p.fit_gap + p.lid_height) - (p.ceiling_z + p.fit_gap)
    assert np.isclose(maxz - minz, expected, atol=0.2)


def test_bolt_holes_pierce_both(meshes, default_params, plan):
    body, lid = meshes
    p = default_params
    # a vertical ray segment through the tab center must NOT hit any face
    for c in plan.tab_centers:
        for mesh in (body, lid):
            hits = mesh.ray.intersects_any(
                ray_origins=[[c[0], c[1], -50.0]], ray_directions=[[0, 0, 1.0]]
            )
            assert not hits[0]
```

- [ ] **Step 2: Run tests, verify failure**

Run: `uv run pytest tests/test_meshing.py -v`
Expected: ERROR with `ModuleNotFoundError: No module named 'meshing'`

- [ ] **Step 3: Implement meshing.py**

```python
"""Constrained triangulation and watertight mesh assembly."""

from __future__ import annotations

import numpy as np
import shapely
import triangle as tr
import trimesh
from shapely.geometry import LinearRing, MultiPolygon, Polygon


def densify(coords_or_geom, step):
    """Resample a closed loop to ~step spacing. Returns (N,2), open
    (last point != first point)."""
    if hasattr(coords_or_geom, "coords"):
        ring = LinearRing(coords_or_geom.coords)
    else:
        ring = LinearRing(np.asarray(coords_or_geom, dtype=float))
    ring = shapely.segmentize(ring, step)
    coords = np.asarray(ring.coords, dtype=float)
    if np.allclose(coords[0], coords[-1]):
        coords = coords[:-1]
    return coords


def circle(center, radius, step):
    n = max(16, int(np.ceil(2.0 * np.pi * radius / step)))
    th = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    return np.column_stack(
        [center[0] + radius * np.cos(th), center[1] + radius * np.sin(th)]
    )


def rings_of(geom):
    """All boundary rings (exterior + interiors) of a (Multi)Polygon."""
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    rings = []
    for p in polys:
        rings.append(np.asarray(p.exterior.coords, dtype=float)[:-1])
        for interior in p.interiors:
            rings.append(np.asarray(interior.coords, dtype=float)[:-1])
    return rings


def triangulate_part(outer, loops, hole_seeds, max_area):
    """CDT of the region inside `outer`, with `loops` as constrained edges
    and `hole_seeds` marking regions to drop (bolt holes).

    Returns (V (n,2), F (m,3), idx: name -> input-vertex index array).
    Input vertices keep their indices in V (triangle preserves them; the
    YY flags forbid Steiner points on constrained segments).
    """
    verts: list[tuple] = []
    segs: list[tuple] = []
    idx: dict[str, np.ndarray] = {}

    def add(name, pts):
        start = len(verts)
        n = len(pts)
        verts.extend(map(tuple, pts))
        segs.extend([(start + i, start + (i + 1) % n) for i in range(n)])
        idx[name] = np.arange(start, start + n)

    add("outer", outer)
    for name, pts in loops.items():
        add(name, pts)

    A = dict(
        vertices=np.asarray(verts, dtype=float),
        segments=np.asarray(segs, dtype=int),
    )
    if len(hole_seeds):
        A["holes"] = np.asarray(hole_seeds, dtype=float)
    B = tr.triangulate(A, f"pq30a{max_area:.5f}YY")
    return (
        np.asarray(B["vertices"], dtype=float),
        np.asarray(B["triangles"], dtype=int),
        idx,
    )


class SoupBuilder:
    """Collects oriented triangles in 3D; builds a welded trimesh."""

    def __init__(self, V):
        self.V = np.asarray(V, dtype=float)
        self.tris: list[np.ndarray] = []

    def surface(self, faces, z, up=True):
        if len(faces) == 0:
            return
        xy = self.V[faces]                      # (m,3,2)
        zz = z[faces][:, :, None]               # (m,3,1)
        tri3 = np.concatenate([xy, zz], axis=2)  # (m,3,3)
        if not up:
            tri3 = tri3[:, ::-1, :]
        self.tris.append(tri3)

    def wall(self, loop_idx, z_a, z_b):
        i0 = np.asarray(loop_idx)
        i1 = np.roll(i0, -1)
        a0 = np.column_stack([self.V[i0], z_a[i0]])
        a1 = np.column_stack([self.V[i1], z_a[i1]])
        b0 = np.column_stack([self.V[i0], z_b[i0]])
        b1 = np.column_stack([self.V[i1], z_b[i1]])
        self.tris.append(np.stack([a0, a1, b1], axis=1))
        self.tris.append(np.stack([a0, b1, b0], axis=1))

    def build(self):
        soup = np.concatenate(self.tris)
        mesh = trimesh.Trimesh(**trimesh.triangles.to_kwargs(soup), process=True)
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()
        trimesh.repair.fix_normals(mesh)
        if mesh.volume < 0:
            mesh.invert()
        return mesh


def generate_meshes(params, plan, surf):
    step = params.mesh_size
    max_area = 0.6 * step * step
    outer = densify(plan.silhouette_loop, step)
    pocket_loop = densify(plan.pocket.exterior, 0.6 * step)
    bolt_loops = {
        f"bolt{i}": circle(c, params.bolt_hole_d / 2.0, 0.4 * step)
        for i, c in enumerate(plan.tab_centers)
    }
    body = _build_body(params, plan, surf, outer, pocket_loop, bolt_loops, max_area)
    lid = _build_lid(params, plan, surf, outer, pocket_loop, bolt_loops, max_area)
    return body, lid


def _classify(F, V, plan, params):
    cent = V[F].mean(axis=1)
    in_pocket = shapely.contains_xy(plan.pocket, cent[:, 0], cent[:, 1])
    d_tab = np.min(
        [np.hypot(cent[:, 0] - c[0], cent[:, 1] - c[1]) for c in plan.tab_centers],
        axis=0,
    )
    in_nut = d_tab < params.nut_recess_d / 2.0
    return in_pocket, in_nut


def _build_body(params, plan, surf, outer, pocket_loop, bolt_loops, max_area):
    loops = dict(pocket=pocket_loop, **bolt_loops)
    for i, ring in enumerate(rings_of(plan.chain_region)):
        loops[f"chain{i}"] = densify(ring, 0.6 * params.mesh_size)
    for i, c in enumerate(plan.tab_centers):
        loops[f"nut{i}"] = circle(c, params.nut_recess_d / 2.0, 0.5 * params.mesh_size)

    V, F, idx = triangulate_part(outer, loops, plan.tab_centers, max_area)
    in_pocket, in_nut = _classify(F, V, plan, params)

    z_top = surf.body_top(V)
    z_top[idx["outer"]] = params.z_eq          # rim snap
    z_floor = np.full(len(V), params.floor_z)
    z_bot = surf.body_bottom(V)
    z_bot[idx["outer"]] = params.z_eq          # rim snap
    z_recess = np.full(len(V), params.nut_recess_h)

    sb = SoupBuilder(V)
    sb.surface(F[~in_pocket], z_top, up=True)
    sb.surface(F[in_pocket], z_floor, up=True)
    sb.surface(F[~in_nut], z_bot, up=False)
    sb.surface(F[in_nut], z_recess, up=False)
    sb.wall(idx["pocket"], z_top, z_floor)
    for i in range(len(plan.tab_centers)):
        sb.wall(idx[f"nut{i}"], z_recess, z_bot)
        sb.wall(idx[f"bolt{i}"], z_top, z_recess)
    return sb.build()


def _build_lid(params, plan, surf, outer, pocket_loop, bolt_loops, max_area):
    loops = dict(pocket=pocket_loop, **bolt_loops)
    V, F, idx = triangulate_part(outer, loops, plan.tab_centers, max_area)
    in_pocket, _ = _classify(F, V, plan, params)

    rim = params.z_eq + params.fit_gap
    z_top = surf.lid_top(V)
    z_top[idx["outer"]] = rim                  # rim snap
    z_bot = surf.lid_bottom(V)
    z_bot[idx["outer"]] = rim                  # rim snap
    z_ceiling = np.full(len(V), params.ceiling_z + params.fit_gap)

    sb = SoupBuilder(V)
    sb.surface(F, z_top, up=True)
    sb.surface(F[~in_pocket], z_bot, up=False)
    sb.surface(F[in_pocket], z_ceiling, up=False)
    sb.wall(idx["pocket"], z_bot, z_ceiling)
    for i in range(len(plan.tab_centers)):
        sb.wall(idx[f"bolt{i}"], z_top, z_bot)
    lid = sb.build()

    if params.lid_print_orientation == "dome_down":
        lid.apply_transform(
            trimesh.transformations.rotation_matrix(np.pi, [1.0, 0.0, 0.0])
        )
        lid.apply_translation([0.0, 0.0, -lid.bounds[0][2]])
    return lid
```

Implementation notes for the executor:
- If `mesh.is_watertight` fails, debug by exporting and inspecting `trimesh.repair.broken_faces(mesh)` — the usual culprit is a wall loop whose vertices got Steiner-split (check the `YY` flags survived) or a z array mismatch between a wall and its surface region.
- `trimesh.triangles.to_kwargs` deduplicates nothing itself; `process=True` does the exact-duplicate vertex merge.
- The body has no wall at the chain-groove boundary by design: the carve is zero exactly at the groove edge (continuous surface), the constrained `chain*` loops exist only to make the edge crisp.
- The ray test needs `rtree`/embree-less fallback; trimesh's built-in ray engine is fine at this mesh size.

- [ ] **Step 4: Run tests, verify pass**

Run: `uv run pytest tests/test_meshing.py -v`
Expected: 5 passed (allow ~30–60 s; meshing runs once per module)

- [ ] **Step 5: Commit**

```bash
git add meshing.py tests/test_meshing.py
git commit -m "feat(casegen): watertight CDT mesh assembly for body and lid"
```

---

### Task 8: Preview rendering

**Files:**
- Create: `3d-models/casegen/preview.py`
- Test: `3d-models/casegen/tests/test_preview.py`

- [ ] **Step 1: Write the failing test**

```python
from meshing import generate_meshes
from preview import render


def test_render_writes_files(default_params, plan, surf, tmp_path):
    body, lid = generate_meshes(default_params, plan, surf)
    render(default_params, plan, surf, body, lid, tmp_path)
    assert (tmp_path / "preview.png").exists()
    assert (tmp_path / "profile-sections.png").exists()
```

- [ ] **Step 2: Run test, verify failure**

Run: `uv run pytest tests/test_preview.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'preview'`

- [ ] **Step 3: Implement preview.py**

```python
"""Preview renders: plan view + 3D shaded meshes, and slope cross-sections."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np


def render(params, plan, surf, body, lid, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    _overview(params, plan, body, lid, out_dir / "preview.png")
    _sections(params, plan, surf, out_dir / "profile-sections.png")


def _plot_ring(ax, coords, **kw):
    c = np.asarray(coords)
    c = np.vstack([c, c[:1]])
    ax.plot(c[:, 0], c[:, 1], **kw)


def _overview(params, plan, body, lid, path):
    fig = plt.figure(figsize=(16, 7))

    ax = fig.add_subplot(1, 3, 1)
    _plot_ring(ax, plan.silhouette_loop, color="k", lw=1.5, label="silhouette")
    _plot_ring(ax, np.asarray(plan.footprint.exterior.coords), color="tab:blue", lw=1)
    _plot_ring(ax, np.asarray(plan.pocket.exterior.coords), color="tab:orange", lw=1)
    _plot_ring(
        ax, np.asarray(plan.slope_inner.exterior.coords), color="tab:green", lw=0.8
    )
    from meshing import rings_of

    for ring in rings_of(plan.chain_region):
        _plot_ring(ax, ring, color="tab:purple", lw=0.8)
    th = np.linspace(0, 2 * np.pi, 64)
    for cx, cy in plan.tab_centers:
        for r in (params.bolt_hole_d / 2, params.nut_recess_d / 2, params.ring_d / 2):
            ax.plot(cx + r * np.cos(th), cy + r * np.sin(th), color="tab:red", lw=0.8)
    ax.set_aspect("equal")
    ax.set_title("plan view")

    for i, (mesh, name) in enumerate([(body, "body"), (lid, "lid (print orient.)")]):
        ax3 = fig.add_subplot(1, 3, 2 + i, projection="3d")
        v, f = mesh.vertices, mesh.faces
        ax3.plot_trisurf(
            v[:, 0], v[:, 1], v[:, 2], triangles=f, cmap="viridis",
            linewidth=0, antialiased=False,
        )
        ax3.set_box_aspect(np.ptp(v, axis=0))
        ax3.set_title(name)

    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def _sections(params, plan, surf, path):
    cx, cy = plan.pillow_center
    angles = [0.0, 45.0, 90.0, 135.0]
    fig, axes = plt.subplots(2, 2, figsize=(14, 8), sharey=True)
    for ax, deg in zip(axes.ravel(), angles):
        th = np.radians(deg)
        d = np.array([np.cos(th), np.sin(th)])
        r_max = float(np.hypot(plan.a, plan.b)) + params.tab_radius + 5.0
        r = np.linspace(0.0, r_max, 500)
        P = np.column_stack([cx + r * d[0], cy + r * d[1]])
        inside = plan.sdf(P) < 0.0
        Pi, ri = P[inside], r[inside]
        ax.plot(ri, surf.body_top(Pi), label="body top")
        ax.plot(ri, surf.body_bottom(Pi), label="body bottom")
        ax.plot(ri, surf.lid_bottom(Pi), "--", label="lid underside")
        ax.plot(ri, surf.lid_top(Pi), label="lid top")
        ax.axhline(params.z_eq, color="grey", lw=0.5)
        ax.set_title(f"section at {deg:.0f}° from pillow center")
        ax.set_aspect("equal")
        ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
```

- [ ] **Step 4: Run test, verify pass**

Run: `uv run pytest tests/test_preview.py -v`
Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add preview.py tests/test_preview.py
git commit -m "feat(casegen): preview and cross-section rendering"
```

---

### Task 9: CLI, validation, case.toml, end-to-end

**Files:**
- Create: `3d-models/casegen/casegen.py`
- Create: `3d-models/case-starflower-pendant-short/case.toml`
- Modify: `.gitignore` (repo root)
- Test: `3d-models/casegen/tests/test_end_to_end.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Write case.toml** (test depends on it)

`3d-models/case-starflower-pendant-short/case.toml` — every parameter explicit so tweaking never requires reading Python:

```toml
# Case parameters for the starflower pendant (short).
# All lengths in mm. Groups are cosmetic; keys must match CaseParams fields.

[input]
footprint_path = "dxfs/starflower-pendant - starflower-short-footprint - layer-1.dxf"

[shape]
stack_height = 4.0            # 4 layers x 1mm

[pocket]
pocket_clearance = 0.5        # radial play around the footprint
pocket_clearance_z = 0.5      # vertical play
pocket_body_fraction = 0.66   # share of pocket depth in the body
rim_flat_width = 1.0          # flat shelf around the pocket before the slope

[plan]
margin_x = 9.0                # silhouette half-axis margin beyond footprint
margin_y = 9.0
n_plan = 2.3                  # 2 = ellipse, higher = squircle

[tabs]
tab_radius = 7.0
tab_offset = 2.0              # tab center beyond the oval end
neck_k = 6.0                  # smooth-union sharpness (higher = tighter neck)

[heights]
z_rim = 6.0                   # parting surface at the pocket rim
slope_drop = 6.0              # rise rim -> seam (seam = z_rim + slope_drop)
lid_height = 9.0              # dome above the seam
belly_depth = 16.0            # > seam height => flat bottom appears

[profile]
profile_axis_a = 2.5          # axis sigmoid exponent
profile_diag_b = 2.2          # diagonal profile exponent
quarter_sharpness = 1.5       # pillow quarter blend
pillow_center_offset = [0.0, 0.0]

[side]
p_side = 2.5                  # dome/belly superellipse exponents
q_side = 2.5

[fit]
fit_gap = 0.15                # lid/body clearance along the surface normal

[chain]
chain_width = 2.4
chain_depth = 2.0
trough_offset = 3.0           # ring distance from the pocket hull

[bolt]
bolt_hole_d = 4.4             # M4 clearance
ring_z_top = 14.5             # lid ring seat height
ring_d = 11.0
ring_blend_k = 5.0
funnel_grade = 1.2
nut_recess_d = 8.4            # M4 nut + play
nut_recess_h = 3.5
tab_flat_blend = 4.0

[magnets]
magnets_enabled = false

[mesh]
mesh_size = 0.5
lid_print_orientation = "dome_down"
```

- [ ] **Step 3: Run test, verify failure**

Run: `uv run pytest tests/test_end_to_end.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'casegen'`

- [ ] **Step 4: Implement casegen.py**

```python
#!/usr/bin/env python3
"""Generate cast-case masters (body + lid STL) for a laser-cut pendant.

Usage:  uv run casegen.py ../case-<name>/case.toml [--preview-only]
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
from shapely.geometry import Point

import meshing
import preview
from footprint import load_footprint
from geometry2d import build_plan
from params import load_params
from surfaces import Surfaces


def validate(params, plan, surf):
    errors = []

    if not plan.silhouette_poly.buffer(-1.0).contains(plan.slope_inner):
        errors.append(
            "slope band too thin: shelf edge within 1mm of the silhouette "
            "(increase margin_x/margin_y or reduce rim_flat_width)"
        )
    if not plan.silhouette_poly.buffer(-1.0).contains(plan.chain_region):
        errors.append("chain trough/channel within 1mm of the silhouette")
    for c in plan.tab_centers:
        if plan.chain_region.distance(Point(c)) <= params.ring_d / 2.0:
            errors.append(f"chain region overlaps the bolt ring at {c}")
    if params.floor_z < 1.5:
        errors.append(
            f"pocket floor web {params.floor_z:.2f}mm < 1.5mm "
            "(raise z_rim or reduce pocket depth/body fraction)"
        )
    if params.ring_z_top - (params.z_eq + params.fit_gap) < 2.0:
        errors.append("lid web at the ring seat < 2mm (raise ring_z_top)")
    if params.z_eq - params.nut_recess_h < 2.0:
        errors.append("body web above the nut recess < 2mm")

    # lid web above the pocket recess (sampled over the pocket)
    minx, miny, maxx, maxy = plan.pocket.bounds
    xs = np.linspace(minx, maxx, 30)
    ys = np.linspace(miny, maxy, 30)
    X, Y = np.meshgrid(xs, ys)
    P = np.column_stack([X.ravel(), Y.ravel()])
    import shapely

    inside = shapely.contains_xy(plan.pocket, P[:, 0], P[:, 1])
    web = surf.lid_top(P[inside]) - (params.ceiling_z + params.fit_gap)
    if web.min() < 1.5:
        errors.append(
            f"lid web above the pocket {web.min():.2f}mm < 1.5mm "
            "(raise lid_height or lower ceiling via pocket_body_fraction)"
        )

    if errors:
        raise ValueError("invalid case parameters:\n- " + "\n- ".join(errors))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("config", help="path to a case.toml")
    ap.add_argument(
        "--preview-only",
        action="store_true",
        help="render previews but skip STL export",
    )
    args = ap.parse_args(argv)

    params = load_params(args.config)
    fp = load_footprint(params.footprint_path)
    plan = build_plan(params, fp)
    surf = Surfaces(params, plan)
    validate(params, plan, surf)

    body, lid = meshing.generate_meshes(params, plan, surf)
    out = params.case_dir / "output"
    out.mkdir(exist_ok=True)
    preview.render(params, plan, surf, body, lid, out)
    if not args.preview_only:
        body.export(out / "body.stl")
        lid.export(out / "lid.stl")

    bw, bh = body.bounds[1][:2] - body.bounds[0][:2]
    print(f"body: {bw:.1f} x {bh:.1f} x {body.bounds[1][2]:.1f} mm, "
          f"{len(body.faces)} faces, watertight={body.is_watertight}")
    print(f"lid:  {len(lid.faces)} faces, watertight={lid.is_watertight}")
    print(f"output -> {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 5: Add output dirs to the repo-root .gitignore**

Append to `/Users/jeroen/code/jpjagt/gridpaint/.gitignore` (create the lines, keep existing content):

```
3d-models/case-*/output/
```

- [ ] **Step 6: Run tests, verify pass**

Run: `uv run pytest tests/test_end_to_end.py -v`
Expected: 2 passed

- [ ] **Step 7: Run the full suite**

Run: `uv run pytest tests -v`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add casegen.py tests/test_end_to_end.py ../case-starflower-pendant-short/case.toml ../../.gitignore
git commit -m "feat(casegen): CLI, parameter validation, starflower case config"
```

---

### Task 10: Full-resolution generation + human review

**Files:**
- Generated: `3d-models/case-starflower-pendant-short/output/*` (gitignored)

- [ ] **Step 1: Generate the real case at production resolution**

Run: `cd 3d-models/casegen && uv run casegen.py "../case-starflower-pendant-short/case.toml"`
Expected output (approximately): `body: 43.2 x 68.4 x 12.0 mm, … watertight=True`, `lid: … watertight=True`, no validation errors.

- [ ] **Step 2: Sanity-check the previews yourself**

Open `3d-models/case-starflower-pendant-short/output/preview.png` and `profile-sections.png` (Read tool — they are images). Check: four pillow quarters visible; chain ring + channel visible around the pocket; sections show sigmoid on 0°/90°, steep-start on 45°/135°; lid underside tracks body top with a hairline gap; no surface spikes.

- [ ] **Step 3: Report to the user for visual review**

Tell the user the output paths and the achieved dimensions, and ask them to look at the PNGs/STLs (e.g. in a slicer) before treating defaults as final. Parameter tweaking iterations happen via editing `case.toml` and re-running with `--preview-only`.

---

## Self-review notes (already applied)

- Spec coverage: footprint loading (T3), pocket/shelf (T5/T6/T7), pillow profiles + quarters (T4/T6), superellipse silhouette + necked bolt tabs (T5), dome/belly/flat bottom (T6), lid inverse + fit gap (T6/T7), chain trough + channel (T5/T6), bolt holes/ring seats/nut recesses (T6/T7), validation rules (T9), previews with axis/diagonal sections (T8), watertight STL output + CLI + case.toml (T9), casting plan needs no code. Magnet pockets are spec'd optional/off — deliberately NOT implemented (YAGNI); the `magnets_enabled` param exists and `validate` does not reference it; implementing it later is an isolated meshing addition.
- Type consistency: `CaseParams` property names (`z_eq`, `floor_z`, `ceiling_z`, `pocket_depth`) match usage in surfaces/meshing/casegen; `PlanGeometry` field names match usage; `Surfaces` method names (`z_part`, `body_top`, `body_bottom`, `lid_top`, `lid_bottom`, `chain_carve`, `slope_factor`, `_t`, `_rho`, `_shell`) are consistent across tasks.
- Known risk points called out inline: `triangle` install (T1 step 4), `chain_centerlines.geoms` access (T6 note), watertightness debugging (T7 notes).
