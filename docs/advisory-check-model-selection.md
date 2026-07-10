# Advisory Check: Model Selection Rationale (DEV-83)

Date: 2026-07-09
Ticket: DEV-83
References: ADR 0018 (Advisory Check), ADR 0017 (shared mini-PC CPU budget),
AI_USAGE_GUIDE section 1 (self-hosted model vetting).

This note records the model choice for the Advisory Check and the reasons. It is a
ticket-level decision that ADR 0018 left open ("the exact model, and whether to use a
trained classifier or a prompted generative SLM, is a ticket-level decision validated by
benchmark"). The mini-PC benchmark (separate AC) validates the final pick.

## Decision

Use a prompted, instruction-tuned generative SLM, run zero-shot, quantized to Q4, CPU-only,
self-hosted on the team mini-PC through llama.cpp (GGUF weights). No fine-tuning for the MVP.
No model of 7B or larger. The primary candidate is 1.5B or smaller for CPU latency; a 3B model
is retained as a quality-ceiling comparator, at the ADR 0018 cap.

## Why prompted generative, not a trained classifier or a zero-shot encoder

- No labeled inspection-note data exists at launch. The feature is not deployed, so there are
  no real notes to train on (cold start). A fine-tuned classifier needs labels. Real notes are
  also PII under FOIP, so training on them later needs separate care. Fine-tuning is deferred.
- Zero-shot prompting needs no training data. An instruction-tuned SLM handles negation and
  paraphrase better than a zero-shot NLI encoder. Examples the encoder tends to miss: "no
  damage found", "wheel was fine after re-seating", "looked cracked but it is just paint".
- The client asked for an AI feature. An instruction-tuned SLM is a visible, genuine machine
  learning feature. ADR 0018 rejected a lexical rule engine because it is not machine learning.
- Trade-off accepted: an SLM is a heavier second CPU consumer than an encoder. ADR 0017's
  shared-CPU budget is derived for exactly this case. The advisory runs sequentially after
  transcription and is non-blocking, so it runs behind faster-whisper in the shared pool and
  never delays submit. The mini-PC benchmark confirms the combined load fits the concurrency
  cap and resource reservation.

## Shortlist (Q4_K_M GGUF, CPU)

| Model                 | Params | License                     | Role                              |
| --------------------- | ------ | --------------------------- | --------------------------------- |
| Qwen2.5-1.5B-Instruct | 1.5B   | Apache-2.0                  | Primary candidate                 |
| Llama-3.2-1B-Instruct | 1.2B   | Llama 3.2 Community License | Fallback if 1.5B latency too high |
| Llama-3.2-3B-Instruct | 3.2B   | Llama 3.2 Community License | Quality-ceiling comparator        |

License note (verify against each model card before pinning): Qwen2.5 is Apache-2.0 at the
0.5B/1.5B/7B/14B/32B sizes, but the 3B size is under the Qwen license, not Apache-2.0. For
that reason the 3B comparator is Llama-3.2-3B, not Qwen2.5-3B. Llama 3.2 models carry the
Llama 3.2 Community License Agreement with an acceptable-use policy; capstone scale is well
inside its terms. Gemma-2-2B-it (Gemma terms) is an optional extra comparator, not shortlisted.

## Chosen primary: Qwen2.5-1.5B-Instruct (Q4_K_M)

Reasons:

- License. Apache-2.0 is the lowest-friction license for a self-hosted model under
  AI_USAGE_GUIDE section 1.
- Size. 1.5B fits the CPU-latency target better than 3B on the Ryzen 7 5825U, which matters
  because the advisory shares cores with faster-whisper (ADR 0017).
- Quality. Strong zero-shot instruction following at this size for a short binary judgment.

Llama-3.2-1B is the fallback if 1.5B latency is too high under 2 to 4 concurrent operations.
Llama-3.2-3B is the comparator if 1.5B quality is too low. The final pick is confirmed by the
mini-PC benchmark, not by this document.

## Runtime and vetting (AI_USAGE_GUIDE section 1)

- Runtime: llama.cpp through llama-cpp-python, CPU inference (AVX2 on Zen3). GGUF weights.
- Weights are pulled once from Hugging Face, pinned by revision, and cached on the mini-PC.
  No per-request network call. Note text never leaves the box; there is no external inference
  API in the path.
- Output is made deterministic and parseable: temperature 0, a fixed seed, and a constrained
  output (a single label or a small fixed JSON), so the signal is reproducible and easy to
  validate.
- Model card reviewed for intended use and stated limitations. License recorded above.

## Interface (text-in / signal-out)

The AI Service exposes a text-in endpoint so the advisory does not depend on the voice
transcription endpoint (DEV-31) being finished. Input is note text plus the pass/fail mark;
output is a boolean advisory signal. The response is ephemeral: it is not persisted, and
nothing about the advisory is written to the Inspection or the Audit Chain (ADR 0018).

- MVP direction only: flag a note that signals a defect on an item marked PASS. The reverse
  direction (a clean note on a FAIL) is out of scope for the MVP.
- Fail-open: on timeout, model-unavailable, or a 429 from the concurrency cap, the path returns
  "no advisory" and the PWA shows no prompt. Submit is never blocked or delayed (ADR 0017,
  ADR 0018).

## Benchmark plan (separate AC, runs on the mini-PC)

faster-whisper small.en (int8) plus Qwen2.5-1.5B-Instruct (Q4_K_M), under 2 to 4 concurrent
operations, measuring per-note latency and thermal throttling on the Ryzen 7 5825U. Confirm the
combined load fits the ADR 0017 concurrency cap and resource reservation. Compare Llama-3.2-1B
and Llama-3.2-3B if 1.5B misses the latency or quality target. Development and model comparison
may use a workstation GPU, but the production judgment is CPU latency on the mini-PC.
