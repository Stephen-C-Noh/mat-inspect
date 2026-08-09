# ADR 0025: The operator PWA tolerates short network drops and is not offline-first

- Status: Accepted
- Date: 2026-07-26
- Deciders: Stephen Noh
- Related: ADR 0006 (computed equipment readiness), ADR 0007 (attestation over HMAC), ADR 0008 (transactional outbox and content digest), ADR 0009 (idempotency key store), DEV-125, DEV-129

## Context

The connectivity scope of the operator PWA was decided during the v5 revision of
`docs/ARCHITECTURE.md`: full offline-first was downgraded to short-drop tolerance. The
decision was recorded only in prose, in Section 10.1, in the revision note at the top of
that document, and in Section 9 of `docs/FRS.md`. No ADR was written.

The prose drifted. `docs/FRS.md:226` still described an IndexedDB offline queue that
syncs when the network returns, and Section 13.2 still promised 24 hours of partial
state in IndexedDB with a resume offer on next login. Both were survivors of the
pre-v5 design and neither matched Section 9.

The drift cost real work. Assignment 2 test cases were written against the FRS, so
TC063 ("complete a checklist while offline, reconnect, expect automatic sync") was a
transcription of the withdrawn requirement. During A3 execution those cases sat as
Blocked and were reported as an environment problem, when the product behaved as
designed (DEV-129).

The same lines are a handover risk. The FRS is part of the governance package SAIT
receives. A reader who lands on them believes the delivered system queues inspections
offline. It does not. An operator who believes it does could treat a submission as
safely queued when it was never recorded, which is an OHS record-keeping exposure.

This ADR records the decision, its reasons, and the conditions for revisiting it, so
there is one citable answer to "why does this not work offline".

## Decision

The operator PWA is tolerant of short network drops. It is not an offline-first
application. It does not queue inspections for later synchronisation.

The mechanism is specified in FRS Section 9.1 and ARCHITECTURE Section 10.1:

1. The submission payload is held in memory and in `sessionStorage`, so a page load
   during submission does not lose it.
2. The `Idempotency-Key` is generated client-side at the moment of tap and reused on
   every retry, so a retry replays the original write instead of creating a second
   inspection (ADR 0009).
3. The POST is retried with exponential backoff: 1s, 2s, 4s, 8s. The backoff caps at 8s
   and retries continue at that interval.
4. After 15 minutes without success, retrying stops and the operator sees a clear
   "submission failed, retry?" state with a manual retry action. The payload is still
   preserved; it is not discarded.
5. Photo and voice-clip uploads use the same 1s, 2s, 4s, 8s backoff and then surface a
   user-visible error. They do not get the 15-minute window: the operator is at the
   screen and can retry the capture directly, whereas a submission represents an already
   completed inspection and is worth holding on to.
6. Checklist templates are cached by the browser's HTTP cache (1-hour TTL). There is no
   service worker. On a cold start with no connectivity the PWA shows a "no connection"
   error rather than rendering a checklist from stale cache, because an inspection
   performed against an out-of-date template is a compliance risk (FRS 9.2, 9.3).

In-progress inspections live in `sessionStorage` for the duration of the browser
session. A hard device failure ends the session and the in-progress inspection is lost.

## Amendment (2026-08-08, DEV-144)

Point 6 above and "The offline foundation does not exist" under Reasons said the PWA has no
service worker. DEV-144 added one, for installability only: Chrome gates the home-screen
install prompt on a service worker with a fetch handler. It does not change this ADR's
decision. `apps/pwa/public/sw.js` passes every request straight to the network, uncached; it
has no Cache Storage read or write path. A device with no connectivity still gets the "no
connection" error in point 6, not a cached checklist. Do not add caching to that file without
first amending this decision, not just the file's own comment.

## Reasons

### The client bought the descope with a WiFi commitment

Reliable lab WiFi is not an assumption the project made on its own. Section 6 of the
client meeting questions makes WiFi coverage at each of the 10 equipment locations a
hard requirement for project go-ahead, verified by a signal survey. Offline-first was
descoped against that commitment. Reinstating it would spend 3 to 5 days of sprint
capacity re-solving a problem the client agreed to solve in the lab.

