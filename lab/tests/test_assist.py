"""assist / jev with the heuristic judge and a scripted fake judge (no network)."""

from pathlib import Path

import pytest

import gridlab.jev as jev
from gridlab.assist import (RouteContext, brief_to_settings, execute, op_options, plan_variants, route_edit,
                            route_questions)
from gridlab.cli import main
from gridlab.io import load_any, load_design
from gridlab.jev import HeuristicJudge, choice_confidence, strip_private

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


@pytest.fixture(autouse=True)
def _no_network(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDLAB_JEV", "off")
    monkeypatch.setattr(jev, "CACHE_DIR", tmp_path / "jev-cache")


@pytest.fixture
def design():
    return load_any(SAMPLES / "multi_1.json")


class FakeJudge:
    """Returns the heuristic answers with the op Choice overridden by given probabilities."""

    source = "fake"

    def __init__(self, op_probs: dict, op_rev_probs: dict | None = None, **over):
        self.op_probs, self.op_rev_probs, self.over = op_probs, op_rev_probs or op_probs, over

    def ask(self, state, questions, tag=""):
        ans = HeuristicJudge().ask(state, questions)
        for key, probs in (("op", self.op_probs), ("op_rev", self.op_rev_probs)):
            full = {k: probs.get(k, 0.0) for k in questions[key]["criteria"]}
            ans[key] = {"type": "choice", "choice": max(full, key=full.get), "probabilities": full,
                        "confidence": choice_confidence(full), "source": "fake"}
        ans.update(self.over)
        return ans


def test_strip_private_and_confidence():
    q = route_questions()
    clean = strip_private(q)
    assert all(not k.startswith("_") for v in clean.values() for k in v)
    assert "_keywords" in q["op"]
    assert choice_confidence({"a": 1.0, "b": 0.0}) == 1.0
    assert choice_confidence({"a": 0.5, "b": 0.5}) == 0.0


def test_op_options_follow_registry():
    from gridlab.ops.registry import OPS, register_op

    @register_op("zz-test-op")
    def _zz(mask, n: int = 1):
        """Turn every cell into a tiny test star. More text here."""
        return mask

    try:
        crit, kws = op_options()
        assert crit["zz-test-op"]["what"] == "Turn every cell into a tiny test star"
        assert list(crit)[-1] == "other" and "invert-in-mask" not in crit
        assert crit["mirror"]["what"].startswith("Mirror one side")
        q = route_questions()
        assert list(q["op_rev"]["criteria"])[0] == list(crit)[-2]  # reversed, 'other' stays last
    finally:
        OPS.pop("zz-test-op", None)


def test_heuristic_routes_and_args(design):
    ctx = RouteContext.from_design(design)
    p = route_edit("fill the holes in layer 3", ctx, judge=HeuristicJudge())
    assert p.decision == "apply" and p.op == "fill-holes"
    assert p.candidates[0].steps[-1].layers == [3]
    p = route_edit("mirror the left half onto the right", ctx, judge=HeuristicJudge())
    assert p.op == "mirror" and p.candidates[0].steps[-1].kwargs == {"axis": "x", "keep": "left", "cx": 7.0}  # material centre
    p = route_edit("export it as svg", ctx, judge=HeuristicJudge())
    assert p.decision == "handoff" and "coordinator" in p.message


def test_unstated_axis_gives_candidates(design):
    p = route_edit("make it symmetric please", RouteContext.from_design(design),
                   judge=FakeJudge({"mirror": 0.95, "symmetrize": 0.05}))
    assert p.decision == "candidates"
    assert [c.steps[-1].kwargs["axis"] for c in p.candidates] == ["x", "y", "xy"]


def test_thresholds(design):
    ctx = RouteContext.from_design(design)
    hi = route_edit("thicken it", ctx, judge=FakeJudge({"dilate": 0.9, "outline": 0.1}))
    assert hi.decision == "apply" and hi.op == "dilate"
    mid = route_edit("thicken it", ctx, judge=FakeJudge({"dilate": 0.66, "outline": 0.34}))
    assert mid.decision == "candidates" and [c.steps[-1].op for c in mid.candidates] == ["dilate", "outline"]
    lo = route_edit("thicken it", ctx, judge=FakeJudge({"dilate": 0.4, "outline": 0.35, "close": 0.25}))
    assert lo.decision == "handoff" and "dilate" in lo.message and "outline" in lo.message
    dis = route_edit("thicken it", ctx, judge=FakeJudge({"dilate": 0.9, "outline": 0.1}, {"outline": 0.9, "dilate": 0.1}))
    assert dis.decision == "handoff" and "disagreement" in dis.message
    oth = route_edit("undo that", ctx, judge=FakeJudge({"other": 0.9}))
    assert oth.decision == "handoff"


def test_derive_layer_and_square_prep(design):
    ctx = RouteContext.from_design(design)  # layers 2 (top), 3 (middle), 4 (bottom); 16x24
    p = route_edit("make the top layer the skeleton of the middle", ctx, judge=FakeJudge(
        {"skeleton": 0.95, "erode": 0.05},
        source={"type": "choice", "choice": "middle", "confidence": 0.9, "probabilities": {"middle": 0.92, "not_said": 0.08}},
        target={"type": "choice", "choice": "top", "confidence": 0.95, "probabilities": {"top": 0.96, "not_said": 0.04}},
        target_stated={"type": "noul", "noul": 0.95}))
    steps = p.candidates[0].steps
    assert [s.op for s in steps] == ["copy-layer", "skeleton"]
    assert steps[0].layers == [3] and steps[0].kwargs["to"] == 2 and steps[1].layers == [2]
    out = execute(design.copy(), steps)
    assert out.layer(2).count > 0 and out.layer(2).mask.sum() <= design.layer(3).mask.sum()
    p = route_edit("make it 4-fold symmetric", ctx, judge=HeuristicJudge())
    assert p.decision == "candidates"
    assert [s.op for s in p.candidates[0].steps] == ["trim", "resize", "symmetrize"] and {c.steps[-1].kwargs["kind"] for c in p.candidates} == {"d4", "rot4"}
    v = execute(design.copy(), p.candidates[1].steps)
    assert v.width == v.height == 25


def test_brief_heuristic_and_variants():
    s = brief_to_settings("a delicate airy ring pendant", judge=HeuristicJudge())
    assert s.slots["silhouette"].value == "ring" and s.slots["density"].value in ("light", "very_airy")
    vs = plan_variants(s, 4)
    assert len(vs) == 4 and len({v["seed"] for v in vs}) == 4
    from gridlab.recipes import get_recipe
    for v in vs:
        get_recipe(v["recipe"])  # resolvable
        assert set(v["params"]) <= set(get_recipe(v["recipe"]).params)


def test_cli_ask_and_brief(tmp_path, capsys, monkeypatch):
    import gridlab.cli as cli

    monkeypatch.setattr(cli, "WORK", tmp_path)
    f = tmp_path / "a.json"
    assert main(["import", str(SAMPLES / "multi_1.json"), str(f)]) == 0
    before = load_design(f).layer(3).count
    assert main(["ask", str(f), "fill the holes in layer 3", "--dry-run"]) == 0
    assert load_design(f).layer(3).count == before
    assert main(["ask", str(f), "fill the holes in layer 3"]) == 0
    out = capsys.readouterr().out
    assert "APPLY" in out and "ok: ask" in out
    assert load_design(f).layer(3).count >= before
    assert main(["undo", str(f)]) == 0 and load_design(f).layer(3).count == before
    assert main(["ask", str(f), "make it 4-fold symmetric"]) == 0
    out = capsys.readouterr().out
    assert "CANDIDATES" in out and (tmp_path / "a.v1.json").exists() and (tmp_path / "a.ask.png").exists()
    assert main(["ask", str(f), "export it as svg"]) == 0
    assert "handoff" in capsys.readouterr().out
    import gridlab.assist as assist
    from gridlab.recipes import get_recipe

    noise = get_recipe("symmetric_noise")
    monkeypatch.setattr(assist, "recipe_options", lambda: ({"symmetric_noise": {"what": noise.description}}, {}))
    assert main(["brief", "a delicate airy ring pendant", "--out", str(tmp_path / "b.json"), "--n", "2"]) == 0
    assert (tmp_path / "b.v2.json").exists() and (tmp_path / "b.brief.png").exists()


def test_swap_layers_needs_two_layers(design):
    ctx = RouteContext.from_design(design)
    p = route_edit("swap the top and middle layers", ctx, judge=FakeJudge({"swap-layers": 0.95}))
    assert p.decision == "apply" and sorted(p.candidates[0].steps[0].layers) == [2, 3]
    p = route_edit("swap them", ctx, judge=FakeJudge({"swap-layers": 0.95}))
    assert p.decision == "handoff" and "needs layers" in p.message


def test_jev_cache_roundtrip(tmp_path, monkeypatch):
    """A cached answer is served without network; private keys never reach the cache key."""
    import json

    j = jev.JevJudge("dummy", cache_dir=tmp_path)
    q = {"x": {"type": "noul", "instructions": "Is it?", "_keywords": ["it"]}}
    ck = j.cache_key({"request": "a"}, q)
    assert ck == j.cache_key({"request": "a"}, {"x": {"type": "noul", "instructions": "Is it?"}})
    (tmp_path / f"{ck}.json").write_text(json.dumps({"answers": {"x": {"type": "noul", "noul": 0.9}}}))
    monkeypatch.setattr(jev.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    assert j.ask({"request": "a"}, q)["x"]["noul"] == 0.9
    # cache miss + network failure -> heuristic fallback, same shape
    monkeypatch.setattr(jev.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert j.ask({"request": "b it"}, q)["x"]["noul"] == 0.85
