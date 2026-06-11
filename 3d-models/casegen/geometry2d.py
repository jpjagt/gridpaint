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
