# ADR 0028: Advisory Check, Retargeted (Defect Categorization on Fail Notes plus Manager-Side Defect Summarization)

Date: 2026-08-17
Status: Accepted (amends ADR-0018)

## Context

ADR 0018 built the Advisory Check to flag one thing: a note that describes a defect on
an item the Operator marked PASS. The trigger requires a PASS mark and a non-empty note
(`services/ai/advisory.py`, `assess_note`: it returns early unless `item_marked_pass`
and `note_text` are both present).

The PWA no longer captures notes on passing items. Notes, voice, and photos now live only
in the failure-documentation flow, folded into the checklist screen. So the trigger
condition (PASS mark plus note text) is never satisfied. The model is not consulted, and
the feature is dead code. The client asked for an AI feature; a feature that never runs
does not satisfy that request.

Two facts frame the fix.

First, the data moved. Free-text and voice notes now exist only on FAIL items. Any
retargeted advisory must read the data that exists, which is fail notes.

Second, the constitutional parts of ADR 0018 still hold and are not in question: an on-prem
SLM, text-only, no audio off-box, the ADR 0017 CPU budget and serialized inference, fail-open
and non-blocking, and Azure Foundry retained only as a conditional post-handover upgrade.
This ADR retargets what the model reads and adds a second use. It does not reopen those
decisions.

## Decision

Keep the on-prem SLM. Change what it reads, and add a manager-side batch use. Two parts.

### Part 1: Operator flow. Suggest a defect category on a FAIL note (assistive).

When an Operator marks an item FAIL and dictates or types a note, the on-prem SLM reads the
note text and suggests a defect category and, optionally, a coarse severity. The PWA surfaces
the suggestions as dismissible chips at the review-before-submit step. The Operator confirms,
edits, or ignores them. The confirmed category is the Operator's, not the model's.

The trigger inverts: `assess_note` runs on FAIL items with a note, not PASS items. The
contradiction check from ADR 0018 (note describes a defect on a PASS mark) is retired, not
re-homed, because the input it needed no longer exists.

Persistence changes from ADR 0018, with a boundary. The raw model output stays ephemeral. The
Operator-confirmed category persists as a field on the `inspection_responses` row, written once
at submit with the rest of the response and sealed the same way (immutable row, part of the
canonical content hash, mirroring ADR 0023 for photo references). What persists is an
Operator-confirmed value, not model output, so the s.257 posture holds: the human made the
call, the record stores the human's call. No model-derived text enters the Audit Chain.

### Part 2: Manager flow. Summarize and cluster fail notes (batch, off the operator path).

After submission, the same on-prem model runs in batch on accumulated fail notes to produce
manager-facing views: a shift or period defect summary, recurring-issue clusters per equipment,
and a draft maintenance work-order description. This runs on the dashboard side, out of the
operator latency path, on data that already exists.

This use does not touch pass or fail, does not run during an Inspection, and does not gate
submission, so OHS s.257 does not bear on it. Its output is a derived, regenerable view. It is
not written to the Audit Chain and not written to the immutable Inspection tables. It is
computed from the sealed fail notes on demand or cached, and can be regenerated from source at
any time.

### s.257 boundary (both parts)

The Advisory Check remains assistive only. It never decides pass or fail, never blocks or
delays submission, uses neutral wording, and is dismissible. Part 1 suggests a label the human
confirms. Part 2 does not touch the pass/fail judgment at all. If the model is slow or
unavailable, Part 1 shows no chips and Part 2 shows no summary; neither blocks anything.

## Consequences

Positive: the AI feature runs again, on data that exists, in both the operator flow (Part 1)
and the manager flow (Part 2). Part 2 sidesteps the s.257 tightrope entirely because it never
touches the result, and batch timing fits the ADR 0017 CPU budget without competing with
transcription latency. Structured defect categories improve the dashboard and speed
maintenance work-order creation. Text stays on-prem, so the FOIP posture from ADR 0018 is
unchanged.

Negative: adding a persisted category field to `inspection_responses` changes the canonical
content hash, so dev and dev-staging need a clean re-seed, the same operational cost ADR 0023
incurred. The category taxonomy is a new decision (fixed enum versus model-open labels) and
must be fixed at ticket level, validated on the mini-PC benchmark. Part 2 is a new surface on
the dashboard with its own tickets. A small on-prem model produces weaker category and cluster
quality than a frontier model; the Foundry conditional-upgrade path from ADR 0018 still applies
if quality proves insufficient.

Follow-on updates required: the Advisory Check term in CONTEXT.md still describes the retired
contradiction use and must be rewritten to the categorization and summarization use. The
`assess_note` signature and the PWA review-step wiring change. A schema migration adds the
category field. All are ticket-level work under this ADR.

## Alternatives Considered

Restore optional notes on PASS items to keep the contradiction check alive. Rejected. It
re-adds the input the PWA deliberately removed and re-encourages notes on passing items, which
slows the operator flow. The categorization use delivers value on the data that now exists
without that cost.

Auto-assign the defect category without Operator confirmation. Rejected. An unconfirmed
model label on the record puts model output into inspection data and weakens the s.257 posture.
Operator confirmation keeps the stored value human-owned.

Free-text categorization with no model (manual dropdown only). Rejected as the AI feature, kept
as the fallback. A manual dropdown is not machine learning and does not satisfy the client's
request. It stays available when the model is unavailable, consistent with fail-open.

Write the Part 2 summary into the Audit Chain or the Inspection tables. Rejected. It places
model-derived, regenerable output into the immutable legal record, the same objection ADR 0018
raised for advisory outcomes. The summary is a derived view, computed from sealed source, not a
record of what happened.

Keep Part 2 in the operator flow (per-inspection, at review). Rejected. Summarization and
clustering need the accumulated corpus, not one inspection, and running it inline would add a
second model call to the latency-sensitive submit path. Batch on the manager side is the right
placement.
