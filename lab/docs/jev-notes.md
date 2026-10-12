# Jev (TypeSafe System One) notes for gridpaint-lab

Source: https://docs.typesafe.ai (read 2026-10-13; jaggedness page last reviewed 2026-10-02).
Pages read: introduction, quickstart, coding-agents, system-one, state, primitives (+choice/score/noul/advanced),
confidence, how-to-build-with-system-one, patterns (fan-out, composite scoring, confidence routing, intent routing),
models, api, sdk/python (+usage, constants, sync client, exceptions), agent-skill + SKILL.md,
model-jaggedness/jev-1.13, cookbooks function_calling and semantic_find.

---

## Part A: API summary

### What Jev is

- A "System One" model: it takes a **state** (text / JSON) and a map of typed **questions**, and returns
  **typed answers with probabilities**. It does **not generate** text, code, or content. All questions in a
  request are evaluated **in parallel and independently** against the same state (one answer is never
  context for another).
- **Text only.** State must be a string, JSON object, or array of text values. **No images, audio or video**
  ("not supported (yet)"). Non-text input must be converted to text/structured fields in code first.
- English is the main training language.
- Latency: "Most queries complete in about 100 ms". Adding questions to a request barely changes latency.
- Trained with "RLCD" for calibrated probabilities. Same weights for every account; no fine-tuning. You
  customise it only through state, instructions and criteria.

### Endpoint and auth

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json

GET  https://api.typesafe.ai/v1/models     # lists aliases
```

Environment variables read by the Python SDK:

| Var | Purpose | Default |
|---|---|---|
| `TYPESAFE_API_KEY` | API key (required) | none |
| `TYPESAFE_BASE_URL` | API root | `https://api.typesafe.ai` |
| `TYPESAFE_DEFAULT_MODEL` | default model | `jev-latest` |
| `TYPESAFE_LOG_LEVEL` | SDK logger level | unset |

Important for our fallback: `TypeSafeClient()` **raises `TypeSafeError` at construction** if the key is
missing/invalid. So check `os.environ.get("TYPESAFE_API_KEY")` *before* constructing it.

Also reachable through gateways (same SDK, different `base_url`/model): OpenRouter
(`base_url="https://openrouter.ai/api"`, `model="~typesafe/jev-latest"`), Vercel AI Gateway, Pydantic AI Gateway.

### Models, limits, pricing

| | |
|---|---|
| Current model | `jev-1.13.0` |
| Aliases | `jev-latest` -> `jev-1.13.0` (SDK default); `jev-preview` -> same right now |
| Price | **$0.042 per million input tokens** ($42 / billion). Output tokens free. |
| Rate limits | 100K tokens/s and 80 requests/s (described as "adjusting dynamically") |
| Context | 64k tokens per request (state + all questions); **32k for state + the longest single question** |
| Choice options | max **255** per Choice |
| Score levels | 2 to **10** |
| SDK default timeout | 10 s per HTTP operation; SDK retries 429/529 with backoff |
| Errors | 401 bad key, 422 validation, 429 rate limit, 529 overloaded |

Pin `jev-1.13.0` if you tune thresholds; aliases move. The response `model` field reports the versioned ID.
(Older cookbooks use `jev-1.12`.)

Cost intuition for us: a 4-layer 60x60 ASCII dump plus ~40 questions is maybe 10-20k tokens, which is under
$0.001 per call. Cost is not a concern; accuracy is.

### Request JSON

```json
{
  "state": "string | object | array",
  "model": "jev-latest",
  "questions": {
    "<your_id>": {"type": "noul",   "instructions": "...", "criteria": {"true": "...", "false": "..."}},
    "<your_id>": {"type": "choice", "instructions": "...", "criteria": {"opt_a": "desc", "opt_b": null}},
    "<your_id>": {"type": "score",  "instructions": "...", "criteria": ["level 0 desc", "level 1 desc", "..."]}
  }
}
```

