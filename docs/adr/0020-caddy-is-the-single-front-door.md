# ADR 0020: Caddy is the single front door

- Status: Accepted
- Date: 2026-07-13
- Deciders: Stephen Noh
- Related: ADR 0014 (fail-closed route auth guard), ADR 0015 (validate environment at boot), ADR 0019 (the PWA reaches the AI Service through core-api), DEV-85, DEV-98

## Context

The routing table for `/api/v1/*` lived in two files that disagreed.

`infra/caddy/Caddyfile` described a gateway: `/api/v1/media/*` to media, `/api/v1/reports/*` and `/api/v1/audit/*` to audit, everything else to core-api. `apps/pwa/next.config.ts` rewrote **all** of `/api/v1/:path*` to `CORE_API_URL`, which in Compose is `http://core-api:3000`. The PWA therefore never passed through Caddy, and the per-service rules were dead code from the browser's point of view.

The disagreement produced real bugs, not hypothetical ones. `POST /api/v1/ai/transcribe` reached core-api, which had no such route, and 404d (DEV-34). The same failure was armed for `POST /api/v1/media/upload` (DEV-33) and for the audit report endpoints (DEV-38).

A second problem sat on top of it. The PWA and the dashboard published their own ports from Compose, so a browser reached the PWA over plain HTTP at `http://<box>:3000`. MSAL needs a secure context for `crypto.subtle`, and plain HTTP to a LAN address is not one. Until the apps sit behind TLS, the operator flow cannot be demonstrated on the deploy box at all.

## Decision

Caddy is the only thing a browser talks to. Every other container is reachable only on the internal Docker network.

### The publishing rule

> A service may be published at the gateway if it validates Entra tokens itself. A service that does not is reached through core-api.

The discriminator is authentication, not routing. media validates Entra access tokens with the same shared verifier as core-api (`packages/shared-auth-server`, DEV-98), so it is published directly: there is no reason to push a 10 MB photo through core-api's memory. The AI Service validates nothing, so it stays behind core-api (ADR 0019). audit's report endpoints are published when they carry `requireRole`, and not before.

Authentication is not moved to Caddy. Caddy cannot validate an Entra token without a plugin and a custom image build. ADR 0019 owns that decision; this ADR does not reopen it.

### The routing table

One table, in `infra/caddy/Caddyfile`, expressed once as a snippet and imported by every site block:

```
(api) {
	handle /api/v1/media/*  -> media:3000
	handle /api/v1/*        -> core-api:3000
}

mat-inspect.staging            -> import api; everything else -> pwa:3000
dashboard.mat-inspect.staging  -> import api; everything else -> dashboard:3000
:8080 (dev only, loopback)     -> import api; /dev/* -> core-api:3000
```

The apps are two origins, not two paths under one origin. Path-mounting the dashboard under the PWA's origin would put both apps' MSAL caches in one `sessionStorage` and give an operator and a manager the same session boundary. The cost is a second hostname and a second Entra redirect URI.

The `@audit` rules are removed. `services/audit` registers only the internal ingest route today, so the rules routed nothing. They are written when the report routes are (DEV-38).

### Dev routes through the gateway too

`npm run dev` keeps the Next rewrite, but the destination is `GATEWAY_URL`, not `CORE_API_URL`. Developers run the Compose gateway, which publishes a plain-HTTP dev listener on `127.0.0.1:8080`, and the PWA dev server proxies `/api/v1/*` to it.

The alternative was to let dev keep talking to core-api directly and document the difference. That is what produced DEV-34: a call that works in dev, 404s in staging, and the failure is invisible because the PWA treats a non-2xx transcript as a soft failure. Dev and staging now resolve a path the same way, so a cross-service call that is broken is broken in the first place it is tried.

The dev listener is plain HTTP, bound to loopback on the host. It carries no authentication of its own and needs none: the services behind it authenticate. It is not reachable from the LAN.

### TLS and hostnames

Caddy keeps its internal CA (`tls internal`). Every device that opens the PWA installs the CA root and resolves the two hostnames to the box. The runbook (`docs/runbooks/gateway-and-device-setup.md`) has the steps.

`tailscale serve` in front of Caddy was considered, and would remove the per-device CA install by supplying a publicly-trusted certificate. It was not taken. Tailscale is a development and operations tool here: it carries the deploy SSH to the mini-PC, and it is not part of what SAIT receives. A production deployment has no tailnet, so serving the browser path through `tailscale serve` would mean the path we demonstrate and the path we hand over are different paths, and the TLS termination in the delivered artifact would be the one nobody exercised. Caddy terminates TLS in both, with `tls internal` now and ACME wherever the stack lands a public name.

The device setup below is therefore a cost of the capstone's private hostnames, not of the architecture. It disappears the moment the stack has a real DNS name and a real certificate; nothing in the topology changes with it.

### The regression guard

Two checks, because they prove different things.

1. `POST /api/v1/ai/transcribe` with no token answers 401. Runs on every deploy. It proves there is no unauthenticated path to the model, which is the FOIP property that matters. It proves nothing else: the 401 comes from core-api's own hooks, so it stays green against a stale AI Service, an unreachable one, or one with no weights loaded.
2. `POST /api/v1/ai/transcribe` with an operator token and a real clip answers 200 with a transcript. Runs on demand (`scripts/smoke-transcribe.sh`), because minting an Entra **user** token in CI needs either user credentials or a new app permission, and the operator role is a user role that a service principal cannot hold. A human pastes a token from a PWA session.

A unit test also fails the build if the Caddyfile ever declares a route to `ai:8000`. It checks the spelling of the config, which is weaker than the 401 check, but it fails in the pull request rather than after the deploy.

## Consequences

The routing table has one home. Adding a service means one `handle` in the Caddyfile, and nothing in an app's Next config.

The PWA and the dashboard stop publishing host ports. The only way in is `https://mat-inspect.staging` and `https://dashboard.mat-inspect.staging`, which is a secure context, so MSAL works on a phone on the LAN. This is what unblocks demonstrating the operator flow end to end on the box.

Every device that wants to open the apps needs the CA root and two hosts entries, including stakeholders' phones. This is the cost of the internal CA and it is real. The runbook exists so that it is not tribal knowledge.

Two Entra redirect URIs have to be registered on the SPA app registration (`https://mat-inspect.staging` and `https://dashboard.mat-inspect.staging`), or MSAL rejects the origin.

Developers now run Caddy locally for `npm run dev` to reach the API. That is one more container in the dev loop. It buys the guarantee that a route which resolves in dev also resolves in staging.

The gateway healthcheck now probes the site over TLS rather than the admin API. A Caddy container that serves nothing still answers its own admin socket on 2019, so the old check reported healthy while the gateway was dead (observed on the box during DEV-95). The new check goes through the site block, so it fails if the site is not served or the internal CA never issued a certificate.

It still cannot see whether the port is published on the host. A Docker healthcheck runs inside the container, and a probe aimed back at the host comes home through Docker's own DNAT rules even when the host-side bind failed. That was tried first and reproduced exactly that false pass on a dev box where another process held 443. Host-side reachability is therefore checked from outside the container, on the box, by `scripts/smoke-gateway.sh` on every deploy. The two checks answer different questions and both are needed: "is Caddy serving the site" and "can anything reach the front door".
