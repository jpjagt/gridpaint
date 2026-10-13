"""Shared CLI plumbing: parsing helpers, workspace load/commit (history, provenance, --sel, --dry-run).

``RUN`` holds per-invocation flags set by ``cli.main`` (nested calls from `variants` get their own).
"""

from __future__ import annotations

import shlex
import time
from pathlib import Path

import numpy as np

from . import metrics as MX
from . import view
from .io import design_from_dict, design_to_dict, load_any, save_design
from .model import Design
from .ops import symmetry as SYM

LAB_ROOT = Path(__file__).resolve().parents[1]
WORK = LAB_ROOT / "work"
HISTORY_CAP = 50
ASCII_MAX_W = 80

# per-invocation flags (set by cli.main): dry_run (bool), sel (spec string or None)
RUN: dict = {"dry_run": False, "sel": None}


class CliError(Exception):
    pass


# ---- parsing helpers -------------------------------------------------------

def parse_xy(s: str) -> tuple[int, int]:
    try:
        x, y = s.replace(" ", "").split(",")
        return int(x), int(y)
    except Exception:
        raise CliError(f"expected x,y got {s!r}")


def parse_fxy(s: str) -> tuple[float, float]:
    try:
        x, y = s.replace(" ", "").split(",")
        return float(x), float(y)
    except Exception:
        raise CliError(f"expected x,y got {s!r}")


def parse_region(s: str | None):
    if not s:
        return None
    try:
        v = [int(t) for t in s.replace(" ", "").split(",")]
        assert len(v) == 4
    except Exception:
        raise CliError(f"--region expects x0,y0,x1,y1 (inclusive), got {s!r}")
    x0, y0, x1, y1 = v
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def parse_points(s: str | None) -> list[tuple[int, int]]:
    """'x,y x,y' or 'x,y;x,y'; ranges allowed per coordinate: '3-6,2' or '4,1-5'."""
    if not s:
        return []
    out = []
    for tok in s.replace(";", " ").split():
        try:
            xs, ys = tok.split(",")
        except ValueError:
            raise CliError(f"bad point {tok!r} (want x,y)")

        def rng(t):
            if "-" in t[1:]:
                a, b = t[0] + t[1:].split("-", 1)[0], t[1:].split("-", 1)[1]
                a, b = int(a), int(b)
                return range(min(a, b), max(a, b) + 1)
            return [int(t)]

        out += [(x, y) for x in rng(xs) for y in rng(ys)]
    return out


def parse_size(s: str) -> tuple[int, int]:
    try:
        w, h = s.lower().split("x")
        return int(w), int(h)
    except Exception:
        raise CliError(f"--size expects WxH, got {s!r}")


def parse_layers(s: str | None, d: Design | None = None) -> list[int] | None:
    if s is None or s == "all":
        return None
    return [int(t) for t in str(s).split(",")]


