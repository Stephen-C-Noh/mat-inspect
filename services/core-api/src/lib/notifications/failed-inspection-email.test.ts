import { describe, it, expect } from 'vitest';
import { buildFailedInspectionEmail } from './failed-inspection-email.js';

const baseInput = {
  equipmentName: 'Overhead Crane 1',
  assetTag: 'CRANE-01',
  operatorDisplayName: 'Jordan Lee',
  // A fixed instant: 2026-06-26T20:30:00Z is 14:30 Mountain Time (UTC-6 in June).
  submittedAt: new Date('2026-06-26T20:30:00Z'),
  blockingDefects: ['Hoist brake does not hold load', 'Hook safety latch missing'],
};

describe('buildFailedInspectionEmail', () => {
  it('puts the asset tag but no operator name in the subject (FRS AC-8.1.3, no PII)', () => {
    const { subject } = buildFailedInspectionEmail(baseInput);
    expect(subject).toContain('CRANE-01');
    expect(subject).not.toContain('Jordan Lee');
    expect(subject).not.toContain('brake');
  });

  it('includes equipment, operator, time, and every defect in the text body', () => {
    const { text } = buildFailedInspectionEmail(baseInput);
    expect(text).toContain('Overhead Crane 1');
    expect(text).toContain('CRANE-01');
    expect(text).toContain('Jordan Lee');
    expect(text).toContain('Hoist brake does not hold load');
    expect(text).toContain('Hook safety latch missing');
    // Rendered in lab-local (Mountain) time: the calendar date holds and the clock shows 2:30.
    expect(text).toContain('2026');
    expect(text).toContain('2:30');
  });

  it('lists every defect in the HTML body', () => {
    const { html } = buildFailedInspectionEmail(baseInput);
    expect(html).toContain('<li>Hoist brake does not hold load</li>');
    expect(html).toContain('<li>Hook safety latch missing</li>');
  });

  it('escapes HTML in operator name and defect descriptions', () => {
    const { html } = buildFailedInspectionEmail({
      ...baseInput,
      operatorDisplayName: 'A <b>Name</b>',
      blockingDefects: ['leak in <valve> & hose'],
    });
    expect(html).toContain('A &lt;b&gt;Name&lt;/b&gt;');
    expect(html).toContain('leak in &lt;valve&gt; &amp; hose');
    expect(html).not.toContain('<b>Name</b>');
  });

  it('handles an empty defect list without breaking the body', () => {
    const { text, html } = buildFailedInspectionEmail({ ...baseInput, blockingDefects: [] });
    expect(text).toContain('no defect description provided');
    expect(html).toContain('no defect description provided');
  });
});
