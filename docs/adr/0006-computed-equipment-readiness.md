# ADR 0006: Computed Equipment Readiness Without Shift Windows

Date: 2026-06-09
Status: Accepted

## Context

The original data model gave each Inspection a `shift_window_id` and defined the core
safety rule as "Equipment cannot become READY without a passing Inspection within the
shift window." The term "shift window" was never defined: no document said what a shift
is, who opens one, how long it lasts, or what resets Equipment to AWAITING_INSPECTION
when one ends. The rule "status defaults to AWAITING_INSPECTION at shift start" implied
a scheduled job that resets all ten machines on a timer. No such job existed in the
architecture, the container list, or the sprint plan.

The SAIT MAT lab is a training environment, not a multi-shift factory. Equipment is
inspected once per day before first use. A shift abstraction imported from industrial
settings did not match the actual operation and dragged in a scheduler, calendar
configuration, and a reset job the team would have to build and test.

## Decision

Do not model shifts. Remove `shift_window_id` from the Inspection entity.

An Inspection is valid for the calendar day on which it is submitted, in lab-local time
(America/Edmonton). Equipment readiness is computed at read time, not stored as a
scheduled state:

Equipment is READY if and only if all of the following hold.

1. A passing Inspection exists whose `submitted_at` falls on the current calendar day,
   lab-local.
2. That Inspection's `submitted_at` is at or after the Equipment's
   `readiness_baseline_at` watermark.
3. The Equipment status is not OUT_OF_SERVICE or RETIRED.
4. The Equipment has no open blocking Defect.

OUT_OF_SERVICE and RETIRED are stored, sticky states that override the computed result.
AWAITING_INSPECTION is not written by any job; it is what Equipment reads as when no
passing Inspection satisfies the conditions above.

Return-to-service sets `readiness_baseline_at = now()`. This closes the same-day repair
case: a passing Inspection from earlier the same day predates the new watermark, so it
no longer restores READY, and a fresh Inspection is required, as OHS intends.

The calendar-day check and the watermark check are independent and both live in the
read query. The calendar-day check handles daily expiry without a midnight job. The
watermark handles intra-day disruptions (return-to-service).

## Consequences

Positive: no scheduler, no nightly reset job, no shift table or shift configuration.
Daily expiry and the same-day repair case are both handled by one read query. The model
matches how the lab actually operates.

Negative: readiness is derived, not a stored fact, so a reader must run the query rather
than read a single status column for the READY/AWAITING distinction (OUT_OF_SERVICE and
RETIRED remain stored). The system cannot state "this Inspection belonged to the Tuesday
night shift" as a stored fact, because shifts are not modeled. Equipment gains one stored
column, `readiness_baseline_at`.

## Alternatives Considered

Stored shift windows: a first-class Shift entity with open and close times. Rejected. It
requires a scheduler to open shifts and a job to reset Equipment, configuration the lab
does not need, and it models a concept (multi-shift operation) that does not exist in a
training lab.

Superseded-inspection flag: on return-to-service, mark prior passing Inspections as
superseded and query for non-superseded ones. Rejected. It mutates an Inspection after
submission, which violates the immutability of the legal record (ADR 0007 and the audit
posture depend on Inspections never being written after submit). The watermark places
the mutable fact on Equipment, which is allowed to change, and leaves the Inspection
untouched.
