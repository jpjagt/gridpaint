"""CLI: metadata & provenance (`meta`, `export`) and `describe`."""

from __future__ import annotations

import json
from pathlib import Path

from .cli_common import RUN, CliError, load_ws
from .io import copy_to_clipboard, design_to_dict, save_design, selection_to_dict
from .model import Design

NOTES_RECIPE_MAX = 1200


def recipe_line(d: Design) -> str:
    steps = [p for p in d.provenance if not p.startswith("#")]
    if not steps:
        return ""
    s = "recipe: " + " ; ".join(steps)
    return s if len(s) <= NOTES_RECIPE_MAX else s[:NOTES_RECIPE_MAX - 3] + "..."


def apply_meta(d: Design, a) -> list[str]:
    changed = []
    if getattr(a, "title", None) is not None:
        d.title = a.title
        changed.append("title")
    if getattr(a, "notes", None) is not None:
        d.notes = a.notes
        changed.append("notes")
    if getattr(a, "append_notes", None):
        d.notes = (d.notes + "\n" + a.append_notes).strip()
        changed.append("notes+")
    if getattr(a, "tags", None) is not None:
        d.tags = [t.strip() for t in a.tags.split(",") if t.strip()]
        changed.append("tags")
    if getattr(a, "add_tags", None):
        d.tags = list(dict.fromkeys(d.tags + [t.strip() for t in a.add_tags.split(",") if t.strip()]))
        changed.append("tags+")
    if getattr(a, "id", None):
        d.id = a.id
        changed.append("id")
    return changed


def cmd_meta(a):
    path = Path(a.file)
    d = load_ws(path)
    changed = apply_meta(d, a)
    if changed and not RUN.get("dry_run"):
        save_design(d, path)  # metadata is not geometry: no undo entry
        print(f"ok: meta {', '.join(changed)} -> {path}")
    elif changed:
        print(f"dry-run (NOT saved): meta {', '.join(changed)}")
    print(f"id: {d.id}\ntitle: {d.title}\ntags: {','.join(d.tags)}\nrecipe: {d.recipe} seed: {d.seed}")
    print("notes: " + (d.notes.replace("\n", "\n       ") if d.notes else "(empty; export fills it with the recipe line)"))
    prov = d.provenance
    print(f"provenance ({len(prov)} steps since new/import):")
    for p in prov[-a.n:]:
        print(f"  {p}")


def export_dict(d: Design, fmt: str, no_trim: bool = False) -> dict:
    if fmt == "selection":
        return selection_to_dict(d, trim=not no_trim)
    obj = design_to_dict(d)
    rl = recipe_line(d)
    if rl and not d.notes:
        obj["notes"] = rl
    elif rl and "recipe:" not in d.notes:
        obj["notes"] = d.notes + "\n" + rl
    return obj


def cmd_export(a):
    d = load_ws(a.file)
    apply_meta(d, a)  # --title/--notes/--tags only affect the export (use `meta` to store them)
    obj = export_dict(d, a.format, a.no_trim)
    text = json.dumps(obj, separators=(",", ":"))
    done = False
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text)
        print(f"ok: wrote {a.format} JSON -> {a.out}" + (f" (title {d.title!r}, {len(d.provenance)} provenance steps)"
                                                          if a.format == "design" else ""))
        done = True
    if a.clipboard:
        copy_to_clipboard(text)
        print(f"ok: copied {a.format} JSON to clipboard ({len(text)} chars); paste in gridpaint with Cmd+V"
              + (" (target layer ids must exist in the editor)" if a.format == "selection" else ""))
        done = True
    if not done:
        print(text)


def cmd_describe(a):
    from .describe import describe

    d = load_ws(a.file)
    print(describe(d, Path(a.file).name))
    if not d.layers:
        raise CliError("no layers")
