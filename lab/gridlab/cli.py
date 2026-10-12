"""`gridlab` CLI — an AI-facing tool to look at and edit gridpaint designs.

A workspace is a gridlab-design JSON file (e.g. lab/work/foo.json) with an embedded edit
history (undo). Every mutating command prints a one-line confirmation plus a compact
per-layer metrics delta. Run `gridlab` with no args for the command list.
"""

from __future__ import annotations

import argparse
import contextlib
import io as _io
import json
import shlex
import sys
import time
from pathlib import Path

import numpy as np

from . import metrics as MX
from . import view
from .io import (copy_to_clipboard, design_from_dict, design_to_dict, load_any, save_design,
                 selection_to_dict)
from .model import Design, Layer
from .ops import draw as D
from .ops import symmetry as SYM
from .ops.registry import apply_op, get_op, list_ops, parse_kwargs

LAB_ROOT = Path(__file__).resolve().parents[1]
WORK = LAB_ROOT / "work"
HISTORY_CAP = 50
ASCII_MAX_W = 80


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


def parse_layers(s: str | None, d: Design) -> list[int] | None:
    if s is None or s == "all":
        return None
    return [int(t) for t in s.split(",")]


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


def commit(path: Path, before: Design | None, after: Design, op: str, quiet: bool = False) -> None:
    """Save after-state with a history entry holding the before-state; print a delta."""
    if before is not None:
        after.history = list(before.history) + [{"op": op, "t": int(time.time()), "prev": snapshot(before)}]
        after.history = after.history[-HISTORY_CAP:]
    save_design(after, path)
    if quiet:
        return
    b = MX.compact(before) if before is not None else {}
    print(f"ok: {op}{size_note(before, after) if before is not None else ''} -> {path}")
    print(MX.delta_text(b, MX.compact(after)))


def mutate(path: Path, op: str, fn) -> Design:
    before = load_ws(path)
    after = fn(before.copy())
    if after is None:
        raise RuntimeError("mutation returned None")
    commit(path, before, after, op)
    return after


def op_string(argv: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in argv)


def rel(p: Path | str) -> str:
    """Path relative to cwd when possible (keeps output short)."""
    p = Path(p)
    try:
        return str(p.resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return str(p)


def default_png(path: Path, suffix: str = "") -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    return WORK / f"{path.stem}{suffix}.png"


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


def target_group(d: Design, layer_id: int, group: str | None, create_layer: bool = True):
    layer = d.layer(layer_id, create=create_layer)
    return layer.group(group or "default", create=True)


# ---- commands ----------------------------------------------------------------

def cmd_new(a):
    path = ws_path(a.file)
    if path.exists() and not a.force:
        raise CliError(f"{path} exists (use --force to overwrite)")
    w, h = parse_size(a.size)
    ids = [int(t) for t in a.layers.split(",")]
    d = Design.empty(w, h, ids, id=path.stem, title=path.stem)
    save_design(d, path)
    print(f"ok: new {w}x{h} layers {sorted(ids)} (1 = top) -> {path}\nnext: gridlab show {path}")


def cmd_import(a):
    path = ws_path(a.file)
    d = load_any(a.src)
    if a.trim is not None:
        d.trim(a.trim)
    d.id = path.stem
    if path.exists():
        before = load_ws(path)
        d.history = before.history
        commit(path, before, d, f"import {a.src}")
    else:
        d.history = []
        save_design(d, path)
        print(f"ok: imported {a.src} -> {path}")
        print(view.header(d, path.name))


def cmd_export(a):
    d = load_ws(a.file)
    if a.format == "selection":
        obj = selection_to_dict(d, trim=not a.no_trim)
    else:
        obj = design_to_dict(d)
    text = json.dumps(obj, separators=(",", ":"))
    done = False
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text)
        print(f"ok: wrote {a.format} JSON -> {a.out}")
        done = True
    if a.clipboard:
        copy_to_clipboard(text)
        print(f"ok: copied {a.format} JSON to clipboard ({len(text)} chars); paste in gridpaint with Cmd+V"
              + (" (target layer ids must exist in the editor)" if a.format == "selection" else ""))
        done = True
    if not done:
        print(text)


