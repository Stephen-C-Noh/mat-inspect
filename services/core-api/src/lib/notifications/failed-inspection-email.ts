import type { MailMessage } from './mailer.js';

// Content layer for the failed-inspection email alert (DEV-21). Pure: given the inspection facts
// it returns the subject, plain text, and HTML, with no transport or I/O. The subject carries no
// PII (FRS AC-8.1.3); the body identifies the operator (OHS Part 6 log book rule) and HTML-escapes
// every interpolated value. The orchestrator (notify-failed-inspection.ts) adds from/to and sends.

// The lab is at SAIT Main Campus (Calgary), so "lab-local" time is Mountain Time. The timestamp
// in the email is rendered in this zone so a supervisor reads the wall-clock time of submission.
const LAB_TIME_ZONE = 'America/Edmonton';

export type FailedInspectionEmailInput = {
  equipmentName: string;
  assetTag: string;
  // Operator identity is required on the inspection record (OHS Part 6 log book rule). The email
  // goes to named supervisors on a need-to-know basis, so it carries the operator display name in
  // the body. It stays out of the subject line, which must contain no PII (FRS AC-8.1.3).
  operatorDisplayName: string;
  submittedAt: Date;
  // Human-readable descriptions of the checklist items that failed with BLOCKING severity.
  blockingDefects: string[];
};

// Escapes the five characters that change HTML structure, so an operator name or a defect
// description cannot break the markup or inject content into the email body.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Explicit component options with a pinned 12-hour clock, so the rendered time does not depend on
// the host ICU build (a timeStyle 'short' renders en-CA as 24-hour on some builds). Fixed shape:
// "Jun 26, 2026, 2:30 p.m." in lab-local time.
const formatLabLocal = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: LAB_TIME_ZONE,
  }).format(date);

// Builds the subject, plain-text, and HTML parts of the failed-inspection alert email.
// Returns content only; the caller adds from/to (see notify-failed-inspection.ts).
export const buildFailedInspectionEmail = (
  input: FailedInspectionEmailInput,
): Pick<MailMessage, 'subject' | 'text' | 'html'> => {
  const when = formatLabLocal(input.submittedAt);

  // Subject carries the asset tag (an equipment identifier, not PII) and never the operator
  // name or defect text (FRS AC-8.1.3).
  const subject = `MAT-Inspect: Blocking defect on ${input.assetTag}`;

  const defectsText =
    input.blockingDefects.length > 0
      ? input.blockingDefects.map((d) => `  - ${d}`).join('\n')
      : '  - (no defect description provided)';

  const text = [
    'A pre-use inspection recorded a blocking defect. The equipment is out of service until a',
    'supervisor reviews it.',
    '',
    `Equipment: ${input.equipmentName} (${input.assetTag})`,
    `Operator: ${input.operatorDisplayName}`,
    `Submitted: ${when}`,
    '',
    'Blocking defects:',
    defectsText,
    '',
    'Review this failure in the MAT-Inspect dashboard.',
  ].join('\n');

  const defectsHtml =
    input.blockingDefects.length > 0
      ? `<ul>${input.blockingDefects.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
      : '<p>(no defect description provided)</p>';

  const html = [
    '<p>A pre-use inspection recorded a blocking defect. The equipment is out of service until a',
    ' supervisor reviews it.</p>',
    '<table>',
    `<tr><td>Equipment</td><td>${escapeHtml(input.equipmentName)} (${escapeHtml(input.assetTag)})</td></tr>`,
    `<tr><td>Operator</td><td>${escapeHtml(input.operatorDisplayName)}</td></tr>`,
    `<tr><td>Submitted</td><td>${escapeHtml(when)}</td></tr>`,
    '</table>',
    '<p>Blocking defects:</p>',
    defectsHtml,
    '<p>Review this failure in the MAT-Inspect dashboard.</p>',
  ].join('');

  return { subject, text, html };
};
