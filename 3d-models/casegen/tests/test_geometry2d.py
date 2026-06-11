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
