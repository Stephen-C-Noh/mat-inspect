# Runbook: Sprint 5 sponsor demo (M5, Jul 27 to Aug 02)

Live in-person demo for the SAIT sponsor and capstone panel. Milestone M5: "Sponsor observes all
workflows." Audience is mixed technical and non-technical. Emphasis: Alberta OHS s.257 compliance
(a competent human operator inspects; AI only assists) and audit integrity.

Verification basis, checked 2026-07-23 against `main` (commit 2929112):

- The full Compose stack (10 services) was built and booted on a dev machine. All containers
  reached healthy. Migrations and seed ran clean (10 equipment, 4 checklist templates).
- `scripts/smoke-gateway.sh` passed: gateway health 200, PWA served over TLS, unauthenticated
  transcribe and media upload both 401.
- The audit service logged `audit chain verified on startup`.
- The full test suite passed: 45 files, 404 tests, including integration tests that drive
  inspection submit through the outbox into the audit chain (append, dedupe on redelivery,
  10,000-event chain verification).
- Not verified live: any flow behind MSAL login (needs a human sign-in), real voice
  transcription (model weights are on the mini-PC, not the dev machine), SMTP and Teams delivery
  (depends on staging env values).

---

## 1. Gaps between "all workflows" and current reality

Say these plainly in sprint planning; two are scope gaps, the rest are prep work.

| Gap                                                    | Status                                                                                                                                                                                                                                                                                                                                                       | Impact on the demo                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily compliance grid (DEV-37)                         | In Progress (Sophia), not on main                                                                                                                                                                                                                                                                                                                            | The dashboard today shows the persistent failure queue and the defect inbox, not a per-equipment per-day compliance grid. "Manager sees today's compliance" is only partially shown unless DEV-37 merges before demo day.                                                                    |
| Audit export + chain verification UI (DEV-38)          | To Do (Enzo)                                                                                                                                                                                                                                                                                                                                                 | No PDF or CSV export, no on-demand verify endpoint. The chain itself works (hash-chained, append-only, verified at startup). Demo it from a terminal (section 4, segment E) or cut the segment. The milestone wording already hedges this with "if ready"; it is not ready.                  |
| Staging stack was down and stale (resolved 2026-07-23) | Two causes, both fixed: the box was offline since about Jul 14 (rebooted 2026-07-23), and the checkout had been left on a feature branch, so the deploy's `git pull` was a no-op. Checkout moved back to `main`; the CI deploy then ran green: all 10 containers healthy, smoke-gateway passing, DB schema current with 10 equipment and 4 templates seeded. | Remaining DEV-47 work is the authenticated verification (MSAL logins, smoke-transcribe, notification rehearsal). Lesson for the team: after manual branch work on the box, put the checkout back on `main`, or every later deploy silently pins the old tree while still pulling new images. |
| Phone name resolution has no working path              | Open question                                                                                                                                                                                                                                                                                                                                                | The gateway runbook's device setup uses a hosts-file entry for `mat-inspect.staging`. Phones cannot edit hosts files. No LAN-facing DNS runs on the box today (checked: only loopback resolved and libvirt dnsmasq). Section 3 lists options. This is the single biggest unsolved prep item. |
| Voice transcription end-to-end                         | Code and tests pass; weights present on the box (1.1 GB, deployed Jul 13)                                                                                                                                                                                                                                                                                    | Not yet exercised against the deployed stack. Run `scripts/smoke-transcribe.sh` with an operator token.                                                                                                                                                                                      |
| Admin and auditor roles                                | Admin has API endpoints (template list, diff, publish) but no UI. Auditor is a reporting persona, not an App Role (settled in DEV-30), and its artifact is the DEV-38 export that does not exist yet.                                                                                                                                                        | The sprint goal "all roles exercised" realistically covers operator, supervisor, manager. Do not promise an admin screen or an auditor login.                                                                                                                                                |

Everything else in the milestone list is genuinely on main and covered by tests: login, QR scan,
checklist render, pass and fail submit with attestation, computed readiness (ADR 0006), defect
lifecycle with return-to-service, lockout screen, photo on failed item, voice note with
transcript review, Teams and email notification, outbox to audit chain.

---

## 2. Environment prep (do this the week before, not demo morning)

The normal deploy path is CI: merging to `main` builds and pushes images, then
`deploy-staging.yml` connects over Tailscale, pulls the checkout and the images, brings the stack
up, and runs the health and gateway smoke checks. Verified working end to end on 2026-07-23. The
steps below are the manual fallback and the checks CI does not cover.

