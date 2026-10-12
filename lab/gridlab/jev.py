"""Thin client for TypeSafe "Jev" (System One) + a keyword `HeuristicJudge` with the same answer shapes.

Jev answers typed questions about a state with calibrated probabilities (see docs/jev-notes.md,
docs/jev-experiments.md). In gridlab it is used ONLY for language -> closed-set decisions
(edit routing + args, brief -> generator settings). Never for reading grids or judging beauty:
code computes grid properties exactly.

    judge = make_judge()                       # JevJudge if a key exists, else HeuristicJudge
    answers = judge.ask(state, questions, tag="route")
    answers["op"]["choice"], answers["op"]["probabilities"], answers["op"]["confidence"]
    answers["axis_stated"]["noul"]

Question specs may carry private heuristic hints (stripped before sending to Jev):
- choice: ``"_keywords": {option: [regex, ...]}``, ``"_fallback": option`` (winner when nothing matches)
- noul:   ``"_keywords": [regex, ...]`` (match -> 0.85, else 0.15; no keywords -> 0.5)
- score:  ``"_keywords": [[regex...] per level]``, ``"_default": level``

Key: env ``TYPESAFE_API_KEY`` or ``lab/.env`` (never printed or logged). Responses are cached on disk
in ``lab/work/.jev-cache/`` keyed by (model, state, questions); every exchange is appended to
``lab/work/.jev-cache/log.jsonl``. ``GRIDLAB_JEV=off`` forces the heuristic; ``GRIDLAB_JEV_CACHE_ONLY=1``
uses only cached answers (heuristic on a miss) - handy to replay without spending credits.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB_ROOT = Path(__file__).resolve().parents[1]
MODEL = "jev-1.13.0"  # pinned: thresholds in assist.py were tuned on this version
ENDPOINT = "https://api.typesafe.ai/v1/systemone"
CACHE_DIR = LAB_ROOT / "work" / ".jev-cache"
PRIVATE_KEYS = ("_keywords", "_fallback", "_default")


# ---- key loading ---------------------------------------------------------------

def load_key(env_file: Path | None = None) -> str | None:
    """TYPESAFE_API_KEY from the environment, else from lab/.env (simple KEY=VALUE parser)."""
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k.strip()
    env_file = env_file or (LAB_ROOT / ".env")
    try:
        text = env_file.read_text()
    except OSError:
        return None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, val = line.split("=", 1)
        if name.strip().removeprefix("export ").strip() == "TYPESAFE_API_KEY":
            return val.strip().strip('"').strip("'") or None
    return None


# ---- helpers -------------------------------------------------------------------

def strip_private(questions: dict) -> dict:
    """Remove heuristic-only keys (``_keywords`` ...) before sending to Jev."""
    return {qid: {k: v for k, v in q.items() if k not in PRIVATE_KEYS} for qid, q in questions.items()}


def choice_confidence(probs: dict[str, float]) -> float:
    """Documented Jev formula: (p_max - 1/n) / (1 - 1/n)."""
    n = len(probs)
    if n <= 1:
        return 1.0
    pmax = max(probs.values())
    return max(0.0, (pmax - 1 / n) / (1 - 1 / n))


def _state_text(state) -> str:
    if isinstance(state, str):
        return state
    if isinstance(state, dict):
        for k in ("request", "brief", "text"):
            if isinstance(state.get(k), str):
                return state[k]
    return json.dumps(state)


def _hits(patterns, text: str) -> int:
    return sum(1 for p in patterns or [] if re.search(p, text, re.I))


# ---- judges --------------------------------------------------------------------

class HeuristicJudge:
    """Keyword fallback. Same answer shapes as the API, plus ``source="heuristic"``."""

    source = "heuristic"

    def ask(self, state, questions: dict, tag: str = "") -> dict:
        text = _state_text(state)
        out = {}
        for qid, q in questions.items():
            t = q.get("type")
            if t == "choice":
                out[qid] = self._choice(q, text)
            elif t == "noul":
                kws = q.get("_keywords")
                p = 0.5 if kws is None else (0.85 if _hits(kws, text) else 0.15)
                out[qid] = {"type": "noul", "noul": p, "source": self.source}
            elif t == "score":
                levels = q.get("criteria") or []
                kws = q.get("_keywords") or [[] for _ in levels]
                counts = [_hits(k, text) for k in kws]
                lvl = max(range(len(counts)), key=lambda i: counts[i]) if any(counts) else int(q.get("_default", 0))
                probs = {str(i): (1.0 if i == lvl else 0.0) for i in range(len(levels))}
                out[qid] = {"type": "score", "score": float(lvl), "probabilities": probs,
                            "confidence": 0.6 if any(counts) else 0.3, "source": self.source}
            else:
                raise ValueError(f"question {qid}: unknown type {t!r}")
        _log(tag, state, questions, out, source=self.source, cached=False, dt=0.0)
        return out

    @staticmethod
    def _choice(q: dict, text: str) -> dict:
        opts = list(q["criteria"])
        kws = q.get("_keywords") or {}
        counts = {o: _hits(kws.get(o), text) for o in opts}
        fb = q.get("_fallback")
        if not any(counts.values()):
            logits = {o: (1.0 if o == fb else 0.0) for o in opts}
        else:
            logits = {o: 5.0 * c for o, c in counts.items()}
        m = max(logits.values())
        ex = {o: math.exp(v - m) for o, v in logits.items()}
        s = sum(ex.values())
        probs = {o: round(v / s, 4) for o, v in ex.items()}
        best = max(opts, key=lambda o: probs[o])
        return {"type": "choice", "choice": best, "probabilities": probs,
                "confidence": round(choice_confidence(probs), 4), "source": "heuristic"}


class JevJudge:
    """Plain-urllib Jev client with an on-disk cache. Falls back to the heuristic on any error."""

    source = "jev"

    def __init__(self, key: str, model: str = MODEL, cache_dir: Path = CACHE_DIR, cache_only: bool = False,
                 timeout: float = 30):
        self._key = key
        self.model = model
        self.cache_dir = cache_dir
        self.cache_only = cache_only
        self.timeout = timeout
        self.fallback = HeuristicJudge()
        self.last_source = "jev"

    def cache_key(self, state, questions: dict) -> str:
        blob = json.dumps({"model": self.model, "state": state, "questions": strip_private(questions)},
                          sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode()).hexdigest()[:32]

    def ask(self, state, questions: dict, tag: str = "") -> dict:
        ck = self.cache_key(state, questions)
        cpath = self.cache_dir / f"{ck}.json"
        if cpath.exists():
            ans = json.loads(cpath.read_text())["answers"]
            for a in ans.values():
                a["source"] = "jev-cache"
            self.last_source = "jev-cache"
            _log(tag, state, questions, ans, source="jev-cache", cached=True, dt=0.0)
            return ans
        if self.cache_only:
            self.last_source = "heuristic"
            return self.fallback.ask(state, questions, tag=tag + ":cache-miss")
        body = json.dumps({"state": state, "model": self.model, "questions": strip_private(questions)}).encode()
        req = urllib.request.Request(ENDPOINT, data=body, headers={
            "Authorization": f"Bearer {self._key}", "Content-Type": "application/json"})
        t0 = time.time()
        out, err = None, None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    out = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                err = f"HTTP {e.code}"
                if e.code in (429, 529) and attempt < 2:
                    time.sleep(1.5 + 2 * attempt)
                    continue
                break
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
                err = type(e).__name__
                break
        if out is None or "answers" not in out:
            _log(tag, state, questions, None, source="jev-error", cached=False, dt=time.time() - t0, error=err)
            self.last_source = "heuristic"
            return self.fallback.ask(state, questions, tag=tag + ":fallback")
        ans = out["answers"]
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cpath.write_text(json.dumps({"model": out.get("model", self.model), "answers": ans,
                                     "usage": out.get("usage")}))
        for a in ans.values():
            a["source"] = "jev"
        self.last_source = "jev"
        _log(tag, state, questions, ans, source="jev", cached=False, dt=time.time() - t0, usage=out.get("usage"))
        return ans


def make_judge(mode: str | None = None):
    """mode: 'auto' (default; env GRIDLAB_JEV), 'jev', 'heuristic'/'off', 'cache' (cache only)."""
    mode = (mode or os.environ.get("GRIDLAB_JEV") or "auto").lower()
    if mode in ("off", "heuristic", "0", "no"):
        return HeuristicJudge()
    key = load_key()
    if not key:
        if mode == "jev":
            raise RuntimeError("no TYPESAFE_API_KEY (env or lab/.env)")
        return HeuristicJudge()
    cache_only = mode == "cache" or os.environ.get("GRIDLAB_JEV_CACHE_ONLY") == "1"
    return JevJudge(key, cache_only=cache_only)


def _log(tag, state, questions, answers, *, source, cached, dt, **extra) -> None:
    """Append one exchange to the JSONL log (never contains the key)."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        rec = {"t": int(time.time()), "tag": tag, "source": source, "cached": cached, "dt": round(dt, 3),
               "state": state, "questions": sorted(questions), "answers": answers, **extra}
        with (CACHE_DIR / "log.jsonl").open("a") as f:
            f.write(json.dumps(rec, default=str) + "\n")
    except OSError:
        pass