- Question IDs are **not sent to the model**. Write the full question in `instructions`.
- `instructions` and every criteria entry can be a string, object, array or null. Objects are useful
  (`{"question": ..., "focus": ...}`, `{"what": ..., "not_for": ..., "examples": [...]}`). Field names are free.
- Refer to parts of a structured state with backticked paths, e.g. ``"Does `request.text` ask for symmetry?"``.
- Noul `criteria` is optional.

### Response JSON

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "op":      {"type": "choice", "choice": "mirror", "probabilities": {"mirror": 0.85, "fill": 0.15}, "confidence": 0.78},
    "density": {"type": "score",  "score": 1.43, "legend": {"0": "...", "1": "...", "2": "..."},
                "probabilities": {"0": 0.0, "1": 0.57, "2": 0.43}, "confidence": 0.35},
    "is_x":    {"type": "noul",   "noul": 0.93}
  },
  "usage": {"input_tokens": 392, "output_tokens": 65}
}
```

- Choice: `choice` = argmax; `probabilities` sum to 1; `confidence = (p_max - 1/n) / (1 - 1/n)`.
- Score: `score` = probability-weighted mean of level indices (0..n-1), can fall between levels.
  Confidence is a spread measure (adjacent-level splits penalised less than opposite-end splits).
  Normalise with `score / (n_levels - 1)` before combining.
- Noul: single probability of "yes". No `confidence` field; use `abs(2p - 1)` if you want one.
  A Noul near 0.5 means "unsure", **not** "medium amount".

### Python SDK

```bash
uv add typesafe-sdk          # or: pip install typesafe-sdk   (Python >= 3.10)
# optional: typesafe-sdk[http2]
```

JS SDK: `@typesafe-ai/sdk` (`new TypeSafeClient()`), if we ever call it from the TS app (keep keys server-side).

Minimal example per primitive (questions may be SDK objects or raw dicts in the API shape):

```python
from typesafe_sdk import Choice, Noul, NoulCriteria, Score, TypeSafeClient

with TypeSafeClient() as client:            # reads TYPESAFE_API_KEY; model defaults to jev-latest
    r = client.system_one(
        state={"request": "make the left half mirror the right"},
        questions={
            # Choice: one option from a closed set
            "op": Choice(
                instructions="Which edit does `request` ask for?",
                criteria={"mirror": "Make the design symmetric", "fill_holes": "Close gaps", "other": None},
            ),
            # Score: position on ordered, described levels (2..10 levels)
            "scope": Score(
                instructions="How much of the design should `request` change?",
                criteria=["A few cells", "One region", "The whole design"],
            ),
            # Noul: probability a statement is true
            "names_axis": Noul(
                instructions="Does `request` say which axis to mirror across?",
                criteria=NoulCriteria(true="Mentions left/right, top/bottom, or an axis", false="No axis mentioned"),
            ),
        },
    )