On the mini-PC (`stephen-noh@stephen-noh-M5-PLUS`, checkout `~/projects/mat-inspect`):

1. Confirm the checkout is on `main` (`git status -sb`). If it is on a feature branch, the CI
   deploy's `git pull` is a no-op and the compose file and scripts silently stay stale. Then
   `git pull --ff-only`. Never `reset --hard`.
2. If not deploying through CI: `docker compose pull` (or `build`), then `docker compose up -d`.
3. Migrations and seed do not run on deploy. Run them from the deployed images (DEV-97 made the
   published images able to do this) or from the checkout: `npm run db:migrate` and
   `npm run db:seed` in `services/core-api`. Schema was current and seed data present on
   2026-07-23; re-check after any PR that adds a migration.
4. `./scripts/smoke-gateway.sh` on the box. All four checks must pass.
5. Sign in to the PWA as the test operator, capture the access token, run
   `./scripts/smoke-transcribe.sh <token>`. This is the only check that proves the voice path.
6. Confirm notification env on the box (`TEAMS_WEBHOOK_URL`, `SMTP_HOST`, `SMTP_USER`,
   `SMTP_PASS`, `SUPERVISOR_ALERT_EMAILS` in the box `.env`). Submit one blocking failure as a
   rehearsal and confirm the Teams card and the email arrive. If they are not configured, cut
   the notification beat from the script and lean on the dashboard failure queue (ADR 0013
   makes the queue the guaranteed channel anyway).
7. Verify port 443 is free before `up` (`ss -tlnp | grep :443`). `tailscale serve` is the known
   squatter. It was clean on 2026-07-23.
8. Full rehearsal, timed, with the exact devices and accounts. Record it (see fallbacks).

Demo devices:

- **Phone (operator)**: real mobile device with camera and microphone. Install and trust the
  Caddy CA root (`docs/runbooks/gateway-and-device-setup.md` steps; iOS needs both the profile
  install and the Certificate Trust Settings toggle). Camera and mic permissions only work in a
  secure context, so HTTPS through Caddy is mandatory, not optional.
- **Laptop (manager)**: hosts entries for `mat-inspect.staging` and
  `dashboard.mat-inspect.staging`, CA root trusted, signed in to the dashboard before the demo.
- **Projector or screen share** from the laptop; mirror the phone if the room allows (QuickTime
  via cable for iPhone is the reliable option).

Name resolution for the phone (pick one, test it in advance):

- Bring a travel router the team controls. Give the mini-PC a static lease and add a local DNS
  entry for both hostnames. Uplink the router to a phone hotspot for internet (MSAL needs
  `login.microsoftonline.com`). This is the most self-contained option and does not depend on
  SAIT guest Wi-Fi, which may isolate clients.
- Or run dnsmasq on the mini-PC bound to the LAN interface, and set the phone's Wi-Fi DNS to the
  box IP manually.
- Tailscale on the phone reaches the box IP (`100.119.248.37`) but does not resolve the
  `.staging` names; it is a transport fallback, not a DNS answer.

