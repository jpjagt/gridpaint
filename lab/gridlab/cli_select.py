"""CLI: selections (`sel`, `erase`) and layer management incl. booleans (`layer FILE add|rm|bool`)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import view
from .cli_common import CliError, current_sel, load_ws, mutate, parse_layers
from .model import Design, mask_bbox
from .selection import SelError, parse_sel


def cmd_sel(a):
    d = load_ws(a.file)
    try:
        m = parse_sel(a.spec, d)
    except SelError as e:
        raise CliError(str(e))
    union = d.union_mask()
    bb = mask_bbox(m)
    per = ", ".join(f"L{l.id} {int((l.mask & m).sum())}" for l in d.layers_top_to_bottom())
    print(f"selection {a.spec!r}: {int(m.sum())} cells, bbox {'empty' if bb is None else '%d,%d..%d,%d' % bb}; material inside: {per}")
    if d.width <= 80 or a.force:
        chars = np.full(d.shape, ".", dtype="<U1")
        chars[union & ~m] = "o"
        chars[m & ~union] = "+"
        chars[m & union] = "#"
        print("('+' selected empty, '#' selected material, 'o' material outside, '.' empty outside)")
        print(view.grid_text(chars))


def cmd_erase(a):
    path = Path(a.file)
    if not a.sel:
        raise CliError("erase needs --sel SPEC (e.g. --sel 'half:x>12' or --sel circle:8,8,3)")

    def fn(d: Design):
        sel = current_sel(d)
        ids = parse_layers(a.layer) or d.layer_ids
        for lid in ids:
            for g in d.layer(lid).groups:
                g.cells = g.cells & ~sel
        return d

    mutate(path, "erase " + " ".join(a.raw), fn)


LAYER_USAGE = "layer FILE add ID | rm ID | bool A and|or|sub|xor B [--into C]"


def cmd_layer(a):
    from .ops.lattice_ops import BOOL_OPS, layer_bool

    path = Path(a.file)
    args = a.args
    if a.action in ("add", "rm"):
        if len(args) != 1:
            raise CliError(f"usage: {LAYER_USAGE}")
        lid = int(args[0])

        def fn(d: Design):
            if a.action == "add":
                if d.has_layer(lid):
                    raise CliError(f"layer {lid} exists")
                d.layer(lid, create=True)
            else:
                d.layer(lid)
                d.remove_layer(lid)
            return d

        mutate(path, f"layer {a.action} {lid}", fn)
        return
    if len(args) != 3 or args[1] not in BOOL_OPS:
        raise CliError(f"usage: {LAYER_USAGE}")
    A, op, B = int(args[0]), args[1], int(args[2])
    into = a.into if a.into is not None else A

    def fn(d: Design):
        return layer_bool(d, A, op, B, into)

    mutate(path, f"layer bool {A} {op} {B} --into {into}", fn)
