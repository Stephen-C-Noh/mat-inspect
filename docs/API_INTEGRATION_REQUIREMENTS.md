# MAT-Inspect API: Integration Requirements for Any Calling Frontend

Date: 2026-06-17
Revised: 2026-07-12
Status: Items 1 to 3 are locked. Item 4 is pending the tenant decision (ADR 0016).

SAIT does not host the project during the capstone (ADR 0016). The capstone
delivers the full stack: the operator PWA, the manager dashboard, the services,
the database, and the Compose files that run them. SAIT can adopt that stack as
delivered, self-host it, or deploy it to its own Azure infrastructure. No
redesign is required for any of those paths, and SAIT does not need to build a
frontend to use the system.

SAIT may still choose to build its own frontend against the MAT-Inspect API.
That option is supported. The requirements below define the interface any calling
frontend must meet, whether it is the PWA delivered with the stack or one SAIT
writes later. They hold in every hosting topology. They are interface
requirements, not preferences. Two of them follow from Alberta OHS and are not
negotiable.

## 1. The API is a protected resource. Each frontend is its own client.

MAT-Inspect exposes one API. Any webpage that calls it, SAIT's or the project's,
registers as its own client application in Entra ID and requests the API's
delegated scope `access_as_user` (App ID URI `api://mat-inspect-api`; exact value
pending the tenant decision in item 4). The API validates the token audience
against its own identity, not against any single client. The number of frontends
does not matter to the API.

## 2. Every inspection write must identify the individual operator.

Alberta OHS requires every inspection record to identify the competent human
operator who performed it (OHS Code Part 6 and section 257; see Regulatory basis
below). That identity comes from the validated access token, never from the
request body. Every request that creates or amends an inspection must carry a
delegated access token issued for a signed-in operator.

## 3. App-only tokens and API keys are rejected on inspection writes.

The API rejects application-only tokens (client credentials flow) and static API
keys on inspection write paths. If SAIT places a backend between its webpage and
the API, that backend must forward the operator's delegated token using the
OAuth2 on-behalf-of flow. It must not call the API under its own application
identity. A server-to-server API key model is not acceptable for inspection
writes, because it erases the operator identity the law requires.

## 4. Open dependency: who configures Entra ID, and which tenant issues tokens.

To finalize the exact audience and issuer the API validates, two answers are
needed: which tenant issues the access tokens (the SAIT tenant, a project tenant,
or both), and whether SAIT IT will configure the API and client app registrations
and assign the App Roles (operator, supervisor, manager, admin). The exact
audience and issuer values cannot be fixed until these are confirmed.

This is a post-capstone item. ADR 0016 records that the tenant decision does not
happen during the capstone: Entra ID stays on a project tenant, and a tenant swap
is a handover step gated on the governance track. Items 1 to 3 do not depend on
the answer, so the API contract is stable now. Only the configured audience and
issuer values change when a tenant is chosen. The runbook for that step is part
of the handover package (DEV-44).

## Regulatory basis

The requirements in items 2 and 3 follow from the Alberta Occupational Health and
Safety Code:

- Section 257: a competent human operator completes the visual inspection.
- Part 6 (log book rule): every inspection record identifies the human operator
  who performed it.

Official source: https://search-ohs-laws.alberta.ca/

Confirm the exact section numbers and the current OHS Code edition against the
official source before this document goes to SAIT.
