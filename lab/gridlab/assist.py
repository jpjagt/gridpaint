"""Language -> gridlab actions, with Jev (gridlab.jev) as the closed-set decider.

Per docs/jev-experiments.md Jev is used ONLY for:
- ``route_edit``: which *registered* op a free-text edit request means + closed-set args
  (axis, fold, source/target layer, strength), with "was it stated?" Nouls;
- ``brief_to_settings``: brief -> recipe + silhouette / density / symmetry / layers / size buckets.
It never reads grids or judges beauty (code metrics + the human / a vision LLM do that).

Routing policy (tuned on jev-1.13.0, 50 requests, 98% op accuracy, all errors had conf < 0.7):
the op Choice is asked twice in one call (forward + reversed option order) and the probabilities are
averaged. ``other`` / conf < 0.5 / order disagreement -> hand off to the LLM coordinator;
0.5 <= conf < 0.7 -> top-2 candidates as variants; conf >= 0.7 -> apply (undoable). An arg is used only
when its ``*_stated`` Noul > 0.6; an unstated but essential arg (mirror axis, 4-fold kind) yields
candidates instead of a guess. Call confidence = min(op, used args).

The op list is built from the registry at call time, so ops added by other modules are routable.
Descriptions come from ``OP_HINTS`` (hand-written, human wording) or else the op docstring's first
sentence; ``ROUTE_HIDDEN`` drops aliases.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from .jev import choice_confidence, make_judge
from .model import Design
from .ops.registry import OpSpec, apply_op, list_ops

APPLY_AT = 0.7
CANDIDATES_AT = 0.5
STATED_AT = 0.6

GENERIC_TOKENS = {"layer", "layers", "the", "and", "all", "cells", "sym"}  # too common to be op keywords
ROUTE_HIDDEN = {"invert-in-mask"}  # aliases / plumbing not worth a routing option

# Human descriptions (criteria sent to Jev) + private keywords for the heuristic judge.
OP_HINTS: dict[str, tuple[dict, list[str]]] = {
    "mirror": ({"what": "Mirror one side onto the other along ONE axis (left<->right or top<->bottom), so that side is copied reflected"},
               [r"\bmirror", r"\breflect", r"symmetric", r"match(es)? the (left|right|top|bottom)", r"onto the (left|right|top|bottom)"]),
    "symmetrize": ({"what": "Make the whole design symmetric by copying one part around: both-ways mirror (2 mirrors), 4-fold or 2-fold rotational symmetry, like a snowflake or rosette"},
                   [r"\d[- ]?fold", r"(two|four)[- ]?(fold|way)", r"snowflake", r"radial", r"rotational", r"symmetri(c|cal|ze)"]),
    "sym-or": ({"what": "Add the mirrored or rotated copies of the cells on top of what is there (symmetric union; only adds cells, never removes)"},
               [r"add .*mirror", r"union"]),
    "sym-and": ({"what": "Keep only the cells that already have a symmetric partner; delete the asymmetric leftovers"},
                [r"asymmetric (bits|cells|parts)"]),
    "dilate": ({"what": "Make strokes and shapes bolder / thicker by growing them outward"},
               [r"thick", r"bold", r"chunk", r"fatter", r"\bgrow", r"heav(y|ier)", r"wider"]),
    "erode": ({"what": "Make shapes thinner / smaller by shrinking them inward from their edges"},
              [r"thinner", r"\bshrink", r"slimmer", r"finer", r"\bthin\b"]),
    "open": ({"what": "Remove thin spurs, whiskers and narrow necks while keeping the bulk of the shapes"},
             [r"spur", r"whisker", r"\bhairs?\b", r"narrow bits"]),
    "close": ({"what": "Close small gaps, notches and cracks between nearby parts so shapes become solid and smooth",
               "not_for": "holes fully enclosed inside a shape"},
              [r"\bgaps?\b", r"notch", r"crack", r"\bsmooth", r"soften", r"less (blocky|pixel)"]),
    "skeleton": ({"what": "Thin shapes down to single-cell-wide centre lines (skeleton), a fine filigree / wire look"},
                 [r"skeleton", r"centre ?line", r"center ?line", r"one[- ]cell[- ]wide", r"single[- ]pixel", r"wire"]),
    "fill-holes": ({"what": "Fill empty gaps that are completely enclosed by filled cells", "not_for": "joining separate pieces"},
                   [r"\bholes?\b", r"fill (in )?the (gaps|holes)", r"enclosed"]),
    "remove-small": ({"what": "Delete tiny isolated bits, specks, crumbs and stray single cells"},
                     [r"\bspecks?\b", r"stray", r"crumbs?", r"\bdust\b", r"\bnoise\b", r"tiny (bits|pieces|dots)", r"isolated", r"little (bits|dots)", r"clean ?up"]),
    "keep-largest": ({"what": "Keep only the biggest connected piece and delete every other piece"},
                     [r"(only|just) the (biggest|largest|main)", r"largest piece"]),
    "outline": ({"what": "Trace every stroke: add an offset band hugging each shape, or hollow shapes out to just their outline",
                 "not_for": "a single border around the whole piece"},
                [r"\boutline", r"\brim\b", r"halo", r"hollow"]),
    "frame": ({"what": "Add a border / frame line around the whole piece (around its outer silhouette)"},
              [r"\bframe\b", r"\bborder\b", r"\bedging\b"]),
    "clear": ({"what": "Erase everything in the layer or selection"},
              [r"\berase\b", r"\bclear\b", r"delete (everything|all)", r"wipe"]),
    "clip": ({"what": "Cut the design down to a silhouette shape (ellipse, capsule, diamond or shield), deleting what is outside"},
             [r"\bclip\b", r"\bcrop to\b", r"cut .* (oval|ellipse|diamond|shield|capsule)", r"\binto an? (oval|ellipse|diamond|shield)"]),
    "fill": ({"what": "Fill a whole shape solid (ellipse, capsule, diamond, shield, or the full area)"},
             [r"fill (it|the (whole|area|layer|region))", r"\bsolid\b"]),
    "flip": ({"what": "Flip or turn the whole design (mirror image, upside down, rotate 90 degrees) without copying anything"},
             [r"\bflip", r"upside[- ]down", r"\brotate\b", r"turn it"]),
    "invert": ({"what": "Swap filled and empty cells (negative image)"},
               [r"\binvert", r"negative", r"swap (the )?(filled|empty)"]),
    "shift": ({"what": "Nudge or move the cells by an offset (left, right, up, down)"},
              [r"\bnudge", r"\bmove (it|everything|this) (up|down|left|right)", r"\bshift"]),
    "center": ({"what": "Centre the design on the canvas"}, [r"\bcent(er|re)\b"]),
    "copy-layer": ({"what": "Copy one layer unchanged onto another layer"},
                   [r"\bcopy\b.*layer", r"duplicate .*layer"]),
    "move-layer": ({"what": "Give a layer a different layer number (renumber it)"}, [r"renumber"]),
    "swap-layers": ({"what": "Swap the contents of two layers"}, [r"\bswap\b.*layers?"]),
    "merge-groups": ({"what": "Merge the connectivity groups of a layer so all its cells blob together"},
                     [r"merge (the )?groups"]),
    "clip-to-below": ({"what": "Remove the cells of a layer that have no material underneath them (unsupported overhangs)"},
                      [r"overhang", r"unsupported", r"floating .*(layer|above)"]),
    "support": ({"what": "Add material to the layer beneath so every cell of the upper layer rests on something"},
                [r"\bsupport", r"rest on", r"backing"]),
    "clip-to-layer": ({"what": "Keep only the cells of a layer that lie over, or inside the outline of, ANOTHER layer (mask one layer by another)"},
                      [r"(inside|within|over) (the )?(outline of )?(layer|the (top|middle|bottom) layer)", r"mask (it |layer \d )?by"]),
    "lattice": ({"what": "Fill an area with a regular diagonal lattice / trellis / mesh pattern (quatrefoil lace)"},
                [r"lattice", r"trellis", r"\bmesh\b", r"\bgrid pattern", r"quatrefoil"]),
    "scale": ({"what": "Enlarge the design or a layer by an integer factor (twice / three times as big)"},
              [r"\bscale", r"enlarge", r"twice as (big|large)", r"\bdouble the size", r"upscale"]),
    "trim": ({"what": "Crop the canvas tightly around the design"}, [r"\btrim\b", r"crop the canvas"]),
    "pad": ({"what": "Add empty margin around the canvas"}, [r"\bpad\b", r"\bmargin\b"]),
    "resize": ({"what": "Change the canvas size"}, [r"\bresize\b", r"canvas size"]),
}
OTHER = {"what": "Anything else: app commands (undo, export, save), vague feelings, or requests none of the options describe"}
OTHER_KW: list[str] = []

ARG_QUESTIONS = {
    "axis": {"type": "choice", "instructions": "If `request` asks for mirror symmetry, across which axis?",
             "criteria": {"left_right": "Left and right sides become mirror images", "top_bottom": "Top and bottom become mirror images",
                          "both": "Both left-right and top-bottom", "diagonal": "Across a diagonal",
                          "not_said": "The request does not say which way"},
             "_keywords": {"left_right": [r"\bleft\b", r"\bright\b", r"horizontal"],
                           "top_bottom": [r"top (half|side)? ?(on)?to the bottom", r"bottom (half|side)? ?(on)?to the top",
                                          r"upside", r"vertical", r"top and bottom", r"bottom half match"],
                           "both": [r"\bboth\b", r"all four", r"quadrant"], "diagonal": [r"diagonal"]},
             "_fallback": "not_said"},
    "axis_stated": {"type": "noul", "instructions": "Does `request` explicitly say which direction or axis to mirror across (left/right, top/bottom, diagonal)?",
                    "_keywords": [r"\bleft\b", r"\bright\b", r"top (half|side)", r"bottom (half|side)", r"diagonal", r"horizontal", r"vertical", r"\bboth\b"]},
    "fold": {"type": "choice", "instructions": "If `request` asks for rotational repetition, how many-fold?",
             "criteria": {"two": "Half-turn (2-fold)", "four": "Quarter-turn (4-fold)", "not_said": "The request does not say"},
             "_keywords": {"two": [r"\b(2|two)[- ]?(fold|way)", r"half[- ]turn", r"180"],
                           "four": [r"\b(4|four)[- ]?(fold|way)", r"quarter[- ]turn", r"\b90\b", r"snowflake"]},
             "_fallback": "not_said"},
    "source": {"type": "choice", "instructions": "Which layer or side does `request` treat as the reference or source to copy/follow from?",
               "criteria": {"top": "The top layer or top side", "middle": "The middle layer", "bottom": "The bottom layer or bottom side",
                            "left": "The left side", "right": "The right side", "not_said": "No source is mentioned"},
               "_keywords": {"top": [r"(of|from|follow|match|like) (the )?top"], "middle": [r"(of|from|follow|match|like) (the )?middle"],
                             "bottom": [r"(of|from|follow|match|like) (the )?(bottom|base)"],
                             "left": [r"\bleft (half|side)? ?(on)?to\b", r"from the left"], "right": [r"\bright (half|side)? ?(on)?to\b", r"from the right"]},
               "_fallback": "not_said"},
    "target": {"type": "choice", "instructions": "Which layer does `request` want changed or to receive the result?",
               "criteria": {"top": "The top layer", "middle": "The middle layer", "bottom": "The bottom layer / base plate",
                            "not_said": "No layer is mentioned"},
               "_keywords": {"top": [r"\btop layer", r"make the top\b"], "middle": [r"middle layer", r"make the middle\b"],
                             "bottom": [r"bottom layer", r"\bbase\b", r"back ?plate"]},
               "_fallback": "not_said"},
    "target_stated": {"type": "noul", "instructions": "Does `request` explicitly name a layer (top, middle, bottom, base plate, a layer number)?",
                      "_keywords": [r"\blayer", r"\bbase\b", r"back ?plate", r"(top|middle|bottom) one"]},
    "details_unhandled": {"type": "noul", "instructions": "Does `request` state specific details beyond the kind of edit: "
                          "a distance or gap, a size or thickness, a count, a new or extra layer, a symmetry order "
                          "(e.g. 4-fold), or something that must stay unchanged?",
                          "_keywords": [r"\d+[- ]?(cell|px|pixel|fold|times)", r"\bgap\b", r"new (top |bottom )?layer",
                                        r"extra layer", r"\bfold\b", r"\bthick(ness)?\b", r"\bwide\b"]},
    "strength": {"type": "score", "instructions": "How strong a change does `request` ask for?",
                 "criteria": ["A subtle touch: the user says slightly, a bit, a little", "A normal change: no intensity word is used",
                              "A strong change: the user says much more, very, a lot"],
                 "_keywords": [[r"slight", r"a (little )?bit", r"a little", r"subtle", r"tiny bit"], [],
                               [r"much", r"\bvery\b", r"a lot", r"really", r"way more", r"heavily"]],
                 "_default": 1},
}

SIDE_OPS = {"mirror", "flip", "symmetrize", "sym-or", "sym-and", "shift"}
SQUARE_KINDS = {"d4", "rot4", "diag"}


# ---- data ------------------------------------------------------------------------

@dataclass
class RouteContext:
    layer_ids: list[int]                  # gridpaint ids, 1 = top
    width: int = 0
    height: int = 0
    layer: int | None = None              # explicit --layer
    region: tuple[int, int, int, int] | None = None
    active_layer: int | None = None
    bbox: tuple[int, int, int, int] | None = None  # material bbox (code-computed)

    @classmethod
    def from_design(cls, d: Design, layer: int | None = None, region=None) -> "RouteContext":
        return cls(sorted(d.layer_ids), d.width, d.height, layer, region, layer, d.bbox())

    def off_centre(self) -> bool:
        """Material bbox not centred on the canvas -> symmetry ops about the canvas centre would misalign."""
        if self.bbox is None or not self.width:
            return False
        x0, y0, x1, y1 = self.bbox
        return (x0 + x1) != (self.width - 1) or (y0 + y1) != (self.height - 1)

    def named(self) -> dict[str, int]:
        ids = sorted(self.layer_ids)
        out = {}
        if ids:
            out["top"], out["bottom"] = ids[0], ids[-1]
        if len(ids) >= 3:
            out["middle"] = ids[len(ids) // 2]
        return out

    def describe(self, lid: int) -> str:
        roles = [k for k, v in self.named().items() if v == lid]
        return f"layer {lid}" + (f" ({'/'.join(roles)})" if roles else "")


@dataclass
class Step:
    op: str
    layers: list[int] | None = None       # None = all layers
    region: tuple[int, int, int, int] | None = None
    kwargs: dict = field(default_factory=dict)

    def cli(self, file: str = "FILE") -> str:
        s = f"gl op {file} {self.op}"
        if self.layers is not None:
            s += f" --layer {','.join(map(str, self.layers))}"
        if self.region is not None:
            s += f" --region {','.join(map(str, self.region))}"
        s += "".join(f" {k}={v}" for k, v in self.kwargs.items())
        return s


@dataclass
class Candidate:
    label: str
    steps: list[Step]
    prob: float = 1.0


@dataclass
class EditPlan:
    request: str
    decision: str                          # "apply" | "candidates" | "handoff"
    op: str
    confidence: float                      # call confidence = min(op, used args)
    op_confidence: float
    op_probs: dict[str, float]             # averaged fwd/rev, sorted desc
    args: dict[str, dict]                  # semantic args: {name: {value, confidence, stated}}
    candidates: list[Candidate] = field(default_factory=list)  # 1 for apply, >=2 for candidates
    message: str = ""
    notes: list[str] = field(default_factory=list)
    source: str = "heuristic"

    def top_ops(self, k: int = 4) -> list[tuple[str, float]]:
        return list(self.op_probs.items())[:k]

    def text(self, file: str = "FILE") -> str:
        lines = [f"request: {self.request!r}   [judge: {self.source}]",
                 "op probs: " + ", ".join(f"{k} {v:.2f}" for k, v in self.top_ops(5)),
                 f"op: {self.op} (conf {self.op_confidence:.2f})  call conf {self.confidence:.2f}  -> {self.decision.upper()}"]
        used = {k: v for k, v in self.args.items() if v.get("used")}
        if used:
            lines.append("args: " + ", ".join(f"{k}={v['value']} ({v['confidence']:.2f})" for k, v in used.items()))
        for i, c in enumerate(self.candidates, 1):
            pre = "plan" if self.decision == "apply" else f"candidate {i}"
            lines.append(f"{pre}: {c.label}")
            lines += [f"    {s.cli(file)}" for s in c.steps]
        lines += [f"note: {n}" for n in self.notes]
        if self.message:
            lines.append(self.message)
        return "\n".join(lines)


# ---- op options from the registry ---------------------------------------------------

def _first_sentence(doc: str) -> str:
    s = " ".join(doc.split())
    m = re.match(r"(.+?[.:;])(\s|$)", s)
    return (m.group(1) if m else s).rstrip(".:;")[:160] or "(no description)"


def op_options(specs: list[OpSpec] | None = None) -> tuple[dict, dict]:
    """(criteria, keywords) for the op Choice, from the live registry; 'other' last."""
    specs = specs if specs is not None else list_ops()
    crit, kws = {}, {}
    for s in specs:
        if s.name in ROUTE_HIDDEN:
            continue
        if s.name in OP_HINTS:
            crit[s.name], kws[s.name] = OP_HINTS[s.name]
        else:
            crit[s.name] = {"what": _first_sentence(s.doc)}
            toks = [t for t in re.split(r"[-_]", s.name) if len(t) > 2 and t not in GENERIC_TOKENS]
            kws[s.name] = [r"\b" + re.escape(" ".join(re.split(r"[-_]", s.name)))] + [rf"\b{re.escape(t)}" for t in toks]
    crit["other"], kws["other"] = OTHER, OTHER_KW
    return crit, kws


def route_questions(specs: list[OpSpec] | None = None) -> dict:
    crit, kws = op_options(specs)
    names = list(crit)
    base = {"type": "choice", "instructions": {"question": "Which edit operation does `request` ask for?",
                                               "focus": "Classify the main change the user wants to see in the design."},
            "_keywords": kws, "_fallback": "other"}
    fwd = {**base, "criteria": crit}
    rev = {**base, "criteria": {k: crit[k] for k in names[-2::-1] + ["other"]}}
    return {"op": fwd, "op_rev": rev, **ARG_QUESTIONS}


def route_state(request: str, ctx: RouteContext) -> dict:
    """Small JSON state per the experiments: request, selection in words, active layer, layer names. No grid data."""
    sel = (f"a rectangular region x {ctx.region[0]}..{ctx.region[2]}, y {ctx.region[1]}..{ctx.region[3]}"
           if ctx.region else "the whole design")
    return {"request": request, "selection": sel,
            "active_layer": ctx.describe(ctx.active_layer) if ctx.active_layer else "none (all layers)",
            "layers": [ctx.describe(i) + (" (base plate)" if i == ctx.layer_ids[-1] and len(ctx.layer_ids) > 1 else "")
                       for i in ctx.layer_ids]}


# ---- routing ------------------------------------------------------------------------

def _avg_choice(a: dict, b: dict) -> dict[str, float]:
    keys = list(a["probabilities"])
    p = {k: (a["probabilities"].get(k, 0) + b["probabilities"].get(k, 0)) / 2 for k in keys}
    return dict(sorted(p.items(), key=lambda kv: -kv[1]))


def _layer_refs(request: str, ctx: RouteContext) -> tuple[list[int], list[int]]:
    """Explicit layer numbers in the text (code, not Jev): (targets, sources)."""
    src = [int(n) for n in re.findall(r"\b(?:of|from|like|follow(?:s|ing)?)\s+(?:the\s+)?layer\s*#?(\d+)", request, re.I)]
    allnums = [int(n) for n in re.findall(r"\blayer\s*#?(\d+)", request, re.I)]
    valid = set(ctx.layer_ids)
    tgt = [n for n in allnums if n not in src and n in valid]
    return tgt, [n for n in src if n in valid]


def _resolve_args(ans: dict, request: str, ctx: RouteContext) -> dict[str, dict]:
    def ch(q):
        a = ans[q]
        return {"value": a["choice"], "confidence": float(a.get("confidence", 0)), "probs": a["probabilities"]}

    args = {"axis": ch("axis"), "fold": ch("fold"), "source": ch("source"), "target": ch("target")}
    args["axis"]["stated"] = ans["axis_stated"]["noul"] > STATED_AT and args["axis"]["value"] != "not_said"
    args["fold"]["stated"] = args["fold"]["value"] != "not_said" and args["fold"]["confidence"] >= CANDIDATES_AT
    args["source"]["stated"] = args["source"]["value"] != "not_said" and args["source"]["confidence"] >= STATED_AT
    args["target"]["stated"] = ans["target_stated"]["noul"] > STATED_AT and args["target"]["value"] != "not_said"
    st = ans["strength"]
    lvl = int(round(float(st["score"])))
    args["strength"] = {"value": ["subtle", "normal", "strong"][max(0, min(2, lvl))],
                        "confidence": float(st.get("confidence", 0)), "stated": lvl != 1}
    # layer numbers / --layer are exact: code wins over Jev
    tgt_n, src_n = _layer_refs(request, ctx)
    named = ctx.named()
    if ctx.layer is not None:
        args["target_layer"] = {"value": ctx.layer, "confidence": 1.0, "stated": True, "why": "--layer"}
    elif tgt_n:
        args["target_layer"] = {"value": tgt_n[0], "confidence": 1.0, "stated": True, "why": "layer number in text"}
    elif (args["target"]["stated"] and args["target"]["value"] in named
          and re.search(r"\blayer|\bbase\b|plate|\b(top|middle|bottom) one\b", request, re.I)):
        # code guard: "the bottom half" is a side, not a layer; only trust layer words that say layer
        args["target_layer"] = {"value": named[args["target"]["value"]], "confidence": args["target"]["confidence"],
                                "stated": True, "why": f"'{args['target']['value']}'"}
    if src_n:
        args["source_layer"] = {"value": src_n[0], "confidence": 1.0, "stated": True, "why": "layer number in text"}
    elif args["source"]["stated"] and args["source"]["value"] in named:
        args["source_layer"] = {"value": named[args["source"]["value"]], "confidence": args["source"]["confidence"],
                                "stated": True, "why": f"'{args['source']['value']}'"}
    for v in args.values():
        v.setdefault("used", False)
    return args


def _centre_prep(ctx: RouteContext, region) -> tuple[list[Step], int, int]:
    """Whole-canvas symmetry needs the material centred: trim to bbox+1 first. Returns (steps, W, H) after."""
    if region is None and ctx.off_centre():
        x0, y0, x1, y1 = ctx.bbox
        return [Step("trim", None, None, {"margin": 1})], x1 - x0 + 3, y1 - y0 + 3
    return [], ctx.width, ctx.height


def _square_prep(ctx: RouteContext, region, w: int | None = None, h: int | None = None):
    """Steps/region so a square-only op can run: square region or grow the canvas."""
    w = ctx.width if w is None else w
    h = ctx.height if h is None else h
    if region is not None:
        x0, y0, x1, y1 = region
        s = min(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        return [], (cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s)
    if w and h and w != h:
        m = max(w, h)
        return [Step("resize", None, None, {"w": m, "h": m})], None
    return [], region


def _alternatives(op: str, spec: OpSpec, args: dict, ctx: RouteContext, request: str) -> tuple[list[Candidate], list[str]]:
    """Concrete step lists for op (>1 = an essential arg was not stated: try both). Returns (cands, used arg names)."""
    region = ctx.region
    tl = args.get("target_layer")
    layers = [tl["value"]] if tl else None
    used: list[str] = ["target_layer"] if tl else []
    params = {p.name: p.default for p in spec.params}
    strength = args["strength"]["value"]
    pre: list[Step] = []

    def C(label, kw, reg=region, lyr=None, pre_steps=()):
        return Candidate(label, list(pre_steps) + [Step(op, lyr if lyr is not None else layers, reg, kw)])

    # derive: "make the top layer the skeleton of the middle" -> copy middle onto top, then op on top
    sl = args.get("source_layer")
    if spec.kind == "mask" and op not in SIDE_OPS and sl and tl and sl["value"] != tl["value"]:
        pre.append(Step("copy-layer", [sl["value"]], None, {"to": tl["value"], "mode": "replace"}))
        used.append("source_layer")

    axis, src = args["axis"], args["source"]["value"]
    if op == "mirror":
        ax_map = {"left_right": "x", "top_bottom": "y", "both": "xy", "diagonal": "diag"}
        side_axis = {"left": "x", "right": "x", "top": "y", "bottom": "y"}
        if axis["stated"]:
            ax = [ax_map[axis["value"]]]
            used.append("axis")
        elif args["source"]["stated"] and src in side_axis:
            ax = [side_axis[src]]
            used.append("source")
        else:
            ax = ["x", "y", "xy"]
        out = []
        for a in ax:
            kw = {"axis": a}
            if a in ("x", "y") and args["source"]["stated"] and side_axis.get(src) == a:
                kw["keep"] = src
                if "source" not in used:
                    used.append("source")
            prep, reg = ([], region)
            if a == "diag":
                cprep, w, h = _centre_prep(ctx, region)
                prep, reg = _square_prep(ctx, region, w, h)
                prep = cprep + prep
            elif region is None and ctx.off_centre():
                x0, y0, x1, y1 = ctx.bbox  # mirror about the material centre, not the canvas centre
                if a in ("x", "xy"):
                    kw["cx"] = (x0 + x1) / 2
                if a in ("y", "xy"):
                    kw["cy"] = (y0 + y1) / 2
            out.append(C(f"mirror axis={a}" + (f" keep={kw['keep']}" if "keep" in kw else ""), kw, reg, pre_steps=pre + prep))
        return out, used
    if op in ("symmetrize", "sym-or", "sym-and"):
        fold = args["fold"]
        if fold["stated"]:
            kinds = ["rot2"] if fold["value"] == "two" else ["d4", "rot4"]
            used.append("fold")
        elif axis["stated"] and axis["value"] == "both":
            kinds = ["d2"]
            used.append("axis")
        elif axis["stated"] and op != "symmetrize" and axis["value"] in ("left_right", "top_bottom", "diagonal"):
            kinds = [{"left_right": "x", "top_bottom": "y", "diagonal": "diag"}[axis["value"]]]
            used.append("axis")
        else:
            kinds = ["d2", "d4"]
        out = []
        cprep, w, h = _centre_prep(ctx, region)
        for k in kinds:
            prep, reg = _square_prep(ctx, region, w, h) if k in SQUARE_KINDS else ([], region)
            prep = cprep + prep
            out.append(C(f"{op} kind={k}", {"kind": k}, reg, pre_steps=pre + prep))
        return out, used
    if op == "flip":
        a = {"left_right": "x", "top_bottom": "y"}.get(axis["value"]) if axis["stated"] else None
        if a:
            used.append("axis")
            return [C(f"flip axis={a}", {"axis": a}, pre_steps=pre)], used
        return [C("flip axis=x", {"axis": "x"}, pre_steps=pre), C("flip axis=y", {"axis": "y"}, pre_steps=pre)], used
    if op in ("copy-layer", "move-layer") and sl and tl and sl["value"] != tl["value"]:
        used.append("source_layer")
        return [Candidate(f"{op} {sl['value']} -> {tl['value']}",
                          [Step(op, [sl["value"]], None, {"to": tl["value"]})])], used
    if op == "swap-layers":
        pair = [x["value"] for x in (tl, sl) if x]
        if len(set(pair)) < 2:  # exact layer words / numbers in the text (code, not Jev)
            named = ctx.named()
            words = [named[w] for w in re.findall(r"\b(top|middle|bottom)\b", request, re.I) if w in named]
            pair = list(dict.fromkeys(pair + words + _layer_refs(request, ctx)[0]))
        if len(set(pair)) >= 2:
            return [Candidate(f"swap-layers {pair[0]},{pair[1]}", [Step(op, pair[:2], None, {})])], used
        return [], used
    if op in ("copy-layer", "move-layer"):
        return [], used  # needs both a source and a destination layer
    kw: dict = {}
    if op == "remove-small":
        kw["min_size"] = 6 if strength == "strong" else 3
    elif op == "outline":
        hollow = re.search(r"hollow|only the outline|just the outline|keep (only )?the (outline|border)", request, re.I)
        kw = {"d": 0, "thickness": 1, "mode": "replace"} if hollow else {"d": 1, "thickness": 1, "mode": "or"}
    elif "n" in params and isinstance(params["n"], int) and not isinstance(params["n"], bool):
        kw["n"] = 2 if strength == "strong" else 1
    label = op + "".join(f" {k}={v}" for k, v in kw.items())
    return [C(label, kw, pre_steps=pre)], used


_NUM = {"one": 1, "a": 1, "single": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "eight": 8}
_N = r"(\d+|one|a|single|two|three|four|five|six|eight)"


def _num(t: str) -> int:
    return int(t) if t.isdigit() else _NUM[t.lower()]


def extract_details(request: str) -> list[dict]:
    """Concrete details stated in the text (code, not Jev): [{text, kind, value}].
    kinds: gap (empty cells between), thickness, distance, count, new_layer, fold, keep."""
    r = request.lower()
    out = []

    def add(m, kind, value=None):
        out.append({"text": m.group(0), "kind": kind, "value": value})

    for m in re.finditer(_N + r"[- ]?(?:cell|px|pixel|square)s?[- ]?(?:wide )?gap|gap of " + _N + r"(?: cells?)?", r):
        add(m, "gap", _num(m.group(1) or m.group(2)))
    for m in re.finditer(_N + r"[- ]?(?:cell|px|pixel)s?[- ]?(?:thick|wide)\b|thickness (?:of )?" + _N, r):
        add(m, "thickness", _num(m.group(1) or m.group(2)))
    for m in re.finditer(_N + r"[- ]?(?:cell|px|pixel)s? (?:away|apart|out|from)", r):
        add(m, "distance", _num(m.group(1)))
    for m in re.finditer(r"\bby " + _N + r"(?: cells?| steps?| times)?\b", r):
        add(m, "count", _num(m.group(1)))
    for m in re.finditer(r"\b(?:new|extra|another|separate) (?:top |bottom |back |front )?layer|\bon a layer of its own", r):
        add(m, "new_layer")
    for m in re.finditer(r"\b(\d|two|three|four|six|eight)[- ]?fold\b", r):
        add(m, "fold", _num(m.group(1)))
    for m in re.finditer(r"\bkeep(?:ing)? (?:it |the |them )?(\w+)", r):
        add(m, "keep", m.group(1))
    return out


# detail kind -> op params it can set (first existing wins), with a value transform
DETAIL_PARAMS = {
    "gap": [("d", lambda v: v + 1)],          # frame/outline: d=1 touches, a 1-cell gap needs d=2
    "thickness": [("thickness", lambda v: v), ("width", lambda v: v)],
    "distance": [("d", lambda v: v), ("reach", lambda v: v), ("max_len", lambda v: v)],
    "count": [("n", lambda v: v), ("k", lambda v: v)],
}


def apply_details(op: str, spec: OpSpec, cands: list, details: list[dict], args: dict) -> tuple[list[str], list[str]]:
    """Map details onto op params (mutates candidate steps). Returns (mapped notes, unhandled detail texts)."""
    params = {p.name for p in spec.params}
    mapped, unhandled = [], []
    for det in details:
        k = det["kind"]
        hit = next(((p, f) for p, f in DETAIL_PARAMS.get(k, []) if p in params), None)
        if hit:
            p, f = hit
            for c in cands:
                for st in c.steps:
                    if st.op == op:
                        st.kwargs[p] = f(det["value"])
            mapped.append(f"'{det['text']}' -> {p}={f(det['value'])}")
        elif k == "fold" and op in ("symmetrize", "sym-or", "sym-and") and args.get("fold", {}).get("used"):
            continue  # already honoured by the fold arg
        elif k == "keep" and det["value"] in ("symmetric", "symmetry") and op in ("symmetrize", "mirror", "sym-or", "sym-and"):
            continue
        elif k == "count" and det["value"] in (1,):
            continue
        else:
            unhandled.append(det["text"])
    return mapped, unhandled


def _handoff_message(plan: EditPlan, reason: str, file: str) -> str:
    likely = [(k, v) for k, v in plan.top_ops(5) if k != "other" and v >= 0.03][:4]
    lines = [f"handoff: {reason}. Not applied - the coordinator (LLM) should decide or ask the user."]
    if likely:
        lines.append("likely ops: " + ", ".join(f"{k} ({v:.2f})" for k, v in likely))
        lines += [f"    gl ops {k}" for k, _ in likely[:3]]
    lines.append("compound / multi-step requests: chain `gl op` calls, `gl show` after each.")
    return "\n".join(lines)


def route_edit(request: str, context: RouteContext | Design, judge=None, file: str = "FILE") -> EditPlan:
    ctx = context if isinstance(context, RouteContext) else RouteContext.from_design(context)
    judge = judge or make_judge()
    specs = {s.name: s for s in list_ops()}
    qs = route_questions(list(specs.values()))
    ans = judge.ask(route_state(request, ctx), qs, tag="route")
    source = next(iter(ans.values())).get("source", getattr(judge, "source", "?"))
    probs = _avg_choice(ans["op"], ans["op_rev"])
    top = next(iter(probs))
    op_conf = choice_confidence(probs)
    disagree = ans["op"]["choice"] != ans["op_rev"]["choice"]
    args = _resolve_args(ans, request, ctx)
    plan = EditPlan(request, "handoff", top, op_conf, op_conf, {k: round(v, 3) for k, v in probs.items()}, args, source=source)
    if top == "other" or op_conf < CANDIDATES_AT or disagree:
        why = ("request is outside the op set ('other')" if top == "other" else
               f"op order disagreement ({ans['op']['choice']} vs {ans['op_rev']['choice']})" if disagree else
               f"low confidence {op_conf:.2f}")
        plan.message = _handoff_message(plan, why, file)
        return plan
    cands, used = _alternatives(top, specs[top], args, ctx, request)
    if not cands:
        plan.message = _handoff_message(plan, f"{top} needs layers the request does not pin down (name them or pass --layer)", file)
        return plan
    for u in used:
        args[u]["used"] = True
    plan.confidence = min([op_conf] + [args[u]["confidence"] for u in used])
    if plan.confidence >= APPLY_AT and len(cands) == 1:
        plan.decision, plan.candidates = "apply", cands
    elif plan.confidence >= CANDIDATES_AT or len(cands) > 1:
        plan.decision = "candidates"
        if len(cands) > 1:
            plan.notes.append(f"{top}: the request leaves an essential choice open, so trying {len(cands)} options")
        if plan.confidence < APPLY_AT:
            second = [k for k in list(probs)[1:] if k != "other" and probs[k] >= 0.1][:1]
            for k in second:
                c2, _ = _alternatives(k, specs[k], args, ctx, request)
                cands.append(Candidate(c2[0].label, c2[0].steps, probs[k]))
        plan.candidates = cands
    else:
        plan.message = _handoff_message(plan, f"argument confidence too low ({plan.confidence:.2f})", file)
    if plan.decision != "handoff":
        details = extract_details(request)
        mapped, unhandled = apply_details(top, specs[top], plan.candidates, details, args)
        for m in mapped:
            plan.notes.append(f"detail {m}")
        jev_flag = float(ans.get("details_unhandled", {}).get("noul", 0)) > STATED_AT
        if unhandled or (jev_flag and not details):
            why = (f"stated details the op can't express: {', '.join(repr(u) for u in unhandled)}" if unhandled else
                   "Jev: the request states details the chosen op/args may not capture")
            plan.notes.append(why + " -> not auto-applied; check the candidate(s) or edit by hand")
            if plan.decision == "apply":
                plan.decision = "candidates"
    if plan.decision != "handoff" and "target_layer" not in used and len(ctx.layer_ids) > 1 and specs[top].kind == "mask":
        plan.notes.append(f"no layer named -> applies to all layers {ctx.layer_ids} (pass --layer to narrow)")
    return plan


def execute(design: Design, steps: list[Step]) -> Design:
    d = design
    for s in steps:
        d = apply_op(d, s.op, layers=s.layers, region=s.region, **s.kwargs)
    return d


# ---- brief -> generator settings -------------------------------------------------------

BRIEF_SLOTS = {
    "silhouette": {"type": "choice", "instructions": "Which outline shape best fits the piece described in `brief`?",
                   "criteria": {"capsule": "Tall rounded rectangle / pill, like a classic tag pendant",
                                "oval": "Smooth ellipse or circle, a locket or cameo",
                                "ring": "A circular band with an open centre, a halo or wreath",
                                "diamond": "A lozenge standing on its point", "shield": "Flat top, pointed bottom, heraldic or gothic"},
                   "_keywords": {"capsule": [r"\btag\b", r"\bpill", r"capsule", r"\btall\b"],
                                 "oval": [r"\boval", r"\bround\b", r"circle", r"locket", r"cameo", r"medallion"],
                                 "ring": [r"\bring\b", r"halo", r"wreath", r"hoop"], "diamond": [r"diamond", r"lozenge", r"rhomb"],
                                 "shield": [r"shield", r"heraldic", r"gothic"]}, "_fallback": "capsule"},
    "silhouette_stated": {"type": "noul", "instructions": "Does `brief` name or clearly imply an outline shape for the piece?",
                          "_keywords": [r"\btag\b", r"pill", r"capsule", r"oval", r"round", r"circle", r"locket", r"ring\b", r"halo",
                                        r"wreath", r"diamond", r"lozenge", r"shield", r"heraldic", r"medallion"]},
    "density": {"type": "choice", "instructions": "How much solid material should the piece in `brief` have?",
                "criteria": {"very_airy": "Mostly open space, wisps of material, like a cobweb", "light": "Open lace with clear gaps everywhere",
                             "balanced": "About as much metal as openings", "dense": "Mostly solid metal with small piercings"},
                "_keywords": {"very_airy": [r"very airy", r"cobweb", r"wisp", r"gossamer", r"barely there"],
                              "light": [r"\bairy", r"delicate", r"\blight\b", r"\bopen\b", r"lac[ey]", r"fine"],
                              "balanced": [r"balanced"], "dense": [r"dense", r"chunky", r"solid", r"heavy", r"\bbold", r"brutal"]},
                "_fallback": "balanced"},
    "symmetry": {"type": "choice", "instructions": "Which symmetry suits the piece described in `brief`?",
                 "criteria": {"D1": "A single mirror: left and right sides match, top and bottom differ (like a face, leaf or shield)",
                              "D2": "Two mirrors: left/right and top/bottom both match (like a pill or tag)",
                              "D4": "Four-way: looks the same after a quarter turn and mirrored (like a snowflake, rosette or round medallion)"},
                 "_keywords": {"D1": [r"\bleaf", r"\bface", r"shield", r"single mirror"], "D2": [r"\btag\b", r"pill", r"two[- ]?fold"],
                               "D4": [r"snowflake", r"rosette", r"\bstar\b", r"medallion", r"four[- ]?(fold|way)", r"4[- ]?fold", r"radial", r"mandala", r"\bring\b"]},
                 "_fallback": "D2"},
    "layers": {"type": "choice", "instructions": "How many stacked metal layers suit the piece in `brief`?",
               "criteria": {"one": "A single flat cut sheet, the simplest and lightest", "two": "A base plus one overlay, a little depth",
                            "three": "Base, middle and a top accent: clear relief", "four": "Deep layered relief, chunky and sculptural"},
               "_keywords": {"one": [r"single (sheet|layer)", r"one (sheet|layer)", r"\bflat\b"], "two": [r"two layers", r"2 layers", r"double"],
                             "three": [r"three layers", r"3 layers", r"relief"], "four": [r"four layers", r"4 layers", r"lots of depth", r"sculptural", r"deep"]},
               "_fallback": "two"},
    "layers_stated": {"type": "noul", "instructions": "Does `brief` say or clearly imply how many layers or how much depth the piece should have?",
                      "_keywords": [r"layer", r"\bflat\b", r"single sheet", r"depth", r"relief", r"sculptural"]},
    "size": {"type": "choice", "instructions": "How big should the piece described in `brief` be?",
             "criteria": {"small": "Small: an earring, charm, stud or tiny pendant", "medium": "Medium: an ordinary pendant or necklace piece",
                          "large": "Large: a brooch, statement piece, big medallion or belt buckle"},
             "_keywords": {"small": [r"earring", r"charm", r"\bstud", r"tiny", r"\bsmall"], "medium": [r"pendant", r"necklace"],
                           "large": [r"brooch", r"statement", r"\blarge", r"\bbig\b", r"buckle"]},
             "_fallback": "medium"},
}
STATED_NOUL = {"silhouette": "silhouette_stated", "layers": "layers_stated"}
SLOT_NAMES = ["silhouette", "density", "symmetry", "layers", "size"]
BRIEF_HIDDEN_RECIPES = {"sample_echo"}  # not generators

# slot value -> generic recipe param values
# Nudges relative to the recipe default (each recipe's "density" knob means something different, e.g. CA seed
# noise, so absolute values would break generators; the defaults are tuned to look right).
DENSITY_MUL = {"very_airy": 0.6, "light": 0.8, "balanced": 1.0, "dense": 1.25}
SIZE_MUL = {"small": 0.8, "medium": 1.0, "large": 1.25}
LAYERS_N = {"one": 1, "two": 2, "three": 3, "four": 4}
SYM_ALIASES = {"D1": ["d1", "x", "lr", "mirror", "mirror_x"], "D2": ["d2", "xy"], "D4": ["d4"]}


@dataclass
class Slot:
    value: str
    confidence: float
    probs: dict[str, float]
    specified: bool                      # brief implies it (conf >= 0.5 and stated noul, if any, > 0.5)


@dataclass
class Settings:
    brief: str
    recipe: Slot
    slots: dict[str, Slot]
    source: str = "heuristic"

    def text(self) -> str:
        def fmt(name, s: Slot):
            mark = "" if s.specified else "  (unspecified -> default/sample)"
            alts = ", ".join(f"{k} {v:.2f}" for k, v in list(s.probs.items())[:3])
            return f"  {name:<10} {s.value:<16} conf {s.confidence:.2f}  [{alts}]{mark}"
        return "\n".join([f"brief: {self.brief!r}   [judge: {self.source}]", fmt("recipe", self.recipe)]
                         + [fmt(k, v) for k, v in self.slots.items()])


def recipe_options():
    from .recipes import SECTIONS, list_recipes

    crit, kws = {}, {}
    for r in list_recipes():
        if r.name in BRIEF_HIDDEN_RECIPES:
            continue
        sec = SECTIONS.get(r.section, {})
        crit[r.name] = {"what": f"{r.title}: {r.description}"[:300],
                        "family": f"{sec.get('title', r.section)}: {sec.get('description', '')}"[:200]}
        words = set(re.split(r"[_\s-]", r.name)) | set(r.tags) | set(re.split(r"\W+", r.title.lower()))
        kws[r.name] = [rf"\b{re.escape(w)}" for w in words if len(w) > 3]
    return crit, kws


def _slot(ans: dict, name: str) -> Slot:
    a = ans[name]
    probs = dict(sorted(a["probabilities"].items(), key=lambda kv: -kv[1]))
    conf = float(a.get("confidence", 0))
    spec = conf >= CANDIDATES_AT
    if name in STATED_NOUL and STATED_NOUL[name] in ans:
        spec = spec and ans[STATED_NOUL[name]]["noul"] > 0.5
    return Slot(a["choice"], conf, probs, spec)


def brief_to_settings(brief: str, judge=None) -> Settings:
    judge = judge or make_judge()
    crit, kws = recipe_options()
    qs = dict(BRIEF_SLOTS)
    if len(crit) > 1:
        qs["recipe"] = {"type": "choice", "instructions": {"question": "Which generator best produces the piece described in `brief`?",
                                                           "focus": "Match the look, texture and structure the brief asks for."},
                        "criteria": crit, "_keywords": kws, "_fallback": next(iter(crit))}
    ans = judge.ask({"brief": brief}, qs, tag="brief")
    source = next(iter(ans.values())).get("source", "?")
    if "recipe" in ans:
        rslot = _slot(ans, "recipe")
    else:
        only = next(iter(crit)) if crit else ""
        rslot = Slot(only, 1.0, {only: 1.0}, True)
    return Settings(brief, rslot, {k: _slot(ans, k) for k in SLOT_NAMES}, source)


def _pick(slot: Slot, rng: random.Random | None) -> str | None:
    """Specified -> value; unspecified -> None (default) for the first variant, else a probability-weighted sample."""
    if slot.specified:
        return slot.value
    if rng is None:
        return None
    top = list(slot.probs.items())[:3]
    tot = sum(p for _, p in top) or 1
    r, acc = rng.random() * tot, 0.0
    for k, p in top:
        acc += p
        if r <= acc:
            return k
    return top[0][0]


def settings_to_params(spec, values: dict[str, str | None]) -> tuple[dict, list[str]]:
    """Map slot values onto whatever knobs a recipe exposes. Returns (params, notes about mapping)."""
    params, notes = {}, []
    P = spec.params

    def find(*names):
        return next((n for n in names if n in P), None)

    v = values.get("silhouette")
    k = find("silhouette", "shape", "outline")
    if v and k and P[k].choices:
        if v in P[k].choices:
            params[k] = v
        else:
            notes.append(f"silhouette={v} not in {k} choices")
    v = values.get("symmetry")
    k = find("sym", "symmetry")
    if v and k and P[k].choices:
        hit = next((c for c in P[k].choices if str(c).lower() in SYM_ALIASES[v]), None)
        if hit is not None:
            params[k] = hit
    v = values.get("density")
    k = find("density", "fill", "coverage")
    if v and k and P[k].type in ("float", "int"):
        p = P[k]
        val = p.default * DENSITY_MUL[v]
        if p.default:  # 0 usually means "auto"
            params[k] = round(val, 3) if p.type == "float" else int(round(val))
    v = values.get("layers")
    k = find("layers", "n_layers", "num_layers")
    if v and k:
        params[k] = LAYERS_N[v]
    v = values.get("size")
    if v:
        for k in ("width", "height", "size", "radius"):
            if k in P and P[k].type == "int":
                params[k] = int(round(P[k].default * SIZE_MUL[v]))
    if "width" in P and "height" in P and (values.get("symmetry") == "D4" or values.get("silhouette") == "ring"):
        side = max(params.get("width", P["width"].default), params.get("height", P["height"].default))
        params["width"] = params["height"] = side  # D4 / ring needs a square canvas
    resolved = {}
    for k2, val in params.items():
        try:
            resolved[k2] = P[k2].coerce(val)
        except ValueError as e:
            notes.append(f"{k2}: {e}")
    return resolved, notes


def plan_variants(settings: Settings, n: int = 6) -> list[dict]:
    """[{recipe, params, seed, label}] - v1 = most likely settings (defaults for unspecified slots),
    others sample unspecified slots (and the recipe, if unsure) from Jev's probabilities."""
    from .recipes import get_recipe

    out = []
    rec_choices = [k for k, p in settings.recipe.probs.items() if p >= 0.1][:3] or [settings.recipe.value]
    for i in range(n):
        rng = None if i == 0 else random.Random(1000 + i)
        if settings.recipe.specified or i == 0:
            rname = settings.recipe.value
        else:
            rname = rec_choices[i % len(rec_choices)]
        values = {k: _pick(s, rng) for k, s in settings.slots.items()}
        spec = get_recipe(rname)
        params, notes = settings_to_params(spec, values)
        label = rname + "".join(f" {k}={v}" for k, v in params.items())
        out.append({"recipe": rname, "params": params, "seed": i + 1, "label": label, "values": values, "notes": notes})
    return out


