// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChecklistItem } from '@mat-inspect/shared-types';
import type { ReactElement, ReactNode } from 'react';
import { ChecklistItemCard } from './checklist-item-card';
import type { ChecklistAnswer } from '@/lib/checklist-answers';

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }) },
    accounts: [
      {
        homeAccountId: 'home-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant-id',
        localAccountId: 'local-id',
        username: 'jane.doe@example.edu',
        name: 'Jane Doe',
        idTokenClaims: { roles: ['operator'] },
      },
    ],
  }),
}));

const photoOnFailItem: ChecklistItem = {
  key: 'forks',
  prompt: 'Forks intact?',
  type: 'BOOLEAN_PHOTO_ON_FAIL',
  required: true,
  failSeverity: 'BLOCKING',
};

const plainBooleanItem: ChecklistItem = {
  key: 'horn',
  prompt: 'Horn sounds?',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'WARNING',
};

const failedAnswer: ChecklistAnswer = { kind: 'BOOLEAN', passed: false };
const passedAnswer: ChecklistAnswer = { kind: 'BOOLEAN', passed: true };

const renderCard = (overrides: {
  item?: ChecklistItem;
  answer?: ChecklistAnswer;
  notes?: string;
  photoIds?: string[];
  onAnswerChange?: (answer: ChecklistAnswer) => void;
  onNotesChange?: (notes: string) => void;
  onPhotoIdsChange?: (ids: string[]) => void;
  onTranscript?: (transcript: string) => void;
}): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(
    <ChecklistItemCard
      item={overrides.item ?? photoOnFailItem}
      answer={overrides.answer}
      notes={overrides.notes ?? ''}
      photoIds={overrides.photoIds ?? []}
      onAnswerChange={overrides.onAnswerChange ?? vi.fn()}
      onNotesChange={overrides.onNotesChange ?? vi.fn()}
      onPhotoIdsChange={overrides.onPhotoIdsChange ?? vi.fn()}
      onTranscript={overrides.onTranscript ?? vi.fn()}
    />,
    { wrapper },
  );
};

beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no MediaRecorder. Same stand-in used in use-voice-note-recorder.test.ts: emitData()
// feeds a chunk to the hook's ondataavailable handler, stop() fires onstop.
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options?: { audioBitsPerSecond?: number },
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }

  emitData(blob: Blob): void {
    this.ondataavailable?.({ data: blob });
  }
}

describe('ChecklistItemCard photo capture affordance', () => {
  it('shows the photo capture affordance for a failed BOOLEAN_PHOTO_ON_FAIL item', () => {
    renderCard({ item: photoOnFailItem, answer: failedAnswer });

    expect(screen.queryByRole('button', { name: /add photo/i })).not.toBeNull();
  });

  it('does not show the photo capture affordance for a plain BOOLEAN fail', () => {
    renderCard({ item: plainBooleanItem, answer: failedAnswer });

    expect(screen.queryByRole('button', { name: /add photo/i })).toBeNull();
  });

  it('does not show the photo capture affordance for a passing BOOLEAN_PHOTO_ON_FAIL item', () => {
    renderCard({ item: photoOnFailItem, answer: passedAnswer });

    expect(screen.queryByRole('button', { name: /add photo/i })).toBeNull();
  });
});

describe('ChecklistItemCard photo upload', () => {
  const PHOTO_ID = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:mock-preview-url');
        static revokeObjectURL = vi.fn();
      },
    );
  });

  it('uploads the selected photo and reports the new id once it succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            photoId: PHOTO_ID,
            container: 'evidence-photos',
            blobName: `${PHOTO_ID}.jpg`,
            contentType: 'image/jpeg',
            size: 1024,
            sha256: 'a'.repeat(64),
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const onPhotoIdsChange = vi.fn();
    renderCard({ item: photoOnFailItem, answer: failedAnswer, onPhotoIdsChange });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(onPhotoIdsChange).toHaveBeenCalledWith([PHOTO_ID]));
  });
});

describe('ChecklistItemCard restored evidence photo', () => {
  const RESTORED_PHOTO_ID = '55555555-5555-5555-5555-555555555555';

  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:mock-photo-url');
        static revokeObjectURL = vi.fn();
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => new Blob(['bytes']),
      } as Response),
    );
  });

  it('renders the restored evidence photo instead of the add-photo affordance', async () => {
    renderCard({ item: photoOnFailItem, answer: failedAnswer, photoIds: [RESTORED_PHOTO_ID] });

    await screen.findByRole('img', { name: /evidence/i });
    expect(screen.queryByRole('button', { name: /add photo/i })).toBeNull();
  });

  it('removing the restored photo reports an empty photo list', async () => {
    const onPhotoIdsChange = vi.fn();
    renderCard({
      item: photoOnFailItem,
      answer: failedAnswer,
      photoIds: [RESTORED_PHOTO_ID],
      onPhotoIdsChange,
    });

    await screen.findByRole('img', { name: /evidence/i });
    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));

    expect(onPhotoIdsChange).toHaveBeenCalledWith([]);
  });
});

describe('ChecklistItemCard voice notes', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  it('reports the transcript once a recording finishes, untouched for the parent to merge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: 'left fork cracked at the heel' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const onTranscript = vi.fn();
    renderCard({ item: photoOnFailItem, answer: failedAnswer, onTranscript });

    fireEvent.click(screen.getByRole('button', { name: /add voice note/i }));
    await waitFor(() => expect(FakeMediaRecorder.instances.length).toBe(1));

    const recorder = FakeMediaRecorder.instances.at(-1)!;
    recorder.emitData(new Blob(['audio'], { type: 'audio/webm' }));
    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('left fork cracked at the heel'));
  });

  // "For each failed item, the app shows a notes field with two options: type or tap to dictate"
  // (ARCHITECTURE.md 7.1). Dictation is not scoped to the photo-required items: DEV-134 briefly tied
  // it to BOOLEAN_PHOTO_ON_FAIL by placing the button inside the photo component, which silently
  // removed voice notes from the plain BOOLEAN items that make up most of a template.
  it('offers the notes field and dictation on a plain BOOLEAN fail, not just photo-required items', () => {
    renderCard({ item: plainBooleanItem, answer: failedAnswer });

    expect(screen.queryByRole('button', { name: /add voice note/i })).not.toBeNull();
    expect(screen.queryByPlaceholderText(/dictate/i)).not.toBeNull();
  });

  it('does not offer the notes field on a passing item', () => {
    renderCard({ item: plainBooleanItem, answer: passedAnswer });

    expect(screen.queryByRole('button', { name: /add voice note/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/dictate/i)).toBeNull();
  });
});
