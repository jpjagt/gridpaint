# Jev (TypeSafe System One) experiments for gridlab

Date: 2026-10-13. Model pinned to `jev-1.13.0`. Plain HTTP via urllib, with the key loaded from `lab/.env`.
Total: **135 API calls**, 0 errors, about 272k input tokens (about $0.01). Mean latency was 0.3 s per call with up to 27 questions.
Scripts and raw JSON: `/private/tmp/claude-501/-Users-jeroen-code-jpjagt-gridpaint/38b2da63-0c55-5a56-8c5b-ecf7174852e9/scratchpad/jev/`
(`exp1_routing.py`, `exp1b_hard.py`, `exp2_perception.py`, `exp3_critic.py`, `exp4_params.py`, `exp5_targets.py`, `analyze*.py`, `exp*_raw.json`, `exp*_analysis.txt`).

Caveats: the samples are small (10 to 50 items per experiment), and I wrote all the gold labels myself before running.
In exp 1 I also wrote both the op descriptions and the requests, so the easy set leaks wording. The hard set (1b) avoids that.

## 1. Edit intent routing (closed set of 17 ops plus `other`, with args)

One call per request. The op Choice was asked **three times in the same call**: forward, reversed and shuffled option order. Questions are evaluated independently, so this costs nothing extra. Each call also had args and 17 per-op Nouls, 27 questions in total.

| set | n | op accuracy (fwd / rev / shuf, lenient) | all 3 orders agree | conf. of correct (mean) | conf. of wrong |
|---|---|---|---|---|---|
| easy (my wording) | 30 | 30 / 29 / 30 | 29/30 | 0.94 | 0.68 (rev) |
| hard paraphrases | 20 | 19 / 19 / 19 | 19/20 | 0.87 | 0.25 to 0.42 |
| pooled | 50 | **49/50 (98%)** | 48/50 | 0.91 | all < 0.70 |

- **Confidence separates right from wrong.** In the pooled fwd results, gating at confidence ≥ 0.7 auto-routes 44/50 requests at 100% precision. Every error and every order disagreement had confidence < 0.7 ("make it like a snowflake": rotate 0.51 vs texture 0.39; "a bit more like the moon": smooth 0.45).
- **No first-option bias was measurable.** Mean probability on a wrong first option was 0.0004 (fwd) and 0.004 (rev). Order only flips genuinely ambiguous cases. That makes order disagreement a free ambiguity detector.
- **Args were 22/22 correct** (axis, fold, source side or layer, target layer, "slightly" → strength 0).
- **Pitfall:** when no layer was mentioned, `target` never picked `not_said` (0/44). It resolved to the active layer named in state. A `*_stated` Noul fixes this: `axis_stated` gave 0.04 for "make it symmetric" and ≥ 0.79 when an axis was named.
- **`anything_fits` Noul** for detecting `other` is weak: "other" requests scored 0.04 to 0.83. Use the `other` option of the Choice instead.
- **Per-op Nouls (multi-label)** have high recall (41/44) but many false positives (19): `densify` fires on "fill holes", and `sparsify` fires on "delicate". Use them only to detect compound requests ("mirror … and thicken": both > 0.5), and only for ops with p > 0.8.

## 2. Reading 2-D properties from ASCII (10 grids, 9x9 to 29x29, 3 encodings, 8 Nouls)

| encoding | accuracy (80 judgments) | majority-class baseline |
|---|---|---|
| plain `#.` | **81%** | 74% |
| row/col labelled | 78% | 74% |
| run-length words | 70% | 74% |

Per question (plain encoding): `sym_tb` 10/10, `frame` 10/10, `center_heavy` 10/10, `sym_lr` 9/10, `mostly_empty` 9/10, `has_hole` 8/10, `rot4` 6/10 (a 9x9 plus-cross got 0.18), and `one_piece` 3/10 (always says "connected").
AUROCs are often high, so the ranking is roughly right, but the 0.5 thresholds are badly calibrated and the margins are thin. For example, mirrored noise with 3 flipped cells scored 0.30, while a truly symmetric framed grid scored 0.47. Density Score vs true fill gives Spearman 0.82.
**Conclusion:** this is a rough gist only. Code computes every one of these properties exactly in microseconds, so never ask Jev for them. Run-length encoding is worst. If you must show ASCII, use plain `#.`.

## 3. Aesthetic critic (12 designs: 4 user samples plus 8 generated)

The 8 generated designs were: lace band D2, solid wavy blob D2, outline+cross, mirrored noise, CA maze, dense blob, sparse scatter and random noise. They were rated with Scores (restraint, organic_ordered, pendant) and a Noul (is_noise).
The states tested were (a) code-computed metrics as word buckets, (b) ASCII, and (c) both.
Gold was my 1–5 rating: samples 5, lace band 4, outline+cross 3, mirrored noise / solid blob 2, the rest 1 to 1.5.