# ---- CLI glue (called from gridlab.cli) ------------------------------------------------------

def setup_cli(name: str, p) -> None:
    if name == "ask":
        p.add_argument("file")
        p.add_argument("request", help="free-text edit request, e.g. 'mirror the left half onto the right'")
        p.add_argument("--region", help="x0,y0,x1,y1 inclusive (the selection)")
        p.add_argument("--layer", type=int, help="target layer id (overrides what the text says)")
        p.add_argument("--dry-run", action="store_true", help="print the plan only")
        p.add_argument("--judge", choices=["auto", "jev", "heuristic", "cache"], default=None,
                       help="default: env GRIDLAB_JEV or auto (Jev if lab/.env has a key)")
        p.epilog = ("Jev routes the request to a registered op (conf >= 0.7: apply, undoable; 0.5-0.7 or an\n"
                    "unstated essential arg: candidates FILE.vN.json + contact sheet; else: handoff message).")
    elif name == "brief":
        p.add_argument("brief", help="e.g. 'a delicate airy ring pendant'")
        p.add_argument("--out", help="base workspace path (default lab/work/brief.json); candidates are OUT.vN.json")
        p.add_argument("--n", type=int, default=6)
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--judge", choices=["auto", "jev", "heuristic", "cache"], default=None)
        p.add_argument("--cols", type=int, default=3)


