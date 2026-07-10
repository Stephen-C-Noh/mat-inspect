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
