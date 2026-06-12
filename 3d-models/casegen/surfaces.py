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
