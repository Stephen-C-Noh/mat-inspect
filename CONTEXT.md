# MAT-Inspect Domain Glossary

This file is the shared language for the MAT-Inspect domain. It is a glossary, not
a spec. It contains no implementation detail. When a term here conflicts with how
code or conversation uses a word, the conflict gets resolved and this file updated.

Lab-local time means America/Edmonton (Mountain), the timezone of SAIT Main Campus.

---

## Equipment

A single piece of high-risk powered equipment tracked by the system. Ten exist at
launch: 4 overhead cranes, 2 trucks, 1 electric pallet jack, 3 forklifts. Each
carries a printed QR sticker holding its asset tag.

## Equipment Status

The operational state of one piece of Equipment.

- **Ready**: cleared for use today. Equipment is Ready only if it has a passing
  Inspection that is both dated the current calendar day (lab-local) and performed
  after the most recent return-to-service, and it has no unresolved blocking Defect.
  A passing Inspection from earlier the same day does not by itself restore Ready
  after a return-to-service; a fresh Inspection is required.
- **Awaiting Inspection**: no valid Inspection for today. This is the default a
  piece of Equipment reads as at the start of each calendar day. It is not written
  by a scheduled job; it is the absence of a current passing Inspection.
- **Out of Service**: a blocking Defect is open. A human Supervisor must approve
  return to service. Sticky: it persists until a Supervisor acts, regardless of date.
- **Retired**: permanently removed from service.

## Inspection Validity

An Inspection is valid for the calendar day on which it is submitted, lab-local.
Equipment is inspected once per day before first use. There is no "shift window".
The system does not model shifts. "Shift window" was considered and rejected: the
lab is a training environment, not a multi-shift factory, and daily validity removes
the need for shift scheduling and equipment-reset jobs.

## Inspection

The record of one operator completing the checklist for one piece of Equipment on
one day. Immutable once submitted. Identifies the human Operator who performed it.
Corrections are new linked records, never edits.

## Attestation

The Operator's confirmation that they performed the Inspection and stand behind its
answers. This is the legal signature required by OHS Part 6 ("identify the person
doing the work"). It is not a cryptographic signature. It consists of: the Operator's
authenticated identity, an explicit confirm action taken after reviewing a summary of
their answers, and a server-recorded timestamp. Tamper-evidence over the record comes
from the append-only audit chain, not from a per-record signature. The earlier
client-computed HMAC signature is dropped: holding the key on the client proved
nothing, and the audit chain already provides integrity.

## Inspection Result

Whether an Inspection passed. Every checklist item is a yes/no judgment made by the
Operator. The Operator records any abnormal reading or note as free text against an
item; the system does not store numeric measurements as structured, thresholded data.
The system, not the client, derives the overall result: it maps each item answer to
pass or fail and combines them using the item severities defined in the checklist
template. A blocking failure makes the whole Inspection a blocking failure. The
client cannot declare an Inspection passed; the server recomputes it.

## Operator

A competent human (Lab Tech) who performs the visual Inspection. Alberta OHS s.257
requires the Inspection be completed by a competent human. The AI is assistive only
and never decides pass or fail.

## Advisory Check

An assistive prompt that surfaces a possible inconsistency for the Operator to
consider, for example a note describing a defect on an item the Operator marked as
passing. It is advisory only: the Operator may act on it or dismiss it. It never
determines the Inspection Result, never blocks submission, and leaves no trace on the
Inspection record. Consistent with OHS s.257, the competent human makes every pass or
fail judgment; an Advisory Check informs that judgment, it does not make it. Whether an
Advisory Check is computed by rules or by a machine-learning model does not change this:
the assistive-only limit binds the role, not the implementation.

## App Role

An authorization role Entra ID issues in the access token `roles` claim. Four exist:
Operator, Supervisor, Manager, Admin. core-api gates each endpoint on these values; a
user may hold more than one. Auditor is not an App Role. An Auditor is a reporting
persona who reads the PDF audit reports built from the Audit Chain; they do not call a
role-gated endpoint. This was settled in DEV-30.

## Audit Chain

The append-only, hash-linked log that is the legal record of what happened in the
system. With the per-record HMAC dropped, this is the sole tamper-evidence mechanism.
It proves two things for each Inspection: that the record exists in a fixed order
(existence and sequence), and that its answers have not changed since submission
(content). Content is bound by sealing a digest of the full Inspection into the
chained event, not by storing the answers in the log. The log holds no PII.

## Defect

A problem found during an Inspection. Has a severity. A blocking Defect forces the
Equipment to Out of Service and requires Supervisor return-to-service approval.

## Photo Evidence

An image the Operator captures as evidence against one checklist item, for example a
photo of the failed part. It belongs to the individual Inspection answer, not to the
Inspection as a whole and not to the Defect: a warning-severity photo item opens no
Defect, and several blocking failures collapse into one aggregate Defect, so neither
the Inspection nor the Defect can hold per-item evidence faithfully. The bytes live on
SAIT-controlled storage (the same FOIP boundary as voice clips); the Inspection answer
holds only a reference to them. The reference is part of what the Audit Chain seals, so
a swapped or removed photo reference is tamper-evident like any other answer content.
