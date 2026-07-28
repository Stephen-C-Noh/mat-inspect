import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { acquireAccessToken } from '@/lib/auth';
import {
  AUDIO_BITS_PER_SECOND,
  MAX_RECORDING_MS,
  clipFilename,
  parseTranscript,
  transcriptionErrorMessage,
} from '@/lib/voice-notes';

export type VoiceRecorderState =
  | { status: 'idle' }
  | { status: 'recording'; elapsedMs: number }
  | { status: 'transcribing' }
  | { status: 'error'; message: string };

// Records a defect note, transcribes it via the AI Service, and hands the transcript to the
// caller. It knows nothing about "notes": merging the transcript into existing note text is the
// caller's business rule (lib/voice-notes.ts applyTranscript), not this hook's.
export const useVoiceNoteRecorder = (
  onTranscript: (transcript: string) => void,
): { state: VoiceRecorderState; start: () => void; stop: () => void } => {
  const { instance, accounts } = useMsal();
  const [state, setState] = useState<VoiceRecorderState>({ status: 'idle' });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const capRef = useRef<number | null>(null);

  // A transcription request outlives the component that started it: the card unmounts when the
  // operator collapses it or re-marks the item as passing, and the response would then land on an
  // item whose answer has changed, writing a defect note onto what is now a pass (ADR 0008).
  const liveRef = useRef(true);

  // Voice is biometric PII under FOIP. Leaving the tracks live keeps the microphone open (and the
  // browser and OS recording indicators lit) after the operator believes recording ended.
  const releaseMicrophone = (): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearTimers = (): void => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (capRef.current !== null) window.clearTimeout(capRef.current);
    tickRef.current = null;
    capRef.current = null;
  };

  useEffect(() => {
    // Navigating away mid-recording must release the microphone too. The onstop handler is dropped
    // first: an operator leaving the screen is not asking for a transcript.
    return () => {
      liveRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      clearTimers();
      releaseMicrophone();
    };
  }, []);

  // Sends the clip to core-api, which forwards it to the AI Service on the internal network. The
  // AI Service is not reachable from the browser (ADR 0019).
  const sendAudioToAIService = async (clip: Blob, mimeType: string): Promise<void> => {
    setState({ status: 'transcribing' });

    try {
      const accessToken = await acquireAccessToken(instance, accounts);

      const formData = new FormData();
      formData.append('clip', clip, clipFilename(mimeType));

      const res = await fetch('/api/v1/ai/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      if (!liveRef.current) return;

      if (!res.ok) {
        setState({ status: 'error', message: transcriptionErrorMessage(res.status) });
        return;
      }

      const text = parseTranscript(await res.json());
      if (text.trim().length === 0) {
        // A 200 with nothing in it. Say so, rather than stopping the spinner over an unchanged
        // field and leaving the operator to guess.
        setState({ status: 'error', message: transcriptionErrorMessage(400) });
        return;
      }

      onTranscript(text);
      setState({ status: 'idle' });
    } catch {
      if (!liveRef.current) return;
      // Transcription never blocks an inspection (ADR 0017): the note field stays typable either
      // way.
      setState({ status: 'error', message: transcriptionErrorMessage('network') });
    }
  };

  const stop = (): void => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearTimers();
    setState((prev) => (prev.status === 'recording' ? { status: 'idle' } : prev));
  };

  const start = (): void => {
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setState({ status: 'error', message: transcriptionErrorMessage('microphone') });
        return;
      }

      // Stored before anything else can throw. The MediaRecorder constructor rejects bitrate and
      // container combinations on some browsers, and a stream that was never stored is a stream no
      // cleanup path can stop: the microphone and the OS recording indicator would stay live for the
      // rest of the page's life, holding biometric PII capture open (FOIP).
      streamRef.current = stream;

      // The recorder picks its own container (WebM/Opus on Chrome and Android, mp4 on iOS
      // Safari), so the clip is labelled with recorder.mimeType rather than an assumed type. The
      // bitrate is set explicitly to keep a capped recording well under the 10 MB the AI Service
      // accepts.
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
      } catch {
        releaseMicrophone();
        setState({ status: 'error', message: transcriptionErrorMessage('microphone') });
        return;
      }

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        releaseMicrophone();
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (chunks.length === 0) return;
        void sendAudioToAIService(new Blob(chunks, { type: recorder.mimeType }), recorder.mimeType);
      };

      const startedAt = Date.now();
      recorder.start();
      setState({ status: 'recording', elapsedMs: 0 });

      tickRef.current = window.setInterval(() => {
        setState((prev) =>
          prev.status === 'recording'
            ? { status: 'recording', elapsedMs: Date.now() - startedAt }
            : prev,
        );
      }, 250);
      // Auto-stop at the cap. Without it the operator can record past what the AI Service accepts
      // and learn about it only after the upload (a 413).
      capRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
    })();
  };

  return { state, start, stop };
};
