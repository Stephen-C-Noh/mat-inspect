"""On-prem voice-to-text transcription (DEV-31).

faster-whisper small.en, CPU inference. Audio is biometric PII under FOIP: it stays on
SAIT-controlled infrastructure and is never sent to an external AI API. Transcription is
assistive only (OHS s.257): it produces editable note text, it never decides pass or fail.

This module holds the pure orchestration (size guard, concurrency cap, threading) and the model
interface. The concrete faster-whisper model lives in transcription_model.py and is injected, so
this logic is testable without the model weights or the CTranslate2 runtime.

The concurrency cap defends the DEV-31 latency NFR on the shared mini-PC (ADR 0017): the cap
equals the reserved core count. A request that cannot get a slot waits briefly, then gets 429; a
missing model yields 503. Both are soft failures for the caller: the PWA keeps the note field
editable and the operator types instead. Submit is never blocked.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

logger = logging.getLogger("ai.transcription")

# ADR 0017: the cap equals the cores reserved for the ai container. Two consumers share the box
# (transcription and the advisory); transcription is the bottleneck, so the cap gates it.
DEFAULT_MAX_CONCURRENCY = 2

# A request that cannot get a slot waits this long, then returns 429 rather than piling onto the
# CPU and blowing the latency budget for the transcriptions already in flight.
DEFAULT_ACQUIRE_TIMEOUT_SECONDS = 2.0

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


class AudioTooLarge(Exception):
    """The clip exceeds max_audio_bytes (413)."""


async def transcribe_clip(
    *,
    audio: bytes,
    transcriber: Transcriber | None,
    semaphore: asyncio.Semaphore,
    acquire_timeout_seconds: float = DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    max_audio_bytes: int = MAX_AUDIO_BYTES,
) -> str:
    """Transcribe one clip under the concurrency cap.

    Raises AudioTooLarge, TranscriptionUnavailable, or TranscriptionAtCapacity for the three
    soft-failure paths. On success returns the transcript text (may be empty for silence).
    """
    if len(audio) > max_audio_bytes:
        raise AudioTooLarge

    if transcriber is None:
        raise TranscriptionUnavailable

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=acquire_timeout_seconds)
    except asyncio.TimeoutError as exc:
        raise TranscriptionAtCapacity from exc

    try:
        # Inference is synchronous CPU work; run it off the event loop so the semaphore, not the
        # loop, is what bounds concurrency. transcribe() opens no network connection, so the audio
        # never leaves the box.
        return await asyncio.to_thread(transcriber.transcribe, audio)
    finally:
        semaphore.release()
