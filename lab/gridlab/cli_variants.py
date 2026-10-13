"""CLI: choosing between options — `variants`, `pick`, `sheet`, `frames`.

Variant runs live next to their source: ``foo.json`` -> ``foo.variants/run<N>/v<i>.json`` + ``sheet.png``.
Runs are numbered (never overwritten). Placeholders in any argument sweep values:
``{0.1,0.3}`` / ``{a,b}`` (lists) and ``{1..6}`` (int range); ``{seed}`` is the seed.
"""

from __future__ import annotations

import contextlib
import io as _io
import itertools
import re
import shlex
import shutil
from pathlib import Path

from .cli_common import (RUN, WORK, CliError, commit, load_ws, parse_kv, parse_seeds, prov_text, rel, save_new,
                         variant_line)
from .io import save_design
from .model import Design, Layer

MAX_VARIANTS = 48
PH_RE = re.compile(r"\{([^{}]*(?:,|\.\.)[^{}]*)\}")


# ---- placeholders ----------------------------------------------------------------

def ph_values(inner: str) -> list[str]:
    if ".." in inner and "," not in inner:
        a, b = inner.split("..", 1)
        try:
            a, b = int(a), int(b)
        except ValueError:
            raise CliError(f"placeholder {{{inner}}}: ranges need ints, e.g. {{1..6}}")
        step = 1 if b >= a else -1
        return [str(v) for v in range(a, b + step, step)]
    return [v.strip() for v in inner.split(",")]


def find_placeholders(texts: list[str]) -> list[tuple[str, str, list[str]]]:
    """[(placeholder text, label, values)] in order of first appearance (same text = same sweep)."""
    seen: dict[str, tuple[str, str, list[str]]] = {}
    for t in texts:
        for m in PH_RE.finditer(t or ""):
            full = m.group(0)
            if full in seen:
                continue
            km = re.search(r"([\w-]+)=$", t[:m.start()])
            label = km.group(1) if km else f"#{len(seen) + 1}"
            seen[full] = (full, label, ph_values(m.group(1)))
    return list(seen.values())


def combos(phs) -> list[dict[str, str]]:
    if not phs:
        return [{}]
    return [dict(zip([p[0] for p in phs], vals)) for vals in itertools.product(*[p[2] for p in phs])]


def subst(text: str, combo: dict[str, str]) -> str:
    for k, v in combo.items():
        text = text.replace(k, v)
    return text


def combo_label(phs, combo) -> str:
    return " ".join(f"{lab}={combo[full]}" for full, lab, _ in phs)


# ---- run directories --------------------------------------------------------------

def new_run_dir(parent: Path, stem: str) -> Path:
    """parent/<stem>.variants/run<N> with the next free N (mkdir is atomic -> parallel-safe)."""
    root = parent / f"{stem}.variants"
    root.mkdir(parents=True, exist_ok=True)
    n = 1 + max([int(p.name[3:]) for p in root.glob("run*") if p.name[3:].isdigit()] or [0])
    while True:
        d = root / f"run{n}"
        try:
            d.mkdir()
            return d
        except FileExistsError:
            n += 1


def _run_nested(toks: list[str]) -> tuple[int, str]:
    from .cli import main

    buf = _io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        rc = main(toks, _nested=True)
    return rc, buf.getvalue()


