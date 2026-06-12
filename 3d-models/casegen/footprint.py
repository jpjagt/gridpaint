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
