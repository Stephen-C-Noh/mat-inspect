# Advisory Check category-accuracy results (DEV-155)

Date: TBD
Hardware: mini-PC, AMD Ryzen 7 5825U (8c/16t, Zen3, AVX2), 32 GB, CPU-only, Ubuntu (Python 3.14).
Model: Qwen2.5-1.5B-Instruct (Q4_K_M GGUF), llama.cpp, same weights and prompt as production
(`services/ai/advisory_model.py`).
Dataset: `category_notes.jsonl`, 57 labeled FAIL-item notes (6 to 7 per substantive category,
plus 12 NONE rows for negation, all-clear, and notes that fit none of the 7). See `README.md` for
the dataset description and `category_accuracy.py` for the scorer.

TBD: Opus fills in the numbers below after running this on the mini-PC (weights present there;
not run here, no weights in this environment). Command used:

```
cd services/ai
python -m venv .venv && . .venv/bin/activate
pip install llama-cpp-python==0.3.2
cd benchmark
python category_accuracy.py \
  --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

## Overall accuracy

| Notes scored | Correct | Accuracy | Abstain specificity (correct NONE) | Wrongly abstained on a real category |
| ------------ | ------- | -------- | ---------------------------------- | ------------------------------------ |
| TBD          | TBD     | TBD      | TBD                                | TBD                                  |

## Confusion matrix

TBD. Paste the `category_accuracy.py` markdown block here.

## Out-of-taxonomy check

TBD: confirm 0 predictions fell outside the 7 model-suggestable labels plus NONE. This should be
structurally impossible (`advisory.DefectCategory` has no OTHER member); the harness flags it
rather than assuming it.

## Findings

TBD. Note anything that stands out: categories the model confuses with each other, whether
negation handling holds on the real model (not just the `_parse_category` unit tests), and
whether abstain behavior on the "fits none of the 7" NONE rows looks reasonable.

## Decision

TBD. If accuracy or a specific category's confusion rate is poor enough to be misleading rather
than helpful, note it here: the advisory stays assistive and dismissible either way (ADR 0028),
but this result is the input for whether the Foundry conditional-upgrade path from ADR 0018
should be revisited.
