// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVoiceNoteRecorder } from './use-voice-note-recorder';

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

// jsdom has no MediaRecorder. This stand-in is driven manually per test: emitData() feeds a chunk
// to the same ondataavailable handler the hook wires up, and stop() fires onstop the way a real
// recorder would once the operator (or the recording cap) ends the session. Every constructed
// instance is tracked so a test can reach into the one the hook created.
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

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.unstubAllGlobals();
  FakeMediaRecorder.instances = [];
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

describe('useVoiceNoteRecorder', () => {
  it('drops a transcript that arrives after the card unmounted', async () => {
    // The card unmounts when the operator collapses it or re-marks the item as passing. A transcript
    // landing afterwards would write a defect note onto what is now a pass (ADR 0008).
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const onTranscript = vi.fn();
    const { result, unmount } = renderHook(() => useVoiceNoteRecorder(onTranscript));

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));

    const recorder = FakeMediaRecorder.instances[0] as FakeMediaRecorder;
    act(() => {
      recorder.emitData(new Blob(['audio']));
      recorder.stop();
    });
    await waitFor(() => expect(result.current.state.status).toBe('transcribing'));

    unmount();

    await act(async () => {
      release(
        new Response(JSON.stringify({ text: 'left fork cracked' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('releases the microphone when the MediaRecorder constructor throws', async () => {
    // A stream that was never stored is a stream no cleanup path can stop: the mic and the OS
    // recording indicator would stay live for the rest of the page's life (FOIP).
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new Error('unsupported bitrate');
        }
      },
    );

    const { result } = renderHook(() => useVoiceNoteRecorder(vi.fn()));

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(stop).toHaveBeenCalled();
  });

  it('reports the transcript and returns to idle after a successful recording', async () => {
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
    const { result } = renderHook(() => useVoiceNoteRecorder(onTranscript));

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.state.status).toBe('recording'));

    const recorder = FakeMediaRecorder.instances.at(-1)!;
    recorder.emitData(new Blob(['audio'], { type: 'audio/webm' }));

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('left fork cracked at the heel'));
    await waitFor(() => expect(result.current.state.status).toBe('idle'));
  });

  it('surfaces a microphone error and never starts recording when permission is denied', async () => {
    getUserMedia.mockRejectedValue(new Error('permission denied'));

    const { result } = renderHook(() => useVoiceNoteRecorder(vi.fn()));

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ message: expect.stringContaining('Microphone') });
  });

  it('surfaces a transcription error when the server rejects the clip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })));

    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceNoteRecorder(onTranscript));

    act(() => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.state.status).toBe('recording'));

    const recorder = FakeMediaRecorder.instances.at(-1)!;
    recorder.emitData(new Blob(['audio'], { type: 'audio/webm' }));

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ message: expect.stringContaining('busy') });
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
