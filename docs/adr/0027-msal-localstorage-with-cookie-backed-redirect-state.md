# ADR 0027: MSAL cache moves to localStorage, with a Secure cookie backing the redirect handshake

- Status: Accepted
- Date: 2026-08-08
- Deciders: Stephen Noh
- Related: ADR 0007 (attestation over per-record HMAC), ADR 0020 (Caddy is the single front door), ADR 0025 (short drop tolerance, not offline-first), DEV-144, DEV-151

## Context

`packages/shared-auth/src/msal-config.ts` configured MSAL's cache as:

```
cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
```

This predates DEV-144, which made the operator PWA installable to the Android home
screen. A review pass on DEV-144's PR (#142) flagged that installability exercises this
config in a way it was never tested against, on two separate axes.

**Redirect round-trip state loss.** `loginRedirect` stores request state (PKCE verifier,
`state`, `nonce`) before navigating to `login.microsoftonline.com` and expects to find it
on return. MSAL always keeps that temporary state in `sessionStorage` or memory,
regardless of the `cacheLocation` setting; `storeAuthStateInCookie` is the only knob that
backs it up anywhere else. An installed (non-TWA) PWA's out-of-scope top-level navigation
to the identity provider is not guaranteed to return to the same browsing context on
Android Chrome. This was not verified against a real device or emulator; neither was
available in the environment that made this decision. It is accepted as a plausible,
low-cost-to-fix risk rather than a confirmed one.

**Session loss between app launches.** `sessionStorage` is scoped to the browsing
context's lifetime. Android can kill an installed PWA's process under memory pressure
between uses, and relaunching from the home screen icon after that starts a fresh
context with empty `sessionStorage`, forcing a relogin even though nothing about the
underlying Entra session expired. Fixing this needs `cacheLocation: 'localStorage'`.

An initial pass at this decision assumed operator devices were shared lab tablets,
because ADR 0007 and ADR 0025 both described them that way at the time. Under that
premise, `localStorage` was rejected: a token cache that survives past the current tab
would mean the next operator to pick up the device inherits the previous one's Entra
session, which is a Part 6 log book violation (CLAUDE.md Section 2), not just a UX
tradeoff. That premise was wrong. Operator devices are individually assigned, not
shared; ADR 0007 and ADR 0025 are corrected in this same change to say so. With that
corrected, the cross-operator session risk does not apply, and the localStorage fix for
the second concern above stands.

## Decision

```
cache: {
  cacheLocation: 'localStorage',
  storeAuthStateInCookie: true,
  secureCookies: true,
},
system: {
  navigateToLoginRequestUrl: false,
},
```

`cacheLocation: 'localStorage'` survives an Android process kill between launches. This
is a real XSS exposure tradeoff against the prior `sessionStorage` setting: a
cross-site-scripting bug that could previously only read the current tab's tokens can
now read every token issued to the device until logout. The project accepts this because
the redirect-launch-only vector normally used to smuggle a token out of `sessionStorage`
is no easier against `localStorage`, and the counter-measure for stored-XSS is not
storage location but not having a stored-XSS bug in the first place (Zod validation at
every boundary, no `dangerouslySetInnerHTML` of user content, CSP as a future hardening
step). `cacheLocation` does not change what an already-present XSS bug can do to a
still-active session either way; it changes how long a token stays reachable after the
tab that acquired it closes.

`storeAuthStateInCookie: true` is the actual fix for the redirect round-trip concern.
`cacheLocation` does not touch it, because temporary state is never subject to that
setting.

