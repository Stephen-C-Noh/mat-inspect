"""Tests for the assistive Advisory Check path (DEV-154).

The tests exercise the contract and the hard constraints from ADR 0028 and ADR 0017:
assistive only, non-blocking, fail-open, note text stays on-prem, ephemeral. They inject a
fake defect-category model so the suite does not need the real GGUF weights or llama.cpp.

assess_note is async; the tests drive it with asyncio.run so the suite needs no async pytest
plugin (CI installs plain pytest).
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from advisory import (
    AdvisoryResult,
    AdvisoryStatus,
    DefectCategory,
    SerializedDefectModel,
    assess_note,
)
from main import app, get_advisory_model


class FakeModel:
    """Records calls and returns a fixed category (or abstains with None)."""

    def __init__(self, category: DefectCategory | None) -> None:
        self.category = category
        self.calls: list[str] = []

    def categorize_note(self, note_text: str) -> DefectCategory | None:
        self.calls.append(note_text)
        return self.category


class ExplodingModel:
    def categorize_note(self, note_text: str) -> DefectCategory | None:  # noqa: ARG002
        raise RuntimeError("model backend crashed")


class SlowModel:
    def __init__(self, delay: float) -> None:
        self.delay = delay

    def categorize_note(self, note_text: str) -> DefectCategory | None:  # noqa: ARG002
        import time

        time.sleep(self.delay)
        return DefectCategory.LEAK


# --- assess_note: skip rules --------------------------------------------------------


def test_empty_note_is_not_assessed() -> None:
    model = FakeModel(category=DefectCategory.LEAK)
    result = asyncio.run(assess_note(note_text="   ", model=model))
    assert result.category is None
    assert result.status is AdvisoryStatus.OK
    assert model.calls == []


# --- assess_note: model verdicts -----------------------------------------------------


def test_fail_note_with_defect_gets_a_category() -> None:
    model = FakeModel(category=DefectCategory.WEAR)
    result = asyncio.run(
        assess_note(
            note_text="left rear tire is worn down to the cords",
            model=model,
        )
    )
    assert result.category is DefectCategory.WEAR
    assert result.status is AdvisoryStatus.OK
    assert model.calls == ["left rear tire is worn down to the cords"]


def test_model_abstain_is_ok_status_with_no_category() -> None:
    # Abstaining is a normal outcome (the model ran and found no confident match), not a failure.
    model = FakeModel(category=None)
    result = asyncio.run(assess_note(note_text="something seems off", model=model))
    assert result.category is None
    assert result.status is AdvisoryStatus.OK


# --- assess_note: fail-open (never blocks or delays submit) -------------------------


def test_missing_model_is_unavailable_not_categorized() -> None:
    result = asyncio.run(assess_note(note_text="brake feels soft", model=None))
    assert result.category is None
    assert result.status is AdvisoryStatus.UNAVAILABLE


def test_model_error_fails_open() -> None:
    result = asyncio.run(
        assess_note(note_text="brake feels soft", model=ExplodingModel())
    )
    assert result.category is None
    assert result.status is AdvisoryStatus.UNAVAILABLE


def test_slow_model_times_out_and_fails_open() -> None:
    # A slow model must degrade to "no advisory", never delay the operator (ADR 0017).
    result = asyncio.run(
        assess_note(
            note_text="brake feels soft",
            model=SlowModel(delay=1.0),
            timeout_seconds=0.05,
        )
    )
    assert result.category is None
    assert result.status is AdvisoryStatus.UNAVAILABLE


# --- serialization: the model never sees two inferences at once ---------------------


class OverlapDetectingModel:
    """Fails if a second call starts while the first is still inside the model."""

    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.concurrent = 0
        self.max_concurrent = 0
        self.calls = 0
        self._lock = threading.Lock()

    def categorize_note(self, note_text: str) -> DefectCategory | None:  # noqa: ARG002
        with self._lock:
            self.calls += 1
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
        try:
            time.sleep(self.delay)
            return DefectCategory.LEAK
        finally:
            with self._lock:
                self.concurrent -= 1


def test_serialized_model_never_runs_two_inferences_at_once() -> None:
    # llama.cpp's context is not thread-safe: two overlapping inferences corrupt its tensors and
    # kill the process (GGML_ASSERT), taking transcription down with it. Observed on the mini-PC
    # in DEV-95 with two concurrent /advisory calls. Nothing else guards this path; the ADR 0017
    # semaphore covers transcription only.
    inner = OverlapDetectingModel(delay=0.2)
    model = SerializedDefectModel(inner)

    async def two_at_once() -> list[AdvisoryResult]:
        return list(
            await asyncio.gather(
                assess_note(note_text="hose leaking", model=model),
                assess_note(note_text="chain frayed", model=model),
            )
        )

    results = asyncio.run(two_at_once())

    assert inner.max_concurrent == 1, "two inferences overlapped inside the model"
    # The loser is shed, not queued: one real verdict, one UNAVAILABLE.
    statuses = sorted(r.status for r in results)
    assert statuses == [AdvisoryStatus.OK, AdvisoryStatus.UNAVAILABLE]


def test_serialized_model_stays_usable_after_a_shed_call() -> None:
    # Shedding must not leave the lock held. A subsequent note is assessed normally.
    inner = OverlapDetectingModel(delay=0.05)
    model = SerializedDefectModel(inner)

    async def contend_then_retry() -> AdvisoryResult:
        await asyncio.gather(
            assess_note(note_text="a", model=model),
            assess_note(note_text="b", model=model),
        )
        return await assess_note(note_text="forks are bent", model=model)

    result = asyncio.run(contend_then_retry())
    assert result.status is AdvisoryStatus.OK
    assert result.category is DefectCategory.LEAK


def test_timed_out_inference_keeps_holding_the_model() -> None:
    # asyncio.wait_for cancels the coroutine that is waiting; it cannot stop native work already
    # running in a thread. The timed-out inference is therefore still inside the model, and a
    # request arriving behind it must be shed rather than started on top of it. This is the exact
    # sequence that segfaulted the AI Service on the mini-PC.
    inner = OverlapDetectingModel(delay=0.5)
    model = SerializedDefectModel(inner)

    async def timeout_then_immediately_retry() -> AdvisoryResult:
        slow = await assess_note(
            note_text="hose leaking",
            model=model,
            timeout_seconds=0.05,
        )
        assert slow.status is AdvisoryStatus.UNAVAILABLE
        # The first inference is still running in its thread right now.
        return await assess_note(note_text="chain frayed", model=model)

    second = asyncio.run(timeout_then_immediately_retry())
    assert second.status is AdvisoryStatus.UNAVAILABLE
    assert inner.max_concurrent == 1, (
        "a timed-out inference was overlapped by the next one"
    )


# --- note text stays on-prem -------------------------------------------------------


def test_advisory_path_opens_no_network_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Note text never leaves the box (ADR 0028). Block outbound socket connections and confirm
    # the advisory path still completes: it talks only to the in-process model. Blocking connect
    # (not socket creation) targets network egress without breaking asyncio's own internals.
    def blocked_connect(*args: object, **kwargs: object) -> None:
        raise AssertionError("advisory path attempted an outbound network connection")

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked_connect)
    result = asyncio.run(
        assess_note(
            note_text="forks are bent",
            model=FakeModel(category=DefectCategory.DAMAGE),
        )
    )
    assert result.category is DefectCategory.DAMAGE


# --- ephemeral: nothing written to Inspection or Audit Chain ------------------------


def test_ai_service_has_no_persistence_client() -> None:
    # Ephemeral (ADR 0028): the advisory lives only in the HTTP response. The AI Service
    # holds no database or audit client, so it structurally cannot write to the Inspection or
    # the Audit Chain. Those tables live in core-api and audit-service.
    reqs = (Path(__file__).parent / "requirements.txt").read_text().lower()
    for forbidden in ("psycopg", "asyncpg", "sqlalchemy", "azure-storage", "boto3"):
        assert forbidden not in reqs, f"AI Service must not depend on {forbidden}"


# --- endpoint contract -------------------------------------------------------------


def _client_with_model(model: object | None) -> TestClient:
    app.dependency_overrides[get_advisory_model] = lambda: model
    return TestClient(app)


def test_endpoint_returns_category_for_fail_note() -> None:
    client = _client_with_model(FakeModel(category=DefectCategory.LEAK))
    try:
        resp = client.post(
            "/advisory",
            json={"note_text": "coolant leak under the cab"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"category": "LEAK", "status": "OK"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_null_category_on_abstain() -> None:
    client = _client_with_model(FakeModel(category=None))
    try:
        resp = client.post("/advisory", json={"note_text": "something seems off"})
        assert resp.status_code == 200
        assert resp.json() == {"category": None, "status": "OK"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_200_unavailable_when_model_missing() -> None:
    # Fail-open at the HTTP layer too: no model means a 200 with UNAVAILABLE, not an error.
    # The PWA treats UNAVAILABLE the same as "no prompt" and submit is never blocked.
    client = _client_with_model(None)
    try:
        resp = client.post("/advisory", json={"note_text": "brake soft"})
        assert resp.status_code == 200
        assert resp.json() == {"category": None, "status": "UNAVAILABLE"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_never_errors_on_model_crash() -> None:
    client = _client_with_model(ExplodingModel())
    try:
        resp = client.post("/advisory", json={"note_text": "brake soft"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "UNAVAILABLE"
    finally:
        app.dependency_overrides.clear()
