import nodemailer from 'nodemailer';
import { config } from '../config.js';

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
    // Omit auth entirely for relays that accept unauthenticated submission from the app host.
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
