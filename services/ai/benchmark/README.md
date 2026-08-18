# Advisory Check benchmark (DEV-83)

Measures the combined CPU load of faster-whisper `small.en` (int8) and the advisory SLM (Q4
GGUF) on the team mini-PC, under 2 to 4 concurrent operations, reporting per-stage latency and
CPU thermal throttling. This is the AC that validates the model choice and confirms the load
fits the ADR 0017 concurrency cap and resource reservation.

Run it on the actual mini-PC (Ryzen 7 5825U, CPU-only). A GPU workstation is fine for model
comparison but is not the production judgment.

## Setup

```
cd services/ai
python -m venv .venv && . .venv/bin/activate
pip install faster-whisper==1.1.1 llama-cpp-python==0.3.2
```

Get the candidate model as a Q4_K_M GGUF and note the local path, for example
`qwen2.5-1.5b-instruct-q4_k_m.gguf` (primary candidate; see
`docs/advisory-check-model-selection.md`).

## Run

Advisory only (no transcription; DEV-31 not built yet):

```
python advisory_benchmark.py \
  --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --notes notes.txt --skip-transcription \
  --concurrency 2 --iterations 20
```

Combined (transcription then advisory), once a sample clip exists:

```
python advisory_benchmark.py \
  --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --audio sample.wav --notes notes.txt \
  --concurrency 4 --iterations 20
```

Sweep `--concurrency 2 3 4` as separate runs and compare.

## Reading the output

- `advisory` p50/p95: the per-note advisory latency. This is the non-blocking budget in
  ADR 0017; it must stay well inside the `assess_note` timeout so the prompt appears at
  review-before-submit.
- `combined`: transcribe plus advise per note, the sequential per-note cost.
- `cpu temp max` and `cpu freq drop`: a large frequency drop from start to end of the run
  under sustained load indicates thermal throttling on this box. The harness flags a drop
  above 15 percent.

Record the numbers for each concurrency level in the DEV-83 comment and, if the chosen model
misses the latency or quality target, rerun with `--advisory-model` pointed at Llama-3.2-1B or
Llama-3.2-3B.

## Category accuracy (DEV-155)

The benchmark above measures latency and thermals only. It does not check whether the model
picks the right failure-mode category. `category_accuracy.py` closes that gap: it scores the
real classifier (`advisory_model.LlamaCppDefectModel`, same prompt and parser as production)
against a hand-labeled dataset of FAIL-item notes, `category_notes.jsonl`.

`category_notes.jsonl` has 57 synthetic SAIT-style notes across cranes, trucks, forklifts, and
the electric pallet jack: 6 to 7 notes per substantive category (LEAK, DAMAGE, WEAR,
MALFUNCTION, MISSING, CONTAMINATION, NOISE_VIBRATION) plus 12 `NONE` rows the model should
abstain on (negated notes, "all clear" notes, and notes that fit none of the 7 and would be the
Operator's manual OTHER choice, ADR 0028). A few rows deliberately mention two signals at once,
worded so one label is the intended answer.

Run it the same way as the latency benchmark, on the mini-PC with weights present:

```
python category_accuracy.py \
  --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

Add `--dataset <path>` to score a different labeled set. The model is injected the same way
`advisory.assess_note` injects it, so `category_accuracy.py` and its test
(`test_category_accuracy.py`) both run against a stub with no GGUF weights or llama.cpp runtime;
only the CLI's `main()` constructs the real model.

## Reading the accuracy output

- Overall accuracy: predicted category equals the labeled `expected`, where a model abstain
  counts as `NONE`.
- Abstain specificity: how often the model correctly abstained on a `NONE` row. Low specificity
  means it is guessing a category on notes that describe no defect.
- Wrongly abstained: how often it missed a real defect by abstaining instead of naming a
  category. This degrades to no suggestion (fail-open, ADR 0028), not a wrong label, but it is
  still a coverage gap worth tracking.
- Confusion matrix: rows are the labeled category, columns are the predicted one. The diagonal
  is correct; off-diagonal cells show which categories the model confuses.
- Out-of-taxonomy predictions: should always be 0. `advisory.DefectCategory` has no OTHER
  member, so the real model cannot return it; the harness checks this rather than assuming it.

Record the results in `CATEGORY_RESULTS.md`.
