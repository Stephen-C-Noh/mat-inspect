# ADR 0026: The manager dashboard refreshes from undismissed notifications, not from a cursor

- Status: Accepted
- Date: 2026-07-27
- Deciders: Stephen Noh
- Related: ADR 0008 (transactional outbox and content digest), ADR 0016 (team-operated deployment), ADR 0019 (the PWA reaches other services through core-api), DEV-127, DEV-128, FRS AC 6.1.3

## Context

The dashboard did no background refetching at all. No query configured a
`refetchInterval`, and the only query default was a 30 second `staleTime`. Data
therefore refreshed on mount, on the manual Refresh control in the Failure Queue, or
when a stale query revalidated after the window regained focus. Nothing updated the
screen while a manager was simply watching it.

This was found during CPRG305 A3 test execution on dev-staging on 2026-07-26, executing
TC048 (DEV-127). An operator submitted an inspection, the POST returned 201, and the
dashboard still showed the previous state more than 35 seconds later. A reload showed
the new inspection at once, so the data had been on the server the whole time. The case
had never been executable before DEV-123 corrected the operator submit path, so the gap
had gone unnoticed since the dashboard was built.

The documented behaviour it violates is specific. FRS acceptance criterion 6.1.3
requires that "new inspection submissions appear within 5 seconds via polling (no
websocket in MVP)". `docs/PRD.md` contrasts "Manager visibility: none during shift"
with a delivered "Real-time dashboard", and `docs/ARCHITECTURE.md` lists the real-time
dashboard as the control for the risk "Managers cannot verify completion". A dashboard
that only updates when someone reloads it does not answer that risk. The exposure is
worst for a blocking defect: the Failure Queue entry is the supervisor's signal to take
a machine out of service.

The notification bell in the top bar was a decorative icon with no handler and no
state, so a manager who stepped away had no way to see what they had missed.

## Decision

The dashboard polls one endpoint, `GET /api/v1/activity`, and refetches its real
queries only when that endpoint reports something it has not already seen.

The endpoint answers one question: **which inspections has this manager not dismissed**,
within a retention window of 24 hours. It returns each one with the machine's asset tag
and name and the operator's display name. Once a manager clears them, the answer is an
empty array, which is the steady state.

Dismissal is server-side, in a `notification_dismissals` table keyed by
`(user_id, inspection_id)`. `POST /api/v1/activity/dismiss` takes a list of ids, so
clearing the whole panel is one request, and a repeated dismissal conflicts into a
no-op. The client sends the ids it is actually showing, so an inspection that arrives
between the render and the click keeps its notification rather than being cleared
unseen.

When a poll reports an id the client has not seen before, the client invalidates the
equipment, defects and inspections queries, so all three refetch once. One submit can
change a machine's status and raise a blocking defect as well as add a history row, so
all three are refreshed rather than guessing which moved.

The poll interval is 2 seconds. The fleet and defect queries keep a slow 60 second
interval of their own for changes that no feed reports, which are the ones made in
another manager's session: a machine returned to service, or a defect acknowledged or
resolved elsewhere. The manual Refresh control stays as a fallback.

The poll acquires its token with `acquireApiTokenSilent`, which never falls back to
MSAL's interactive redirect. A redirect started from a timer navigates the page with no
user action, and a second poll firing inside the moment before navigation commits leaves
MSAL on `interaction_in_progress`, which blocks the next real sign-in. When the session
needs the user, the poll stops and the next thing the manager clicks signs them back in.

The role gate is supervisor, manager and admin on both routes. The feed is fleet-wide,
and an operator may only read their own inspections.

## Why not a cursor

The first implementation of this feature used a `since` timestamp cursor, and it was
wrong in a way worth recording, because the same trap catches a sequence column.

`inspections.submitted_at` is `defaultNow()`, which in Postgres is the **transaction
start** time. The submit transaction stamps the row and then writes inspection
responses, the content hash, the outbox row, any blocking defect, the equipment status
and the idempotency key before it commits. So a row can carry `21:20:00.100` and only
become visible at `21:20:00.180`.

A poll landing inside that window reads the clock at `21:20:00.140`, does not see the
uncommitted row, and hands the client `since=21:20:00.140`. The next poll asks for
`submitted_at > 21:20:00.140`. The row's `21:20:00.100` does not qualify. **That
inspection is never reported to that client again.** It fails silently, on the path that
carries blocking defects.

