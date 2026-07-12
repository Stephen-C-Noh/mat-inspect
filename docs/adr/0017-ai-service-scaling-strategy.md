# ADR 0017: AI Service Scaling Strategy (Concurrency Cap First, Autoscale Deferred)

Date: 2026-07-09
Status: Accepted

## Context

The AI Service (DEV-31) runs faster-whisper `small.en` with CPU inference in a Docker
container. It transcribes operator voice notes. A question arose during planning: can
this service scale with usage?

Two constraints shape the answer.

First, deployment. During the capstone the whole stack runs on one team mini-PC through a
single `docker-compose.yml`. SAIT IT confirmed no hosted infrastructure during the
project (ADR 0016). Docker Compose has no usage-based autoscaling. `docker compose up
--scale ai=N` sets a fixed replica count; it does not react to CPU load or queue depth.

Second, the workload. Transcription is CPU-bound. On a single box, adding `ai` replicas
does not raise throughput; the replicas contend for the same physical cores. Under
concurrent load this makes each request slower and threatens the 5-second NFR in DEV-31,
rather than serving more requests.

The AI Service is assistive only (OHS s.257) and its failure must not block inspection
submission; the caller falls back to typed notes. So the goal is not maximum throughput.
The goal is to protect the per-request latency NFR under load and stay within the box.

## Decision

For the capstone deployment, do not autoscale the AI Service. Protect it with load
control instead. Apply three levers together, at three layers.

1. Resource bound (container/OS layer). Give the `ai` container an explicit CPU and memory
   bound in Compose (`cpus`, `mem_limit`) so it does not starve the other services.

   `cpus` is a ceiling, not a reservation. Compose maps it to a CFS quota (`cpu.max`), which
   caps how much CPU time the container may consume and guarantees it nothing. Docker offers no
   true CPU reservation here: `deploy.resources.reservations.cpus` is ignored outside Swarm (it
   sets no cgroup value at all). The only defence against contention is relative weight, so the
   container also carries `cpu_shares: 2048`, which puts it ahead of the default 1024 when the
   box is oversubscribed. A hard partition would require pinning every service with `cpuset`,
   which is out of scope for the capstone. See the consequence below.

2. Concurrency cap (application layer). Gate transcription behind a semaphore or bounded
   queue inside the service. Size the cap to the CPU ceiling, so a saturated cap cannot ask for
   more CPU time than the container may use. Requests beyond the cap wait briefly or receive 429. This is the lever that actually defends the 5-second NFR.

3. Non-blocking background transcription (interaction layer). Transcription runs off the
   inspection-submit critical path. The caller invokes the service without blocking the
   operator, shows a non-blocking "transcribing" state, and lets the operator continue the
   checklist. The transcript populates an editable note field for review before submit
   (`notesSource` VOICE_TRANSCRIBED, then VOICE_EDITED if changed). If the service is slow,
   at capacity (429), or down, the field stays editable and the operator types instead.
   Submit is never blocked. Under this model the 5-second latency figure is a backend
   performance target at nominal load, not a user-facing blocking gate; exceeding it
   degrades to "the transcript arrives late", not an error shown to the operator.

The CPU ceiling and the concurrency cap are one number, not two: Compose derives both the
container's `cpus` ceiling and `AI_MAX_CONCURRENCY` from a single variable (`AI_CPUS`), so an
edit to one cannot silently desync the other.

The AI Service box now hosts a second CPU consumer: the on-prem Advisory Check model
(ADR 0018) reads the transcript text and runs on the same mini-PC. The bound and cap
above are re-derived to cover both consumers. Transcription and the advisory are sequential
per note (transcribe first, then advise), and the advisory is non-blocking, so the advisory
runs behind transcription in the shared pool rather than requiring dedicated headroom. The
combined load is validated by a benchmark on the actual mini-PC (faster-whisper small.en
int8 plus the candidate advisory model Q4, under 2 to 4 concurrent operations, measuring
latency and thermal throttling).

