"""Tests for the on-prem voice-to-text path (DEV-31).

The tests exercise the contract and the hard constraints from DEV-31 and ADR 0017: assistive
only, audio stays on-prem, the concurrency cap defends latency, and every failure is soft (413 /
503 / 429) so submit is never blocked. They inject a fake transcriber so the suite needs neither
the faster-whisper runtime nor the model weights.

transcribe_clip is async; the tests drive it with asyncio.run so the suite needs no async pytest
plugin (CI installs plain pytest).
"""

from __future__ import annotations

import asyncio
import socket

import pytest
from fastapi.testclient import TestClient

from main import (
    app,
    get_acquire_timeout,
    get_transcriber,
    get_transcription_semaphore,
)
from transcription import (
    AudioTooLarge,
    TranscriptionAtCapacity,
    TranscriptionUnavailable,
    transcribe_clip,
)

AUDIO = b"fake-webm-bytes"


class FakeTranscriber:
    """Records calls and returns a fixed transcript."""

    def __init__(self, text: str = "left rear tire looks worn") -> None:
        self.text = text
        self.calls: list[bytes] = []

    def transcribe(self, audio: bytes) -> str:
        self.calls.append(audio)
        return self.text


class SlowTranscriber:
    def __init__(self, delay: float) -> None:
        self.delay = delay

    def transcribe(self, audio: bytes) -> str:  # noqa: ARG002
        import time

        time.sleep(self.delay)
        return "done"


def _sem(size: int = 2) -> asyncio.Semaphore:
    return asyncio.Semaphore(size)


# --- transcribe_clip: happy path ---------------------------------------------------


def test_transcribe_returns_text() -> None:
    model = FakeTranscriber("brake pedal feels soft")
    text = asyncio.run(
        transcribe_clip(audio=AUDIO, transcriber=model, semaphore=_sem())
    )
    assert text == "brake pedal feels soft"
    assert model.calls == [AUDIO]


# --- transcribe_clip: soft-failure paths -------------------------------------------


def test_missing_model_raises_unavailable() -> None:
    with pytest.raises(TranscriptionUnavailable):
        asyncio.run(transcribe_clip(audio=AUDIO, transcriber=None, semaphore=_sem()))


def test_oversized_clip_raises_too_large() -> None:
    with pytest.raises(AudioTooLarge):
        asyncio.run(
            transcribe_clip(
                audio=b"x" * 11,
                transcriber=FakeTranscriber(),
                semaphore=_sem(),
                max_audio_bytes=10,
            )
        )


def test_saturated_cap_raises_at_capacity() -> None:
    # A drained semaphore (cap already fully in use) makes the next request wait, then give up
    # with 429 rather than pile onto the CPU (ADR 0017).
    async def scenario() -> None:
        semaphore = _sem(1)
        await semaphore.acquire()  # occupy the only slot
        with pytest.raises(TranscriptionAtCapacity):
            await transcribe_clip(
                audio=AUDIO,
                transcriber=FakeTranscriber(),
                semaphore=semaphore,
                acquire_timeout_seconds=0.05,
            )

    asyncio.run(scenario())


def test_slot_is_released_after_success() -> None:
    # A cap of 1 must be reusable across sequential requests: the semaphore is released in a
    # finally, so a slow first call does not permanently consume the only slot.
    async def scenario() -> None:
        semaphore = _sem(1)
        first = await transcribe_clip(
            audio=AUDIO, transcriber=SlowTranscriber(delay=0.02), semaphore=semaphore
        )
        second = await transcribe_clip(
            audio=AUDIO, transcriber=FakeTranscriber("second"), semaphore=semaphore
        )
        assert first == "done"
        assert second == "second"

    asyncio.run(scenario())


# --- audio stays on-prem -----------------------------------------------------------


def test_transcription_path_opens_no_network_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Audio is biometric PII under FOIP and never leaves the box. Block outbound socket
    # connections and confirm the transcription path still completes: it talks only to the
    # in-process model. Blocking connect (not socket creation) targets network egress without
    # breaking asyncio's own internals.
    def blocked_connect(*args: object, **kwargs: object) -> None:
        raise AssertionError(
            "transcription path attempted an outbound network connection"
        )

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked_connect)
    text = asyncio.run(
        transcribe_clip(
            audio=AUDIO, transcriber=FakeTranscriber("no egress"), semaphore=_sem()
        )
    )
    assert text == "no egress"


# --- endpoint contract -------------------------------------------------------------


def _override(
    *,
    transcriber: object | None,
    semaphore: asyncio.Semaphore,
    acquire_timeout: float = 0.05,
) -> TestClient:
    app.dependency_overrides[get_transcriber] = lambda: transcriber
    app.dependency_overrides[get_transcription_semaphore] = lambda: semaphore
    app.dependency_overrides[get_acquire_timeout] = lambda: acquire_timeout
    return TestClient(app)


def test_endpoint_returns_transcript() -> None:
    client = _override(
        transcriber=FakeTranscriber("coolant pooling under cab"), semaphore=_sem()
    )
    try:
        resp = client.post(
            "/transcribe", files={"clip": ("note.webm", AUDIO, "audio/webm")}
        )
        assert resp.status_code == 200
        assert resp.json() == {"text": "coolant pooling under cab"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_rejects_empty_clip() -> None:
    client = _override(transcriber=FakeTranscriber(), semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe", files={"clip": ("note.webm", b"", "audio/webm")}
        )
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_503_when_model_missing() -> None:
    # Down is a soft failure: 503, not a crash. The PWA keeps the note field editable.
    client = _override(transcriber=None, semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe", files={"clip": ("note.webm", AUDIO, "audio/webm")}
        )
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_429_when_at_capacity() -> None:
    semaphore = _sem(1)
    asyncio.run(semaphore.acquire())  # drain the only slot before the request
    client = _override(
        transcriber=FakeTranscriber(), semaphore=semaphore, acquire_timeout=0.05
    )
    try:
        resp = client.post(
            "/transcribe", files={"clip": ("note.webm", AUDIO, "audio/webm")}
        )
        assert resp.status_code == 429
    finally:
        app.dependency_overrides.clear()


def test_response_carries_no_pass_fail_field() -> None:
    # Assistive only (OHS s.257): the transcript never encodes a decision. The response schema is
    # exactly the text field, nothing that could auto-pass or auto-fail an item.
    from main import TranscriptionResponse

    assert set(TranscriptionResponse.model_fields) == {"text"}