def cmd_variants(a):
    from .recipes import get_recipe, run_recipe
    from .render import contact_sheet

    target = a.target
    is_file = target.endswith(".json") or Path(target).exists()
    texts = ([a.cmd] if a.cmd else []) + list(a.kwargs)
    phs = find_placeholders(texts)
    seeds = parse_seeds(a.seeds) if a.seeds else ([1] if phs else list(range(1, 7)))
    designs, labels, subs, paths = [], [], [], []
    if is_file:
        base = Path(target)
        if not a.cmd:
            raise CliError('usage: gridlab variants FILE "<cmd FILE ...>[; cmd FILE ...]" --seeds 1..6  '
                           '({seed} = seed; {a,b} {0.1,0.2} {1..6} = sweep)')
        orig = load_ws(base)
        jobs = [(seed, c) for c in combos(phs) for seed in seeds]
        if len(jobs) > MAX_VARIANTS:
            raise CliError(f"{len(jobs)} variants > {MAX_VARIANTS}; narrow --seeds or the {{..}} sweeps")
        run = new_run_dir(Path(a.out_dir) if a.out_dir else base.parent, a.name or base.stem)
        designs.append(orig)
        labels.append("v0 current")
        subs.append(variant_line(orig))
        for i, (seed, c) in enumerate(jobs, 1):
            vp = run / f"v{i}.json"
            save_design(orig, vp)
            chain = subst(a.cmd, c).replace("{seed}", str(seed))
            for cmd in chain.split(";"):
                toks = shlex.split(cmd)
                if not toks:
                    continue
                if len(toks) < 2:
                    raise CliError(f"bad sub-command {cmd!r}")
                toks[1] = str(vp)
                if toks[0] == "gen" and "--seed" not in toks:
                    toks += ["--seed", str(seed)]
                rc, out = _run_nested(toks)
                if rc:
                    raise CliError(f"variant {i} failed on: {' '.join(toks)}\n{out}")
            d = load_ws(vp)
            lab = f"v{i} seed={seed}" + (f" {combo_label(phs, c)}" if c else "")
            d.provenance = list(d.provenance) + [f"# variant {lab.split(' ', 1)[1]} of {base.name}"]
            save_design(d, vp)
            designs.append(d)
            labels.append(lab)
            subs.append(variant_line(d))
            paths.append(vp)
    else:
        spec = get_recipe(target)
        params = parse_kv(texts)
        sweeps = [{}]
        if a.sweep:
            k, vals = a.sweep.split("=", 1)
            sweeps = [{k: v} for v in vals.split(",")]
        jobs = [(seed, c, sw) for c in combos(phs) for sw in sweeps for seed in seeds]
        if len(jobs) > MAX_VARIANTS:
            raise CliError(f"{len(jobs)} variants > {MAX_VARIANTS}; narrow --seeds / sweeps")
        run = new_run_dir(Path(a.out_dir) if a.out_dir else WORK, a.name or spec.name)
        for i, (seed, c, sw) in enumerate(jobs, 1):
            p = {k: subst(v, c) for k, v in params.items()}
            p.update(sw)
            d = run_recipe(spec.name, p, seed)
            vp = run / f"v{i}.json"
            d.history = []
            d.provenance = [" ".join(["gen", "FILE", spec.name, "--seed", str(seed)] + [f"{k}={v}" for k, v in p.items()])]
            save_design(d, vp)
            designs.append(d)
            labels.append(f"v{i} seed={seed}" + (f" {combo_label(phs, c)}" if c else "") + "".join(f" {k}={v}" for k, v in sw.items()))
            subs.append(variant_line(d))
            paths.append(vp)
    sheet_path = run / "sheet.png"
    layers = [int(t) for t in a.layers.split(",")] if a.layers else None
    mx = max(max(d.width, d.height) for d in designs)
    cp = a.cell_px or int(max(3, min(14, 220 // max(1, mx))))
    sheet = contact_sheet(designs, labels, cols=a.cols, cell_px=cp, sublabels=subs, show_grid=a.grid, layers=layers)
    sheet.save(sheet_path)
    for lab, sub, p in zip(labels[-len(paths):], subs[-len(paths):], paths):
        print(f"{lab}: {sub} -> {rel(p)}")
    print(f"sheet: {rel(sheet_path)}  ({sheet.size[0]}x{sheet.size[1]}px)" + (f"  layers {a.layers}" if layers else "")
          + ("  tiles: v0=current" if is_file else "") + ", sublabel = per layer cells/pieces/holes")
    dest = rel(base) if is_file else "FILE.json"
    print(f"pick: gridlab pick {rel(paths[0])} {dest} [--clean]   (--clean removes this run dir)")


def _is_run_file(src: Path) -> bool:
    return src.parent.name.startswith("run") and src.parent.parent.name.endswith(".variants")


def cmd_pick(a):
    from .cli_common import ws_path

    src, dest = Path(a.src), ws_path(a.dest)
    d = load_ws(src)
    d.id = dest.stem
    vprov = list(d.provenance)
    if dest.exists():
        before = load_ws(dest)
        bprov = list(before.provenance)
        chain = vprov[len(bprov):] if vprov[:len(bprov)] == bprov else vprov[-6:]
        label = next((c[len("# variant "):] for c in chain if c.startswith("# variant ")), "")
        steps = [c for c in chain if not c.startswith("#")]
        op = f"pick {src.name}" + (f" [{label}]" if label else "") + (": " + " ; ".join(steps) if steps else "")
        d.history = before.history
        d.provenance = bprov
        d.title, d.notes, d.tags = before.title or d.title, before.notes or d.notes, before.tags or d.tags
        commit(dest, before, d, op)
    else:
        d.history = []
        d.provenance = [c for c in vprov if not c.startswith("#")]
        save_new(d, dest, f"ok: pick {src} -> {dest}")
    if a.clean and not RUN.get("dry_run"):
        if _is_run_file(src):
            n = len(list(src.parent.glob("v*.json")))
            shutil.rmtree(src.parent)
            root = src.parent.parent
            if root.exists() and not any(root.iterdir()):
                root.rmdir()
            print(f"removed {n} variant files ({rel(src.parent)})")
        else:
            n = 0
            stem = src.name.split(".v")[0]
            for p in src.parent.glob(f"{stem}.v*.json"):
                p.unlink()
                n += 1
            print(f"removed {n} variant files")


def _labels_for(paths: list[Path]) -> list[str]:
    stems = [p.name[:-5] if p.name.endswith(".json") else p.stem for p in paths]
    out = []
    for p, s in zip(paths, stems):
        if stems.count(s) > 1 or _is_run_file(p):
            s = f"{p.parent.name}/{s}"
            if _is_run_file(p):
                s = f"{p.parent.parent.name.removesuffix('.variants')}:{s}"
        out.append(s)
    return out


def cmd_sheet(a):
    from .render import contact_sheet

    paths = [Path(f) for f in a.files]
    designs = [load_ws(p) for p in paths]
    labels = a.labels.split(",") if a.labels else _labels_for(paths)
    subs = [variant_line(d) for d in designs]
    layers = [int(t) for t in a.layers.split(",")] if a.layers else None
    mx = max(max(d.width, d.height) for d in designs)
    cp = a.cell_px or int(max(4, min(16, 300 // max(1, mx))))
    sheet = contact_sheet(designs, labels, cols=a.cols, cell_px=cp, sublabels=subs, show_grid=a.grid, layers=layers)
    out = Path(a.out) if a.out else paths[0].parent / f"{paths[0].name.removesuffix('.json')}.sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    for lab, sub in zip(labels, subs):
        print(f"{lab}: {sub}")
    print(f"sheet: {rel(out)}  ({sheet.size[0]}x{sheet.size[1]}px, {len(designs)} tiles, cell {cp}px)")


# ---- frames ---------------------------------------------------------------------------

def frame_design(d: Design, i: int) -> Design:
    label, fl = d.frames[i]
    layers = [Layer(int(k), [g.copy() for g in gs]) for k, gs in fl.items()]
    return Design(d.width, d.height, layers or [Layer.from_mask(1, d.union_mask() & False)], id=f"{d.id}.f{i}",
                  title=f"{d.title or d.id} frame {label}")


def _parse_picks(s: str | None, n: int, default_k: int) -> list[int]:
    if s:
        out = []
        for t in s.split(","):
            if ".." in t:
                x, y = t.split("..")
                out += list(range(int(x), int(y) + 1))
            elif t.strip():
                out.append(int(t))
        res = []
        for i in out:
            j = i + n if i < 0 else i
            if not 0 <= j < n:
                raise CliError(f"frame {i} out of range (0..{n - 1}, negatives count from the end)")
            res.append(j)
        return res
    if n <= default_k:
        return list(range(n))
    return sorted({int(round(v)) for v in [1 + (n - 2) * k / (default_k - 1) for k in range(default_k)]} | {n - 1})[-default_k:]


def cmd_frames(a):
    from .recipes import run_recipe
    from .render import contact_sheet

    src = a.src
    is_file = src.endswith(".json") or Path(src).exists()
    if is_file:
        d = load_ws(src)
        stem, parent = Path(src).name.removesuffix(".json"), Path(src).parent
        srcdesc = f"frames {Path(src).name}"
    else:
        params = parse_kv(a.kwargs)
        d = run_recipe(src, params, a.seed)
        stem, parent = f"{src}.s{a.seed}", WORK
        srcdesc = " ".join(["gen", "FILE", src, "--seed", str(a.seed)] + [f"{k}={v}" for k, v in params.items()])
    n = len(d.frames)
    if not n:
        raise CliError(f"{src} has no frames (only process recipes record them; a fill/steps sweep with `variants` "
                       f"and the same seed is the fallback)")
    print(f"{src}: {n} frames: " + ", ".join(f"{i}:{lab}" for i, (lab, _) in enumerate(d.frames[:40]))
          + (" ..." if n > 40 else ""))
    mode = a.as_
    picks = _parse_picks(a.pick, n, 4 if mode == "layers" else 16)
    if mode == "sheet":
        fds = [frame_design(d, i) for i in picks] + ([d] if a.final else [])
        labels = [f"f{i} {d.frames[i][0]}"[:30] for i in picks] + (["final"] if a.final else [])
        mx = max(d.width, d.height)
        cp = a.cell_px or int(max(3, min(14, 220 // max(1, mx))))
        sheet = contact_sheet(fds, labels, cols=a.cols, cell_px=cp, sublabels=[variant_line(x) for x in fds])
        out = Path(a.out) if a.out else parent / f"{stem}.frames.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out)
        print(f"sheet: {rel(out)}  ({sheet.size[0]}x{sheet.size[1]}px)  frames {picks}")
        return
    if mode == "layers":
        masks = {}
        for k, i in enumerate(picks, 1):
            fd = frame_design(d, i)
            masks[k] = fd.union_mask()
        out_d = Design.from_masks(masks, id=stem, title=f"{stem} process fossil", recipe=d.recipe, params=d.params,
                                  seed=d.seed, notes=f"frames {picks} stacked as layers (L1 = earliest)")
        out_d.provenance = [srcdesc, f"frames --as layers --pick {','.join(map(str, picks))}"]
        out = Path(a.out) if a.out else parent / f"{stem}.frames.json"
        if save_new(out_d, out, f"ok: frames {picks} -> layers 1..{len(picks)} (L1 = frame {picks[0]}, top) -> {rel(out)}"):
            from . import metrics as MX
            print(MX.delta_text({}, MX.compact(out_d)))
            print(f"next: gridlab show {rel(out)}")
        return
    if mode == "files":
        out_dir = Path(a.out) if a.out else parent / f"{stem}.frames"
        out_dir.mkdir(parents=True, exist_ok=True)
        for i in picks:
            fd = frame_design(d, i)
            fd.provenance = [srcdesc, f"frame {i}"]
            p = out_dir / f"f{i}.json"
            save_design(fd, p)
            print(f"f{i} {d.frames[i][0]}: {variant_line(fd)} -> {rel(p)}")
        return
    raise CliError("--as sheet|layers|files")
