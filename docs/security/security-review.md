# Security Review (DEV-42)

Full-repository security review. Records the scanners, their scope, the findings, the
fixes applied, and the findings accepted with rationale. The scan is repeatable in CI
(`.github/workflows/security.yml`) and locally with the commands below.

Last full pass: 2026-07-24 (Trivy 0.66.0, Semgrep auto ruleset, Gitleaks).

## Scope and tools

| Scanner     | Target                                        | CI job        |
| ----------- | --------------------------------------------- | ------------- |
| Gitleaks    | Full git history and working tree             | `gitleaks`    |
| Semgrep     | Whole repo, `--config=auto`                   | `semgrep`     |
| Trivy fs    | Repo: dependency CVEs, secrets, IaC misconfig | `trivy`       |
| Trivy image | All six runtime container images              | `trivy-image` |
| npm audit   | Dependency CVEs (cooldown-aware gate)         | `npm-audit`   |
| Hadolint    | All Dockerfiles                               | `hadolint`    |

Severity gate: HIGH and CRITICAL block. Trivy runs with `--ignore-unfixed`, so a CVE
with no upstream fix does not fail the build. MODERATE and below are logged only.

## Results (2026-07-24)

| Scanner             | Result                                                           |
| ------------------- | ---------------------------------------------------------------- |
| Gitleaks            | 0 leaks across 344 commits and the working tree                  |
| Semgrep             | 0 findings (514 rules over 451 files)                            |
| Trivy fs            | 9 HIGH, all dependency CVEs already tracked (see Accepted below) |
| Trivy image         | Base-image findings fixed (see below); app-dep findings tracked  |
| python:3.12-slim OS | 0 fixable HIGH or CRITICAL                                       |

## Fixes applied

### Container images: bundled npm CLI removed, OS libraries patched

The Trivy image scan surfaced HIGH and CRITICAL findings that the filesystem scan did
not, because they live in the base image, not in the repo lockfile:

- **Bundled npm CLI** (`/usr/local/lib/node_modules/npm` in `node:22-alpine`): `tar`
  (CVE-2026-59873 CRITICAL, CVE-2026-59874 HIGH), `sigstore` (CVE-2026-48815),
  `brace-expansion` (CVE-2026-13149), `picomatch` (CVE-2026-33671). These are npm's own
  vendored dependencies. The runtime containers only run `node`, never npm, so npm is
  unused. The five node Dockerfiles now delete it in the runtime stage.
- **OpenSSL** (`libssl3`, `libcrypto3`, CVE-2026-45447): the runtime stage runs
  `apk --no-cache upgrade` to pull the patched packages from the alpine branch. OpenSSL
  is reachable through Node's TLS, so this one is patched, not accepted.

Both changes live in one `RUN` per Dockerfile: `services/core-api`, `services/media`,
`services/audit`, `apps/pwa`, `apps/dashboard`. Verified: after the change the core-api
image reports 0 HIGH or CRITICAL under `.trivyignore.yaml`, and the only findings left
without the ignore file are the tracked app-dependency CVEs below.

The AI image (`python:3.12-slim`) had 0 fixable HIGH or CRITICAL OS findings, so it is
unchanged.

## Accepted findings

All accepted findings are dependency CVEs whose only fix is younger than the `.npmrc`
`min-release-age=7` cooldown, so the fix cannot be installed yet. Each carries an expiry;
once the fix ages past the cooldown the scanner re-surfaces it until it is applied. This
is the DEV-102 mechanism. The entries live in two synchronized files:

- `.trivyignore.yaml` (Trivy fs and image scans)
- `scripts/audit-allowlist.json` and `.trivyignore.yaml` (npm audit gate and Trivy)

Nine HIGH CVEs are accepted this way as of 2026-07-24, expiring between 2026-07-26 and
2026-07-29: `@opentelemetry/propagator-jaeger` (CVE-2026-59892), `fast-uri`
(CVE-2026-13676, CVE-2026-16221), `fast-xml-parser` (GHSA-8r6m-32jq-jx6q), `find-my-way`
(CVE-2026-47219), `sharp` (GHSA-f88m-g3jw-g9cj), and `next` (CVE-2026-64641,
CVE-2026-64645, CVE-2026-64649). The DEV-102 phase-2 override batch applies the real
fixes once they age in. See `.trivyignore.yaml` for the per-CVE rationale.

No secrets were accepted. Gitleaks found none.

## Running the scans locally

```sh
# Gitleaks (full history)
gitleaks detect --source . --redact -v

# Semgrep (auto ruleset, same as CI)
docker run --rm -v "$PWD":/src -w /src semgrep/semgrep:latest \
  semgrep scan --config=auto --error .

# Trivy filesystem (deps + secrets + misconfig)
docker run --rm -v "$PWD":/repo -w /repo aquasec/trivy:0.66.0 fs \
  --severity HIGH,CRITICAL --ignore-unfixed --ignorefile /repo/.trivyignore.yaml .

# Trivy image (build the runtime target first, then scan)
docker build -f services/core-api/Dockerfile --target runtime -t mat-inspect/core-api:scan .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD":/repo \
  aquasec/trivy:0.66.0 image --severity HIGH,CRITICAL --ignore-unfixed \
  --ignorefile /repo/.trivyignore.yaml mat-inspect/core-api:scan
```

CI runs every scanner on push and pull request to `main`.