r.answers["op"].choice, r.answers["op"].probabilities, r.answers["op"].confidence
r.answers["scope"].score            # SDK keys Score probabilities/legend by int
r.answers["names_axis"].noul
# Also: r.choices[...], r.scores[...], r.nouls[...], r.request_id
# Typed responses: subclass SystemOneResponse with fields like `op: ChoiceAnswer`, pass response_model=...
```

Async: `AsyncTypeSafeClient` with `await client.system_one(...)`. Reuse one client. Exceptions live in
`typesafe_sdk`: `TypeSafeError`, `TypeSafeAuthenticationError`, `TypeSafeRateLimitError`,
`TypeSafeAPITimeoutError`, `TypeSafeAPIConnectionError`, `TypeSafeUnprocessableEntityError`, ...

### How the docs say to use it

1. Keep control flow, rules, arithmetic and side effects **in code**. Use Jev only for common-sense
   judgments over unstructured input.
2. One **atomic** "snap judgment" per question (a few seconds of thought for a knowledgeable person).
   Split multi-factor judgments and recombine with weights in code (**composite scoring**).
3. **Speculative fan-out**: put every question you might need in one request (dozens are fine), and let
   code ignore irrelevant ones. One request costs about the same as one question.
4. **Confidence-gated routing**: act on high confidence, ask/confirm on medium, escalate (human / LLM) on low.
   Thresholds should scale with risk.
5. **Intent routing / function calling**: a Choice picks the function; one Choice per closed-set argument;
   one Noul per set member; plus a `stated?` Noul per optional argument so unspecified args keep code defaults
   rather than a confidently guessed value. Overall call confidence = the **minimum** over the judgments used.
6. Score levels must describe **concrete situations**, not degrees ("moderately X") and not numbers.
   Levels given as just "0","1","2" behave badly.
7. Choice probabilities always sum to 1, so *something* wins even when nothing fits: add an `other` option
   and/or a separate "does anything fit?" Noul (semantic_find cookbook pattern).

### Known jaggedness (jev-1.13), with relevance to grids

| Failure mode | What docs say | Impact on gridpaint |
|---|---|---|
| **Counting** | "does not count reliably", error grows with size | Counting filled cells, holes, components or columns from ASCII will be unreliable. Count in code. |
| **Numbers / numeric precision** | "struggles with tasks that require numeric precision"; prefers named semantic buckets over raw numbers (hex colour example); score levels "weak in numerical calibration" | Pass metrics as named buckets ("sparse", "dense") as well as or instead of raw numbers. Never interpolate score values back into quantities. |
| **Low-level encodings** | does better on high-level languages than on assembly / binary-encoded instructions | Strong hint that a raw 0/1 bitmap is a poor input. |
| **Indirection** | multi-hop / "property of a property" questions degrade | "Is the region left of the largest hole symmetric?" is multi-hop. Resolve geometry in code. |
| **Large state with irrelevant detail** | accuracy falls as unrelated state grows ("context rot") | Don't dump all layers when the question is about the selected region. |
| **Literal reading** | answers the words, not the intent | Spell out boundary cases in criteria. |
| **Choice option order** | leans toward the first option | Shuffle options / run twice for close calls (cheap). |
| **Contradictory instructions vs criteria** | confuses it | Keep "true" meaning "yes". |
| **Adversarial content** | state can steer it | Minor for us (user text is the user's own). |
| **Generation** | not trained for it | It cannot output a grid, coordinates, or new shapes. |
| **Images** | not accepted | It cannot see the rendered design. |

Not documented at all: any spatial, 2-D, ASCII-art or grid reasoning ability. Given the counting, numeric
and low-level-encoding weaknesses above, assume it is **weak** at reading 2-D structure from ASCII until
we measure it.

---

## Part B: How Jev fits gridpaint

### Core principle

Jev does not draw anything. It turns **fuzzy human language into typed, closed-set decisions**, and it gives
**calibrated "how sure am I"** signals. Code (or an LLM coordinator) generates and transforms grids. So the
architecture is:

```
user text + selection
   |
   v
[Jev router]  -- one request, ~30-60 speculative questions -->  op + args + region + confidence
   |                                                            |
   | high conf                                                  | low conf / op == "other"
   v                                                            v
deterministic grid ops (numpy / TS)                         LLM coordinator (Claude) writes a plan
   |                                                           or asks the user a clarifying question
   v
N candidates (param sweeps / evolutionary search)
   |
   v
code metrics (exact)  -> [optional Jev: text-goal -> metric weights/targets] -> rank
   |
   v
