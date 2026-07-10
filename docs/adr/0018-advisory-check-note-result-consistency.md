# ADR 0018: Assistive Advisory Check on Note/Result Consistency (On-Prem SLM, Text-Only, Ephemeral)

Date: 2026-07-09
Status: Accepted

## Context

The client asked for an AI feature. The feature chosen is an Advisory Check that flags a
possible contradiction between an Operator's pass/fail marks and their free-text note: for
example, a note that describes a defect on an item the Operator marked as passing. See the
Advisory Check term in CONTEXT.md.

Three constraints shape the design.

First, OHS s.257. A competent human completes the Inspection. The AI is assistive only and
never decides pass or fail (CONTEXT.md, Operator and Inspection Result). An automated
component that interprets a note and surfaces a judgment-adjacent prompt raises this concern
regardless of whether it is built with rules or with a model.

Second, FOIP. Audio is biometric PII and stays on-prem; the existing AI Service transcribes
voice on the team hardware for that reason (faster-whisper). Inspection note text is also
inspection data. Sending inspection data to a consumer external AI is a third-party
disclosure and is prohibited (CLAUDE.md, AI_USAGE_GUIDE).

Third, deployment. During the capstone the stack runs on the team mini-PC and SAIT provides
no Azure environment; Azure is a post-handover path (ADR 0016).

A small language model (SLM) is a machine-learning model, so it satisfies the client's
request for an AI feature, and it can run on-prem. Running it on-prem keeps note text on
SAIT-controlled infrastructure, so the FOIP third-party-disclosure question does not arise
at all, and the feature can run on real note text during the capstone and the pilot. This is
consistent with why faster-whisper already runs on-prem.

Hardware for the on-prem path is known. The mini-PC is an AMD Ryzen 7 5825U (8 cores, 16
threads, Zen3, AVX2, no usable discrete GPU), 32 GB DDR4, NVMe. Inference is CPU-only. The
box already runs faster-whisper and is CPU-bound (ADR 0017). The advisory model is a second
CPU consumer on the same box.

## Decision

Build the Advisory Check as an on-prem machine-learning feature.

Placement. The advisory model runs on the team mini-PC, in or alongside the AI Service. Note
text never leaves SAIT-controlled infrastructure, so the FOIP disclosure question does not
arise and the feature works on real note text during the capstone and pilot.

Model size. A small classifier (encoder, for example DistilBERT/MiniLM scale) or a quantized
generative SLM of 3B parameters or fewer (for example Qwen2.5-1.5B/3B, Llama-3.2-1B/3B,
Gemma-2-2B), CPU int8 or Q4. No model of 7B or larger, which is too heavy for this CPU. The
exact model, and whether to use a trained classifier or a prompted generative SLM, is a
ticket-level decision validated by benchmark.

Pipeline. faster-whisper produces the transcript on-prem, then the on-prem advisory model
reads that text and returns a signal that the note may contradict the mark. The two steps are
sequential per note, not simultaneous. The PWA surfaces the result as a neutral, dismissible
prompt at the review-before-submit step.

s.257 boundary. The Advisory Check is advisory only. It never blocks submission, never changes
the Inspection Result, uses neutral wording, and the Operator may dismiss it. The model output
is ephemeral: nothing about the advisory is written to the Inspection or to the Audit Chain.
The Operator's final marks plus Attestation remain the sole record. If the advisory model is
slow or unavailable, the prompt simply does not appear; it never blocks or delays submission.

Hardware budget. The advisory model shares the CPU with faster-whisper. ADR 0017's resource
reservation and concurrency cap are re-derived to account for two CPU consumers. Because the
steps are sequential per note and the advisory is non-blocking, the advisory runs behind
transcription in the shared pool rather than needing dedicated headroom. Feasibility is
confirmed by a benchmark on the actual mini-PC: faster-whisper small.en (int8) plus the
candidate advisory model (Q4) under 2 to 4 concurrent operations, measuring latency and
thermal throttling. Development and model comparison may use a workstation GPU, but the
production judgment is CPU latency on the mini-PC.

Azure Foundry as a conditional upgrade. A cloud model (Azure AI Foundry) is retained only as
a possible post-handover upgrade if the on-prem model's quality or throughput proves
insufficient. It is not part of the delivered capstone path. If it is ever adopted, note text
leaves the box, which reintroduces the FOIP conditions verified against Microsoft "Data,
privacy, and security for Foundry Models sold by Azure" (2026-05-18): a Standard (regional)
deployment in a Canada geography (not Global or DataZone), and approved modified abuse
monitoring (ContentLogging=false). Those conditions gate any real note text sent to Foundry.

## Consequences

Positive: the client gets a genuine machine-learning AI feature. Note text never leaves
on-prem, so the FOIP third-party-disclosure question does not arise and the feature runs on
real data during the capstone and pilot, with no personal-versus-SAIT tenant gate. The design
is consistent with on-prem faster-whisper. The AI stays out of the legal record (ephemeral),
so the s.257 posture is maximally defensible. No cloud cost and no network dependency.

Negative: the feature adds a second CPU consumer to a CPU-bound single box, so ADR 0017's
budget must be re-derived and the mini-PC must be benchmarked before the model size is fixed.
A small on-prem model is weaker than a frontier cloud model on subtle or paraphrased
contradictions. The team hosts and must vet another model runtime (AI_USAGE_GUIDE §1 flags
self-hosted models for team vetting). If higher quality is later required, moving to Foundry
reintroduces the FOIP conditions and a network dependency.

## Alternatives Considered

Azure Foundry cloud model as the primary path. Rejected as primary. It gives higher model
quality and zero local compute cost, but it sends inspection note text off-prem, which raises
the FOIP disclosure question and forces two conditions (regional deployment, modified abuse
monitoring) plus a personal-versus-SAIT tenant gate that blocks real data until handover. An
on-prem SLM is machine learning, so it satisfies the client, keeps text on-prem, and runs on
real data now. Foundry is retained as a conditional post-handover upgrade.

Rule/lexical Advisory Check (defect-keyword plus negation dictionary). Rejected. The client
asked specifically for an AI feature and a deterministic rule engine is not machine learning.
It stays as a fallback only; the assistive-only limit would apply to it unchanged.

Send audio to any model, cloud or local. Rejected for the cloud case (audio is biometric PII
and must stay on-prem) and unnecessary for the local case. Only the derived transcript text is
used, and on the on-prem path not even the text leaves the box.

Store the advisory outcome in the Audit Chain as informed-override evidence. Rejected for the
MVP. It places model-derived output in the immutable legal record and touches the no-PII
property of the Audit Chain, which needs heavy care (AI_USAGE_GUIDE). Deferred to a separate
decision if the evidence is later needed.

Block submission or auto-change the result on a detected contradiction. Rejected. It violates
OHS s.257, because the AI would decide, and the assistive-only rule in CONTEXT.md and
CLAUDE.md.