### Offline submission conflicts with computed readiness

ADR 0006 computes equipment readiness at read time from `submitted_at`, which the server
sets. An inspection performed offline at 07:00 and synchronised at 15:00 carries a
`submitted_at` of 15:00. That leaves two options, both bad:

- Accept the server timestamp. The equipment reads as AWAITING_INSPECTION all morning
  while the operator believes it was inspected. Under the state machine it was not
  READY, so the morning's operation is recorded as operation without a valid inspection.
- Accept a client-supplied `submitted_at`. This is exactly the unverifiable client-side
  assertion that ADR 0007 removed and that the ADR 0008 content digest seals against.

Offline-first therefore is not an additive feature. It requires deciding whose clock is
authoritative for an OHS record, which would amend ADR 0006 and weaken ADR 0007.

### Authentication is online-only

Token acquisition goes through MSAL against Entra ID (ADR 0002, ADR 0012). A device with
no connectivity cannot acquire an access token, so a queued submission cannot be sent
until the operator is back online and re-authenticated. Offline queueing does not remove
the online dependency; it defers it and hides it from the operator.

### The offline foundation does not exist

`apps/pwa` has no service worker, no web app manifest, and no client-side durable
storage. Offline-first is not "add IndexedDB" on top of the current app; it is the app
shell, the cache strategy, the queue, and the blob handling for photos, built from
nothing. The 3-to-5-day estimate in ARCHITECTURE Section 10.1 reflects that.

### `sessionStorage` over `localStorage` on the operator's device

Devices are individually assigned per operator, not shared between operators.
`sessionStorage` still bounds a draft's defect notes and evidence photos to the browser
session rather than leaving them on the device indefinitely: a lost or stolen phone, or
one later reassigned or sold, does not carry the last inspection's PII with it.
`localStorage` would survive a device power-off and satisfy the old FRS 13.2 promise, but
it would need explicit expiry and PII-retention handling (FOIP) to avoid that exposure.
The cross-session resume case is deferred to v2 along
with the rest of offline-first.

## Consequences

An operator who loses the device mid-inspection re-answers the checklist. A page load,
a reload, or an interactive token renewal does not lose it. A network drop of up to 15
minutes during submission is transparent or recoverable.

The PWA cannot be used where there is no WiFi or LTE. This is a hard dependency on the
lab coverage commitment, and it is the project's single largest operational assumption.
If coverage fails at any of the 10 locations, inspections cannot be recorded there at
all.

TC011, TC063 and TC065 are Descoped rather than Failed, citing this ADR. TC032 and TC064
test the short-drop tolerance that is in scope.

The documentation now states the connectivity model in one place. FRS Section 9 and
ARCHITECTURE Section 10.1 describe the mechanism; FRS 4.x alternate flows and Section
13.2 point at them rather than restating a different model.

## Escalation to v2

Full offline-first is reconsidered if the pilot shows drops that the short-drop model
does not cover: submissions reaching the 15-minute manual-retry state in normal use, or
dead zones at equipment locations that the signal survey did not predict. Any such work
starts with an ADR that decides the `submitted_at` authority question above, because
that decision, not the client storage, is what makes offline records defensible.

## Alternatives Considered

**Full offline-first now (IndexedDB queue, service worker, background sync).** Rejected
for the capstone. Cost is 3 to 5 days at the end of the schedule, it reopens ADR 0006,
and the client already committed to the lab coverage that makes it unnecessary.

**`localStorage` with a 24-hour expiry, matching the old FRS 13.2.** Rejected. It solves
only the device-failure case, not offline submission, so it does not deliver what a
reader of the old text expects, and a 24-hour window still leaves operator PII on the
device past the inspection it belongs to, with no expiry logic built to enforce it.

**No client persistence at all, the state before DEV-125.** Rejected. It fails FRS
Section 9.1 outright and silently discards completed inspections, which is what DEV-125
reported.