def _auto_cell_px(d: Design, panels: int, target: int = 1400) -> int:
    return int(max(6, min(22, target // max(1, panels * (d.width + 2) + panels))))


def cmd_show(a):
    path = Path(a.file)
    d = load_ws(path)
    region = parse_region(a.region)
    print(view.header(d, path.name))
    if a.groups:
        print(view.groups_info(d))
    if a.ascii:
        x0, y0, x1, y1 = region or (0, 0, d.width - 1, d.height - 1)
        if (x1 - x0 + 1) > ASCII_MAX_W and not a.force:
            print(f"(ascii skipped: {x1 - x0 + 1} cols > {ASCII_MAX_W}; use --region or --force)")
        elif a.layer is not None:
            print(f"L{a.layer} ('#' filled):")
            print(view.ascii_layer(d, a.layer, region))
        else:
            print("composite (char = topmost layer id at cell, '.' empty):")
            print(view.ascii_composite(d, region))
    if a.metrics:
        print(MX.summary_text(d))
    if not a.no_png:
        from .render import render, render_layers_panel

        out = Path(a.png) if a.png else default_png(path)
        hl = parse_region(a.highlight)
        if a.layer is not None:
            ordered = [l.id for l in d.layers_top_to_bottom()]
            i = ordered.index(a.layer)
            ghost = [ordered[i + 1]] if i + 1 < len(ordered) else None
            cp = a.cell_px or _auto_cell_px(d, 1, 900)
            im = render(d, cell_px=cp, show_grid=True, layers=[a.layer], ghost=ghost, region=region, highlight=hl)
        elif a.composite_only or len(d.layers) == 1:
            cp = a.cell_px or _auto_cell_px(d, 1, 900)
            im = render(d, cell_px=cp, show_grid=True, region=region, highlight=hl)
        else:
            n = len(d.layers) + 1
            rw = (region[2] - region[0] + 1) if region else d.width
            cols = None if rw * n * 12 <= 1500 else 2  # wrap wide designs into 2 columns
            cp = a.cell_px or _auto_cell_px(d, cols or n, 1500 if cols is None else 1100)
            im = render_layers_panel(d, cell_px=cp, region=region, highlight=hl, cols=cols)
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out)
        print(f"png: {rel(out)}  ({im.size[0]}x{im.size[1]}px)")


def cmd_render(a):
    from .render import render

    d = load_ws(a.file)
    layers = [int(t) for t in a.layers.split(",")] if a.layers else None
    im = render(d, cell_px=a.cell_px, margin=a.margin, show_grid=a.grid, layers=layers, region=parse_region(a.region))
    out = Path(a.out) if a.out else default_png(Path(a.file), ".render")
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    print(f"png: {rel(out)}  ({im.size[0]}x{im.size[1]}px)")


def cmd_set(a):
    path = Path(a.file)
    on, off = parse_points(a.on), parse_points(a.off)
    if not on and not off:
        raise CliError("give --on and/or --off points, e.g. --on '3,4 5,6' (ranges: '3-6,2')")

    def fn(d: Design):
        g = target_group(d, a.layer, a.group)
        onm = D.set_points(np.zeros(d.shape, bool), on) if on else None
        offm = D.set_points(np.zeros(d.shape, bool), off) if off else None
        g.cells = apply_with_mirror(g.cells, onm, None, a.mirror)
        if offm is not None:  # --off removes from every group of the layer (unless --group)
            groups = [g] if a.group else d.layer(a.layer).groups
            for gg in groups:
                gg.cells = apply_with_mirror(gg.cells, None, offm, a.mirror)
        oob = [p for p in on + off if not (0 <= p[0] < d.width and 0 <= p[1] < d.height)]
        if oob:
            print(f"warning: {len(oob)} point(s) outside {d.width}x{d.height} ignored, e.g. {oob[0]}")
        return d

    mutate(path, op_string(["set"] + a.raw), fn)


def cmd_stamp(a):
    path = Path(a.file)
    text = a.text if a.text is not None else sys.stdin.read()
    on, care = D.parse_ascii(text)
    if not care.any():
        raise CliError("empty stamp (give --text '##./.#.' or ascii on stdin; '/' or newline separates rows)")
    x, y = parse_xy(a.at)

    def fn(d: Design):
        layer = d.layer(a.layer, create=True)
        groups = [layer.group(a.group or "default", create=True)]
        if a.mode in ("set", "and", "clear") and not a.group:
            groups = layer.groups  # removals apply to all groups
        for g in groups:
            new = D.stamp_ascii(g.cells, text, (x, y), a.mode)
            is_target = g.id == (a.group or "default")
            if not is_target:  # non-target groups only lose cells
                new = g.cells & new
            if a.mirror:
                added = new & ~g.cells
                removed = g.cells & ~new
                new = apply_with_mirror(g.cells, added, removed, a.mirror)
            g.cells = new
        return d

    raw = [f"<{on.shape[1]}x{on.shape[0]} art>" if t == text else t for t in a.raw]
    if a.text is None:
        raw.append(f"<stdin {on.shape[1]}x{on.shape[0]} art>")
    mutate(path, "stamp " + " ".join(raw), fn)


DRAW_HELP = """shapes (coords x,y; rects inclusive):
  line x0,y0 x1,y1 [x2,y2 ...]   polyline (Bresenham, 8-connected)
  rect x0,y0 x1,y1               outline;  fill-rect x0,y0 x1,y1  filled
  ellipse cx,cy rx,ry            outline;  fill-ellipse cx,cy rx,ry  filled
  ring cx,cy rx,ry --thickness T
  point x,y [x,y ...]"""


def cmd_draw(a):
    path = Path(a.file)
    pts = [parse_fxy(t) for t in a.args]
    shape = a.shape

    def need(n):
        if len(pts) < n:
            raise CliError(f"draw {shape} needs {n} x,y args\n{DRAW_HELP}")

    def fn(d: Design):
        blank = np.zeros(d.shape, bool)
        ip = [(int(round(x)), int(round(y))) for x, y in pts]
        if shape == "line":
            need(2)
            m = D.polyline(blank, ip)
        elif shape in ("rect", "fill-rect"):
            need(2)
            m = D.rect(blank, *ip[0], *ip[1], filled=shape == "fill-rect")
        elif shape in ("ellipse", "fill-ellipse"):
            need(2)
            m = D.ellipse(blank, pts[0][0], pts[0][1], pts[1][0], pts[1][1], filled=shape == "fill-ellipse" or a.filled)
        elif shape == "ring":
            need(2)
            m = D.ring(blank, pts[0][0], pts[0][1], pts[1][0], pts[1][1], a.thickness)
        elif shape == "point":
            need(1)
            m = D.set_points(blank, ip)
        else:
            raise CliError(f"unknown shape {shape!r}\n{DRAW_HELP}")
        if a.off:
            groups = [d.layer(a.layer).group(a.group)] if a.group else d.layer(a.layer).groups
            for g in groups:
                g.cells = apply_with_mirror(g.cells, None, m, a.mirror)
        else:
            g = target_group(d, a.layer, a.group)
            g.cells = apply_with_mirror(g.cells, m, None, a.mirror)
        return d

    mutate(path, op_string(["draw"] + a.raw), fn)


def cmd_op(a):
    path = Path(a.file)
    spec = get_op(a.name)
    kw = parse_kwargs(spec, a.kwargs)
    region = parse_region(a.region)

    def fn(d: Design):
        layers = parse_layers(a.layer, d)
        if spec.kind == "mask" and layers is None and a.layer is None and len(d.layers) > 1:
            print(f"note: no --layer given, applying {a.name} to all layers {d.layer_ids}")
        return apply_op(d, a.name, layers=layers, group=a.group, region=region, **kw)

    mutate(path, op_string(["op"] + a.raw), fn)


def cmd_ops(a):
    for s in list_ops():
        if a.name and s.name != a.name:
            continue
        doc = s.doc if a.name else " ".join(s.doc.split()).split(". ")[0]
        tag = " [design]" if s.kind == "design" else ""
        print(f"{s.name}{tag} {s.signature()}\n    {doc}")
    if not a.name:
        print("usage: gridlab op FILE NAME [--layer ID|A,B|all] [--group G] [--region x0,y0,x1,y1] k=v ...\n"
              "mask ops apply per group; with --region the op sees only that rectangle (mirror axes = region centre).")


def _place(d: Design, src: Design, a) -> Design:
    lm = {}
    if a.layer_map:
        for pair in a.layer_map.split(","):
            s, t = pair.split(":")
            lm[int(s)] = int(t)
    if a.at:
        x, y = parse_xy(a.at)
    else:
        x, y = (d.width - src.width) // 2, (d.height - src.height) // 2
    if x < 0 or y < 0 or x + src.width > d.width or y + src.height > d.height:
        print(f"warning: {src.width}x{src.height} at {x},{y} does not fit {d.width}x{d.height}; clipped "
              f"(grow with `op FILE resize w= h=` or `op FILE pad n=`)")
    return d.paste(src, x, y, lm, a.mode)


def cmd_gen(a):
    from .recipes import run_recipe

    path = ws_path(a.file)
    params = parse_kv(a.kwargs)
    src = run_recipe(a.recipe, params, a.seed)
    opstr = op_string(["gen"] + a.raw)
    if not path.exists():
        lm = {}
        if a.layer_map:
            lm = {int(s): int(t) for s, t in (p.split(":") for p in a.layer_map.split(","))}
        for l in src.layers:
            l.id = lm.get(l.id, l.id)
        src.layers.sort(key=lambda l: l.id)
        src.history = []
        save_design(src, path)
        print(f"ok: {opstr} (new workspace {src.width}x{src.height}) -> {path}")
        print(MX.delta_text({}, MX.compact(src)))
        return
    before = load_ws(path)
    after = _place(before.copy(), src, a)
    after.notes = (after.notes + f"\n{opstr}").strip()
    commit(path, before, after, opstr)


def cmd_undo(a):
    path = Path(a.file)
    d = load_ws(path)
    if not d.history:
        raise CliError("nothing to undo")
    n = min(a.n, len(d.history))
    popped = d.history[-n:]
    before = d.copy()
    restore(d, popped[0]["prev"])
    d.history = d.history[:-n]
    save_design(d, path)
    print(f"ok: undid {n}: " + " | ".join(e["op"] for e in reversed(popped)) + size_note(before, d))
    print(MX.delta_text(MX.compact(before), MX.compact(d)))


def cmd_log(a):
    d = load_ws(a.file)
    if not d.history:
        print("(no history)")
    for i, e in enumerate(d.history[-a.n:], start=max(1, len(d.history) - a.n + 1)):
        t = time.strftime("%H:%M:%S", time.localtime(e.get("t", 0)))
        print(f"{i:>3} {t} {e['op']}")


def cmd_diff(a):
    A, B = load_ws(a.a), load_ws(a.b)
    if A.shape != B.shape:
        print(f"note: sizes differ {A.width}x{A.height} vs {B.width}x{B.height}; comparing aligned by material bbox (coords = bbox-relative)")
        A, B = A.copy().trim(0), B.copy().trim(0)
        W, H = max(A.width, B.width), max(A.height, B.height)
        A, B = A.resize(W, H, "topleft"), B.resize(W, H, "topleft")
    region = parse_region(a.region)
    ids = sorted(set(A.layer_ids) | set(B.layer_ids))
    if a.layer is not None:
        ids = [a.layer]
    for lid in ids:
        ma = A.layer(lid).mask if A.has_layer(lid) else np.zeros(A.shape, bool)
        mb = B.layer(lid).mask if B.has_layer(lid) else np.zeros(B.shape, bool)
        add, rem = int((mb & ~ma).sum()), int((ma & ~mb).sum())
        print(f"L{lid}: +{add} -{rem} ({int(ma.sum())}->{int(mb.sum())})")
        if (add or rem) and not a.quiet and (B.width <= ASCII_MAX_W or region):
            print(view.ascii_diff(ma, mb, region))
    print(MX.delta_text(MX.compact(A), MX.compact(B)))


def cmd_metrics(a):
    d = load_ws(a.file)
    if a.json:
        md = MX.design_metrics(d)
        print(json.dumps(md, default=lambda o: o if not isinstance(o, tuple) else list(o)))
    else:
        print(view.header(d, Path(a.file).name))
        print(MX.summary_text(d))


def cmd_recipes(a):
    from .recipes import SECTIONS, get_recipe, list_recipes

    if a.name:
        s = get_recipe(a.name)
        print(f"{s.name} [{s.section}] {s.title}\n  {s.description}")
        for k, p in s.params.items():
            rng = f" {p.min}..{p.max}" if p.min is not None else ""
            ch = f" choices={p.choices}" if p.choices else ""
            print(f"  {k}={p.default} ({p.type}{rng}{ch}) {p.description}")
        return
    if a.json:
        print(json.dumps([r.to_json() for r in list_recipes()]))
        return
    cur = None
    for r in list_recipes():
        if r.section != cur:
            cur = r.section
            print(f"[{SECTIONS.get(cur, {}).get('title', cur)}]")
        ps = " ".join(f"{k}={p.default}" for k, p in r.params.items())
        print(f"  {r.name}: {r.description.split('. ')[0]} | {ps}")
    print("details: gridlab recipes NAME ; run: gridlab gen FILE NAME --seed N k=v")


def cmd_layer(a):
    path = Path(a.file)

    def fn(d: Design):
        if a.action == "add":
            if d.has_layer(a.id):
                raise CliError(f"layer {a.id} exists")
            d.layer(a.id, create=True)
        elif a.action == "rm":
            d.layer(a.id)
            d.remove_layer(a.id)
        return d

    mutate(path, f"layer {a.action} {a.id}", fn)


def _variant_path(base: Path, i: int) -> Path:
    return base.with_name(f"{base.stem}.v{i}.json")


def _variant_line(d: Design) -> str:
    c = MX.compact(d)
    return " ".join(f"L{k}:{v['cells']}c/{v['pieces']}p/{v['holes']}h" for k, v in c.items())


def cmd_variants(a):
    from .recipes import RECIPES, get_recipe, run_recipe
    from .render import contact_sheet

    seeds = parse_seeds(a.seeds)
    designs, labels, subs, paths = [], [], [], []
    target = a.target
    is_file = target.endswith(".json") or Path(target).exists()
    if is_file:
        base = Path(target)
        if not a.cmd:
            raise CliError('usage: gridlab variants FILE "<cmd FILE ...>[; cmd FILE ...]" --seeds 1..6  ({seed} is substituted)')
        orig = load_ws(base)
        designs.append(orig)
        labels.append("v0 current")
        subs.append(_variant_line(orig))
        for i, seed in enumerate(seeds, 1):
            vp = _variant_path(base, i)
            save_design(orig, vp)
            for cmd in a.cmd.split(";"):
                toks = shlex.split(cmd.replace("{seed}", str(seed)))
                if not toks:
                    continue
                if len(toks) < 2:
                    raise CliError(f"bad sub-command {cmd!r}")
                toks[1] = str(vp)
                if toks[0] == "gen" and "--seed" not in toks:
                    toks += ["--seed", str(seed)]
                buf = _io.StringIO()
                with contextlib.redirect_stdout(buf):
                    rc = main(toks, _nested=True)
                if rc:
                    raise CliError(f"variant {i} failed on: {' '.join(toks)}\n{buf.getvalue()}")
            d = load_ws(vp)
            designs.append(d)
            labels.append(f"v{i} seed={seed}")
            subs.append(_variant_line(d))
            paths.append(vp)
        sheet_path = default_png(base, ".variants")
    else:
        spec = get_recipe(target)
        params = parse_kv(([a.cmd] if a.cmd else []) + a.kwargs)
        sweeps = [{}]
        if a.sweep:
            k, vals = a.sweep.split("=", 1)
            sweeps = [{k: v} for v in vals.split(",")]
        out_dir = Path(a.out_dir) if a.out_dir else WORK
        base = out_dir / f"{a.name or spec.name}.json"
        i = 0
        for sw in sweeps:
            for seed in seeds:
                i += 1
                p = {**params, **sw}
                d = run_recipe(spec.name, p, seed)
                vp = _variant_path(base, i)
                d.history = []
                save_design(d, vp)
                designs.append(d)
                labels.append(f"v{i} seed={seed}" + "".join(f" {k}={v}" for k, v in sw.items()))
                subs.append(_variant_line(d))
                paths.append(vp)
        sheet_path = default_png(base, ".variants")
    mx = max(max(d.width, d.height) for d in designs)
    cp = a.cell_px or int(max(3, min(14, 220 // max(1, mx))))
    sheet = contact_sheet(designs, labels, cols=a.cols, cell_px=cp, sublabels=subs, show_grid=a.grid)
    sheet.save(sheet_path)
    for lab, sub, p in zip(labels[-len(paths):], subs[-len(paths):], paths):
        print(f"{lab}: {sub} -> {rel(p)}")
    print(f"sheet: {rel(sheet_path)}  ({sheet.size[0]}x{sheet.size[1]}px)  tiles: v0=current (FILE form), sublabel = per layer cells/pieces/holes")
    dest = base if is_file else Path("<FILE>")
    print(f"pick: gridlab pick {rel(paths[0]) if paths else 'X.vN.json'} {rel(dest) if is_file else dest} [--clean]")


def cmd_pick(a):
    src, dest = Path(a.src), ws_path(a.dest)
    d = load_ws(src)
    d.id = dest.stem
    if dest.exists():
        before = load_ws(dest)
        d.history = before.history
        commit(dest, before, d, f"pick {src.name}")
    else:
        d.history = []
        save_design(d, dest)
        print(f"ok: pick {src} -> {dest}")
    if a.clean:
        n = 0
        stem = src.name.split(".v")[0]
        for p in src.parent.glob(f"{stem}.v*.json"):
            p.unlink()
            n += 1
        print(f"removed {n} variant files")


def cmd_serve(a):
    from .server import serve

    serve(a.port)


def cmd_gallery(a):
    from .build_gallery import build_gallery

    out = Path(a.out) if a.out else (LAB_ROOT.parent / "public" / "lab" / "gallery.json")
    build_gallery(out, seeds=a.seeds, only=a.only.split(",") if a.only else None)


# ---- command table -----------------------------------------------------------

def _common_edit(p, layer_required=True):
    p.add_argument("file")
    p.add_argument("--layer", type=int, required=layer_required, help="layer id (1 = top)")
    p.add_argument("--group", help="connectivity group (default 'default')")
    p.add_argument("--mirror", choices=["x", "y", "xy", "d2", "d4", "rot2", "rot4", "diag"],
                   help="also apply the edit to the symmetric images (about the canvas centre)")


def _setup(name: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=f"gridlab {name}", description=COMMANDS[name][1],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    if name == "new":
        p.add_argument("file")
        p.add_argument("--size", required=True, help="WxH")
        p.add_argument("--layers", default="1", help="comma ids, e.g. 3,2,1 (1 = top)")
        p.add_argument("--force", action="store_true")
    elif name == "import":
        p.add_argument("src", help="path, '-' (stdin) or 'clipboard'")
        p.add_argument("file")
        p.add_argument("--trim", type=int, help="crop to material bbox + N margin")
    elif name == "export":
        p.add_argument("file")
        p.add_argument("--clipboard", action="store_true")
        p.add_argument("--out")
        p.add_argument("--format", choices=["selection", "design"], default="selection")
        p.add_argument("--no-trim", action="store_true", help="selection bounds = full canvas instead of bbox")
    elif name == "show":
        p.add_argument("file")
        p.add_argument("--region", help="x0,y0,x1,y1 inclusive (coords stay absolute)")
        p.add_argument("--layer", type=int, help="show one layer ('#') + PNG of it with the layer below ghosted")
        p.add_argument("--png", help="output path (default lab/work/<name>.png)")
        p.add_argument("--no-png", action="store_true")
        p.add_argument("--ascii", action=argparse.BooleanOptionalAction, default=True)
        p.add_argument("--metrics", action=argparse.BooleanOptionalAction, default=True)
        p.add_argument("--groups", action="store_true", help="list groups per layer")
        p.add_argument("--composite-only", action="store_true")
        p.add_argument("--highlight", help="x0,y0,x1,y1 rect outlined in the PNG")
        p.add_argument("--cell-px", type=int)
        p.add_argument("--force", action="store_true", help="ASCII even if wider than 80")
    elif name == "render":
        p.add_argument("file")
        p.add_argument("--out")
        p.add_argument("--cell-px", type=int, default=16)
        p.add_argument("--margin", type=int, default=1)
        p.add_argument("--grid", action="store_true")
        p.add_argument("--layers", help="comma ids subset")
        p.add_argument("--region")
    elif name == "set":
        _common_edit(p)
        p.add_argument("--on", help="'x,y x,y ...' (ranges ok: '3-6,2')")
        p.add_argument("--off", help="'x,y ...' removed from all groups of the layer (or --group)")
    elif name == "stamp":
        _common_edit(p)
        p.add_argument("--at", required=True, help="x,y of the art's top-left")
        p.add_argument("--mode", choices=["set", "or", "and", "xor", "clear"], default="set")
        p.add_argument("--text", help="art; rows separated by newline or '/'. '#' on, '.' off, ' ' unchanged. Else stdin.")
    elif name == "draw":
        _common_edit(p)
        p.add_argument("shape", help="line|rect|fill-rect|ellipse|fill-ellipse|ring|point")
        p.add_argument("args", nargs="*", help="x,y coordinate pairs")
        p.add_argument("--off", action="store_true", help="erase instead of draw")
        p.add_argument("--filled", action="store_true")
        p.add_argument("--thickness", type=float, default=1)
        p.epilog = DRAW_HELP
    elif name == "op":
        p.add_argument("file")
        p.add_argument("name")
        p.add_argument("kwargs", nargs="*", help="k=v")
        p.add_argument("--layer", help="ID, A,B or all (default all)")
        p.add_argument("--group")
        p.add_argument("--region", help="x0,y0,x1,y1 inclusive")
    elif name == "ops":
        p.add_argument("name", nargs="?")
    elif name == "gen":
        p.add_argument("file")
        p.add_argument("recipe")
        p.add_argument("kwargs", nargs="*", help="recipe params k=v")
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--layer-map", help="src:dst pairs, e.g. 3:1,2:2")
        p.add_argument("--at", help="x,y top-left placement (default centred)")
        p.add_argument("--mode", choices=["or", "replace", "area"], default="or",
                       help="or: add; replace: clear target layers first; area: clear the pasted rect first")
    elif name == "variants":
        p.add_argument("target", help="workspace FILE.json or RECIPE name")
        p.add_argument("cmd", nargs="?", help='for FILE: "cmd FILE args; cmd FILE args" ({seed} substituted)')
        p.add_argument("kwargs", nargs="*", help="for RECIPE: params k=v")
        p.add_argument("--seeds", default="1..6", help="1..6 or 1,4,9")
        p.add_argument("--sweep", help="RECIPE only: k=v1,v2,v3 (x seeds)")
        p.add_argument("--cols", type=int, default=4)
        p.add_argument("--cell-px", type=int)
        p.add_argument("--grid", action="store_true")
        p.add_argument("--out-dir", help="RECIPE only (default lab/work)")
        p.add_argument("--name", help="RECIPE only: base name of variant files")
    elif name == "pick":
        p.add_argument("src")
        p.add_argument("dest")
        p.add_argument("--clean", action="store_true", help="delete the sibling variant files")
    elif name == "undo":
        p.add_argument("file")
        p.add_argument("-n", type=int, default=1)
    elif name == "log":
        p.add_argument("file")
        p.add_argument("-n", type=int, default=20)
    elif name == "diff":
        p.add_argument("a")
        p.add_argument("b")
        p.add_argument("--layer", type=int)
        p.add_argument("--region")
        p.add_argument("--quiet", "-q", action="store_true", help="counts only")
    elif name == "metrics":
        p.add_argument("file")
        p.add_argument("--json", action="store_true")
    elif name == "recipes":
        p.add_argument("name", nargs="?")
        p.add_argument("--json", action="store_true")
    elif name == "layer":
        p.add_argument("file")
        p.add_argument("action", choices=["add", "rm"])
        p.add_argument("id", type=int)
    elif name == "serve":
        p.add_argument("--port", type=int, default=8765)
    elif name == "gallery":
        p.add_argument("--out", help="default ../public/lab/gallery.json")
        p.add_argument("--seeds", type=int, default=3)
        p.add_argument("--only", help="comma recipe names")
    return p


COMMANDS = {
    "new": (cmd_new, "create an empty workspace: new FILE --size WxH [--layers 3,2,1]"),
    "import": (cmd_import, "import SRC (path|clipboard|-) as workspace FILE (selection or design JSON)"),
    "export": (cmd_export, "export FILE [--clipboard] [--out x.json] [--format selection|design]"),
    "show": (cmd_show, "LOOK: ASCII + metrics + PNG panel (composite + per layer, grid & rulers)"),
    "render": (cmd_render, "plain PNG render: render FILE [--out] [--cell-px] [--grid] [--layers]"),
    "set": (cmd_set, "set/clear cells: set FILE --layer ID --on 'x,y ...' --off 'x,y ...' [--mirror xy]"),
    "stamp": (cmd_stamp, "stamp ASCII art: stamp FILE --layer ID --at x,y --text '##./.#.' [--mode]"),
    "draw": (cmd_draw, "draw FILE --layer ID line|rect|fill-rect|ellipse|fill-ellipse|ring|point x,y ..."),
    "op": (cmd_op, "op FILE NAME [--layer ID|all] [--region R] k=v  (see `gridlab ops`)"),
    "ops": (cmd_ops, "list ops with params (ops NAME for full doc)"),
    "gen": (cmd_gen, "gen FILE RECIPE [--seed N] [k=v] [--layer-map 3:1] [--at x,y] [--mode or|replace|area]"),
    "variants": (cmd_variants, 'variants FILE "cmd FILE ..." --seeds 1..6 | variants RECIPE --seeds 1..6 [k=v] -> contact sheet'),
    "pick": (cmd_pick, "pick FILE.vN.json FILE  (adopt a variant; undoable)"),
    "undo": (cmd_undo, "undo FILE [-n N]"),
    "log": (cmd_log, "history of FILE"),
    "diff": (cmd_diff, "diff A B: cells added/removed per layer (+/- ASCII)"),
    "metrics": (cmd_metrics, "metrics FILE [--json]"),
    "recipes": (cmd_recipes, "list recipes (recipes NAME for params)"),
    "layer": (cmd_layer, "layer FILE add|rm ID"),
    "serve": (cmd_serve, "HTTP API for the /lab page (default port 8765)"),
    "gallery": (cmd_gallery, "build public/lab/gallery.json from all recipes + samples"),
}

USAGE = """gridlab — look at / edit / generate gridpaint designs (coords x,y; y down; layer 1 = top)
workflow: show -> small edit -> show (open the PNG) ; variants + pick to choose ; undo freely
commands:
""" + "\n".join(f"  {k:<9} {v[1]}" for k, v in COMMANDS.items()) + "\nhelp: gridlab CMD -h"


def main(argv: list[str] | None = None, _nested: bool = False) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE)
        return 0
    name = argv[0]
    if name not in COMMANDS:
        import difflib

        close = difflib.get_close_matches(name, COMMANDS.keys(), n=2)
        print(f"error: unknown command {name!r}" + (f"; did you mean {', '.join(close)}?" if close else ""), file=sys.stderr)
        print(USAGE, file=sys.stderr)
        return 2
    parser = _setup(name)
    try:
        args = parser.parse_intermixed_args(argv[1:])
    except SystemExit as e:
        return int(e.code or 0)
    args.raw = argv[1:]
    try:
        COMMANDS[name][0](args)
    except (CliError, ValueError, KeyError, FileNotFoundError, json.JSONDecodeError) as e:
        msg = e.args[0] if isinstance(e, KeyError) and e.args else e
        print(f"error: {msg}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