| Spearman vs gold | metrics | ascii | both |
|---|---|---|---|
| organic_ordered | 0.90 | **0.97** | 0.93 |
| pendant | 0.66 | 0.74 | 0.80 |
| restraint | 0.19 | 0.18 | 0.18 |
| is_noise (inverted) | 0.18 | 0.20 | 0.20 |
| composite (organic_ordered + pendant + not-noise) | 0.78 | **0.89** | 0.83 |
| **code-only lace-grammar rule count** (no Jev) | | | **0.85** |

- Jev's correlation comes mainly from separating **symmetric vs asymmetric** designs, which code already knows. **Mirrored random noise ranks with the samples** (composite 0.93 vs 0.92 to 0.96), and that is exactly the soup the user dislikes. Within the 9 exactly-symmetric designs, the composite reached Spearman 0.52 to 0.73. That is no better than the code baseline (0.73).
- "Restraint" was understood as "solid and simple", so dense blobs scored highest. The common-sense reading is the opposite of this user's taste.
- Score confidences are low (mean 0.43 to 0.59), so it knows it is unsure.

## 4. Generator parameters from a brief (10 prompts, 5 Choices plus 2 `stated` Nouls)

**29/30 graded slots** were sensible. For example, "delicate, very airy, ring shaped" gave ring / very_airy / D4 / one layer / lace. The one miss was "minimal tag" → dense, at confidence 0.39.
Confidence is meaningful. Slots the brief implies averaged 0.84. Slots it does not imply averaged 0.46 (65% below 0.5), so low confidence means "not specified, use a default or sample several".

## 5. Extra: aesthetic words → direction of change for computed metrics (8 requests, 8 metrics)

18/22 graded directions were correct, but the errors are **systematically against this user's aesthetic**:
- "more organic" → *lower symmetry* (conf 0.85)
- "more ordered" → *less diagonal lace detail* (0.98)
- "less soupy" → *more fill and solid blocks*

Jev applies generic common sense. Domain rules ("organic = wiggly lace *inside* symmetry") must either be in the criteria or be hard-coded.

## Conclusions

**Where Jev is useful (use it):**
1. **Edit-intent routing and closed-set args.** It was 98% accurate, and confidence < 0.7 catches every error.
2. **Brief → generator presets.** It picks silhouette, symmetry, density, layer count and texture family. The probabilities can be used to sample variants.
3. Optionally, **wording → which metrics to push**, but only with domain-tuned criteria, and code should enforce the invariants (symmetry is never lowered).

**Where code or the LLM coordinator should decide instead:**
- Code should compute all grid properties (symmetry, holes, components, density, frame).
- Code should do candidate ranking: lace-grammar metrics plus fitness. Jev adds nothing over code here and misses symmetric soup.
- The coordinator should handle `other`, compound multi-step edits, and taste critique of renders. Only a vision LLM or the human can judge "soup vs lace".

**State encoding:** for routing, a small JSON object of `request`, `selection` in words, `active_layer`, and `layers` as names. Do not include grid data, because it is irrelevant to routing and invites context rot.
If grid context is ever needed, send code-computed word buckets, not ASCII, RLE or numbers.

### Final question definitions (validated parts)

