"""Tests for the on-prem voice-to-text path (DEV-31).

The tests exercise the contract and the hard constraints from DEV-31 and ADR 0017: assistive
only, audio stays on-prem (and off local disk), the concurrency cap defends latency, and every
failure is soft (413 / 503 / 429) so submit is never blocked. They inject a fake transcriber so
the suite needs neither the faster-whisper runtime nor the model weights.

transcribe_clip is async; the tests drive it with asyncio.run so the suite needs no async pytest
plugin (CI installs plain pytest).
"""

from __future__ import annotations

import asyncio
import socket
import tempfile
import threading

import pytest
from fastapi.testclient import TestClient

from main import (
    MAX_REQUEST_BYTES,
    _env,
    _parse_bool,
    app,
    get_acquire_timeout,
    get_inference_timeout,
    get_transcriber,
    get_transcription_semaphore,
)
from transcription import (
    MAX_AUDIO_BYTES,
    AudioTooLarge,
    TranscriptionAtCapacity,
    TranscriptionFailed,
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


class BrokenTranscriber:
    """Stands in for the decoder choking on a corrupt clip."""

    def transcribe(self, audio: bytes) -> str:  # noqa: ARG002
        raise ValueError("corrupt clip")


class BlockingTranscriber:
    """Holds the worker thread until released, so a hang can be simulated deterministically."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def transcribe(self, audio: bytes) -> str:  # noqa: ARG002
        self.started.set()
        self.release.wait(timeout=5)
        return "released"


def _sem(size: int = 2) -> asyncio.Semaphore:
    return asyncio.Semaphore(size)


async def _wait_until_unlocked(
    semaphore: asyncio.Semaphore, timeout: float = 5.0
) -> bool:
    # The slot is freed from a done-callback on the executor future, so it lands on a later loop
    # iteration than the await that raised.
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if not semaphore.locked():
            return True
        await asyncio.sleep(0.01)
    return not semaphore.locked()


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
    inference_timeout: float = 5.0,
) -> TestClient:
    app.dependency_overrides[get_transcriber] = lambda: transcriber
    app.dependency_overrides[get_transcription_semaphore] = lambda: semaphore
    app.dependency_overrides[get_acquire_timeout] = lambda: acquire_timeout
    app.dependency_overrides[get_inference_timeout] = lambda: inference_timeout
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


# --- a failing or hung model is a soft failure, not a 500 --------------------------


def test_model_error_raises_transcription_failed() -> None:
    # A corrupt clip makes the decoder raise. That must not escape as an unhandled exception.
    with pytest.raises(TranscriptionFailed):
        asyncio.run(
            transcribe_clip(
                audio=AUDIO, transcriber=BrokenTranscriber(), semaphore=_sem()
            )
        )


def test_endpoint_returns_503_when_model_errors() -> None:
    client = _override(transcriber=BrokenTranscriber(), semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe", files={"clip": ("note.webm", AUDIO, "audio/webm")}
        )
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_slot_is_released_after_model_error() -> None:
    async def scenario() -> None:
        semaphore = _sem(1)
        with pytest.raises(TranscriptionFailed):
            await transcribe_clip(
                audio=AUDIO, transcriber=BrokenTranscriber(), semaphore=semaphore
            )
        assert await _wait_until_unlocked(semaphore)

    asyncio.run(scenario())


def test_hung_inference_times_out_and_holds_its_slot_until_the_thread_ends() -> None:
    # A hang must not wedge the caller, and must not free the slot while the thread is still on a
    # core: the CPU is genuinely occupied until transcribe() returns.
    async def scenario() -> None:
        semaphore = _sem(1)
        model = BlockingTranscriber()
        with pytest.raises(TranscriptionFailed):
            await transcribe_clip(
                audio=AUDIO,
                transcriber=model,
                semaphore=semaphore,
                inference_timeout_seconds=0.05,
            )
        assert semaphore.locked()
        model.release.set()
        assert await _wait_until_unlocked(semaphore)

    asyncio.run(scenario())


# --- cancellation must not over-admit ----------------------------------------------


def test_cancelled_request_keeps_its_slot_until_the_thread_finishes() -> None:
    # Python cannot preempt a running thread. If a client disconnects mid-transcription the
    # worker keeps burning a core, so admitting a replacement request would push real concurrency
    # past the cap (ADR 0017). The slot is freed only when the thread actually ends.
    async def scenario() -> None:
        semaphore = _sem(1)
        model = BlockingTranscriber()
        task = asyncio.create_task(
            transcribe_clip(audio=AUDIO, transcriber=model, semaphore=semaphore)
        )
        await asyncio.to_thread(model.started.wait, 5)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert semaphore.locked()

        model.release.set()
        assert await _wait_until_unlocked(semaphore)

    asyncio.run(scenario())


# --- audio stays off local disk ----------------------------------------------------


def test_clip_larger_than_the_default_spool_threshold_is_never_written_to_disk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Audio is biometric PII under FOIP. Starlette's multipart parser holds each part in a
    # SpooledTemporaryFile and rolls it over to a real file on disk past its threshold, which at
    # the 1 MB default catches an ordinary voice note. Fail the test if any rollover happens.
    def blocked_rollover(self: object) -> None:
        raise AssertionError("audio was spooled to disk")

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", blocked_rollover)

    client = _override(transcriber=FakeTranscriber("stays in memory"), semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe",
            files={"clip": ("note.webm", b"x" * (2 * 1024 * 1024), "audio/webm")},
        )
        assert resp.status_code == 200
        assert resp.json() == {"text": "stays in memory"}
    finally:
        app.dependency_overrides.clear()


def test_oversized_body_is_rejected_before_the_clip_is_parsed() -> None:
    # The guard runs in middleware, ahead of the multipart parser, so an oversized upload is
    # refused on its declared length instead of being buffered (and spooled) first.
    model = FakeTranscriber()
    client = _override(transcriber=model, semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe",
            files={"clip": ("note.webm", b"x" * (MAX_REQUEST_BYTES + 1), "audio/webm")},
        )
        assert resp.status_code == 413
        assert model.calls == []
    finally:
        app.dependency_overrides.clear()


def test_body_without_a_declared_length_is_rejected() -> None:
    # A chunked body cannot be size-checked without reading it, which is what the guard exists to
    # avoid. The PWA posts a Blob, so the browser always sets Content-Length.
    client = _override(transcriber=FakeTranscriber(), semaphore=_sem())
    try:
        resp = client.post(
            "/transcribe",
            content=iter([b"--boundary--\r\n"]),
            headers={"content-type": "multipart/form-data; boundary=boundary"},
        )
        assert resp.status_code == 411
    finally:
        app.dependency_overrides.clear()


def test_clip_within_the_size_limit_is_accepted() -> None:
    # The framing allowance means a clip at exactly MAX_AUDIO_BYTES still fits under the
    # request-size guard: the guard rejects oversized uploads, it does not shrink the limit.
    assert MAX_REQUEST_BYTES > MAX_AUDIO_BYTES


# --- env parsing -------------------------------------------------------------------


def test_disabled_flag_is_parsed_strictly(monkeypatch: pytest.MonkeyPatch) -> None:
    # bool("false") is True in Python, so a truthiness check would let AI_TRANSCRIPTION_DISABLED
    # =false silently disable transcription and return 503 for every request.
    for raw, expected in (("false", False), ("0", False), ("true", True), ("1", True)):
        monkeypatch.setenv("AI_TRANSCRIPTION_DISABLED", raw)
        assert _env("AI_TRANSCRIPTION_DISABLED", False, _parse_bool) is expected

    monkeypatch.setenv("AI_TRANSCRIPTION_DISABLED", "nonsense")
    assert _env("AI_TRANSCRIPTION_DISABLED", False, _parse_bool) is False