top-K -> human picks (or vision-capable LLM critiques rendered PNGs)
```

### B1. Intent routing (best fit, high confidence it works)

This is the `function_calling` cookbook mapped onto our edit operations. Each op is a plain Python
function with `Literal` args. Jev picks the op and fills closed-set args. A `stated?` Noul guards each
optional argument.

State (keep it small and textual):

```python
state = {
    "request": "make it mirror left-right but keep the bottom as is",
    "selection": {"kind": "rectangle", "covers": "the left half of layer 2"},   # described in words by code
    "active_layer": "layer 2 of 3",
    "layers": ["layer 1 (base plate)", "layer 2 (pattern)", "layer 3 (top accent)"],
}
```

Sample questions (raw-dict form, drop-in for `client.system_one(state, questions)`):

```python
EDIT_OPS = {
    "mirror_symmetry":  {"what": "Make the design symmetric by mirroring one side onto the other",
                         "examples": ["add mirror symmetry", "make it symmetric", "reflect left to right"]},
    "rotational_symmetry": {"what": "Repeat the design around the centre by rotation (2-, 4-fold)",
                         "examples": ["make it radial", "4-fold like a snowflake"]},
    "fill_holes":       {"what": "Fill empty gaps enclosed by filled cells",
                         "not_for": "Adding new shapes outside the existing outline",
                         "examples": ["fill holes", "close the gaps", "make it solid"]},
    "remove_specks":    {"what": "Delete tiny isolated bits and single stray cells",
                         "examples": ["clean it up", "remove the noise", "get rid of loose pixels"]},
    "smooth_organic":   {"what": "Round off corners and staircase edges so shapes look grown or fluid",
                         "examples": ["make it more organic", "softer", "less blocky"]},
    "roughen":          {"what": "Make edges irregular, eroded, or textured",
                         "examples": ["make it rougher", "weathered", "more ragged"]},
    "thicken":          {"what": "Make strokes and shapes bolder by growing them outward",
                         "examples": ["bolder", "thicker lines", "chunkier"]},
    "thin":             {"what": "Make strokes and shapes finer by shrinking them",
                         "examples": ["more delicate", "thinner", "lacier"]},
    "connect":          {"what": "Join separate pieces so the design holds together as one piece",
                         "examples": ["connect the islands", "it falls apart, link it", "make it one piece"]},
    "sparsify":         {"what": "Remove material to make the design lighter and more open",
                         "examples": ["less busy", "more restraint", "too much going on"]},
    "densify":          {"what": "Add material to make the design fuller",
                         "examples": ["fuller", "more going on", "fill it out more"]},
    "pattern_fill":     {"what": "Fill the region with a repeating texture such as stripes, dots or checks"},
    "outline":          {"what": "Keep only the border of shapes, hollowing them out"},
    "invert":           {"what": "Swap filled and empty cells"},
    "move_to_layer":    {"what": "Move or copy the selected cells to a different layer"},
    "other":            {"what": "A request that none of the options above describe"},
}

