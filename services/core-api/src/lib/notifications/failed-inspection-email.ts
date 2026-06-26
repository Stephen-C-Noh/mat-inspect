import type { MailMessage } from './mailer.js';

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

const formatLabLocal = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
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