```python
EDIT_OPS = {  # Choice criteria; keep 'other' last. Ask the op Choice twice (as given + reversed) in the same call.
  "mirror": {"what": "Make the design mirror-symmetric by reflecting one side onto the other"},
  "rotate_symmetry": {"what": "Repeat the design around its centre by rotation (2-fold half-turn, 4-fold quarter-turn)"},
  "fill_holes": {"what": "Fill empty gaps that are enclosed by filled cells", "not_for": "joining separate pieces"},
  "remove_specks": {"what": "Delete tiny isolated bits and stray single cells"},
  "smooth": {"what": "Round off corners and staircase edges so shapes look soft and fluid"},
  "roughen": {"what": "Make edges irregular, eroded or ragged"},
  "thicken": {"what": "Make strokes and shapes bolder by growing them outward"},
  "thin": {"what": "Make strokes finer by shrinking or skeletonising them, keeping the same layout"},
  "connect": {"what": "Join separate pieces with bridges so the design holds together as one piece"},
  "sparsify": {"what": "Remove some elements to make the area lighter, more open and less busy"},
  "densify": {"what": "Add more elements to make the area fuller"},
  "add_frame": {"what": "Add a border or frame line around the design or selection"},
  "outline_only": {"what": "Hollow out shapes, keeping only their border cells"},
  "invert": {"what": "Swap filled and empty cells"},
  "derive_layer": {"what": "Make one layer a transformed copy of another layer (grown, shrunk, offset, outlined)"},
  "texture_fill": {"what": "Fill the region with a generated texture or pattern style (lace, coral, maze, veins...)"},
  "move_to_layer": {"what": "Move or copy the selected cells onto a different layer"},
  "other": {"what": "Anything else: app commands, vague feelings, requests none of the options describe"},
}
OP_Q = {"type": "choice", "instructions": {"question": "Which edit operation does `request` ask for?",
        "focus": "Classify the main change the user wants to see in the design."}, "criteria": EDIT_OPS}
ROUTER = {
  "op": OP_Q,
  "op_rev": {**OP_Q, "criteria": {k: EDIT_OPS[k] for k in list(EDIT_OPS)[-2::-1] + ["other"]}},
  "axis": {"type": "choice", "instructions": "If `request` asks for mirror symmetry, across which axis?",
           "criteria": {"left_right": "Left and right sides become mirror images", "top_bottom": "Top and bottom become mirror images",
                        "both": "Both left-right and top-bottom", "diagonal": "Across a diagonal", "not_said": "The request does not say which way"}},
  "axis_stated": {"type": "noul", "instructions": "Does `request` explicitly say which direction or axis to mirror across (left/right, top/bottom, diagonal)?"},
  "fold": {"type": "choice", "instructions": "If `request` asks for rotational repetition, how many-fold?",
           "criteria": {"two": "Half-turn (2-fold)", "four": "Quarter-turn (4-fold)", "not_said": "The request does not say"}},
  "source": {"type": "choice", "instructions": "Which layer or side does `request` treat as the reference or source to copy/follow from?",
             "criteria": {"top": "The top layer or top side", "middle": "The middle layer", "bottom": "The bottom layer or bottom side",
                          "left": "The left side", "right": "The right side", "not_said": "No source is mentioned"}},
  "target": {"type": "choice", "instructions": "Which layer does `request` want changed or to receive the result?",
             "criteria": {"top": "The top layer", "middle": "The middle layer", "bottom": "The bottom layer / base plate", "not_said": "No layer is mentioned"}},
  "target_stated": {"type": "noul", "instructions": "Does `request` explicitly name a layer (top, middle, bottom, base plate, a layer number)?"},  # untested wording; needed (see 1)
  "strength": {"type": "score", "instructions": "How strong a change does `request` ask for?",
               "criteria": ["A subtle touch: the user says slightly, a bit, a little", "A normal change: no intensity word is used",
                            "A strong change: the user says much more, very, a lot"]},
  # compound detection: add f"has_{op}" Nouls ("Does `request` ask for this edit: <what>?") only for ops you can chain
}
# routing: avg(op, op_rev) probs; if top == 'other' or conf < 0.5 or op.choice != op_rev.choice -> coordinator (LLM) / ask user
#          0.5 <= conf < 0.7 -> apply top-2 ops as candidates for the user to pick; conf >= 0.7 -> apply directly (undoable)
#          use an arg only if its *_stated Noul > 0.6 (else code default / try both); call confidence = min(op, used args)

BRIEF = {  # generator presets; a slot with conf < 0.5 is 'unspecified' -> code default or sample from probabilities
  "silhouette": {"type": "choice", "instructions": "Which outline shape best fits the piece described in `brief`?",
                 "criteria": {"capsule": "Tall rounded rectangle / pill, like a classic tag pendant", "oval": "Smooth ellipse or circle, a locket or cameo",
                              "ring": "A circular band with an open centre, a halo or wreath", "diamond": "A lozenge standing on its point",
                              "shield": "Flat top, pointed bottom, heraldic or gothic"}},
  "density": {"type": "choice", "instructions": "How much solid material should the piece in `brief` have?",
              "criteria": {"very_airy": "Mostly open space, wisps of material, like a cobweb", "light": "Open lace with clear gaps everywhere",
                           "balanced": "About as much metal as openings", "dense": "Mostly solid metal with small piercings"}},
  "symmetry": {"type": "choice", "instructions": "Which symmetry suits the piece described in `brief`?",
               "criteria": {"D1": "A single mirror: left and right sides match, top and bottom differ (like a face, leaf or shield)",
                            "D2": "Two mirrors: left/right and top/bottom both match (like a pill or tag)",
                            "D4": "Four-way: looks the same after a quarter turn and mirrored (like a snowflake, rosette or round medallion)"}},
  "layers": {"type": "choice", "instructions": "How many stacked metal layers suit the piece in `brief`?",
             "criteria": {"one": "A single flat cut sheet, the simplest and lightest", "two": "A base plus one overlay, a little depth",
                          "three": "Base, middle and a top accent: clear relief", "four": "Deep layered relief, chunky and sculptural"}},
  "texture": {"type": "choice", "instructions": "Which texture family best matches the look in `brief`?",
              "criteria": {"lace": "Fine symmetric pixel lace, wiggly one-cell strokes, like the reference samples",
                           "worm": "Meandering worm or slime-mould trails", "venation": "Branching veins, roots or frost growing from a spine",
                           "coral": "Blobby coral, lichen or mould growth", "truchet": "Woven arcs, maze-like celtic paths",
                           "rosette": "Crisp geometric star / rosette motifs, folk embroidery"}},
  "silhouette_stated": {"type": "noul", "instructions": "Does `brief` name or clearly imply an outline shape for the piece?"},
  "layers_stated": {"type": "noul", "instructions": "Does `brief` say or clearly imply how many layers or how much depth the piece should have?"},
}
```

Not recommended: ASCII perception Nouls, and critic Scores used as fitness. If the metric-direction questions (exp 5) are used,
pin `symmetry` to "keep" in code and add the user's definition to the criteria ("organic means wiggly diagonal lace detail
inside exact symmetry, never broken symmetry").