ROUTER_QUESTIONS = {
    "op": {
        "type": "choice",
        "instructions": {
            "question": "Which edit operation does `request` ask for?",
            "focus": "Classify the main change the user wants to see in the design, not every word they use.",
        },
        "criteria": EDIT_OPS,
    },
    "op_anything_fits": {
        "type": "noul",
        "instructions": "Does `request` ask for a change to a pixel design that is described by a simple geometric "
                        "or texture edit (symmetry, filling, smoothing, thickening, cleaning, connecting, density)?",
    },
    # --- speculative args: mirror / rotation ---
    "mirror_axis": {
        "type": "choice",
        "instructions": "Which way should the design be mirrored according to `request`?",
        "criteria": {
            "vertical_axis":   "Left and right sides become mirror images (left-right symmetry)",
            "horizontal_axis": "Top and bottom become mirror images (up-down symmetry)",
            "both_axes":       "Symmetric both left-right and top-bottom (four quadrants match)",
            "diagonal":        "Mirrored across a diagonal line",
        },
    },
    "mirror_axis_stated": {
        "type": "noul",
        "instructions": "Does `request` say which direction or axis to mirror across "
                        "(for example left/right, top/bottom, horizontal, vertical, diagonal)?",
    },
    "mirror_source": {
        "type": "choice",
        "instructions": "Which side should be kept and copied onto the other side, according to `request`?",
        "criteria": {"left": None, "right": None, "top": None, "bottom": None, "not_said": "The request does not say"},
    },
    "rotation_order": {
        "type": "choice",
        "instructions": "How many-fold rotational repetition does `request` ask for?",
        "criteria": {"two_fold": "Half-turn symmetry", "four_fold": "Quarter-turn symmetry, like a square snowflake",
                     "not_said": "The request does not say"},
    },
    # --- speculative args: intensity of morphological edits ---
    "strength": {
        "type": "score",
        "instructions": "How strong a change does `request` ask for?",
        "criteria": [
            "A subtle touch; the user says slightly, a bit, or a little",
            "A clear but moderate change; no intensity word is used",
            "A strong change; the user says much more, very, or a lot",
        ],
    },
    "fill_hole_scope": {
        "type": "choice",
        "instructions": "Which holes does `request` want filled?",
        "criteria": {"small_only": "Only small gaps or pinholes", "all": "Every enclosed hole",
                     "not_said": "The request does not say"},
    },
    "pattern_kind": {
        "type": "choice",
        "instructions": "Which repeating texture does `request` ask for?",
        "criteria": {"stripes": None, "dots": "Polka dots or a dotted grid", "checker": "Checkerboard",
                     "diagonal_hatch": "Diagonal lines", "not_said": None},
    },
    # --- scope ---
    "region": {
        "type": "choice",
        "instructions": "Which part of the design should the edit apply to, according to `request` and `selection`?",
        "criteria": {
            "selection":    "Only the cells inside `selection`",
            "active_layer": "The whole active layer",
            "all_layers":   "Every layer of the design",
        },
    },
    "target_layer": {
        "type": "choice",
        "instructions": "If `request` mentions a destination or specific layer, which one?",
        "criteria": {"layer_1": "The base plate", "layer_2": None, "layer_3": None, "layer_4": None, "not_said": None},
    },
    "keep_constraint": {
        "type": "noul",
        "instructions": "Does `request` ask to leave some part of the design unchanged?",
    },
}
```

Routing logic (confidence-gated):

```python
a = response.answers
op = a["op"]
if op.choice == "other" or a["op_anything_fits"].noul < 0.4 or op.confidence < 0.5:
    return escalate_to_llm(state)                 # LLM coordinator writes a multi-step plan or asks the user
args = {}
if op.choice == "mirror_symmetry" and a["mirror_axis_stated"].noul > 0.6:
    args["axis"] = a["mirror_axis"].choice      # else: code default, or try both and show candidates
call_confidence = min(op.confidence, *(arg_confidences))   # cookbook: min, not product
if call_confidence < 0.7:
    show_preview_and_confirm()                   # edits are undoable, so the bar can be lower than in banking
