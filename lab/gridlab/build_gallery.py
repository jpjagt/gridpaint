"""Build the static gallery JSON consumed by the /lab page.

Runs every recipe for seeds 1..N, groups designs by recipe section, and appends a "samples"
section with the user's reference designs (lab/samples/*.json, recipe "sample").
A recipe that raises is reported and skipped (the gallery still builds).
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
import time
import traceback
from pathlib import Path

from .io import design_to_dict, load_any
from .recipes import SECTIONS, list_recipes, run_recipe

LAB_ROOT = Path(__file__).resolve().parents[1]
SAMPLES = LAB_ROOT / "samples"


def sample_designs() -> list:
    out = []
    for p in sorted(SAMPLES.glob("*.json")):
        try:
            d = load_any(p)
        except Exception as e:  # pragma: no cover
            print(f"skip sample {p.name}: {e}", file=sys.stderr)
            continue
        d.id = f"sample-{p.stem}"
        d.title = p.stem.replace("_", " ")
        d.recipe = "sample"
        d.tags = ["sample"]
        d.notes = f"user reference design samples/{p.name}"
        out.append(d)
    return out


def build_gallery_dict(seeds: int = 3, only: list[str] | None = None, verbose: bool = True) -> dict:
    sections: dict[str, dict] = {}
    for spec in list_recipes():
        if only and spec.name not in only:
            continue
        if spec.name == "sample_echo":  # samples get their own section
            continue
        sec = sections.setdefault(spec.section, {**SECTIONS.get(spec.section, {"id": spec.section, "title": spec.section, "description": ""}), "designs": []})
        t = time.time()
        for s in range(1, seeds + 1):
            try:
                sec["designs"].append(design_to_dict(run_recipe(spec.name, {}, s)))
            except Exception:
                print(f"recipe {spec.name} seed {s} failed:\n{traceback.format_exc()}", file=sys.stderr)
        if verbose:
            print(f"  {spec.section}/{spec.name}: {seeds} seeds in {time.time() - t:.1f}s")
    out_sections = [s for s in sections.values() if s["designs"]]
    if not only:
        out_sections.append({"id": "samples", "title": "Samples", "description": "The user's own reference designs.",
                             "designs": [design_to_dict(d) for d in sample_designs()]})
    return {"type": "gridlab-gallery", "version": 1,
            "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "sections": out_sections}


def build_gallery(out: str | Path, seeds: int = 3, only: list[str] | None = None) -> Path:
    g = build_gallery_dict(seeds, only)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(g, separators=(",", ":")))
    n = sum(len(s["designs"]) for s in g["sections"])
    print(f"ok: gallery {len(g['sections'])} sections, {n} designs -> {out} ({out.stat().st_size // 1024} KB)")
    return out
