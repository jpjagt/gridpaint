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
CURATED = LAB_ROOT / "curated"

# Recipe sections in study order (curated sections come first, by their own `order`); unknown ones go last but before basics.
SECTION_ORDER = ["hybrids", "threads", "sigils", "sacred_geometry", "sacred_lattice", "growth", "simulation", "learned",
                 "walkers", "layering", "automata", "ornament"]
LAST_SECTIONS = ["basic"]


def _section_rank(sec_id: str) -> tuple[int, int]:
    if sec_id in SECTION_ORDER:
        return (0, SECTION_ORDER.index(sec_id))
    if sec_id in LAST_SECTIONS:
        return (2, LAST_SECTIONS.index(sec_id))
    return (1, 0)


def curated_sections() -> list[dict]:
    """Hand/AI-made designs: lab/curated/<dir>/section.json ({title, description, order?}) + *.json designs."""
    out = []
    if not CURATED.exists():
        return out
    for d in sorted(p for p in CURATED.iterdir() if p.is_dir()):
        meta_p = d / "section.json"
        meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
        designs = []
        for p in sorted(d.glob("*.json")):
            if p.name == "section.json":
                continue
            try:
                des = load_any(p)
            except Exception as e:  # pragma: no cover
                print(f"skip curated {p}: {e}", file=sys.stderr)
                continue
            des.id = des.id if des.id not in ("", "design") else f"{d.name}-{p.stem}"
            des.title = des.title or p.stem.replace("_", " ")
            designs.append(design_to_dict(des))
        if designs:
            sec = {"id": d.name, "title": meta.get("title", d.name), "description": meta.get("description", ""),
                   "order": meta.get("order", 0), "designs": designs}
            if meta.get("layout"):  # "pairs": designs are before/after pairs, shown side by side
                sec["layout"] = meta["layout"]
            out.append(sec)
    out.sort(key=lambda s: s.pop("order"))
    return out


def preset_designs() -> dict[str, list[dict]]:
    """Tuned parameter presets from lab/curated/presets.json: [{recipe, params, seeds:[..], title?}] -> by section."""
    p = CURATED / "presets.json"
    by_section: dict[str, list[dict]] = {}
    if not p.exists():
        return by_section
    for entry in json.loads(p.read_text()):
        for s in entry.get("seeds", [1]):
            try:
                des = run_recipe(entry["recipe"], entry.get("params", {}), s)
            except Exception:
                print(f"preset {entry} seed {s} failed:\n{traceback.format_exc()}", file=sys.stderr)
                continue
            if entry.get("title"):
                des.title = entry["title"]
            des.tags = list(des.tags) + ["preset"]
            from .recipes import get_recipe
            by_section.setdefault(get_recipe(entry["recipe"]).section, []).append(design_to_dict(des))
    return by_section


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
    if not only:
        for sec_id, ds in preset_designs().items():
            sec = sections.setdefault(sec_id, {**SECTIONS.get(sec_id, {"id": sec_id, "title": sec_id, "description": ""}), "designs": []})
            sec["designs"].extend(ds)
    out_sections = sorted((s for s in sections.values() if s["designs"]), key=lambda s: _section_rank(s["id"]))
    if not only:
        curated = curated_sections()
        samples = {"id": "samples", "title": "Your samples (reference)",
                   "description": "Your own hand-drawn pieces - the taste target every generator is judged against. "
                                  "Not generated.",
                   "designs": [design_to_dict(d) for d in sample_designs()]}
        # "Start here" (featured) first, then the reference samples, then the other curated sections.
        head = [s for s in curated if s["id"] == "featured"]
        out_sections = head + [samples] + [s for s in curated if s["id"] != "featured"] + out_sections
    recipes = {spec.name: {"title": spec.title, "section": spec.section, "description": spec.description}
               for spec in list_recipes()}
    return {"type": "gridlab-gallery", "version": 1,
            "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "sections": out_sections, "recipes": recipes}


def build_gallery(out: str | Path, seeds: int = 3, only: list[str] | None = None) -> Path:
    g = build_gallery_dict(seeds, only)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(g, separators=(",", ":")))
    n = sum(len(s["designs"]) for s in g["sections"])
    print(f"ok: gallery {len(g['sections'])} sections, {n} designs -> {out} ({out.stat().st_size // 1024} KB)")
    return out
