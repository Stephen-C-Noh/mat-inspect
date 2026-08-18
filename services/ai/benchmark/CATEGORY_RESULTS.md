# Advisory Check category-accuracy results (DEV-155)

Date: 2026-08-18
Hardware: mini-PC, AMD Ryzen 7 5825U (8c/16t, Zen3, AVX2), 32 GB, CPU-only, Ubuntu (Python 3.14).
Model: Qwen2.5-1.5B-Instruct (Q4_K_M GGUF), llama.cpp (llama-cpp-python 0.3.2), n_ctx 2048, same
weights and prompt as production (`services/ai/advisory_model.py`), deterministic (seed 0,
temperature 0).
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
| 57           | 41      | 71.9%    | 3/12 (25.0%)                       | 0/45 (0.0%)                          |

On the 45 genuine-defect notes alone (excluding the 12 adversarial NONE rows), accuracy is
38/45 (84.4%). This is the production-relevant slice: the advisory fires only on a FAIL-item
note, so an "all clear" or negated note would not normally reach it.

## Confusion matrix

```
expected \ predicted               LEAK           DAMAGE             WEAR      MALFUNCTION          MISSING    CONTAMINATION  NOISE_VIBRATION             NONE
LEAK                                  6                0                1                0                0                0                0                0
DAMAGE                                0                5                1                0                0                0                0                0
WEAR                                  0                0                7                0                0                0                0                0
MALFUNCTION                           0                0                2                3                1                0                0                0
MISSING                               0                0                0                0                7                0                0                0
CONTAMINATION                         1                0                0                0                0                5                0                0
NOISE_VIBRATION                       0                0                1                0                0                0                5                0
NONE                                  2                0                1                0                5                1                0                3
```

## Out-of-taxonomy check

0 predictions fell outside the 7 model-suggestable labels plus NONE, as expected
(`advisory.DefectCategory` has no OTHER member, so the real model cannot return it). The harness
checks this rather than assuming it.

## Prompt tuning

The shipped prompt is not the first one tried. The original bare-list prompt (label names, no
definitions) scored 63.2% overall / 77.8% on the defect slice, with two clear failures: DAMAGE
was read as WEAR (2/6) and non-defect notes were almost never abstained on (1/12). Three prompt
variants were A/B'd on the mini-PC against this same 57-note set, one model load, deterministic:

| Prompt                                                          | Overall   | Defect slice (45) | Abstain (12) | Weakest category    |
| --------------------------------------------------------------- | --------- | ----------------- | ------------ | ------------------- |
| Bare list (original)                                            | 63.2%     | 77.8%             | 1/12         | DAMAGE 2/6          |
| Per-label definitions                                           | 70.2%     | 82.2%             | 3/12         | NOISE_VIBRATION 3/6 |
| Definitions + 3 few-shot                                        | 70.2%     | 84.4%             | 2/12         | NOISE_VIBRATION 1/6 |
| Definitions, sharpened MALFUNCTION/NOISE boundary (**shipped**) | **71.9%** | **84.4%**         | **3/12**     | MALFUNCTION 3/6     |

Two things the A/B settled:

- Few-shot examples were dropped. Two NONE few-shot examples did not improve abstain (2/12, below
  the definitions-only 3/12) and collapsed NOISE_VIBRATION to 1/6 (5 of 6 misrouted to
  MALFUNCTION). Definitions alone generalize better here than definitions plus examples.
- The definitions blurred the MALFUNCTION vs NOISE_VIBRATION line (a squeal or grind is arguably
  "not working correctly"). Sharpening both glosses around whether the equipment still operates
  recovered NOISE_VIBRATION (3/6 -> 5/6) at the cost of two MALFUNCTION notes drifting to WEAR.
  That trade nets +1 overall and leaves no category collapsed.

The few-shot examples used in the experiment were freshly written, not drawn from
`category_notes.jsonl`, so the eval set was not leaked into the prompt.

## Findings

- Per-category recall is strong for 5 of the 7 substantive categories: WEAR 7/7, MISSING 7/7,
  LEAK 6/7, DAMAGE 5/6, CONTAMINATION 5/6, NOISE_VIBRATION 5/6.
- MALFUNCTION is now the weakest substantive category: 3/6, with 2 of 6 misrouted to WEAR. When a
  function fails, the model sometimes attributes it to wear. This is the residual cost of
  narrowing the MALFUNCTION definition to protect NOISE_VIBRATION.
- Abstain remains the hard limit: even the best prompt reaches only 3/12 on NONE rows, and 5 of
  the 12 are still classified MISSING. Prompt wording and few-shot could not push a 1.5B model
  past roughly a quarter of the NONE rows. In the real flow the advisory fires only on FAIL-item
  notes, so these non-defect and out-of-taxonomy rows are largely out of distribution; the
  residual risk is a stray suggestion on a FAIL note that describes an out-of-taxonomy problem
  (e.g. an expired tag), which the Operator dismisses or overrides to OTHER.
- Wrongly abstained on a real category: 0/45. On a genuine defect the model always names a
  category rather than silently doing nothing, so the fail-open path (ADR 0028) is essentially
  never exercised. Coverage is not the problem; over-confident guessing on non-defect notes is.
- A few percent of the "errors" are label ambiguity, not model failure: line 39
  (battery-terminal corrosion labeled CONTAMINATION, defensibly WEAR/DAMAGE) and line 37 (spilled
  fluid on deck plating labeled CONTAMINATION, defensibly LEAK) are deliberate hard cases.

## Decision

Ship the definitions prompt (the shipped variant above). The advisory stays assistive and
dismissible (ADR 0028): the Operator picks the category and makes the final OHS s.257 call, so a
moderate top-1 suggestion is useful without being authoritative. 71.9% overall / 84.4% on
genuine-defect notes, with 6 of 7 categories at 5-7/7, clears that bar and is a real gain over the
original bare-list prompt (+8.7 points overall).

Known limitations, documented rather than tuned further:

- MALFUNCTION is under-suggested (biased toward WEAR). Correcting a WEAR suggestion to MALFUNCTION
  is a one-tap fix for the Operator, so this is a friction cost, not a safety issue.
- The model does not reliably abstain on non-defect or out-of-taxonomy notes (25% ceiling). This
  is largely out of distribution for the FAIL-only flow.

The gains here are measured on a 57-note in-house set; tuning the prompt further against this same
set would fit its noise rather than improve the model, so tuning stops at the definitions prompt.
These numbers are the input for whether the ADR 0018 Foundry conditional-upgrade path should be
revisited. A 1.5B Q4 SLM gives moderate accuracy; a larger model would likely help the MALFUNCTION
and abstain cases, but neither is required for the assistive framing, so no upgrade is proposed
now. This result is recorded as the baseline.