```

Notes:
- Because edits are cheap and undoable, low confidence can mean "generate candidates for the top 2 ops/axes
  and let the user pick" instead of "ask". The `probabilities` map directly to "which alternatives to show".
- Option-order bias: when the top two ops are close, re-ask with the options reversed (the cost is negligible).
- Compound requests ("mirror it and fill the holes") are not well served by one Choice. Use one Noul per op
  ("Does `request` ask to fill holes?") in the same request, and treat it as a multi-label signal. That is how
  the cookbook handles set-valued arguments. Hand the ordering to code or the LLM.
- Keep a `keywords` field in our own spec (not sent) for the offline heuristic fallback (Part C).

### B2. "Painter": generator and preset selection (good fit)

Same shape as B1 but the closed set is **generator families x named presets**. Make the presets **descriptive
words**, not numbers, because Jev is good at semantic matching and bad at numbers.

```python
PAINTER_QUESTIONS = {
    "generator": {
        "type": "choice",
        "instructions": "Which kind of pattern best matches the look described in `request`?",
        "criteria": {
            "cellular_growth":  {"what": "Blobby, coral-like or cave-like organic masses", "examples": ["organic", "lichen", "coral"]},
            "branching":        {"what": "Tree, frost, vein or lightning-like branching lines", "examples": ["frost", "roots", "veins"]},
            "truchet":          {"what": "Tiled arcs or diagonals forming flowing maze-like paths", "examples": ["maze", "celtic", "woven"]},
            "concentric":       {"what": "Rings, ripples or nested frames around a centre", "examples": ["ripples", "target", "halo"]},
            "voronoi_cells":    {"what": "Irregular cells like a honeycomb, cracked mud or giraffe skin"},
            "geometric_tiling": {"what": "Strict repeating geometric motifs like a lattice or grille"},
            "scatter":          {"what": "Loose scattered dots or small specks, like stars or seeds"},
            "glyph":            {"what": "Letters, numbers or a recognisable symbol"},
            "other":            None,
        },
    },
    "line_weight": {
        "type": "score",
        "instructions": "How heavy should the lines and shapes in `request` be?",
        "criteria": [
            "Hairline and delicate, like lace or filigree",
            "Medium strokes, clearly visible but not heavy",
            "Bold and chunky, like a stencil or woodcut",
        ],
    },
    "fill_density": {
        "type": "score",
        "instructions": "How much of the piece should be solid material, according to `request`?",
        "criteria": [
            "Mostly open space with a few elements",
            "A balanced mix of material and openings",
            "Mostly solid with small openings",
        ],
    },
    "order_vs_organic": {
        "type": "score",
        "instructions": "How regular versus natural should the pattern in `request` feel?",
        "criteria": [
            "Strictly geometric and repetitive",
            "Geometric structure with natural variation",
            "Freely natural and irregular, like something grown",
        ],
    },
    "symmetry_wanted": {
        "type": "choice",
        "instructions": "What kind of symmetry does `request` ask for or imply?",
        "criteria": {"none": "Asymmetric or not mentioned", "mirror": "Left-right mirror",
                     "radial": "Repeats around a centre", "not_said": None},
    },
}
```

Code maps `score / (n-1)` (in 0..1) onto continuous generator params (e.g. CA birth/survival thresholds,
dilation radius, branch probability). This is legitimate: we use the Score as a *position*, not as a
precise quantity. Use probabilities to sample several presets rather than one.

### B3. Parameter choice via Choice over discretised sets (good, with a caveat)

Same as the cookbook: when the parameter is semantically nameable, enumerate it (`"thin_1px" -> "hairline
strokes one cell wide"`). Do **not** ask Jev to pick between raw numbers like `"0.35", "0.42"`. That is the
numeric weakness. Caveat: Choice can only pick from options we supply, so an omitted good value cannot be
found. Keep the sets small and descriptive and let code refine numerically around the pick.

### B4. Aesthetic critic / fitness (weak to moderate fit, so be honest)

What will **not** work:
- **Judging visual beauty from ASCII.** Jev cannot see images. ASCII-art reading is undocumented. It cannot
  count, and it is weak on low-level encodings and long states. A 40x40 grid of `#`/`.` is exactly the kind of
  input its jaggedness list warns about. Expect noisy, poorly grounded scores. Calibration does not help here:
  calibrated uncertainty on a task it can't perceive will just be low confidence (best case) or confident
  nonsense (worst case).
- Asking it to compute symmetry %, hole counts, component counts, or "how many cells changed". Code does this exactly.

What plausibly works:
1. **Language -> fitness weights/targets.** The user's aesthetic words ("restrained", "organic but ordered",
   "less soupy") become target buckets per *computed* metric. Code then optimises against those. Jev handles the
   semantic part, and code handles the measuring. This is the composite-scoring pattern turned around.

   ```python
   TARGET_QUESTIONS = {
       f"target_{m}": {
           "type": "choice",
           "instructions": {"question": f"Given `request`, should the design's {label} go down, stay, or go up?",
                            "current": "`metrics_described`"},
           "criteria": {"lower": None, "keep": "The request says nothing that affects this", "higher": None},
       }
       for m, label in [
           ("fill_ratio", "amount of solid material"),
           ("speck_count", "number of tiny isolated bits"),
           ("edge_roughness", "jaggedness of edges"),
           ("symmetry", "degree of symmetry"),
           ("component_count", "number of separate pieces"),
           ("hole_count", "number of enclosed openings"),
           ("stroke_width", "thickness of lines"),
       ]
   }
   ```