`secureCookies: true` is required alongside it. MSAL defaults `secureCookies` to
`false`, which omits the `Secure` attribute; without it the redirect-state cookie -
carrying the PKCE verifier and the authorization response - would be sent over any
plain-HTTP hop, including the initial request to Caddy's own port 80 before its
automatic redirect to 443 (`infra/caddy/Caddyfile` has no HSTS header configured, so a
degraded or mis-configured client can make that first hop repeat). No access token,
refresh token, or ID token is ever written to this cookie; MSAL only ever puts temporary
interaction state there. `TC-AUTH-008` in `docs/TEST_PLAN.md` ("no JWT in localStorage")
is not about this cookie and is now genuinely exercised by `cacheLocation: 'localStorage'`
holding the real token cache; that test case is updated in the same change to expect
tokens in `localStorage` rather than asserting their absence.

`navigateToLoginRequestUrl: false` is a companion hardening step, not required to fix
either concern above. Both apps register their origin, not `/login`, as the redirect
URI, so returning to the origin directly (skipping MSAL's default hop back to the page
that launched the login) removes one place the auth-response cookie has to survive and
keeps it from also having to carry the pre-redirect URL.

## Consequences

An operator who relaunches the installed PWA after Android killed its process stays
signed in, instead of hitting `/login` on every relaunch.

The redirect-in-progress cookie is Secure and does not carry tokens, so the concrete gap
the review found (a non-Secure cookie able to leak a PKCE verifier and auth code over a
stray plain-HTTP hop) is closed.

Both apps share this config (`packages/shared-auth`), so the dashboard's login also picks
up `storeAuthStateInCookie`, `secureCookies`, and the wider `localStorage` cache, even
though the dashboard is not an installed PWA and was never the reason for this change.
Nothing about the dashboard's threat model argues against it; a manager's own device
staying signed in across a browser restart is an unremarkable, expected default there.

`accounts[0]` was used across both apps' components as the active account, with no
`setActiveAccount` call after a redirect response and no consuming code preferring
`instance.getActiveAccount()`. This predates this change and was already a correctness
gap tied to cache insertion order, not to `cacheLocation`, but `localStorage` extends how
long a stale account entry survives in the cache, so it is fixed in the same change:
`packages/shared-auth/src/active-account.ts` adds `wireActiveAccount` (called once from
each app's `MsalProviderWrapper`, bootstrapping the active account from the cache on load
and then tracking it on every `LOGIN_SUCCESS` and `ACQUIRE_TOKEN_SUCCESS` event) and
`getActiveAccount` (`instance.getActiveAccount() ?? accounts[0]`, the resolution every
consumer should use instead of reading `accounts[0]` directly). Every such read in both
apps (`apps/pwa/src/**`, `apps/dashboard/src/**`) and in `access-token.ts`'s token
acquisition calls now goes through it.

The `loginRedirect` round-trip fix (concern 1) is still unverified on a real Android
device with the PWA actually installed. `storeAuthStateInCookie` is the documented,
low-downside response to the failure mode described, and is not conditioned on that
verification landing first.

## Alternatives considered

**Leave `cacheLocation` at `sessionStorage`, fix only the redirect-state cookie.** This
was the first correction attempted, made under the wrong shared-device premise above.
Once that premise is corrected, it under-fixes the actual problem DEV-151 raised: the
relogin-on-every-relaunch UX gap on an installed PWA remains.

**Scope `cacheLocation` to the PWA only, via a parameter on `createMsalConfig`.** Rejected
for now: nothing about the dashboard's usage argues for a narrower cache, and a
per-app branch in a function both apps share is complexity with no corresponding
requirement. Revisit if the dashboard's threat model turns out to need
`sessionStorage` specifically (for example, if it starts running on a shared manager
workstation).

**Wait for real Android device verification before deciding anything.** Rejected as the
blocking path for the whole ticket: `storeAuthStateInCookie` and `secureCookies` are
low-downside, MSAL-documented responses to a real MSAL limitation (temporary state is
never subject to `cacheLocation`) independent of whether the specific Android
browsing-context failure mode is confirmed. The `cacheLocation` change stands on its own
reasoning (process death between launches) and does not depend on that verification
either. Device verification remains open work, tracked as a DEV-151 follow-up.
