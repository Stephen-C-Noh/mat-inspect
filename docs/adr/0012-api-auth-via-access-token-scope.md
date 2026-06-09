# ADR 0012: API Authorization Uses Access Tokens via a Custom Scope, Not ID Tokens

Date: 2026-06-09
Status: Accepted

## Context

The frontends and core-api use one Entra ID app registration (ADR 0002). core-api
`verifyToken` requires the bearer token's `aud` to equal `ENTRA_CLIENT_ID` and reads a
`roles` claim. The dashboard's MSAL login requests `openid profile` only, which yields an
ID token, and it does not yet call core-api. The PWA calls core-api through the dev-only
`/dev/token` endpoint. No real Entra token has exercised the contract.

A tempting shortcut exists. Because the system is one app registration, an ID token's `aud`
already equals the client id, so an ID token used as a bearer would pass `verifyToken`. It
works by coincidence, not by design. ID tokens are meant for the client to learn who the user
is, not to authorize API calls; reusing them conflates authentication with authorization and
relies on `roles` being emitted on the ID token, which is configuration-dependent.

## Decision

The frontend acquires an **access token** scoped to a custom API scope,
`api://{clientId}/access_as_user`, exposed on the app registration, and sends that token to
core-api. Because the API and the SPA share one app registration, the access token's `aud`
equals the client id, so core-api's existing audience check passes with no backend change.
ID tokens are used only for the client's own session, never as the API bearer.

## Consequences

Positive: the Microsoft-recommended "SPA calls its own API" pattern; authentication and
authorization stay separate; `roles` arrive on a token meant for the API. No core-api change.

Negative: the app registration must expose the API scope and assign App Roles, and both
frontends must request the scope. This is verified first by a spike (DEV-30) before Sprint 1
features depend on it.

A future engineer may notice the ID token "works" and switch to it to skip the scope setup.
This ADR records why that is wrong: it passes only by the single-app-registration coincidence,
and it misuses the ID token.