Defer true usage-based autoscaling to after handover, when an orchestrator exists. Azure
Container Apps with KEDA is the recommended target: it can scale on HTTP concurrency or
queue length. At that point, moving transcription from a synchronous POST to a job queue
with a worker pool becomes worthwhile and can be revisited in a superseding ADR. Any such
design keeps audio on SAIT-controlled infrastructure; audio is biometric PII under FOIP
and is never sent to an external AI API.

### Benchmark result and derived cap (2026-07-10)

The benchmark ran on the mini-PC (Ryzen 7 5825U, CPU only): faster-whisper small.en (int8)
plus Qwen2.5-1.5B-Instruct (Q4_K_M), transcribe plus advise per note, worst case (every worker
running flat out on its own model instances), 20 iterations per worker.

| Concurrency | transcribe p95 | advisory p95 | combined p95 | CPU temp max |
| ----------- | -------------- | ------------ | ------------ | ------------ |
| 2           | 3.5 s          | 275 ms       | 3.7 s        | 69.5 C       |
| 3           | 4.8 s          | 399 ms       | 5.1 s        | 78.9 C       |
| 4           | 6.1 s          | 378 ms       | 6.6 s        | 82.6 C       |

Findings. No thermal throttling at any level (max 82.6 C, well below the roughly 95 C trip), so
heat is not the binding constraint. The advisory stays cheap (p95 under 400 ms, 3 to 8 percent
of the combined time) and is never the bottleneck; its worst outlier (2.6 s) stays inside the
advisory fail-open timeout. Transcription is the bottleneck and grows with concurrency as
workers share fewer cores, crossing the DEV-31 5-second target between 3 and 4 concurrent.
Throughput is flat (about 0.6 operations per second), which matches the single-box premise.

Derived cap. Set the concurrency cap (semaphore) to 2, with the container CPU ceiling matched so
two concurrent transcriptions cannot ask for more CPU time than the container may use. The
numbers below were measured on an otherwise idle box, so they hold at the ceiling; a contended
box gives the container less and the figures degrade. At cap 2 both transcription
(3.5 s p95) and combined (3.7 s p95) sit inside the 5-second target with margin. Requests beyond
the cap wait briefly or receive 429 and fall back to typed notes. Cap 3 is a burst ceiling
(combined p95 just over 5 s); cap 4 exceeds the target. Full numbers are in
services/ai/benchmark/RESULTS.md.

## Consequences

Positive: the 5-second NFR is defended on a single CPU box without an orchestrator. Load
control is declarative (Compose limits) plus a small in-process gate, both within the
capstone toolchain. The three levers do not conflict; they compose.

Negative: the service does not scale out under the capstone deployment. Sustained load
above the concurrency cap degrades to waiting or 429, and callers fall back to typed
notes more often. Throughput is bounded by the mini-PC core count until handover. The
full asynchronous form (job queue plus worker pool) is not built now, so a later move to
autoscaling will require that additional work.

Negative: the benchmarked latency holds only while the container can actually reach its CPU
ceiling. `cpus` caps the container, it does not protect it, so a noisy neighbour on the mini-PC
(a CI build, a database restore) can push the container below 2 cores of real CPU time while the
cap still admits 2 concurrent transcriptions. `cpu_shares` biases the contention but does not
remove it. The visible failure is slow transcripts, not errors: the caller degrades to typed
notes. If this shows up in practice, pin the services with `cpuset` and re-run the benchmark.

## Alternatives Considered

Compose `--scale` for the AI Service. Rejected. It sets a static replica count, not
usage-based scaling, and on one box the replicas contend for the same cores, lowering
per-request latency rather than raising throughput.

Docker Swarm. Rejected. It is close to Compose but still has no built-in autoscaling; it
adds orchestration surface the capstone does not need and does not solve the single-box
core limit.

Kubernetes with HPA now. Rejected for the capstone. It provides real autoscaling but is
heavy to run and operate on a single mini-PC and exceeds the project scope. It remains a
possible post-handover path, though Azure Container Apps is the lighter fit.

Job queue plus worker pool now. Rejected for the MVP. It is the right shape for
autoscaling later, but it conflicts with the current synchronous POST acceptance
criterion in DEV-31 and adds a broker and worker lifecycle the capstone does not yet
need. Staged for the post-handover autoscaling work.
