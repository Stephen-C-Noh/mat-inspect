"""On-prem voice-to-text transcription (DEV-31).

faster-whisper small.en, CPU inference. Audio is biometric PII under FOIP: it stays on
SAIT-controlled infrastructure and is never sent to an external AI API. Transcription is
assistive only (OHS s.257): it produces editable note text, it never decides pass or fail.

This module holds the pure orchestration (size guard, concurrency cap, threading) and the model
interface. The concrete faster-whisper model lives in transcription_model.py and is injected, so
this logic is testable without the model weights or the CTranslate2 runtime.

The concurrency cap defends the DEV-31 latency NFR on the shared mini-PC (ADR 0017): the cap
equals the CPU ceiling set on the ai container. A request that cannot get a slot waits briefly,
then gets 429; a missing, failing, or hung model yields 503. All are soft failures for the
caller: the PWA keeps the note field editable and the operator types instead. Submit is never
blocked.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

logger = logging.getLogger("ai.transcription")

# ADR 0017: the cap equals the CPU ceiling set on the ai container (AI_CPUS in Compose). Two
# consumers share the box (transcription and the advisory); transcription is the bottleneck, so
# the cap gates it. Compose passes AI_MAX_CONCURRENCY from the same value; this default only
# applies when the variable is unset (a bare `python -m uvicorn`, or a test).
DEFAULT_MAX_CONCURRENCY = 2

# A request that cannot get a slot waits this long, then returns 429 rather than piling onto the
# CPU and blowing the latency budget for the transcriptions already in flight.
DEFAULT_ACQUIRE_TIMEOUT_SECONDS = 2.0

# A safety valve, not the latency target: the NFR budget for a 15-second clip is 5 seconds, and
# the mini-PC benchmark sets the real figure. This bounds a pathological decode (a corrupt or
# adversarial clip that makes the native decoder spin) so the caller gets a soft failure instead
# of waiting forever.
DEFAULT_INFERENCE_TIMEOUT_SECONDS = 30.0

# A pre-use voice note is short (the NFR sizes a 15-second clip). This bounds memory and rejects
# oversized or wrong-endpoint uploads before they reach the model.
MAX_AUDIO_BYTES = 10 * 1024 * 1024


class Transcriber(Protocol):
    """Turns encoded audio bytes into transcript text. Runs entirely on-prem."""

    def transcribe(self, audio: bytes) -> str: ...


class TranscriptionUnavailable(Exception):
    """The model is not loaded. The caller degrades to typed notes (503)."""


class TranscriptionAtCapacity(Exception):
    """The concurrency cap is saturated. The caller retries or types instead (429)."""


class TranscriptionFailed(Exception):
    """Inference raised or ran past its timeout. The caller degrades to typed notes (503)."""


class AudioTooLarge(Exception):
    """The clip exceeds max_audio_bytes (413)."""


async def transcribe_clip(
    *,
    audio: bytes,
    transcriber: Transcriber | None,
    semaphore: asyncio.Semaphore,
    acquire_timeout_seconds: float = DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    inference_timeout_seconds: float = DEFAULT_INFERENCE_TIMEOUT_SECONDS,
    max_audio_bytes: int = MAX_AUDIO_BYTES,
) -> str:
    """Transcribe one clip under the concurrency cap.

    Raises AudioTooLarge, TranscriptionUnavailable, TranscriptionAtCapacity, or
    TranscriptionFailed. Every failure is one of those four: none of them blocks submit, and no
    model error reaches the caller as a crash. On success returns the transcript text (may be
    empty for silence).
    """
    if len(audio) > max_audio_bytes:
        raise AudioTooLarge

    if transcriber is None:
        raise TranscriptionUnavailable

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=acquire_timeout_seconds)
    except asyncio.TimeoutError as exc:
        raise TranscriptionAtCapacity from exc

    # Inference is synchronous CPU work; run it off the event loop so the semaphore, not the
    # loop, is what bounds concurrency. transcribe() opens no network connection, so the audio
    # never leaves the box.
    try:
        future = asyncio.get_running_loop().run_in_executor(
            None, transcriber.transcribe, audio
        )
    except Exception:
        semaphore.release()
        raise

    # The slot is freed when the worker thread actually finishes, not when this coroutine stops
    # awaiting. Python cannot preempt a running thread: on a client disconnect or a timeout the
    # thread keeps burning a core, so releasing on the await would admit a new request on top of
    # it and push real concurrency past the cap (ADR 0017).
    future.add_done_callback(lambda _: semaphore.release())

    try:
        # shield: a timeout stops this caller waiting, it does not (and cannot) stop the thread.
        # The done-callback above still frees the slot once the thread ends.
        return await asyncio.wait_for(
            asyncio.shield(future), timeout=inference_timeout_seconds
        )
    except asyncio.TimeoutError as exc:
        logger.warning(
            "transcription exceeded %ss; returning 503", inference_timeout_seconds
        )
        raise TranscriptionFailed from exc
    except Exception as exc:
        # Broad by design: a corrupt clip makes the decoder raise, and that must surface as a
        # soft failure, not a 500. Do not log the exception's payload; it can carry audio bytes.
        logger.warning("transcription failed: %s", type(exc).__name__)
        raise TranscriptionFailed from exc
