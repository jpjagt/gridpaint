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
