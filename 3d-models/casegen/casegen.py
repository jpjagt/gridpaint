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
