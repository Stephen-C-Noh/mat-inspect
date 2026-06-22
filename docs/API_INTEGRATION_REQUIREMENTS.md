# MAT-Inspect API: Integration Requirements for a SAIT-Hosted Frontend

Date: 2026-06-17
Status: Draft. Items 1 to 3 are locked. Item 4 is pending the tenant decision.

SAIT will not host the project. SAIT builds its own webpage on its own
infrastructure and calls the MAT-Inspect API for data. These requirements define
the interface that webpage must meet. They hold in every hosting topology. They
are interface requirements, not preferences. Two of them follow from Alberta OHS
and are not negotiable.

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
and assign the App Roles (operator, supervisor, manager, admin). The auth design
cannot be finalized until these are confirmed.

## Regulatory basis

The requirements in items 2 and 3 follow from the Alberta Occupational Health and
Safety Code:

- Section 257: a competent human operator completes the visual inspection.
- Part 6 (log book rule): every inspection record identifies the human operator
  who performed it.

Official source: https://search-ohs-laws.alberta.ca/

Confirm the exact section numbers and the current OHS Code edition against the
official source before this document goes to SAIT.
