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
    # height = dome apex (z_eq+gap+lid_height) minus lowest underside point,
    # in the unflipped frame. The lowest underside is the rim-shelf mating
    # surface at z_rim+gap (the pocket ceiling z_ceiling+gap sits above it
    # whenever pocket_body_fraction < 1).
    expected = (p.z_eq + p.fit_gap + p.lid_height) - (p.z_rim + p.fit_gap)
    assert np.isclose(maxz - minz, expected, atol=0.2)


def test_bolt_holes_pierce_both(meshes, default_params, plan):
    body, lid = meshes
    p = default_params
    # a vertical ray through the tab center must NOT hit any face.
    # note: the lid is exported flipped about x, so its tab centers are at
    # (x, -y); both tabs are symmetric so the set of centers is the same.
    for c in plan.tab_centers:
        for mesh in (body, lid):
            hits = mesh.ray.intersects_any(
                ray_origins=[[c[0], c[1], -50.0]], ray_directions=[[0, 0, 1.0]]
            )
            assert not hits[0]