2. **Rubric scoring of a code-written *description*, not the raw grid.** Code turns metrics into named buckets
   and short phrases. Jev scores rubric dimensions over that description. This can add value when the rubric is
   *semantic*, for example "does this read as restrained?". But note it is partly circular: we wrote the
   descriptors, and Jev mostly re-maps them. Use it as a soft prior or tie-breaker, and validate against your own
   picks before trusting it.

   ```python
   def describe(grid_metrics) -> dict:   # code, exact
       return {
           "material": "about a third of the area is solid (a balanced amount)",
           "pieces": "one main connected piece plus 11 tiny loose specks of one or two cells",
           "openings": "3 large enclosed openings and 9 pinholes",
           "edges": "mostly staircase-jagged edges, few long straight runs",
           "symmetry": "strong left-right mirror symmetry, no top-bottom symmetry",
           "layers": "layer 2 covers most of layer 1, leaving only a thin rim of layer 1 visible",
       }

   CRITIC_QUESTIONS = {
       "restraint": {
           "type": "score",
           "instructions": "How restrained versus cluttered does the design described in `design` sound?",
           "criteria": [
               {"what": "Soupy: many small fragments, specks and holes compete, no clear main form",
                "examples": ["dozens of loose specks", "pinholes everywhere"]},
               {"what": "Busy: a main form is visible but cluttered by small leftovers"},
               {"what": "Controlled: a clear main form with a few deliberate details"},
               {"what": "Minimal: one or two strong forms, almost nothing extra"},
           ],
       },
       "organic_ordered": {
           "type": "score",
           "instructions": "How well does the design described in `design` balance natural irregularity with an underlying order?",
           "criteria": [
               "Rigid: purely mechanical repetition with no variation",
               "Ordered with some natural variation in shapes or edges",
               "Natural-looking forms arranged within a clear structure such as symmetry or rhythm",
               "Chaotic: irregular with no visible structure",
           ],
       },
       "layer_composition": {
           "type": "score",
           "instructions": "How well do the layers described in `design.layers` work together as stacked cut sheets?",
           "criteria": [
               "Layers hide each other almost completely, so stacking adds nothing",
               "Layers overlap with some visible contrast at the edges",
               "Each layer shows a distinct visible band or motif that frames the others",
           ],
       },
       "fragile": {
           "type": "noul",
           "instructions": "Does `design` mention thin necks, single-cell bridges, or loose pieces that would break off or fall out when laser-cut?",
       },
       "matches_request": {
           "type": "noul",
           "instructions": "Does the design described in `design` satisfy what `request` asked for?",
       },
   }
   ```

   Combine in code: `fitness = w1*restraint_norm + w2*organic_norm + ... - penalty*fragile + exact_metric_terms`.
   For ranking N candidates, one request per candidate (requests run at ~100 ms and can run concurrently,
   at 80 req/s), or put all candidates in one state and ask one Noul/Score per candidate via structured
   instructions (the resume-dedup pattern: ``{"candidate": {...}, "question": "..."}``).

3. **Pairwise / best-of-N preference via Choice.** Put candidate descriptions as Choice criteria
   (`{"A": desc_A, "B": desc_B, ...}`, up to 255), and ask "Which candidate best matches `request`?". Shuffle
   and average over 2-3 orderings to cancel first-option bias. Use `probabilities` as soft fitness.

4. **True visual judgment -> elsewhere.** For "is this beautiful", use a vision-capable LLM (the coordinator)
   on rendered PNGs of the **top-K only**, or the human. Jev pre-filters cheaply and the expensive judge sees
   few candidates. This is the docs' own escalation pattern.

