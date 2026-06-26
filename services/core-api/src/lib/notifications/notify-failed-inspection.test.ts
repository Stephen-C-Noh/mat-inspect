import { describe, it, expect, vi } from 'vitest';
import { notifyFailedInspection, type FailedInspectionAlert } from './notify-failed-inspection.js';

const makeAlert = (overrides: Partial<FailedInspectionAlert> = {}): FailedInspectionAlert => ({
  result: 'FAIL_BLOCKING',
  equipmentName: 'Overhead Crane 1',
  assetTag: 'CRANE-01',
  operatorDisplayName: 'Jordan Lee',
  submittedAt: new Date('2026-06-26T20:30:00Z'),
  blockingDefects: ['Hoist brake does not hold load'],
  supervisorEmails: ['sup1@sait.ca', 'sup2@sait.ca'],
  ...overrides,
});

const makeLog = () => ({ warn: vi.fn(), info: vi.fn() });
const noSleep = vi.fn().mockResolvedValue(undefined);
// Supply `from` in every test so the notifier never falls back to defaultFromAddress(), which
// reads the validated config and is not the unit under test here.
const FROM = 'alerts@sait.ca';

describe('notifyFailedInspection', () => {
  it('does not send on PASS', async () => {
    const sender = vi.fn().mockResolvedValue('ok');
    const log = makeLog();
    await notifyFailedInspection(makeAlert({ result: 'PASS' }), { sender, log });
    expect(sender).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('does not send on FAIL_WARNING', async () => {
    const sender = vi.fn().mockResolvedValue('ok');
    await notifyFailedInspection(makeAlert({ result: 'FAIL_WARNING' }), { sender, log: makeLog() });
    expect(sender).not.toHaveBeenCalled();
  });

  it('sends one email to all supervisors on FAIL_BLOCKING', async () => {
    const sender = vi.fn().mockResolvedValue('ok');
    await notifyFailedInspection(makeAlert(), { sender, from: 'alerts@sait.ca', log: makeLog() });
    expect(sender).toHaveBeenCalledTimes(1);
    const message = sender.mock.calls[0]![0];
    expect(message.to).toEqual(['sup1@sait.ca', 'sup2@sait.ca']);
    expect(message.from).toBe('alerts@sait.ca');
    expect(message.subject).toContain('CRANE-01');
    expect(message.text).toContain('Jordan Lee');
    expect(message.text).toContain('Hoist brake does not hold load');
  });

  it('warns and skips when there are no supervisor recipients', async () => {
    const sender = vi.fn().mockResolvedValue('ok');
    const log = makeLog();
    await notifyFailedInspection(makeAlert({ supervisorEmails: [] }), { sender, log });
    expect(sender).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('warns and skips when SMTP is not configured', async () => {
    const log = makeLog();
    await notifyFailedInspection(makeAlert(), { sender: null, log });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![1]).toMatch(/SMTP not configured/);
  });

  it('retries up to three times then logs a single warn, without throwing', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('relay down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = makeLog();
    await expect(
      notifyFailedInspection(makeAlert(), { sender, from: FROM, sleep, log }),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once a send succeeds', async () => {
    const sender = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');
    const log = makeLog();
    await notifyFailedInspection(makeAlert(), { sender, from: FROM, sleep: noSleep, log });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('never rejects even when the sender keeps throwing (fire-and-forget)', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('boom'));
    const promise = notifyFailedInspection(makeAlert(), {
      sender,
      from: FROM,
      sleep: noSleep,
      log: makeLog(),
    });
    await expect(promise).resolves.toBeUndefined();
  });
});