Accounts (fill from the Entra portal; UPNs are in the team's records, not in the repo):

- Test operator (role `operator`) on the phone. PWA admits operator and supervisor only.
- Test manager or supervisor on the laptop. Dashboard admits supervisor, manager, admin.
- Both users signed in before the demo starts. MSAL caches tokens; a warm session survives a
  brief network wobble, a cold login does not.

Seed state on demo day:

- Fresh seed is the right state. Computed readiness (ADR 0006) means every machine shows
  AWAITING_INSPECTION at the start of a new lab-local day (America/Edmonton) with no manual
  reset. Yesterday's rehearsal data does not pollute today's readiness. Rehearsal defects DO
  persist in the failure queue and defect inbox; resolve and return-to-service them during
  rehearsal cleanup, or reseed the database.
- Print QR codes for at least two machines. The scanner takes the last path segment and
  normalizes it to the asset tag, so a QR encoding `MAT-FL-001` or any URL ending in it works.
  Seeded tags: MAT-OC-001..004 (cranes), MAT-TR-001, MAT-TR-002 (trucks), MAT-PJ-001 (pallet
  jack), MAT-FL-001..003 (forklifts).

---

## 3. Demo script (about 25 minutes plus questions)

**A. Framing (2 min, no screen).** One slide or spoken: paper sheets replaced by a tamper-evident
digital record; Alberta OHS s.257 requires a competent human operator to inspect, so the system
never auto-passes or auto-fails; AI only transcribes voice and stays on this box (FOIP). Point at
the mini-PC: the whole stack runs on it, and SAIT receives it as a self-contained artifact
(ADR 0016).

**B. Operator pass flow, on the phone (6 min).** Operator is already signed in. Scan the QR on
"forklift" MAT-FL-001, checklist renders for the forklift class, walk 3 or 4 items quickly, pass
all, review the attestation summary, submit. Back on the equipment list, the forklift now reads
READY. Say the compliance line: READY is computed, valid only for today, and cannot be forced.

**C. Operator fail flow with photo and voice, on the phone (7 min).** Scan MAT-OC-001 (crane).
Fail a blocking item. The card expands in place with photo and voice capture (DEV-134 folded the
separate failures screen into the checklist). Attach a photo (camera opens; a photo is required
per failed item) and record a voice defect note. The transcript comes back for review and edit
before it is accepted; typed, transcribed, and edited notes are tracked as different sources.
Attest and submit. The lockout screen appears; the crane is OUT_OF_SERVICE. If transcription
misbehaves, type the note and move on; do not debug on stage.

**D. Supervisor and manager, on the laptop (6 min).** If notifications are configured, show the
Teams card or email that just arrived. On the dashboard: the failure queue shows the crane; the
defect inbox shows the open defect. Acknowledge it, start repair, resolve with notes, then
approve return-to-service. Switch back to the phone: the crane is AWAITING_INSPECTION, not
READY. This is the strongest compliance beat in the demo: repair approval does not make
equipment operational; only a new passing inspection by an operator does. Optionally re-inspect
the crane to READY (2 extra min).

**E. Audit integrity, terminal on the laptop (4 min, technical but short).** No UI exists yet
(DEV-38), so show the real thing:

1. `docker compose logs audit | grep "chain verified"`: the service refuses to start on a broken
   chain.
2. In psql on audit_db: select seq, action, left(prev_hash, 12), left(this_hash, 12) from the
   last few audit_events. The inspections just submitted are in the chain, each hash sealing the
   previous one.
3. Attempt `UPDATE audit_events SET action = 'X' WHERE seq = 1;` and let the trigger reject it
   live. Same for the inspections table. "The database itself refuses edits" lands well with a
   non-technical audience.

Close: what is in the handover package, and what stays deferred until SAIT hosts it (Azure
halves, ADR 0016).

---

## 4. Fallback plan

Ordered, cheapest first:

1. **Typed note instead of voice.** The typed path has no AI dependency and is always valid.
   Practice the pivot sentence: "operators can also type; voice is a glove-friendly shortcut."
2. **Manual equipment selection instead of QR.** The home screen lists and searches equipment;
   scanning is optional. Covers camera permission failures.
3. **Dashboard failure queue instead of Teams or email.** ADR 0013 already frames the queue as
   the guaranteed channel; the talking point survives the cut.
4. **Laptop as the operator device.** The PWA runs in a desktop browser. Camera QR scanning and
   mic generally work on the laptop too, and the laptop's hosts file and trust store are easier
   to fix live than a phone's.
5. **Local stack on the demo laptop.** The full Compose stack on current main was verified
   healthy on a MacBook on 2026-07-23. If the mini-PC fails on the day, `docker compose up -d`,
   migrate, seed, and run both apps against `https://mat-inspect.staging` resolved to
   127.0.0.1. Prepare this before the demo (images built, CA trusted, .env present), not during.
6. **Recorded rehearsal video.** Record the full happy path during the timed rehearsal (phone
   screen capture plus dashboard capture). If MSAL, the venue network, or the hardware dies, the
   sponsor still observes every workflow. This is the only fallback that survives a total
   network outage, because Entra login requires internet.

Known fragility points, for whoever runs the room:

- MSAL login needs internet to `login.microsoftonline.com`. Warm sessions before the demo;
  bring a hotspot; do not sign out to "show the login" unless the network is proven.
- The Caddy CA is per-volume. If `caddy_data` is ever dropped, every device must re-trust the
  new root. Do not prune volumes during prep week.
- The healthcheck cannot see a failed host port bind; only `smoke-gateway.sh` run on the box
  proves reachability. Trust a request, not `docker port`.
- `npm run dev` and the Compose stack have diverged before (env handling, rewrites). Demo from
  the Compose stack only; use `npm run dev` for nothing on demo day.
- The failure queue and defect inbox show all history. Clean up rehearsal defects (resolve plus
  return-to-service) or reseed before the sponsor arrives.
