# ADR 0028: Advisory Check, Retargeted (Defect Categorization on Fail Notes)

Date: 2026-08-17
Status: Accepted (amends ADR-0018)

Revised 2026-08-17: the manager-side batch summarization use (previously Part 2) is dropped.
See "Out of scope" below. This ADR now covers the operator-flow categorization use only.

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
This ADR retargets what the model reads. It does not reopen those decisions.

## Decision

Keep the on-prem SLM. Change what it reads.

### Operator flow: suggest a defect category on a FAIL note (assistive).

When an Operator marks an item FAIL and dictates or types a note, the on-prem SLM reads the
note text and suggests one defect category. The PWA surfaces the suggestion as a dismissible
chip at the review-before-submit step. The Operator confirms it, changes it, or dismisses it.
The confirmed category is the Operator's, not the model's.

The category is a failure mode, not a subsystem. The checklist item already encodes the
subsystem: a FAIL on the "wire rope is neatly spooled on the drum; no oil leaks" item is
already known to be about the hoist rope, so classifying by subsystem would mostly re-derive
the item and would not need a model. What the item does not encode is how the thing failed,
which lives only in the note: the same item fails for an oil leak, a frayed strand, or tangled
spooling. The model classifies that failure mode from the note text. It is the one axis that
needs to read the note and is not already in the template.

The model does not suggest severity. Severity (BLOCKING or WARNING) is fixed by the checklist
item and drives the Inspection Result. Letting the model propose it would both duplicate the
template and edge an assistive tool toward the pass/fail judgment s.257 reserves for the human.
The "coarse severity" idea from an earlier draft of this ADR is dropped for this reason.

The trigger inverts: `assess_note` runs on FAIL items with a note, not PASS items. The
contradiction check from ADR 0018 (note describes a defect on a PASS mark) is retired, not
re-homed, because the input it needed no longer exists.

Persistence changes from ADR 0018, with a boundary. The raw model output stays ephemeral. The
Operator-confirmed category persists as a field on the `inspection_responses` row, written once
at submit with the rest of the response and sealed the same way (immutable row, part of the
canonical content hash, mirroring ADR 0023 for photo references). What persists is an
Operator-confirmed value, not model output, so the s.257 posture holds: the human made the
call, the record stores the human's call. No model-derived text enters the Audit Chain.

The confirmed category persists only on `inspection_responses`, not on `defects`. A category
applies to every FAIL note, but only a BLOCKING FAIL opens a Defect, so fleet-wide failure-mode
analysis has to read the responses regardless; and `defects` is mutable (its status changes)
while the sealed category must not be. The dashboard joins a Defect back to its response by
(inspection_id, item_key) when it needs the category.

### Category taxonomy

The categories are a fixed enum, not model-open labels: LEAK, DAMAGE, WEAR, MALFUNCTION,
MISSING, CONTAMINATION, NOISE_VIBRATION, OTHER. A fixed set keeps the dashboard groupable (open
labels fragment "leak" from "leaking"), gives the small SLM a bounded pick-one task it can do
reliably, and validates cleanly as a sealed enum value. The model suggests one of the seven
substantive values or abstains; it does not suggest OTHER. OTHER is an Operator-only choice for
a note that fits none of the seven. The enum is defined once and shared: the Postgres enum, the
Zod submit validation, and the PWA chip set read the same source.

### s.257 boundary

The Advisory Check remains assistive only. It never decides pass or fail, never blocks or
delays submission, uses neutral wording, and is dismissible. It suggests a label the human
confirms. If the model is slow or unavailable, the PWA shows no chips, and nothing is blocked.

### Out of scope

A manager-side batch use was considered: run the same model on accumulated fail notes to
produce a period defect summary, recurring-issue clusters per equipment, and a draft
maintenance work-order description. It is dropped from this ADR.

The reason is model capability, not compliance. The operator-flow use is single-label
classification, which fits the small on-prem SLM chosen in `docs/advisory-check-model-selection.md`.
The manager-side use is generative long-form output plus clustering. Summarization and
work-order drafting stretch a 1.5B Q4 model well past the binary-judge task it was selected for,
and "recurring-issue clusters per equipment" needs semantic grouping the current llama.cpp GGUF
runtime has no embedding path for. Building a dashboard surface on top of output of uncertain
quality is premature. If a manager-side summary is wanted later, it starts with a model-capability
spike on the mini-PC benchmark and its own ADR, and the Azure Foundry conditional-upgrade path
from ADR 0018 applies if a small on-prem model proves insufficient.

## Consequences

Positive: the AI feature runs again, on data that exists, in the operator flow. Structured
defect categories improve the dashboard and speed maintenance work-order creation downstream.
Text stays on-prem, so the FOIP posture from ADR 0018 is unchanged.

Negative: adding a persisted category field to `inspection_responses` changes the canonical
content hash, so dev and dev-staging need a clean re-seed, the same operational cost ADR 0023
incurred. The category taxonomy is fixed above (a closed failure-mode enum); its per-note
accuracy on the small model still needs validation on the mini-PC benchmark, with OTHER and
fail-open covering the notes it misses. A small on-prem model produces weaker category quality
than a frontier model; the Foundry conditional-upgrade path from ADR 0018 still applies if
quality proves insufficient.

Follow-on updates required: the Advisory Check term in CONTEXT.md still describes the retired
contradiction use and must be rewritten to the categorization use. The `assess_note` signature
and the PWA review-step wiring change. A schema migration adds the category field. All are
ticket-level work under this ADR.

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