A monotonic sequence column does not fix this. A sequence value is also assigned at
INSERT, and assignment order is not commit order: transaction A can take `seq=5`,
transaction B can take `seq=6` and commit first, and a poll that advances its cursor to
6 will never return to 5. The cursor being an integer rather than a timestamp changes
nothing, because the defect is not in the value's type.

Fixing a cursor properly means knowing commit order, which in Postgres means tracking
`pg_current_snapshot()` xmin or enabling `track_commit_timestamp`, with transaction id
wraparound to handle. That is a disproportionate amount of machinery for a bell.

Asking "what have I not dismissed" has no such window. There is no cursor to advance
past a row that has not committed yet. A late-committing inspection simply appears in
the next answer, like every other undismissed row. The property is structural, not a
tuning parameter.

## Alternatives considered

**Polling every query on a 3 to 5 second timer.** This is what DEV-127 suggested and it
was implemented first. It meets AC 6.1.3, and it is three or four times the work: every
few seconds it re-reads the whole fleet with its last-inspection join, the whole defect
list, and a machine's whole inspection history, in order to learn that nothing happened.
The mini-PC is the deployment target (ADR 0016) and every open dashboard multiplies that
load. It also gives the notification bell nothing, because no query knows which of its
rows are new to a given reader.

**A timestamp or sequence cursor.** Loses inspections permanently; see above.

**Redis or a message queue.** The instinct behind it is right: an explicit queue with
explicit removal has no time dependency, which is exactly why the race disappears. But
the mechanism that removes the race is the dismissal record, not the transport, and
Redis makes the delivery weaker rather than stronger. Publishing after COMMIT is not
atomic with the transaction: a process that dies between the two loses the notification
with nothing to replay from. Avoiding that is precisely why this project already has a
transactional outbox (ADR 0008), so a correct Redis design would be
`outbox -> relay -> Redis -> dashboard`, which is more moving parts for a guarantee
Postgres already provides directly. It also adds a service to the Compose stack on a
mini-PC, in-memory state that a restart loses unless persistence is configured, and a
dependency needing its own justification.

Reconsider if the poll rate times the user count makes Postgres the bottleneck, or if
push delivery becomes worth it. FRS 6.1.3 rules out a websocket for the MVP in the
criterion itself.

**An ETag or Last-Modified on the existing list endpoints.** This would cut the response
size on quiet polls but not the query count: each endpoint would still run its query to
decide whether it had changed. It also gives no per-reader "this is new" information, so
the bell would still have nothing to show.

**Reporting defect changes in the feed as well.** Not needed. A blocking defect is raised
by an inspection submit, so an inspection event already implies a possible defect change.
The other direction, a defect acted on in a second dashboard session, is covered by the
60 second safety interval on the defect query.

## Consequences

New inspections, status changes and failure queue entries appear within about 2 seconds
with no user interaction, which satisfies AC 6.1.3 and lands inside TC048's intent.

Steady state costs one small request per open dashboard every 2 seconds, returning an
empty array once the manager has cleared their bell. On a fleet of about 10 machines the
query is an index scan with a primary-key lookup per candidate row.

The bell survives a reload and agrees across a manager's devices, because dismissal is a
row rather than component state. Two supervisors each keep their own bell: one clearing
a notification does not clear anyone else's.

An inspection older than the 24 hour retention window drops off the feed whether or not
it was dismissed. This is a retention rule, not a correctness boundary; the fleet grid
and the inspection history remain the record. It also bounds the dismissals table, whose
rows can be pruned on the same window.

`notification_dismissals` is not part of the compliance record. It says what a manager
looked at, not what happened to a machine, so unlike `inspections`, `inspection_responses`
and `audit_events` (ADR 0008) its rows are not immutable and deleting one simply restores
a notification.

A notification entry cannot link to its own machine. Fleet selection is component state
with no URL behind it, which is DEV-128. Until that lands, the panel links to Fleet.

The activity route is logged at debug, not info. At one request every 2 seconds per open
dashboard, an info line per poll would bury the rest of the service log. The dismiss
route is logged at info: it is a user action and it is infrequent.

An operator's PWA does not use these endpoints and is refused by them. Operator-side
freshness is unchanged.
