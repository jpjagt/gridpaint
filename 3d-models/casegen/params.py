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
