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
    g = plan.chain_centerlines
    geoms = getattr(g, "geoms", [g])
    ring_pt = np.asarray(geoms[0].coords)[0:1]
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
    # equator at the silhouette (excluding tab-zone points, which are flat)
    sil = plan.silhouette_loop[::40]
    d_tab = np.min(
        [np.hypot(sil[:, 0] - c[0], sil[:, 1] - c[1]) for c in plan.tab_centers],
        axis=0,
    )
    body_sil = sil[d_tab > p.tab_radius + p.tab_flat_blend]
    assert len(body_sil) > 0, "no non-tab silhouette samples found"
    assert np.allclose(surf.body_bottom(body_sil), p.z_eq, atol=0.1)


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
