import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTeamsSender, getTeamsSender, resetTeamsSenderForTest } from './teams-webhook.js';
import { resetConfigForTest } from '../config.js';
import { buildFailedInspectionCard } from './teams-card.js';

const samplePayload = buildFailedInspectionCard({
  assetTag: 'CRANE-01',
  defectId: 'def-1',
  severity: 'BLOCKING',
});

describe('buildTeamsSender', () => {
  it('POSTs the payload as JSON to the webhook url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const send = buildTeamsSender('https://flow.example/webhook', fetchImpl);

    await send(samplePayload);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://flow.example/webhook');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(samplePayload);
  });

  it('rejects when the webhook returns a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const send = buildTeamsSender('https://flow.example/webhook', fetchImpl);

    await expect(send(samplePayload)).rejects.toThrow(/429/);
  });
});

describe('getTeamsSender', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    resetConfigForTest();
    resetTeamsSenderForTest();
  });

  it('returns null when TEAMS_WEBHOOK_URL is not configured', () => {
    process.env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://app:secret@localhost:5432/mat' };
    resetConfigForTest();
    resetTeamsSenderForTest();
    expect(getTeamsSender()).toBeNull();
  });

  it('returns a sender when TEAMS_WEBHOOK_URL is configured', () => {
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://app:secret@localhost:5432/mat',
      TEAMS_WEBHOOK_URL: 'https://flow.example/webhook',
    };
    resetConfigForTest();
    resetTeamsSenderForTest();
    expect(getTeamsSender()).toBeTypeOf('function');
  });
});
