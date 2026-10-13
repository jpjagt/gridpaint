"""`gridlab` CLI — an AI-facing tool to look at and edit gridpaint designs.

A workspace is a gridlab-design JSON file (e.g. work/foo.json) with an embedded edit
history (undo) and a provenance log. Every mutating command prints a one-line confirmation plus a
compact per-layer metrics delta, accepts --dry-run (preview, nothing saved) and, for cell edits,
--sel SPEC (only cells inside the selection change; see gridlab/selection.py).
Run `gridlab` with no args for the command list.

Modules: cli_common (helpers, commit), cli_select (sel/erase/layer), cli_variants (variants/pick/sheet/
frames), cli_meta (meta/export/describe).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from . import metrics as MX
from . import view
from .cli_common import (ASCII_MAX_W, HISTORY_CAP, LAB_ROOT, RUN, WORK, CliError, apply_with_mirror,  # noqa: F401
                         commit, default_png, load_ws, mirror_note, mutate, op_string, parse_fxy, parse_kv,
                         parse_layers, parse_points, parse_region, parse_seeds, parse_size, parse_xy, rel, restore,
                         save_new, size_note, snapshot, target_group, variant_line, ws_path)
from .cli_meta import cmd_describe, cmd_export, cmd_meta
from .cli_select import cmd_erase, cmd_layer, cmd_sel
from .cli_variants import cmd_frames, cmd_pick, cmd_sheet, cmd_variants
from .io import load_any, save_design
from .model import Design
from .ops import draw as D
from .ops.registry import apply_op, get_op, list_ops, parse_kwargs

_variant_line = variant_line  # back-compat (assist.py)


def _variant_path(base: Path, i: int) -> Path:
    return base.with_name(f"{base.stem}.v{i}.json")


# ---- commands ----------------------------------------------------------------

def cmd_new(a):
    path = ws_path(a.file)
    if path.exists() and not a.force:
        raise CliError(f"{path} exists (use --force to overwrite)")
    w, h = parse_size(a.size)
    ids = [int(t) for t in a.layers.split(",")]
    d = Design.empty(w, h, ids, id=path.stem, title=a.title or path.stem)
    d.provenance = [f"new {w}x{h} --layers {a.layers}"]
    save_new(d, path, f"ok: new {w}x{h} layers {sorted(ids)} (1 = top) -> {path}\nnext: gridlab show {path}")


def cmd_import(a):
    path = ws_path(a.file)
    d = load_any(a.src)
    if a.trim is not None:
        d.trim(a.trim)
    d.id = path.stem
    if a.title:
        d.title = a.title
    src_name = Path(a.src).name if a.src not in ("-", "clipboard") else a.src
    if path.exists():
        before = load_ws(path)
        d.history = before.history
        d.provenance = list(before.provenance)
        commit(path, before, d, f"import {a.src}")
    else:
        d.history = []
        d.provenance = list(d.provenance) + [f"import {src_name}" + (f" --trim {a.trim}" if a.trim is not None else "")]
        if save_new(d, path, f"ok: imported {a.src} -> {path}"):
            print(view.header(d, path.name))


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
        multi = [f"L{l.id}:{len([g for g in l.groups if g.cells.any()])}g" for l in d.layers_top_to_bottom()
                 if len([g for g in l.groups if g.cells.any()]) > 1]
        if multi and not a.groups:
            print(f"groups: {' '.join(multi)} (cells only blob-bridge within their group; `show --groups`, `op merge-groups`)")
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
        mirror_note(d, a.mirror)
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
    keep = not a.trim_blank
    on, care = D.parse_ascii(text, keep_blank=keep)
    if not care.any():
        raise CliError("empty stamp (give --text '##./.#.' or ascii on stdin; '/' or newline separates rows)")
    h, w = on.shape
    pts = parse_points(a.at)
    if not pts:
        raise CliError("--at needs x,y (or several: 'x,y x,y')")
    if a.anchor == "center":
        pts = [(x - (w - 1) // 2, y - (h - 1) // 2) for x, y in pts]

    def fn(d: Design):
        mirror_note(d, a.mirror)
        layer = d.layer(a.layer, create=True)
        groups = [layer.group(a.group or "default", create=True)]
        if a.mode in ("set", "and", "clear") and not a.group:
            groups = layer.groups  # removals apply to all groups
        for g in groups:
            new = g.cells
            for (x, y) in pts:
                new = D.stamp_ascii(new, text, (x, y), a.mode, keep_blank=keep)
            is_target = g.id == (a.group or "default")
            if not is_target:  # non-target groups only lose cells
                new = g.cells & new
            if a.mirror:
                added = new & ~g.cells
                removed = g.cells & ~new
                new = apply_with_mirror(g.cells, added, removed, a.mirror)
            g.cells = new
        if a.mirror and any((y + h - 1) < (d.height - 1) / 2 and a.mirror in ("y", "xy", "d2") for _, y in pts):
            gap = int(np.ceil((d.height - 1) / 2)) - max(y + h - 1 for _, y in pts)
            if gap > 0:
                print(f"note: art ends {gap} row(s) above the horizontal mirror axis; the mirrored halves won't touch")
        return d

    raw = [f"<{w}x{h} art>" if t == text else t for t in a.raw]
    if a.text is None:
        raw.append(f"<stdin {w}x{h} art>")
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
        mirror_note(d, a.mirror)
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
        notes: list[str] = []
        out = apply_op(d, a.name, layers=layers, group=a.group, region=region, centre=a.centre, notes=notes, **kw)
        for n in notes:
            print(f"note: {n}" if not n.startswith("WARNING") else n)
        return out

    mutate(path, op_string(["op"] + a.raw), fn)


def cmd_ops(a):
    for s in list_ops():
        if a.name and s.name != a.name:
            continue
        doc = s.doc if a.name else " ".join(s.doc.split()).split(". ")[0]
        tag = " [design]" if s.kind == "design" else ""
        print(f"{s.name}{tag} {s.signature()}\n    {doc}")
    if not a.name:
        print("usage: gridlab op FILE NAME [--layer ID|A,B|all] [--group G] [--region x0,y0,x1,y1] [--sel SPEC] k=v ...\n"
              "(signatures above are the real parameters; docs are the op docstrings)\n"
              "mask ops apply per group; --region: the op sees only that rectangle (mirror axes = region centre);\n"
              "--sel: the op runs normally but only cells inside the selection change; --dry-run previews.")


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
        from .cli_common import prov_text
        prov = prov_text(opstr, path)
        src.provenance = [prov + ("" if "--seed" in prov else f" --seed {a.seed}")]
        if save_new(src, path, f"ok: {opstr} (new workspace {src.width}x{src.height}) -> {path}"):
            print(MX.delta_text({}, MX.compact(src)))
        return
    before = load_ws(path)
    after = _place(before.copy(), src, a)
    after.notes = (after.notes + f"\n{opstr}").strip()
    if "--seed" not in opstr:
        opstr += f" --seed {a.seed}"
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
    k = sum(1 for e in popped if e.get("prov"))
    if k:
        d.provenance = d.provenance[:-k] if k < len(d.provenance) else d.provenance[:1]
    msg = "undid" if not RUN.get("dry_run") else "dry-run (NOT saved): would undo"
    if not RUN.get("dry_run"):
        save_design(d, path)
    print(f"ok: {msg} {n}: " + " | ".join(e["op"] for e in reversed(popped)) + size_note(before, d))
    print(MX.delta_text(MX.compact(before), MX.compact(d)))
    if d.history:
        print(f"now at: {d.history[-1]['op']}  ({len(d.history)} undo steps left)")


def cmd_log(a):
    d = load_ws(a.file)
    if not d.history:
        print("(no history)")
    n0 = max(1, len(d.history) - a.n + 1)
    for i, e in enumerate(d.history[-a.n:], start=n0):
        t = time.strftime("%H:%M:%S", time.localtime(e.get("t", 0)))
        print(f"{i:>3} {t} {e['op']}" + ("   <- latest (undo -n 1 reverts this)" if i == len(d.history) else ""))


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
    print("details: gridlab recipes NAME ; run: gridlab gen FILE NAME --seed N k=v ; frames: gridlab frames NAME")


def cmd_serve(a):
    from .server import serve

    serve(a.port)


def cmd_gallery(a):
    from .build_gallery import build_gallery

    out = Path(a.out) if a.out else (LAB_ROOT.parent / "public" / "lab" / "gallery.json")
    build_gallery(out, seeds=a.seeds, only=a.only.split(",") if a.only else None)


# ---- command table -----------------------------------------------------------

SEL_HELP = ("only cells inside this selection change: rect:x0,y0,x1,y1 circle:cx,cy,r ring:cx,cy,r0,r1 "
            "half:x<10|y>=7|left|right|top|bottom wedge:a0,a1 (deg clockwise from up) layer:ID inside:ID expr:x+y>20 "
            "all; not:TERM; combine with & (and) and | (or)")
MUTATING = {"new", "import", "set", "stamp", "draw", "op", "gen", "pick", "undo", "layer", "erase", "meta"}


def _common_edit(p, layer_required=True):
    p.add_argument("file")
    p.add_argument("--layer", type=int, required=layer_required, help="layer id (1 = top)")
    p.add_argument("--group", help="connectivity group (default 'default')")
    p.add_argument("--mirror", choices=["x", "y", "xy", "d2", "d4", "rot2", "rot4", "diag"],
                   help="also apply the edit to the symmetric images (about the canvas centre)")
    p.add_argument("--sel", help=SEL_HELP)


def _setup(name: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=f"gridlab {name}", description=COMMANDS[name][1],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    if name in MUTATING:
        p.add_argument("--dry-run", action="store_true", help="show the delta, +/- ASCII and a before/after PNG; save nothing")
    if name == "new":
        p.add_argument("file")
        p.add_argument("--size", required=True, help="WxH")
        p.add_argument("--layers", default="1", help="comma ids, e.g. 3,2,1 (1 = top)")
        p.add_argument("--title")
        p.add_argument("--force", action="store_true")
    elif name == "import":
        p.add_argument("src", help="path, '-' (stdin) or 'clipboard'")
        p.add_argument("file")
        p.add_argument("--trim", type=int, help="crop to material bbox + N margin")
        p.add_argument("--title")
    elif name == "export":
        p.add_argument("file")
        p.add_argument("--clipboard", action="store_true")
        p.add_argument("--out")
        p.add_argument("--format", choices=["selection", "design"], default="selection")
        p.add_argument("--no-trim", action="store_true", help="selection bounds = full canvas instead of bbox")
        p.add_argument("--title", help="override title in the export (store it with `meta`)")
        p.add_argument("--notes")
        p.add_argument("--append-notes")
        p.add_argument("--tags")
        p.add_argument("--add-tags")
        p.epilog = "design format: notes get a 'recipe: ...' line from the provenance log; field `provenance` lists the steps."
    elif name == "meta":
        p.add_argument("file")
        p.add_argument("--title")
        p.add_argument("--notes", help="replace notes")
        p.add_argument("--append-notes", help="append a line to notes")
        p.add_argument("--tags", help="replace tags: a,b,c")
        p.add_argument("--add-tags", help="add tags: a,b")
        p.add_argument("--id")
        p.add_argument("-n", type=int, default=15, help="provenance lines to print")
    elif name == "describe":
        p.add_argument("file")
    elif name == "show":
        p.add_argument("file")
        p.add_argument("--region", help="x0,y0,x1,y1 inclusive (coords stay absolute)")
        p.add_argument("--layer", type=int, help="show one layer ('#') + PNG of it with the layer below ghosted")
        p.add_argument("--png", help="output path (default: next to FILE, <name>.png)")
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
        p.add_argument("--out", help="default: next to FILE, <name>.render.png")
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
        p.add_argument("--at", required=True, help="x,y of the art's top-left (or centre with --anchor center); "
                                                   "several: 'x,y x,y' stamps the art at each point")
        p.add_argument("--anchor", choices=["topleft", "center"], default="topleft")
        p.add_argument("--mode", choices=["set", "or", "and", "xor", "clear"], default="set")
        p.add_argument("--text", help="art; rows separated by newline or '/'. '#' on, '.' off, ' ' unchanged. Else stdin.")
        p.add_argument("--trim-blank", action="store_true",
                       help="old behaviour: drop blank rows at the start/end (default keeps them; one trailing newline is ignored)")
    elif name == "draw":
        _common_edit(p)
        p.add_argument("shape", help="line|rect|fill-rect|ellipse|fill-ellipse|ring|point")
        p.add_argument("args", nargs="*", help="x,y coordinate pairs")
        p.add_argument("--off", action="store_true", help="erase instead of draw")
        p.add_argument("--filled", action="store_true")
        p.add_argument("--thickness", type=float, default=1)
        p.epilog = DRAW_HELP
    elif name == "erase":
        p.add_argument("file")
        p.add_argument("--sel", required=True, help=SEL_HELP)
        p.add_argument("--layer", help="ID, A,B or all (default all)")
    elif name == "sel":
        p.add_argument("file")
        p.add_argument("spec", help=SEL_HELP)
        p.add_argument("--force", action="store_true", help="ASCII even if wider than 80")
    elif name == "op":
        p.add_argument("file")
        p.add_argument("name")
        p.add_argument("kwargs", nargs="*", help="k=v")
        p.add_argument("--layer", help="ID, A,B or all (default all)")
        p.add_argument("--group")
        p.add_argument("--region", help="x0,y0,x1,y1 inclusive: the op sees only this rectangle")
        p.add_argument("--sel", help=SEL_HELP)
        p.add_argument("--centre", "--center", dest="centre", choices=["auto", "canvas", "material"], default="auto",
                       help="symmetry axes for symmetry ops: auto (material centre for symmetry-preserving ops like "
                            "connect/sym-thin/grow-*, canvas centre + warning for mirror/symmetrize), canvas, material")
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
        p.add_argument("--sel", help=SEL_HELP)
    elif name == "variants":
        p.add_argument("target", help="workspace FILE.json or RECIPE name")
        p.add_argument("cmd", nargs="?", help='for FILE: "cmd FILE args; cmd FILE args" ({seed} substituted)')
        p.add_argument("kwargs", nargs="*", help="for RECIPE: params k=v (sweeps: k={a,b} k={0.1,0.3} k={1..6})")
        p.add_argument("--seeds", help="1..6 or 1,4,9 (default 1..6; 1 when {..} sweeps are used)")
        p.add_argument("--sweep", help="RECIPE only: k=v1,v2,v3 (x seeds)")
        p.add_argument("--cols", type=int, default=4)
        p.add_argument("--cell-px", type=int)
        p.add_argument("--grid", action="store_true")
        p.add_argument("--layers", "--layer", dest="layers", help="sheet shows only these layer ids, e.g. 1,2")
        p.add_argument("--out-dir", help="parent dir of <name>.variants/runN (default: next to FILE; lab/work for RECIPE)")
        p.add_argument("--name", help="base name (default FILE stem / RECIPE)")
    elif name == "pick":
        p.add_argument("src")
        p.add_argument("dest")
        p.add_argument("--clean", action="store_true", help="delete the run dir (or sibling .vN files)")
    elif name == "sheet":
        p.add_argument("files", nargs="+")
        p.add_argument("--cols", type=int, default=4)
        p.add_argument("--out", help="default: next to the first file, <name>.sheet.png")
        p.add_argument("--cell-px", type=int)
        p.add_argument("--layers", "--layer", dest="layers", help="only these layer ids")
        p.add_argument("--labels", help="comma labels (default: file names)")
        p.add_argument("--grid", action="store_true")
    elif name == "frames":
        p.add_argument("src", help="RECIPE name or FILE with frames")
        p.add_argument("kwargs", nargs="*", help="recipe params k=v")
        p.add_argument("--seed", type=int, default=0)
        p.add_argument("--as", dest="as_", choices=["sheet", "layers", "files"], default="sheet")
        p.add_argument("--pick", help="frame indices, e.g. 0,4,8,-1 or 2..6 (default: spread; 4 for layers)")
        p.add_argument("--out", help="PNG (sheet), workspace JSON (layers) or dir (files)")
        p.add_argument("--cols", type=int, default=4)
        p.add_argument("--cell-px", type=int)
        p.add_argument("--final", action="store_true", help="sheet: append the final design")
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
        p.add_argument("action", choices=["add", "rm", "bool"])
        p.add_argument("args", nargs="+", help="add|rm: ID ; bool: A and|or|sub|xor B")
        p.add_argument("--into", type=int, help="bool: result layer (default A; created if missing)")
        p.add_argument("--sel", help=SEL_HELP)
    elif name == "serve":
        p.add_argument("--port", type=int, default=8765)
    elif name in ("ask", "brief"):
        from .assist import setup_cli

        setup_cli(name, p)
    elif name == "gallery":
        p.add_argument("--out", help="default ../public/lab/gallery.json")
        p.add_argument("--seeds", type=int, default=3)
        p.add_argument("--only", help="comma recipe names")
    return p


COMMANDS = {
    "new": (cmd_new, "create an empty workspace: new FILE --size WxH [--layers 3,2,1] [--title T]"),
    "import": (cmd_import, "import SRC (path|clipboard|-) as workspace FILE (selection or design JSON) [--title T]"),
    "export": (cmd_export, "export FILE [--clipboard] [--out x.json] [--format selection|design] (design: + provenance)"),
    "meta": (cmd_meta, "meta FILE [--title T] [--notes N] [--append-notes N] [--tags a,b]: show/set metadata + provenance"),
    "describe": (cmd_describe, "describe FILE: compact text description (silhouette, symmetry, density, relations)"),
    "show": (cmd_show, "LOOK: ASCII + metrics + PNG panel (composite + per layer, grid & rulers)"),
    "render": (cmd_render, "plain PNG render: render FILE [--out] [--cell-px] [--grid] [--layers]"),
    "set": (cmd_set, "set/clear cells: set FILE --layer ID --on 'x,y ...' --off 'x,y ...' [--mirror xy] [--sel S]"),
    "stamp": (cmd_stamp, "stamp ASCII art: stamp FILE --layer ID --at 'x,y [x,y..]' [--anchor center] --text '##./.#.' [--mode]"),
    "draw": (cmd_draw, "draw FILE --layer ID line|rect|fill-rect|ellipse|fill-ellipse|ring|point x,y ... [--sel S]"),
    "erase": (cmd_erase, "erase FILE --sel SPEC [--layer ID|all]: clear every cell inside a selection"),
    "sel": (cmd_sel, "sel FILE SPEC: preview a selection (count, bbox, ASCII)"),
    "op": (cmd_op, "op FILE NAME [--layer ID|all] [--region R] [--sel S] k=v  (see `gridlab ops`)"),
    "ops": (cmd_ops, "list ops with params (ops NAME for full doc)"),
    "gen": (cmd_gen, "gen FILE RECIPE [--seed N] [k=v] [--layer-map 3:1] [--at x,y] [--mode or|replace|area]"),
    "variants": (cmd_variants, 'variants FILE "cmd FILE ..." --seeds 1..6 | variants RECIPE [k={a,b}] -> FILE.variants/runN/ + sheet'),
    "pick": (cmd_pick, "pick RUN/vN.json FILE  (adopt a variant; undoable; records its chain)"),
    "sheet": (cmd_sheet, "sheet FILES... [--cols 4] [--layers 1,2] [--out P]: contact sheet of any design files"),
    "frames": (cmd_frames, "frames RECIPE|FILE [--seed N] [--as sheet|layers|files] [--pick 0,4,8,-1]: process frames"),
    "undo": (cmd_undo, "undo FILE [-n N]"),
    "log": (cmd_log, "history of FILE"),
    "diff": (cmd_diff, "diff A B: cells added/removed per layer (+/- ASCII)"),
    "metrics": (cmd_metrics, "metrics FILE [--json]"),
    "recipes": (cmd_recipes, "list recipes (recipes NAME for params)"),
    "layer": (cmd_layer, "layer FILE add|rm ID | layer FILE bool A and|or|sub|xor B [--into C]"),
    "serve": (cmd_serve, "HTTP API for the /lab page (default port 8765)"),
    "ask": (lambda a: __import__("gridlab.assist", fromlist=["x"]).cmd_ask(a),
            'ask FILE "request" [--region R] [--layer ID] [--dry-run]: Jev routes text to an op (apply/candidates/handoff)'),
    "brief": (lambda a: __import__("gridlab.assist", fromlist=["x"]).cmd_brief(a),
              'brief "a delicate airy ring pendant" [--out FILE] [--n 6]: Jev picks recipe+settings -> variants sheet'),
    "gallery": (cmd_gallery, "build public/lab/gallery.json from all recipes + samples"),
}

USAGE = """gridlab — look at / edit / generate gridpaint designs (coords x,y; y down; layer 1 = top)
loop: describe/show -> small edit (--dry-run first if unsure; --sel to confine) -> show ; variants + sheet + pick ; undo freely
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
    saved = dict(RUN)
    RUN["dry_run"] = bool(getattr(args, "dry_run", False)) and name in MUTATING
    RUN["sel"] = getattr(args, "sel", None)
    try:
        COMMANDS[name][0](args)
    except (CliError, ValueError, KeyError, FileNotFoundError, json.JSONDecodeError) as e:
        msg = e.args[0] if isinstance(e, KeyError) and e.args else e
        print(f"error: {msg}", file=sys.stderr)
        return 1
    finally:
        RUN.clear()
        RUN.update(saved)
    return 0


if __name__ == "__main__":
    sys.exit(main())