### B5. Grid-as-state representation

Recommendation, in priority order:

1. **Metrics + named buckets + short phrases (primary).** Exact numbers computed in code, *each paired with a
   semantic bucket* ("fill 0.31 (balanced)"). The docs say semantic names beat raw numbers.
2. **Region descriptions in words** produced by code: "selection = top-left quadrant of layer 2, 12x9 cells,
   contains one ring-shaped piece". This avoids indirection.
3. **Small ASCII crop (optional, supplementary, never relied on)**, only for the selected region, only when
   it is under ~20x20, using `#` / `.` with row labels. Label it in state as `"ascii_preview"` and never ask
   questions whose answer requires reading it precisely. Treat any ASCII-dependent answer as experimental until
   measured.
4. **Avoid**: full multi-layer raw bitmaps, run-length encodings, coordinate lists. These are numeric and
   low-level encodings, and they make the state long. They are the worst case on the jaggedness list. RLE in
   particular requires arithmetic to decode.

Token sanity check: even a full 60x60x4 ASCII dump fits under the 32k state limit, so the reason to avoid it is
accuracy (context rot), not limits.

### B6. Where an LLM coordinator fits

- `op == "other"`, low router confidence, compound or multi-step requests ("make it look like a moth"), or
  anything requiring **generation** (new motifs, letterforms, novel shapes) goes to the LLM.
- The LLM can also *author new closed sets on the fly* (e.g. propose 6 candidate edits as descriptions). Jev then
  picks or ranks them cheaply and with calibration. This is "select instead of generate" from SKILL.md.
- Jev can verify the LLM's plan step by step (Noul: "Does `plan.steps[2]` match what `request` asked?"), following
  the citation-check / verify-and-escalate patterns.

---

## Part C: No-key fallback design

```python
import os

def make_judge():
    if os.environ.get("TYPESAFE_API_KEY"):
        from typesafe_sdk import TypeSafeClient          # import lazily; raises TypeSafeError if key invalid
        return JevJudge(TypeSafeClient(model=os.environ.get("TYPESAFE_DEFAULT_MODEL", "jev-1.13.0")))
    return HeuristicJudge()
```

- Both implement `ask(state: dict, questions: dict) -> dict[str, Answer]` returning the **same shape** as the
  API (`choice/probabilities/confidence`, `score/probabilities/confidence`, `noul`), so router and critic code
  is identical either way.
- `HeuristicJudge`:
  - Choice: keyword or regex scores per option, from a `keywords` list kept in *our* spec (strip it before
    sending to Jev), then softmax into probabilities, with confidence computed by the documented formula.
    Unmatched -> `other` with low confidence.
  - Noul: keyword presence -> 0.85 / 0.15, else 0.5.
  - Score: for critic rubrics, map directly from the exact metrics (e.g. restraint from speck_count and
    hole_count buckets). For request-intensity scores, use intensifier words ("slightly", "very").
  - Mark answers `source="heuristic"` so logs and UI can show it.
- Record every (state, questions, answers, user's final pick) to JSONL. This becomes the eval set to tune
  thresholds and to check whether Jev beats the heuristic once a key exists. The docs insist thresholds are tuned
  on our own data.
- Wrap live calls: on `TypeSafeRateLimitError` / timeout / connection error, fall back to the heuristic for that
  call. The SDK already retries 429/529.

## Bottom line

- **Strong fit:** intent routing (op + closed-set args + region, with calibrated confidence), generator or
  preset selection from aesthetic language, language-to-metric-target translation, picking among LLM- or
  code-proposed candidates.
- **Weak fit:** anything that requires *perceiving* the grid: symmetry, holes, counts, beauty from ASCII.
  Compute that in code. Use a vision LLM or the human for actual visual taste on a short list.
- **Cheap and fast enough** (~100 ms, cents per thousands of calls) to call on every keystroke or every
  candidate. The bottleneck is question design and evaluation, not cost.
