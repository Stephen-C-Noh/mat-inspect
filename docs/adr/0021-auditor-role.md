# ADR 0021: Add a Read-Only Auditor Role

Date: 2026-07-23
Status: Accepted

## Context

ARCHITECTURE.md's actor table (Section 4) already describes an Auditor: 0 to 2 people,
read-only access to records and exports, time-boxed. Section 7.4 walks through "Auditor:
Compliance Export" as its own user flow. But `packages/shared-types`' `UserRole` union
never gained the literal: it is `operator | supervisor | manager | admin`. No route in
the codebase has ever needed to distinguish an auditor from a manager, because no route
existed that only an auditor should reach.

DEV-38 (signed PDF export, CSV, chain verification) is that route. Its own ticket
description names the audience as "Auditor and manager exports." Building it against
the existing role set means gating on `manager`, which would require handing anyone
who needs export access — including an external or time-boxed reviewer brought in
specifically to check the system's compliance story — a role that can also approve
return-to-service and resolve defects.

## Decision

Add `'auditor'` to `UserRole`. It is a distinct, read-only role: no route treats
`auditor` as inheriting or being inherited by `manager`, and every export route gates
on an explicit list (`supervisor`, `manager`, `auditor`, `admin`) rather than assuming
`manager` covers it.

Entra ID app-role registration (adding the corresponding App Role in the Azure portal
and assigning it to real accounts) is a manual step for a human, not code (CLAUDE.md
Section 8). This ADR covers the code-side role; provisioning real auditor accounts is
an operational task for whoever runs the tenant.

Time-boxing (an auditor's access expiring after a fixed window) is not implemented here.
It is an Entra ID access-review / conditional-access configuration, not an application
concern this ticket's scope reaches.

## Consequences

Positive: an auditor can be granted exactly the access ARCHITECTURE.md already
describes for them, without also granting defect-resolution or return-to-service
authority. This is a segregation-of-duties property that matters specifically because
audits are what checks for segregation-of-duties failures; gating exports on `manager`
instead would have created the outcome an audit exists to catch.

Negative: one more role to keep in every `requireRole(...)` call that should include
it. There is no centralized permission matrix in this codebase (each route declares its
own roles inline); a future route that should be auditor-visible and forgets the role
is not caught structurally, only by review.

## Amendment (2026-07-28, DEV-112)

This ADR's Decision section covers the code-side role but did not say whether an auditor
account can sign into the dashboard app at all. It could not: the dashboard's app-entry gate
(`ALLOWED_ROLES` in `apps/dashboard/src/lib/auth.ts`) was `supervisor | manager | admin`, so an
auditor authenticated successfully and was bounced to `/unauthorized`. DEV-112 fixes this.

Auditor is now in that app-entry gate. It does not gain access to any operational page by
that alone: dashboard and fleet each carry their own explicit `AuthGuard allowedRoles`
override that excludes `auditor`, so entry to the app and entry to a given page are two
separate checks. Auditor lands on a new, read-only `/audit` route instead of the shared
dashboard home, and the top bar only lists the pages a signed-in role is allowed to open.
`/audit`'s full content (inspection history, signed export, chain verification) is DEV-113;
this amendment covers only that an auditor now has somewhere to land.

## Alternatives Considered

Gate export routes on `manager` (and `admin`) only, deferring a formal auditor role to
a later ticket. Rejected: it satisfies the acceptance criteria's checkboxes but not the
ticket's own stated audience, and retrofitting least privilege after auditors have
already been issued manager accounts is harder than not doing that in the first place —
someone has to notice, revoke, and reissue, and in the meantime an audit-period actor
held write access nobody meant to give them.
