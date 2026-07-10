# Advisory Check benchmark results (DEV-83)

Date: 2026-07-10
Hardware: mini-PC, AMD Ryzen 7 5825U (8c/16t, Zen3, AVX2), 32 GB, CPU-only, Ubuntu (Python 3.14).
Models: faster-whisper `small.en` (int8) + Qwen2.5-1.5B-Instruct (Q4_K_M GGUF), llama.cpp.
Method: transcribe a ~10 s clip then advise, per note. Each worker owns its own model instances
and runs flat out (worst case). 20 iterations per worker. Models preloaded and warmed before
timing. See `advisory_benchmark.py` and `README.md`.

## Latency and thermal

| Concurrency | threads/worker | transcribe p50 / p95 | advisory p50 / p95 | combined p50 / p95 | CPU temp max / mean | throughput |
| ----------- | -------------- | -------------------- | ------------------ | ------------------ | ------------------- | ---------- |
| 2           | 8              | 3.39 / 3.49 s        | 116 / 275 ms       | 3.50 / 3.74 s      | 69.5 / 65.9 C       | 0.56 ops/s |
| 3           | 5              | 4.67 / 4.82 s        | 138 / 399 ms       | 4.83 / 5.11 s      | 78.9 / 70.3 C       | 0.61 ops/s |
| 4           | 4              | 5.76 / 6.09 s        | 168 / 378 ms       | 5.96 / 6.63 s      | 82.6 / 71.8 C       | 0.66 ops/s |

Single worker (reference, warm): transcribe ~2.1 s, advisory ~66 ms, CPU temp ~72 C.

## Findings

- No thermal throttling at any concurrency (max 82.6 C, well below the roughly 95 C trip). Heat
  is not the binding constraint.
- The advisory is cheap and non-blocking: p95 under 400 ms, 3 to 8 percent of the combined time.
  Worst advisory outlier 2.6 s, inside the 4 s fail-open timeout in `assess_note`.
- Transcription is the bottleneck and scales with concurrency (workers share fewer cores). It
  crosses the DEV-31 5-second target between 3 and 4 concurrent.
- Throughput is flat (about 0.6 ops/s): on one CPU box, concurrency spreads latency rather than
  raising throughput (ADR 0017).

## Decision

Concurrency cap = 2 (ADR 0017). Both transcription (3.5 s p95) and combined (3.7 s p95) sit
inside the 5-second target with margin. Cap 3 is a burst ceiling (combined just over 5 s); cap 4
exceeds the target. The container CPU reservation is matched to the cap so two concurrent
transcriptions each keep enough cores.
