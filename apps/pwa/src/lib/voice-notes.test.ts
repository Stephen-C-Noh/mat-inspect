import { describe, it, expect } from 'vitest';
import {
  applyTextEdit,
  applyTranscript,
  clipFilename,
  emptyFailureEntry,
  formatElapsed,
  parseTranscript,
  transcriptionErrorMessage,
  type FailureEntry,
} from './voice-notes';

const typed = (notes: string): FailureEntry => ({ ...emptyFailureEntry(), notes });

describe('applyTranscript', () => {
  it('takes the transcript as the whole note when the field is empty', () => {
    const next = applyTranscript(emptyFailureEntry(), 'hydraulic leak on the mast');

    expect(next.notes).toBe('hydraulic leak on the mast');
    expect(next.notesSource).toBe('VOICE_TRANSCRIBED');
    expect(next.rawTranscript).toBe('hydraulic leak on the mast');
  });

  it('appends to text the operator already had, rather than destroying it', () => {
    // The operator can type while transcription is in flight. Their text wins.
    const next = applyTranscript(typed('front left tire'), 'sidewall is cracked');

    expect(next.notes).toBe('front left tire sidewall is cracked');
    expect(next.notesSource).toBe('VOICE_EDITED');
  });

  it('leaves an appended note unable to claim it is untouched machine output', () => {
    const next = applyTranscript(typed('front left tire'), 'sidewall is cracked');

    expect(next.rawTranscript).toBeNull();
    // Even retyping the transcript verbatim cannot flip a mixed note back.
    expect(applyTextEdit(next, 'sidewall is cracked').notesSource).toBe('VOICE_EDITED');
  });

  it('ignores an empty transcript instead of clearing the note', () => {
    // Recording silence must not destroy what the operator wrote.
    const entry = typed('brake pedal feels soft');

    expect(applyTranscript(entry, '')).toEqual(entry);
    expect(applyTranscript(entry, '   \n ')).toEqual(entry);
  });

  it('does not mark a note VOICE_TRANSCRIBED when nothing was transcribed', () => {
    expect(applyTranscript(emptyFailureEntry(), '').notesSource).toBe('TYPED');
  });
});

describe('applyTextEdit', () => {
  it('keeps a hand-typed note TYPED', () => {
    const next = applyTextEdit(emptyFailureEntry(), 'chain guard missing');

    expect(next.notesSource).toBe('TYPED');
  });

  it('marks an edited transcript VOICE_EDITED', () => {
    const transcribed = applyTranscript(emptyFailureEntry(), 'hydraulic leak');
    const next = applyTextEdit(transcribed, 'hydraulic leak at the base of the mast');

    expect(next.notesSource).toBe('VOICE_EDITED');
  });

  it('restores VOICE_TRANSCRIBED when an edit is undone back to the machine output', () => {
    // Deliberate: notesSource describes the stored text, and this text is the untouched machine
    // output. The audit trail should not claim a human wrote words the model produced.
    const transcribed = applyTranscript(emptyFailureEntry(), 'hydraulic leak');
    const edited = applyTextEdit(transcribed, 'hydraulic leak at the base');
    const undone = applyTextEdit(edited, 'hydraulic leak');

    expect(edited.notesSource).toBe('VOICE_EDITED');
    expect(undone.notesSource).toBe('VOICE_TRANSCRIBED');
  });

  it('marks a cleared transcript VOICE_EDITED, not TYPED', () => {
    // The operator deleted machine output. That is an edit of a transcript, not a fresh typed note.
    const transcribed = applyTranscript(emptyFailureEntry(), 'hydraulic leak');

    expect(applyTextEdit(transcribed, '').notesSource).toBe('VOICE_EDITED');
  });
});

describe('clipFilename', () => {
  it('derives the extension from what the recorder actually produced', () => {
    expect(clipFilename('audio/webm;codecs=opus')).toBe('clip.webm');
    expect(clipFilename('audio/mp4')).toBe('clip.mp4');
    expect(clipFilename('audio/ogg;codecs=opus')).toBe('clip.ogg');
  });

  it('falls back to webm when the recorder reports no type', () => {
    expect(clipFilename('')).toBe('clip.webm');
  });
});

describe('transcriptionErrorMessage', () => {
  it('tells the busy case apart from the unavailable case', () => {
    expect(transcriptionErrorMessage(429)).not.toBe(transcriptionErrorMessage(503));
  });

  it('always tells the operator they can type the note instead', () => {
    const cases = [400, 413, 429, 502, 503, 401, 'network', 'microphone'] as const;

    for (const status of cases) {
      expect(transcriptionErrorMessage(status).toLowerCase()).toContain('type');
    }
  });
});

describe('parseTranscript', () => {
  it('reads the transcript off the documented response shape', () => {
    expect(parseTranscript({ text: 'hydraulic leak' })).toBe('hydraulic leak');
  });

  it('yields no transcript when the response is not the shape core-api documents', () => {
    expect(parseTranscript(null)).toBe('');
    expect(parseTranscript('hydraulic leak')).toBe('');
    expect(parseTranscript({ transcript: 'hydraulic leak' })).toBe('');
    expect(parseTranscript({ text: 42 })).toBe('');
  });
});

describe('formatElapsed', () => {
  it('formats the recording timer', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(75_400)).toBe('1:15');
  });
});
