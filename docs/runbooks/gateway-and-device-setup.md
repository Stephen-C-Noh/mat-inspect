# Runbook: the gateway, and setting up a device to reach it

Caddy is the only thing a browser talks to (ADR 0020). Everything else in the stack listens on the
internal Docker network only.

| URL                                     | Serves                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| `https://mat-inspect.staging`           | Operator PWA, and `/api/v1/*` for that origin             |
| `https://dashboard.mat-inspect.staging` | Manager dashboard, and `/api/v1/*` for that origin        |
| `http://127.0.0.1:8080`                 | Dev listener, for `npm run dev`. Loopback on the box only |

`/api/v1/media/*` goes to the Media Service. Everything else under `/api/v1` goes to core-api,
including `/api/v1/ai/*`, which core-api authenticates and forwards to the AI Service on the
internal network (ADR 0019). The AI Service has no route of its own and must not get one.

## A device that wants to open the PWA

Four steps. All four are needed: the certificate alone is not enough without the hostname, and the
hostname alone is not enough without Entra knowing the origin.

### 1. Export the CA root from the box

Caddy generates its own CA on first boot and keeps it in the `caddy_data` volume. It survives
redeploys. It is regenerated if that volume is ever dropped, and every device then has to trust the
new one.

```
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

The subject reads `CN=Caddy Local Authority - <year> ECC Root`.

### 2. Point the hostnames at the box

The mini-PC is `10.0.0.155` on the LAN and `100.119.248.37` on the tailnet. The tailnet address is
the one that works off-site.

```
# Linux, macOS:  /etc/hosts
# Windows:       C:\Windows\System32\drivers\etc\hosts
100.119.248.37  mat-inspect.staging
100.119.248.37  dashboard.mat-inspect.staging
```

### 3. Trust the CA root on the device

```
macOS    sudo security add-trusted-cert -d -r trustRoot \
           -k /Library/Keychains/System.keychain caddy-root.crt
Windows  certutil -addstore -f ROOT caddy-root.crt        (elevated)
Linux    sudo cp caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt
         sudo update-ca-certificates
Firefox  keeps its own store: Settings, Certificates, View Certificates, Authorities, Import
iOS      AirDrop or email the .crt, install the profile, then
         Settings, General, About, Certificate Trust Settings, and enable it
Android  Settings, Security, Encryption and credentials, Install a certificate, CA certificate
```

iOS needs both halves: installing the profile is not the same as trusting it.

### 4. Register the origin with Entra

Both origins must be redirect URIs on the SPA app registration, or MSAL refuses to complete the
login:

- `https://mat-inspect.staging`
- `https://dashboard.mat-inspect.staging`

No trailing slash. MSAL sends the page origin exactly as the browser reports it.

## Why not a publicly-trusted certificate

`tailscale serve` would supply one and remove steps 1 and 3. It is not used, because Tailscale is a
development and operations tool on this project (it carries the deploy SSH) and is not part of what
SAIT receives. Serving the browser path through it would mean demonstrating a path the handover
artifact does not have. Caddy terminates TLS in both, and the device setup above disappears the day
the stack has a real DNS name (ADR 0020).

## Local development

`npm run dev` runs the apps outside Compose. Their `/api/v1` calls are proxied by the Next dev
server to `GATEWAY_URL`, which defaults to the gateway's dev listener at `http://127.0.0.1:8080`.
So the gateway has to be up:

```
docker compose up -d caddy core-api media postgres azurite
npm run dev --workspace=@mat-inspect/pwa
```

A path resolves in dev through the same routing table staging uses. This is the point: a call to a
service the gateway does not publish fails in dev, where it is cheap, instead of in staging.

## Checks

On every deploy, after the containers report healthy:

```
./scripts/smoke-gateway.sh
```

It asserts the gateway answers on `/gateway/health`, that the PWA is served, that `POST /api/v1/ai/transcribe` without a token is 401, and that
`POST /api/v1/media/upload` without a token is 401 rather than 404. The 401s prove there is no
unauthenticated path to the model or to storage. They prove nothing about whether transcription
works: they never reach the AI Service.

On demand, when the voice path itself needs proving (after a model or image change):

```
./scripts/smoke-transcribe.sh <operator-access-token> [clip.wav]
```

Sign in to the PWA as an operator and read the cached access token for the API scope
(`docs/runbooks/entra-test-users-and-tokens.md`). This is the check that catches a stale AI image,
an empty weights mount, or a model that failed to load.

## Known failure: the gateway is healthy but nothing reaches it

The healthcheck now probes the site over TLS instead of the admin API, so a Caddy that serves
nothing fails. It still cannot see the host-side port binding: a Docker healthcheck runs inside the
container, and a probe aimed back at the host returns through Docker's DNAT rules even when the
host bind failed. `scripts/smoke-gateway.sh` is what catches that, because it runs on the box.

The usual cause is another process already holding 443. On a dev machine, `tailscale serve` is a
common culprit:

```
ss -tlnp | grep :443          # what holds it
tailscale serve status        # tailscale serve publishes on 443
docker compose up -d --force-recreate caddy
```

`docker port caddy` will happily report `443/tcp -> 0.0.0.0:443` in this state. Trust a request, not
the mapping.
