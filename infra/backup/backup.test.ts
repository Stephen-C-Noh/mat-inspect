import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the backup wiring (DEV-43). Like the Caddyfile test, this checks the shape of the
// configuration and scripts so a mistake fails in the pull request instead of on the mini-PC at
// 02:00. It does not run pg_dump; the live dump-and-restore verification runs against a real
// Postgres (see the DEV-43 restore drill in docs/runbooks/backup-and-restore.md).

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const compose = read('../../docker-compose.yml');
const backupScript = read('./pg-backup.sh');
const scheduler = read('./backup-scheduler.sh');
const azureVerify = read('./verify-azure-backups.sh');

// Strip whole-line shell comments so assertions about what a script *does* are not fooled by the
// same words appearing in an explanatory comment (same technique as the Caddyfile test).
const stripComments = (sh: string) =>
  sh
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
const backupCode = stripComments(backupScript);

describe('db-backup compose service', () => {
  it('backs up to a separate volume, never the data volume', () => {
    // A backup on the same volume as the data it protects dies with it (DEV-43, "separate
    // volume"). The service mounts db_backups, and db_backups is declared as its own named volume.
    expect(compose).toMatch(/db_backups:\/backups/);
    expect(compose).toMatch(/^volumes:[\s\S]*^ {2}db_backups:/m);
    // The backup service must not MOUNT the postgres data volume. Match the list-item mount
    // syntax (`- postgres_data...`), not the bare word, which also appears in the service comment.
    const service = compose.slice(compose.indexOf('  db-backup:'), compose.indexOf('  azurite:'));
    expect(service).not.toMatch(/-\s+postgres_data\b/);
  });

  it('runs pg_dump from the same major version as the server', () => {
    // pg_dump cannot restore into a server older than itself. Both the server and the backup
    // sidecar pin postgres:16-alpine, so the versions cannot drift apart.
    const server = compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  db-backup:'));
    const service = compose.slice(compose.indexOf('  db-backup:'), compose.indexOf('  azurite:'));
    expect(server).toMatch(/image:\s*postgres:16-alpine/);
    expect(service).toMatch(/image:\s*postgres:16-alpine/);
  });

  it('waits for a healthy database before starting', () => {
    const service = compose.slice(compose.indexOf('  db-backup:'), compose.indexOf('  azurite:'));
    expect(service).toMatch(/depends_on:\s*\n\s*postgres:\s*\n\s*condition:\s*service_healthy/);
  });

  it('checks scheduler liveness, not dump freshness, in its healthcheck', () => {
    // A nightly job is idle most of the day, so a freshness check on the last dump would report
    // the service unhealthy 23 hours out of 24. The heartbeat proves the loop is alive instead.
    const service = compose.slice(compose.indexOf('  db-backup:'), compose.indexOf('  azurite:'));
    expect(service).toMatch(/db-backup-heartbeat/);
  });
});

describe('pg-backup.sh', () => {
  it('is POSIX sh, since it runs in busybox ash inside postgres:16-alpine', () => {
    expect(backupScript.startsWith('#!/bin/sh')).toBe(true);
  });

  it('dumps in custom format so the dump is verifiable and restorable', () => {
    expect(backupScript).toMatch(/pg_dump.*--format=custom/);
  });

  it('verifies every dump is restore-readable', () => {
    // Cheap gate: the archive header parses. Strong gate: the dump restores into a throwaway
    // database and reproduces the same table count as the source.
    expect(backupScript).toMatch(/pg_restore --list/);
    expect(backupScript).toMatch(/pg_restore --no-owner --no-acl --exit-on-error --dbname/);
    expect(backupScript).toMatch(/restore verify mismatch/);
  });

  it('deletes a dump that fails verification instead of keeping a bad recovery point', () => {
    // A dump that will not restore is worse than none: it hides the failure from rotation.
    const verifyBlock = backupScript.slice(backupScript.indexOf('if ! verify_dump'));
    expect(verifyBlock).toMatch(/rm -f "\$DUMP_FILE"/);
  });

  it('rotates dumps by a retention window', () => {
    expect(backupScript).toMatch(/BACKUP_RETENTION_DAYS/);
    expect(backupScript).toMatch(
      /find "\$BACKUP_DIR".*-mtime \+"\$BACKUP_RETENTION_DAYS".*-delete/s,
    );
  });

  it('exits non-zero when a backup fails so the failure is visible', () => {
    expect(backupScript).toMatch(/if \[ "\$FAILURES" -ne 0 \]/);
    expect(backupScript).toMatch(/finished with \$FAILURES failure/);
  });

  it('never mutates the databases it backs up (compliance: append-only tables)', () => {
    // The script only reads (pg_dump), and creates/drops throwaway scratch databases. It must
    // never issue UPDATE or DELETE SQL against a real application database (CLAUDE.md section 2,
    // ADR 0008). Checked against the comment-stripped code so the words in the explanatory
    // comments do not trip the assertion. (The `find ... -delete` in rotation is a file delete,
    // not SQL, and is intentionally allowed.)
    expect(backupCode).not.toMatch(/\bUPDATE\b/);
    expect(backupCode).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(backupCode).not.toMatch(/dropdb[^\n]*(core_db|audit_db)/);
  });

  it('cleans up scratch verification databases on every exit path', () => {
    expect(backupScript).toMatch(/trap cleanup EXIT/);
    expect(backupScript).toMatch(/dropdb --if-exists/);
  });

  it('reads credentials from libpq env vars, never a command line', () => {
    // PGPASSWORD on a command line would leak into the process list and logs.
    expect(backupScript).not.toMatch(/--password/);
    expect(backupScript).toMatch(/PGUSER|PGPASSWORD/);
  });
});

describe('backup-scheduler.sh', () => {
  it('invokes the backup script and keeps a heartbeat', () => {
    expect(scheduler).toMatch(/pg-backup\.sh/);
    expect(scheduler).toMatch(/HEARTBEAT_FILE/);
    expect(scheduler).toMatch(/touch "\$HEARTBEAT_FILE"/);
  });

  it('survives a failed backup instead of exiting the loop', () => {
    expect(scheduler).toMatch(/will retry on the next schedule/);
  });
});

describe('verify-azure-backups.sh (prod)', () => {
  it('is read-only: it only reads Azure configuration', () => {
    // The three data-reading calls must be `show`, and no call may use a state-changing verb
    // (create/update/delete/purge/configure). `az account set` only changes which subscription
    // the local CLI targets, not a cloud resource, so it is allowed.
    expect(azureVerify).toMatch(/az postgres flexible-server show/);
    expect(azureVerify).toMatch(/az storage account show/);
    expect(azureVerify).toMatch(/az storage account blob-service-properties show/);
    expect(azureVerify).not.toMatch(
      /az (postgres|storage|account|group|resource|network)[^\n]*\b(create|update|delete|purge|configure)\b/,
    );
  });

  it('gates on the retention window and geo-redundancy required by ADR 0004 and 0005', () => {
    expect(azureVerify).toMatch(/backup\.backupRetentionDays/);
    expect(azureVerify).toMatch(/geoRedundantBackup/);
    expect(azureVerify).toMatch(/Standard_GRS/);
    expect(azureVerify).toMatch(/deleteRetentionPolicy/);
    // Fails the run if any required setting is missing.
    expect(azureVerify).toMatch(/exit 1/);
  });
});