def cmd_ask(a) -> None:
    from pathlib import Path

    from . import cli
    from .io import save_design
    from .render import contact_sheet

    path = Path(a.file)
    d = cli.load_ws(path)
    region = cli.parse_region(a.region)
    ctx = RouteContext.from_design(d, a.layer, region)
    plan = route_edit(a.request, ctx, judge=make_judge(a.judge), file=cli.rel(path))
    print(plan.text(cli.rel(path)))
    if a.dry_run or plan.decision == "handoff":
        return
    if plan.decision == "apply":
        steps = plan.candidates[0].steps
        try:
            after = execute(d.copy(), steps)
        except (ValueError, KeyError) as e:
            print(f"handoff: applying {plan.op} failed: {e}")
            return
        cli.commit(path, d, after, f"ask {a.request!r} -> " + "; ".join(s.cli("").replace("gl op  ", "") for s in steps))
        print(f"look: gl show {cli.rel(path)}   undo: gl undo {cli.rel(path)}")
        return
    designs, labels, subs, paths = [d], ["v0 current"], [cli._variant_line(d)], []
    for i, c in enumerate(plan.candidates, 1):
        try:
            v = execute(d.copy(), c.steps)
        except (ValueError, KeyError) as e:
            print(f"candidate {i} ({c.label}) failed: {e}")
            continue
        vp = cli._variant_path(path, i)
        save_design(v, vp)
        designs.append(v)
        labels.append(f"v{i} {c.label}"[:40])
        subs.append(cli._variant_line(v))
        paths.append(vp)
        print(f"v{i}: {c.label} -> {cli.rel(vp)}")
    if not paths:
        print("handoff: no candidate could be applied")
        return
    mx = max(max(x.width, x.height) for x in designs)
    sheet = contact_sheet(designs, labels, cols=4, cell_px=int(max(3, min(14, 220 // max(1, mx)))), sublabels=subs)
    sp = cli.default_png(path, ".ask")
    sheet.save(sp)
    print(f"sheet: {cli.rel(sp)}  -> look, then: gl pick {cli.rel(paths[0])} {cli.rel(path)} --clean")


def cmd_brief(a) -> None:
    from pathlib import Path

    from . import cli
    from .io import save_design
    from .recipes import get_recipe, run_recipe
    from .render import contact_sheet

    settings = brief_to_settings(a.brief, judge=make_judge(a.judge))
    print(settings.text())
    variants = plan_variants(settings, a.n)
    base = Path(a.out) if a.out else cli.WORK / "brief.json"
    base.parent.mkdir(parents=True, exist_ok=True)
    designs, labels, subs = [], [], []
    for i, v in enumerate(variants, 1):
        note = ("  # " + "; ".join(v["notes"])) if v["notes"] else ""
        print(f"v{i}: {v['label']} seed={v['seed']}{note}")
        if a.dry_run:
            continue
        vp = cli._variant_path(base, i)
        try:
            d = run_recipe(v["recipe"], v["params"], v["seed"])
            if not d.union_mask().any():  # the mapped knobs starved the generator: keep only shape/symmetry choices
                spec = get_recipe(v["recipe"])
                keep = {k: x for k, x in v["params"].items() if spec.params[k].type == "choice"}
                print(f"    empty with {v['params']} -> retry with {keep or 'defaults'}")
                d = run_recipe(v["recipe"], keep, v["seed"])
            d.history, d.frames = [], []  # candidates are edit workspaces; growth frames belong to the gallery
            d.notes = (d.notes + "\n" if d.notes else "") + f"brief: {a.brief}"
            save_design(d, vp)
        except Exception as e:  # a broken recipe must not kill the other variants
            print(f"    failed: {type(e).__name__}: {e}")
            continue
        designs.append(d)
        labels.append(f"v{i} {v['recipe']} s{v['seed']}"[:40])
        subs.append(cli._variant_line(d))
        print(f"    -> {cli.rel(vp)}")
    if designs:
        mx = max(max(x.width, x.height) for x in designs)
        sheet = contact_sheet(designs, labels, cols=a.cols, cell_px=int(max(3, min(14, 220 // max(1, mx)))), sublabels=subs)
        sp = cli.default_png(base, ".brief")
        sheet.save(sp)
        print(f"sheet: {cli.rel(sp)}  -> look, then: gl pick {cli.rel(cli._variant_path(base, 1))} {cli.rel(base)} --clean")
