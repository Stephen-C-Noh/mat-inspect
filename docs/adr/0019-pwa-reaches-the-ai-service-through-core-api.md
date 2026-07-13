# ADR 0019: The PWA reaches the AI Service through core-api

- Status: Accepted
- Date: 2026-07-12
- Deciders: Stephen Noh
- Related: ADR 0014 (fail-closed route auth guard), ADR 0017 (AI Service scaling), ADR 0018 (advisory check), DEV-31, DEV-34, DEV-85

## Context

The AI Service exposes `POST /transcribe`. It has no authentication of its own. It was reachable in principle through a Caddy route (`/api/v1/ai/*` to `ai:8000`), and the PWA was written to call `POST /api/v1/ai/transcribe`.

That call never worked. The PWA rewrites all of `/api/v1/*` to core-api and does not pass through Caddy, so the Caddy route was never consulted, and core-api had no such route. The gap surfaced in the PR #77 review: because the PWA treats every non-2xx as a silent soft failure, the 404 looked like "no transcript came back" rather than "the endpoint does not exist".

Fixing the path forces a prior question: who authenticates a transcription request, and may the browser reach the AI Service at all?

Three options were considered.

1. **PWA rewrites straight to the AI Service.** Smallest change. The AI Service would have to validate the Entra token itself, which means a second JWT and JWKS implementation, in Python, alongside the one in core-api. Without it, the endpoint is unauthenticated.
2. **core-api proxies to the AI Service.** core-api authenticates the operator and forwards the clip on the internal network.
3. **Caddy becomes the real gateway** and routes the browser to each service. Caddy cannot validate an Entra token without a plugin and a custom image, so this option leaves authentication unsolved on its own.

## Decision

The PWA reaches the AI Service through core-api.

core-api exposes `POST /api/v1/ai/transcribe`, guarded by `requireRole('operator')`, and forwards the multipart body to the AI Service. The AI Service is not published to the browser: the `@ai` route is removed from the Caddyfile, and `AI_SERVICE_URL` is an internal address.

Constraints on the proxy:

- The body is forwarded as received. core-api does not parse the multipart. Parsing would rebuild the temp-file spool that DEV-31 removed from the AI Service, and audio is biometric PII under FOIP, so it stays in memory.
- The clip is rejected on its declared `Content-Length`, in an `onRequest` hook, before Fastify reads the body. A `preHandler` would run after parsing and so would see a clip that is already in memory.
- `Content-Length` is forwarded. The AI Service answers 411 to a body without one, because measuring an undeclared body means reading it.
- The AI Service's soft-failure statuses (400, 413, 429, 503) pass through unchanged, so the PWA can tell the operator which one happened rather than failing blind. Any other upstream status, and an unreachable AI Service, become 502 and 503 respectively.
- The operator's bearer token is not forwarded. The AI Service does not authenticate, so passing it on would only widen where it can leak.

## Consequences

Authentication stays in one place. The existing `verifyToken` and `requireRole` chain and the fail-closed route guard (ADR 0014) cover transcription with no new code, and there is no second token validator to keep correct.

The AI Service is unreachable from the browser. An unauthenticated endpoint that accepts audio and runs a model is not exposed at the edge, which matters because the audio is biometric PII (FOIP) and the model is the service's scarcest resource (ADR 0017).

core-api gains an outbound dependency on the AI Service, and holds a connection for the length of a transcription (up to about 32 seconds by the AI Service's own budget). This is asynchronous and does not block the event loop, but it does consume a connection slot. The concurrency ceiling that actually matters is still the AI Service's semaphore (ADR 0017), which answers 429 when saturated.

A voice note passes through core-api's memory. The clip is capped at 10 MB, the same limit the AI Service enforces, and it is never written to disk in either service.

Making Caddy the single front door remains the right long-term shape, and the routing table is still duplicated between Caddy and the PWA's rewrites. That cleanup is DEV-85. It is a separate decision from this one, and it does not solve authentication: this ADR holds regardless of where the gateway ends up.

The size limit is duplicated between core-api (TypeScript) and the AI Service (Python). A shared constant would mean a build-time dependency between two services in different languages for one number. Both enforce their own copy, so drift makes the gate stricter or laxer, never absent.