def parse_seeds(s: str) -> list[int]:
    out = []
    for part in s.split(","):
        if ".." in part:
            a, b = part.split("..")
            out += list(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return out


def parse_kv(items: list[str]) -> dict:
    out = {}
    for it in items or []:
        if "=" not in it:
            raise CliError(f"expected k=v, got {it!r}")
        k, v = it.split("=", 1)
        out[k] = v
    return out


# ---- workspace ---------------------------------------------------------------

def ws_path(p: str) -> Path:
    path = Path(p)
    if path.suffix != ".json":
        path = path.with_suffix(".json")
    return path


def load_ws(p: str | Path) -> Design:
    path = Path(p)
    if not path.exists():
        raise CliError(f"no such workspace {path} (create with `gridlab new {path} --size WxH` or `gridlab import SRC {path}`)")
    return load_any(path)


def snapshot(d: Design) -> dict:
    full = design_to_dict(d, include_frames=False)
    return {"width": d.width, "height": d.height, "layers": full["layers"]}


def restore(d: Design, snap: dict) -> Design:
    tmp = design_from_dict({"type": "gridlab-design", "width": snap["width"], "height": snap["height"], "layers": snap["layers"]})
    d.width, d.height, d.layers = tmp.width, tmp.height, tmp.layers
    if d.frames and (d.width, d.height) != tmp.shape[::-1]:
        d.frames = []
    return d


def size_note(a: Design, b: Design) -> str:
    return f" (canvas {a.width}x{a.height} -> {b.width}x{b.height})" if a.shape != b.shape else ""


def op_string(argv: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in argv)


def prov_text(op: str, path: Path | str) -> str:
    """Op string with the workspace path replaced by FILE (paths of variant copies are noise)."""
    p = str(path)
    out = op
    for form in {shlex.quote(p), p, shlex.quote(rel(p)), rel(p)}:
        out = out.replace(form, "FILE")
    return out


def rel(p: Path | str) -> str:
    """Path relative to cwd when possible (keeps output short)."""
    p = Path(p)
    try:
        return str(p.resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return str(p)


def default_png(path: Path, suffix: str = "") -> Path:
    """PNG next to the workspace file: foo.json -> foo<suffix>.png (no shared lab/work/ paths)."""
    path = Path(path)
    stem = path.name[:-5] if path.name.endswith(".json") else path.stem
    out = path.parent / f"{stem}{suffix}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def apply_with_mirror(mask: np.ndarray, on: np.ndarray | None, off: np.ndarray | None, mirror: str | None) -> np.ndarray:
    if mirror:
        kind = {"xy": "d2"}.get(mirror, mirror)
        on = SYM.symmetry_or(on, kind) if on is not None else None
        off = SYM.symmetry_or(off, kind) if off is not None else None
    out = mask.copy()
    if on is not None:
        out |= on
    if off is not None:
        out &= ~off
    return out


def mirror_note(d: Design, mirror: str | None) -> None:
    if not mirror:
        return
    from .ops.registry import centre_note

    n = centre_note(d)
    if n:
        print(f"note: {n}; --mirror uses the CANVAS centre (run `op FILE center` first if the design should be centred)")


def target_group(d: Design, layer_id: int, group: str | None, create_layer: bool = True):
    layer = d.layer(layer_id, create=create_layer)
    return layer.group(group or "default", create=True)


def current_sel(d: Design) -> np.ndarray | None:
    spec = RUN.get("sel")
    if not spec:
        return None
    from .selection import SelError, parse_sel

    try:
        return parse_sel(spec, d)
    except SelError as e:
        raise CliError(f"--sel: {e}")


def _changed_layers(before: Design, after: Design) -> list[tuple[int, np.ndarray, np.ndarray]]:
    out = []
    if before.shape != after.shape:
        return out
    for lid in sorted(set(before.layer_ids) | set(after.layer_ids)):
        a = before.layer(lid).mask if before.has_layer(lid) else np.zeros(before.shape, bool)
        b = after.layer(lid).mask if after.has_layer(lid) else np.zeros(after.shape, bool)
        if (a != b).any():
            out.append((lid, a, b))
    return out


def preview(path: Path, before: Design, after: Design, op: str) -> None:
    """--dry-run output: delta, +/- ASCII per changed layer, and a before/after PNG. Nothing is saved."""
    from .render import render_diff

    print(f"dry-run (NOT saved): {op}{size_note(before, after)}")
    print(MX.delta_text(MX.compact(before), MX.compact(after)))
    for lid, a, b in _changed_layers(before, after):
        add, rem = int((b & ~a).sum()), int((a & ~b).sum())
        print(f"L{lid}: +{add} -{rem}")
        if after.width <= ASCII_MAX_W:
            print(view.ascii_diff(a, b))
    cp = int(max(6, min(18, 700 // max(1, after.width + 2))))
    im = render_diff(before, after, cell_px=cp)
    out = default_png(path, ".dryrun")
    im.save(out)
    print(f"png: {rel(out)}  ({im.size[0]}x{im.size[1]}px)  run again without --dry-run to apply")


def commit(path: Path, before: Design | None, after: Design, op: str, quiet: bool = False) -> None:
    """Save after-state with a history entry holding the before-state; print a delta.
    Honours RUN['sel'] (changes outside the selection are reverted) and RUN['dry_run'] (preview only).
    An edit that changes nothing is not logged."""
    if before is not None:
        sel = current_sel(before)
        if sel is not None:
            from .selection import SelError, confine

            try:
                after = confine(before, after, sel)
            except SelError as e:
                raise CliError(str(e))
            if "--sel" not in op:
                op += f" --sel {shlex.quote(RUN['sel'])}"
        if RUN.get("dry_run"):
            preview(path, before, after, op)
            return
        if snapshot(before) == snapshot(after):
            if not quiet:
                print(f"ok: {op} -> no change (not logged; nothing to undo)")
            return
        after.history = list(before.history) + [{"op": op, "t": int(time.time()), "prev": snapshot(before), "prov": True}]
        after.history = after.history[-HISTORY_CAP:]
        after.provenance = list(before.provenance) + [prov_text(op, path)]
    elif RUN.get("dry_run"):
        print(f"dry-run (NOT saved): {op} would create {path}")
        return
    save_design(after, path)
    if quiet:
        return
    b = MX.compact(before) if before is not None else {}
    print(f"ok: {op}{size_note(before, after) if before is not None else ''} -> {path}")
    print(MX.delta_text(b, MX.compact(after)))


def save_new(d: Design, path: Path, msg: str) -> bool:
    """Create a workspace (respects --dry-run). Returns True when written."""
    if RUN.get("dry_run"):
        print(f"dry-run (NOT saved): would create {path} ({d.width}x{d.height})")
        return False
    save_design(d, path)
    print(msg)
    return True


def mutate(path: Path, op: str, fn) -> Design:
    before = load_ws(path)
    after = fn(before.copy())
    if after is None:
        raise RuntimeError("mutation returned None")
    commit(path, before, after, op)
    return after


def variant_line(d: Design) -> str:
    c = MX.compact(d)
    return " ".join(f"L{k}:{v['cells']}c/{v['pieces']}p/{v['holes']}h" for k, v in c.items())
