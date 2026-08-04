import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the voice-audio retention wiring (DEV-41). Like the db-backup test, this checks the shape
// of the compose service and the scheduler so a mistake fails in the pull request instead of on
// the mini-PC at 03:30. It does not run the purge; the live purge behaviour runs against Azurite
// in services/media/src/lib/voice-retention.integration.test.ts.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const compose = read('../../docker-compose.yml');
const scheduler = read('./voice-retention-scheduler.sh');

// The voice-retention service block, sliced out so assertions do not match other services.
const service = compose.slice(compose.indexOf('  voice-retention:'), compose.indexOf('  audit:'));

describe('voice-retention compose service', () => {
  it('reuses the built media image rather than a second build', () => {
    // The compiled purge job ships inside the media image (services/media/dist/jobs). Reusing the
    // image avoids a duplicate build and keeps the job code in one place.
    expect(service).toMatch(/image:\s*ghcr\.io\/\$\{REGISTRY_OWNER\}\/mat-inspect\/media:/);
    expect(service).not.toMatch(/build:/);
  });

  it('runs the scheduler as its entrypoint', () => {
    expect(service).toMatch(
      /entrypoint:\s*\['\/bin\/sh', '\/opt\/retention\/voice-retention-scheduler\.sh'\]/,
    );
    expect(service).toMatch(/voice-retention-scheduler\.sh:\/opt\/retention\//);
  });

  it('waits for healthy storage before starting', () => {
    expect(service).toMatch(/depends_on:\s*\n\s*azurite:\s*\n\s*condition:\s*service_healthy/);
  });

  it('never connects to a database, so it cannot delete inspection, response, or audit rows', () => {
    // The job purges Blob Storage only (DEV-41 acceptance criterion, CLAUDE.md 2). The service has
    // no DATABASE_URL and does not depend on postgres, so there is no path to a row delete.
    expect(service).not.toMatch(/DATABASE_URL/);
    expect(service).not.toMatch(/postgres/);
  });

  it('checks scheduler liveness, not purge freshness, in its healthcheck', () => {
    // A daily job is idle most of the day, so a freshness check on the last purge would report the
    // service unhealthy most of the time. The heartbeat proves the loop is alive instead.
    expect(service).toMatch(/voice-retention-heartbeat/);
  });

  it('passes the window and schedule as overridable env', () => {
    expect(service).toMatch(/MEDIA_VOICE_RETENTION_DAYS:\s*\$\{MEDIA_VOICE_RETENTION_DAYS:-90\}/);
    expect(service).toMatch(/RETENTION_TIME:\s*\$\{VOICE_RETENTION_TIME:-03:30\}/);
    expect(service).toMatch(/RETENTION_DRY_RUN:/);
  });
});

describe('voice-retention-scheduler.sh', () => {
  it('is POSIX sh, since it runs in busybox ash inside the node alpine image', () => {
    expect(scheduler.startsWith('#!/bin/sh')).toBe(true);
  });

  it('invokes the compiled purge job and keeps a heartbeat', () => {
    expect(scheduler).toMatch(/dist\/jobs\/purge-voice-audio\.js/);
    expect(scheduler).toMatch(/HEARTBEAT_FILE/);
    expect(scheduler).toMatch(/touch "\$HEARTBEAT_FILE"/);
  });

  it('survives a failed purge instead of exiting the loop', () => {
    expect(scheduler).toMatch(/will retry on the next schedule/);
  });

  it('runs one purge on start so a redeploy reconciles retention', () => {
    expect(scheduler).toMatch(/RETENTION_RUN_ON_START/);
  });

  it('never issues database operations (it deletes blobs, not rows)', () => {
    // Defence in depth against a future edit adding a psql call: the scheduler must stay a
    // pure blob-purge driver (CLAUDE.md 2, ADR 0008 append-only tables).
    expect(scheduler).not.toMatch(/\bpsql\b/);
    expect(scheduler).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(scheduler).not.toMatch(/\bUPDATE\b/);
  });
});
