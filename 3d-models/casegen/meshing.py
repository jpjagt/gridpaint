"""Constrained triangulation and watertight mesh assembly."""

from __future__ import annotations

import numpy as np
import shapely
import triangle as tr
import trimesh
from shapely.geometry import LinearRing, MultiPolygon

# gap between the constrained chain loops and the pocket loop; without it the
# chain_region boundary coincides with the pocket exterior at the channel
# mouth (coincident constrained segments segfault triangle).
CHAIN_POCKET_EPS = 0.05


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
    # tolerance dedup of (cyclically) consecutive near-duplicate points
    d = np.hypot(*(coords - np.roll(coords, 1, axis=0)).T)
    return coords[d > 1e-6]


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
        xy = self.V[faces]                       # (m,3,2)
        zz = z[faces][:, :, None]                # (m,3,1)
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
    chain_geom = plan.chain_region.difference(
        plan.pocket.buffer(CHAIN_POCKET_EPS, join_style="round")
    )
    for i, ring in enumerate(rings_of(chain_geom)):
        ring = shapely.simplify(LinearRing(ring), 0.02)
        loops[f"chain{i}"] = densify(ring, 0.6 * params.mesh_size)
    for i, c in enumerate(plan.tab_centers):
        loops[f"nut{i}"] = circle(c, params.nut_recess_d / 2.0, 0.5 * params.mesh_size)

    V, F, idx = triangulate_part(outer, loops, plan.tab_centers, max_area)
    in_pocket, in_nut = _classify(F, V, plan, params)

    z_top = surf.body_top(V)
    z_top[idx["outer"]] = params.z_eq          # rim snap (top only)
    z_floor = np.full(len(V), params.floor_z)
    z_bot = surf.body_bottom(V)                # NOT snapped: equals z_eq away
                                               # from tabs, 0 at the tabs
    z_recess = np.full(len(V), params.nut_recess_h)

    sb = SoupBuilder(V)
    sb.surface(F[~in_pocket], z_top, up=True)
    sb.surface(F[in_pocket], z_floor, up=True)
    sb.surface(F[~in_nut], z_bot, up=False)
    sb.surface(F[in_nut], z_recess, up=False)
    sb.wall(idx["outer"], z_top, z_bot)        # rim wall: degenerate away
                                               # from tabs, tab side faces
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
