import { describe, it, expect, vi } from 'vitest';
import {
  notifyFailedInspectionTeams,
  type FailedInspectionTeamsAlert,
} from './notify-failed-inspection-teams.js';
import type { TeamsWebhookPayload } from './teams-card.js';

const makeAlert = (
  overrides: Partial<FailedInspectionTeamsAlert> = {},
): FailedInspectionTeamsAlert => ({
  result: 'FAIL_BLOCKING',
  assetTag: 'CRANE-01',
  defectId: '7f1d2c3b-0000-4000-8000-000000000001',
  severity: 'BLOCKING',
  ...overrides,
});

const makeLog = () => ({ warn: vi.fn(), info: vi.fn() });
const noSleep = vi.fn().mockResolvedValue(undefined);
// Supply dashboardBaseUrl in every test so the notifier never falls back to config(), which
// reads process.env and is not the unit under test here.
const BASE_URL = 'https://dashboard.example';

// Reads the FactSet facts and the OpenUrl action out of the posted payload.
const inspectPayload = (payload: TeamsWebhookPayload) => {
  const card = payload.attachments[0]!.content as {
    body: Array<{ type: string; facts?: Array<{ title: string; value: string }> }>;
    actions: Array<{ url: string }>;
  };
  const facts = card.body.find((b) => b.type === 'FactSet')?.facts ?? [];
  return { facts, actions: card.actions };
};

describe('notifyFailedInspectionTeams', () => {
  it('does not post on PASS', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const log = makeLog();
    await notifyFailedInspectionTeams(makeAlert({ result: 'PASS' }), {
      sender,
      dashboardBaseUrl: BASE_URL,
      log,
    });
    expect(sender).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('does not post on FAIL_WARNING', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await notifyFailedInspectionTeams(makeAlert({ result: 'FAIL_WARNING' }), {
      sender,
      dashboardBaseUrl: BASE_URL,
      log: makeLog(),
    });
    expect(sender).not.toHaveBeenCalled();
  });

  it('posts one card with asset tag, Defect ID, severity, and deep link on FAIL_BLOCKING', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await notifyFailedInspectionTeams(makeAlert(), {
      sender,
      dashboardBaseUrl: BASE_URL,
      log: makeLog(),
    });
    expect(sender).toHaveBeenCalledTimes(1);
    const { facts, actions } = inspectPayload(sender.mock.calls[0]![0]);
    expect(facts).toContainEqual({ title: 'Asset tag', value: 'CRANE-01' });
    expect(facts).toContainEqual({
      title: 'Defect ID',
      value: '7f1d2c3b-0000-4000-8000-000000000001',
    });
    expect(facts).toContainEqual({ title: 'Severity', value: 'BLOCKING' });
    expect(actions[0]!.url).toBe(
      'https://dashboard.example/defects/7f1d2c3b-0000-4000-8000-000000000001',
    );
  });

  it('posts without a deep link and warns when no dashboard base url is set', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const log = makeLog();
    await notifyFailedInspectionTeams(makeAlert(), { sender, dashboardBaseUrl: '', log });
    expect(sender).toHaveBeenCalledTimes(1);
    const { actions } = inspectPayload(sender.mock.calls[0]![0]);
    expect(actions).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![1]).toMatch(/DASHBOARD_BASE_URL not set/);
  });

  it('warns and skips when the Teams webhook is not configured', async () => {
    const log = makeLog();
    await notifyFailedInspectionTeams(makeAlert(), {
      sender: null,
      dashboardBaseUrl: BASE_URL,
      log,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![1]).toMatch(/Teams webhook not configured/);
  });

  it('retries up to three times then logs a single warn, without throwing', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('webhook down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = makeLog();
    await expect(
      notifyFailedInspectionTeams(makeAlert(), { sender, dashboardBaseUrl: BASE_URL, sleep, log }),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![1]).toMatch(/Teams post failed/);
  });

  it('stops retrying once a post succeeds', async () => {
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    const log = makeLog();
    await notifyFailedInspectionTeams(makeAlert(), {
      sender,
      dashboardBaseUrl: BASE_URL,
      sleep: noSleep,
      log,
    });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('never rejects even when the sender keeps throwing (fire-and-forget)', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('boom'));
    const promise = notifyFailedInspectionTeams(makeAlert(), {
      sender,
      dashboardBaseUrl: BASE_URL,
      sleep: noSleep,
      log: makeLog(),
    });
    await expect(promise).resolves.toBeUndefined();
  });

  it('posts a card carrying no operator name or transcript', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    await notifyFailedInspectionTeams(makeAlert(), {
      sender,
      dashboardBaseUrl: BASE_URL,
      log: makeLog(),
    });
    const serialized = JSON.stringify(sender.mock.calls[0]![0]);
    expect(serialized).not.toMatch(/operator/i);
    expect(serialized).not.toMatch(/transcript/i);
  });
});
