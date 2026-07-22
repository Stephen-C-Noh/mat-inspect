#!/usr/bin/env node
// CI dependency-audit gate.
//
// Why this exists instead of a plain `npm audit --audit-level=high`: the repo pins
// `min-release-age=7` in .npmrc (wait 7 days before resolving a freshly published
// version, a supply-chain guard). When a HIGH/CRITICAL advisory lands and its only fix
// is younger than that window, the fix cannot be installed yet, so a hard `npm audit`
// gate is red and unfixable for up to a week. This gate tolerates exactly those
// advisories, and only with an expiry: once the fix ages past the cooldown the entry
// expires and the gate fails again, forcing the now-installable fix to be applied.
//
// Exit 1 on: any HIGH/CRITICAL that is not allowlisted, or any allowlist entry past its
// expiry. Stale entries (no longer matching a live advisory) are reported, not failed.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAIL_LEVELS = new Set(['high', 'critical']);
const here = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(readFileSync(join(here, 'audit-allowlist.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

// `npm audit` exits non-zero whenever it finds anything, but still prints the JSON report
// to stdout. Capture stdout in both the success and the throw path.
let raw;
try {
  raw = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (err) {
  raw = err.stdout;
}
if (!raw) {
  console.error('audit-gate: could not read `npm audit --json` output');
  process.exit(1);
}
const report = JSON.parse(raw);

// One advisory (GHSA id) can appear under several packages; collapse to distinct ids.
const blocking = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  if (!FAIL_LEVELS.has(vuln.severity)) continue;
  for (const via of vuln.via) {
    if (typeof via !== 'object' || !via.url) continue;
    blocking.set(via.url.split('/').pop(), { name: via.name, title: via.title });
  }
}

const tolerated = [];
const expired = [];
const unexpected = [];
for (const [id, info] of blocking) {
  const entry = allowlist[id];
  if (!entry) unexpected.push({ id, ...info });
  else if (today > entry.expires) expired.push({ id, ...info, ...entry });
  else tolerated.push({ id, ...info, ...entry });
}
const stale = Object.keys(allowlist).filter((id) => !blocking.has(id));

for (const t of tolerated) {
  console.log(`  tolerated ${t.id} (${t.name}) until ${t.expires}: ${t.reason}`);
}
for (const id of stale) {
  console.log(`  note: allowlist entry ${id} matches no current advisory, safe to remove`);
}

let failed = false;
if (expired.length > 0) {
  failed = true;
  console.error(
    '\nAllowlist entries EXPIRED (the fix should be installable now, apply it and remove the entry):',
  );
  for (const e of expired) console.error(`  ${e.id} (${e.name}) expired ${e.expires}`);
}
if (unexpected.length > 0) {
  failed = true;
  console.error('\nUnexpected HIGH/CRITICAL advisories (not allowlisted):');
  for (const u of unexpected) console.error(`  ${u.id} (${u.name}): ${u.title}`);
}

if (failed) {
  console.error('\nDependency audit gate FAILED.');
  process.exit(1);
}
console.log(
  `\nDependency audit gate passed (${tolerated.length} advisory(ies) tolerated, cooldown-blocked).`,
);
