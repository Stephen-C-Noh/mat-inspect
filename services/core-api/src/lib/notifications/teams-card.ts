import type { FailSeverity } from '@mat-inspect/shared-types';

// Builds the Microsoft Teams Adaptive Card for a failed-inspection alert (ADR 0013, replacing
// Web Push from ADR 0010). The card is the fast nudge; it carries no delivery guarantee, so the
// dashboard queue remains the not-missed backstop.
//
// Transport note: Microsoft is retiring legacy Office 365 connectors, so the card is wrapped in
// the message/attachments envelope a Power Automate Workflows webhook forwards, not the bare
// connector card format (ADR 0013, decision 3).

// Adaptive Card content type the Workflows "post card" action expects.
const ADAPTIVE_CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';

// Pinned schema version. 1.4 is widely supported by the Teams card renderer and needs no newer
// features here. The card uses only TextBlock, FactSet, and Action.OpenUrl.
const ADAPTIVE_CARD_VERSION = '1.4';

export type TeamsCardInput = {
  // Equipment identifier, not PII. Printed on the asset, used to locate the equipment.
  assetTag: string;
  // The Defect record id (ARCHITECTURE.md Defect entity, opened on a BLOCKING failure). An
  // opaque identifier, not PII. The card carries the id only, never the defect description or
  // transcript (ADR 0013 PII rule: asset tag and Defect ID only).
  defectId: string;
  severity: FailSeverity;
  // Absolute URL into the manager dashboard for this defect. Optional: when the dashboard base
  // URL is not configured the card still posts with the asset tag and Defect ID, just without
  // the open-in-dashboard button.
  deepLink?: string;
};

// The body forwarded to the Power Automate Workflows webhook. Typed loosely as the card content
// is a fixed JSON document, not a domain object; the shape below is what Teams renders.
export type TeamsWebhookPayload = {
  type: 'message';
  attachments: Array<{
    contentType: typeof ADAPTIVE_CARD_CONTENT_TYPE;
    contentUrl: null;
    content: Record<string, unknown>;
  }>;
};

// Returns the webhook payload for a blocking-defect alert. Pure: no I/O, no config reads. The
// caller (notify-failed-inspection-teams.ts) resolves the deep link and posts the result.
export const buildFailedInspectionCard = (input: TeamsCardInput): TeamsWebhookPayload => {
  // FactSet is the non-PII payload: an equipment identifier, an opaque defect id, and the
  // severity. No operator name, no transcript text, no photo (ADR 0013, decision 4).
  const facts = [
    { title: 'Asset tag', value: input.assetTag },
    { title: 'Defect ID', value: input.defectId },
    { title: 'Severity', value: input.severity },
  ];

  const actions = input.deepLink
    ? [{ type: 'Action.OpenUrl', title: 'Open in dashboard', url: input.deepLink }]
    : [];

  const card: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: ADAPTIVE_CARD_VERSION,
    body: [
      {
        type: 'TextBlock',
        text: 'Blocking defect: equipment out of service',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Attention',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: 'A pre-use inspection recorded a blocking defect. Review it in the dashboard.',
        isSubtle: true,
        wrap: true,
      },
      { type: 'FactSet', facts },
    ],
    actions,
  };

  return {
    type: 'message',
    attachments: [{ contentType: ADAPTIVE_CARD_CONTENT_TYPE, contentUrl: null, content: card }],
  };
};
