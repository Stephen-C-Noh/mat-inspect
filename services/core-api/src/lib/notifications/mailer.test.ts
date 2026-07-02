import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the external SMTP boundary (CLAUDE.md: mock external services only). vi.hoisted runs
// before the hoisted vi.mock factory, so the spy can be referenced safely inside it.
const { mockCreateTransport } = vi.hoisted(() => ({ mockCreateTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mockCreateTransport } }));

import { getMailSender, defaultFromAddress, resetMailSenderForTest } from './mailer.js';
import { resetConfigForTest } from '../config.js';

const ORIGINAL_ENV = { ...process.env };

// Drives config() from a clean env: NODE_ENV=test skips the Azure requirements, leaving only
// DATABASE_URL plus whatever SMTP vars a test sets. Resets the config and mailer caches so each
// call rebuilds from the new env.
const setEnv = (smtp: Record<string, string | undefined>): void => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgres://localhost:5432/mat';
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(smtp)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigForTest();
  resetMailSenderForTest();
};

beforeEach(() => {
  mockCreateTransport.mockReset();
  mockCreateTransport.mockReturnValue({ sendMail: vi.fn() });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetConfigForTest();
  resetMailSenderForTest();
});

describe('getMailSender', () => {
  it('returns null and builds no transport when SMTP is not configured', () => {
    setEnv({});
    expect(getMailSender()).toBeNull();
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('builds the transport once and caches the sender', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u', SMTP_PASS: 'p' });
    const first = getMailSender();
    const second = getMailSender();
    expect(first).toBe(second);
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it('passes auth when user and pass are set', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u', SMTP_PASS: 'p' });
    getMailSender();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        auth: { user: 'u', pass: 'p' },
      }),
    );
  });

  it('omits auth for an unauthenticated relay (no user or pass)', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test' });
    getMailSender();
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it('marks the transport secure on the implicit-TLS port 465', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465' });
    getMailSender();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });
});

describe('defaultFromAddress', () => {
  it('uses SMTP_USER when it is an email address', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'mailer@sait.ca', SMTP_PASS: 'p' });
    expect(defaultFromAddress()).toBe('MAT-Inspect <mailer@sait.ca>');
  });

  it('falls back to no-reply at the relay host when SMTP_USER is not an email', () => {
    setEnv({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'svc-account', SMTP_PASS: 'p' });
    expect(defaultFromAddress()).toBe('MAT-Inspect <no-reply@smtp.example.test>');
  });

  it('falls back to a local no-reply address when SMTP is not configured', () => {
    setEnv({});
    expect(defaultFromAddress()).toBe('MAT-Inspect <no-reply@mat-inspect.local>');
  });
});
