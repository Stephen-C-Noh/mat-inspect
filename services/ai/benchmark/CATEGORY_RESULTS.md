# Advisory Check category-accuracy results (DEV-155)

Date: 2026-08-18
Hardware: mini-PC, AMD Ryzen 7 5825U (8c/16t, Zen3, AVX2), 32 GB, CPU-only, Ubuntu (Python 3.14).
Model: Qwen2.5-1.5B-Instruct (Q4_K_M GGUF), llama.cpp (llama-cpp-python 0.3.2), n_ctx 2048, same
weights and prompt as production (`services/ai/advisory_model.py`).
Dataset: `category_notes.jsonl`, 57 labeled FAIL-item notes (6 to 7 per substantive category,
plus 12 NONE rows for negation, all-clear, and notes that fit none of the 7). See `README.md` for
the dataset description and `category_accuracy.py` for the scorer.

Command used:

```
cd services/ai/benchmark
../.venv/bin/python category_accuracy.py \
  --advisory-model ~/models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

## Overall accuracy

| Notes scored | Correct | Accuracy | Abstain specificity (correct NONE) | Wrongly abstained on a real category |
| ------------ | ------- | -------- | ---------------------------------- | ------------------------------------ |
| 57           | 36      | 63.2%    | 1/12 (8.3%)                        | 0/45 (0.0%)                          |

On the 45 genuine-defect notes alone (excluding the 12 adversarial NONE rows), accuracy is
35/45 (77.8%). This is the production-relevant slice: the advisory fires only on a FAIL-item
note, so an "all clear" or negated note would not normally reach it.

## Confusion matrix

```
expected \ predicted               LEAK           DAMAGE             WEAR      MALFUNCTION          MISSING    CONTAMINATION  NOISE_VIBRATION             NONE
LEAK                                  6                0                1                0                0                0                0                0
DAMAGE                                0                2                4                0                0                0                0                0
WEAR                                  0                0                7                0                0                0                0                0
MALFUNCTION                           0                0                2                3                1                0                0                0
MISSING                               0                0                0                0                7                0                0                0
CONTAMINATION                         0                0                1                0                0                5                0                0
NOISE_VIBRATION                       0                0                1                0                0                0                5                0
NONE                                  1                0                1                0                8                1                0                1
```

## Out-of-taxonomy check

0 predictions fell outside the 7 model-suggestable labels plus NONE, as expected
(`advisory.DefectCategory` has no OTHER member, so the real model cannot return it). The harness
checks this rather than assuming it.

## Findings

- Per-category recall is strong for 5 of the 7 substantive categories: WEAR 7/7, MISSING 7/7,
  LEAK 6/7, CONTAMINATION 5/6, NOISE_VIBRATION 5/6.
- DAMAGE is the weakest substantive category: 2/6, with 4 of the 6 misrouted to WEAR. Bent,
  cracked, dented, and broken components read as WEAR to the model. DAMAGE vs WEAR is the one
  substantive confusion worth a prompt note; the taxonomy distinction (a discrete break/deform
  vs gradual material loss) is real but the model does not hold it reliably.
- WEAR is an over-attractor: predicted 17 times against 7 true labels. It absorbs the DAMAGE
  misroutes plus single misroutes from LEAK, MALFUNCTION (2), CONTAMINATION, and NOISE_VIBRATION.
- Abstain is the real weak point. The model almost never returns NONE: only 1/12 NONE rows were
  correctly abstained, and 8 of the 12 were classified MISSING. Negated notes ("no leak found",
  "not worn, just dirty") and out-of-taxonomy FAIL notes (expired inspection tag, faded placard,
  blocking a fire lane) are not abstained on. Negation handling that passes the `_parse_category`
  unit tests does not hold end to end on the real model. MISSING is the second over-attractor
  (predicted 16 times against 7 true), driven almost entirely by these NONE rows.
- Wrongly abstained on a real category: 0/45. On a genuine defect the model always names a
  category rather than silently doing nothing, so the fail-open path (ADR 0028) is essentially
  never exercised. Coverage is not the problem; over-confident guessing on non-defect notes is.
- A few percent of the "errors" are label ambiguity, not model failure: line 39
  (battery-terminal corrosion labeled CONTAMINATION, defensibly WEAR/DAMAGE) and line 37 (spilled
  fluid on deck plating labeled CONTAMINATION, defensibly LEAK) are deliberate hard cases.

## Decision

Keep the feature as shipped for the capstone. The advisory stays assistive and dismissible
(ADR 0028): the Operator picks the category and makes the final OHS s.257 call, so a moderate
top-1 suggestion is useful without being authoritative. 77.8% top-1 on genuine-defect notes,
with 5 of 7 categories at 5-7/7, clears that bar.

Two known limitations, documented rather than fixed here:

- DAMAGE is under-suggested (biased toward WEAR). An Operator correcting a WEAR suggestion to
  DAMAGE is a one-tap fix, so this is a friction cost, not a safety issue.
- The model does not abstain on non-defect or out-of-taxonomy notes. In the real flow the
  advisory fires only on FAIL-item notes, so this is largely out of distribution; the residual
  risk is a stray suggestion on a FAIL note that describes an out-of-taxonomy problem (e.g. an
  expired tag), which the Operator dismisses or overrides to OTHER.

These numbers are the input for whether the ADR 0018 Foundry conditional-upgrade path should be
revisited. A 1.5B Q4 SLM gives moderate accuracy; a larger model or a prompt that sharpens the
DAMAGE/WEAR boundary and rewards abstention would likely help. Neither is required for the
assistive framing, so no upgrade is proposed now; this result is recorded as the baseline.
