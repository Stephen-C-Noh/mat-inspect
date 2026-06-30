import nodemailer from 'nodemailer';
import { config } from '../config.js';

// SMTP transport for the failed-inspection email alert (DEV-21). This module owns the nodemailer
// relay connection and the system From address, and nothing else: it knows nothing about
// inspections or when to send. The orchestrator (notify-failed-inspection.ts) calls
// getMailSender() to obtain a sender. Email is the minimum guaranteed alert channel (ADR 0013).

// A mail message the notifier hands to the relay. Structurally a subset of nodemailer's
// Mail.Options, kept narrow so callers (and tests) do not depend on the nodemailer type.
export type MailMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
};

// Sends one message and resolves when the relay has accepted it. Rejects on transport error.
export type MailSender = (message: MailMessage) => Promise<unknown>;

let cachedSender: MailSender | null | undefined;

// Returns a sender bound to the configured SMTP relay, or null when SMTP is not configured.
// The transport holds a connection pool, so it is created once and cached. A null result means
// "email is disabled"; the notifier logs and skips rather than failing the inspection submit.
export const getMailSender = (): MailSender | null => {
  if (cachedSender !== undefined) return cachedSender;

  const smtp = config().smtp;
  if (!smtp) {
    cachedSender = null;
    return null;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // config validates that SMTP_USER and SMTP_PASS are set together, so a present user implies a
    // present pass; this never builds a half-filled auth object. Omit auth entirely for a relay
    // that accepts unauthenticated submission from the app host (neither set).
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  cachedSender = (message) => transport.sendMail(message);
  return cachedSender;
};

// From address for system mail. Uses SMTP_USER when it is itself an email address, otherwise a
// no-reply address on the relay host. Deployment can front this with a real shared mailbox.
export const defaultFromAddress = (): string => {
  const smtp = config().smtp;
  const address =
    smtp?.user && smtp.user.includes('@')
      ? smtp.user
      : `no-reply@${smtp?.host ?? 'mat-inspect.local'}`;
  return `MAT-Inspect <${address}>`;
};

// Test-only: drops the cached sender so a test can re-drive getMailSender with a fresh config.
export const resetMailSenderForTest = (): void => {
  cachedSender = undefined;
};
