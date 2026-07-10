"""Tests for the assistive Advisory Check path (DEV-83).

The tests exercise the contract and the hard constraints from ADR 0018 and ADR 0017:
assistive only, non-blocking, fail-open, note text stays on-prem, ephemeral. They inject a
fake defect-signal model so the suite does not need the real GGUF weights or llama.cpp.

assess_note is async; the tests drive it with asyncio.run so the suite needs no async pytest
plugin (CI installs plain pytest).
"""

from __future__ import annotations

import asyncio
import socket
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from advisory import AdvisoryStatus, assess_note
from main import app, get_advisory_model


class FakeModel:
    """Records calls and returns a fixed verdict."""

    def __init__(self, verdict: bool) -> None:
        self.verdict = verdict
        self.calls: list[str] = []

    def signals_defect(self, note_text: str) -> bool:
        self.calls.append(note_text)
        return self.verdict


class ExplodingModel:
    def signals_defect(self, note_text: str) -> bool:  # noqa: ARG002
        raise RuntimeError("model backend crashed")


class SlowModel:
    def __init__(self, delay: float) -> None:
        self.delay = delay

    def signals_defect(self, note_text: str) -> bool:  # noqa: ARG002
        import time

        time.sleep(self.delay)
        return True


# --- assess_note: direction and skip rules -----------------------------------------


def test_fail_item_is_not_assessed() -> None:
    # MVP direction: only a note on a PASS item can contradict. A FAIL item is out of scope,
    # and the model must not even be consulted.
    model = FakeModel(verdict=True)
    result = asyncio.run(
        assess_note(
            note_text="hydraulic line is leaking", item_marked_pass=False, model=model
        )
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.OK
    assert model.calls == []


def test_empty_note_is_not_assessed() -> None:
    model = FakeModel(verdict=True)
    result = asyncio.run(
        assess_note(note_text="   ", item_marked_pass=True, model=model)
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.OK
    assert model.calls == []


# --- assess_note: model verdicts ---------------------------------------------------


def test_pass_item_with_defect_note_is_flagged() -> None:
    model = FakeModel(verdict=True)
    result = asyncio.run(
        assess_note(
            note_text="left rear tire is worn down to the cords",
            item_marked_pass=True,
            model=model,
        )
    )
    assert result.flagged is True
    assert result.status is AdvisoryStatus.OK
    assert model.calls == ["left rear tire is worn down to the cords"]


def test_pass_item_with_clean_note_is_not_flagged() -> None:
    model = FakeModel(verdict=False)
    result = asyncio.run(
        assess_note(note_text="checked, all good", item_marked_pass=True, model=model)
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.OK


# --- assess_note: fail-open (never blocks or delays submit) -------------------------


def test_missing_model_is_unavailable_not_flagged() -> None:
    result = asyncio.run(
        assess_note(note_text="brake feels soft", item_marked_pass=True, model=None)
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.UNAVAILABLE


def test_model_error_fails_open() -> None:
    result = asyncio.run(
        assess_note(
            note_text="brake feels soft", item_marked_pass=True, model=ExplodingModel()
        )
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.UNAVAILABLE


def test_slow_model_times_out_and_fails_open() -> None:
    # A slow model must degrade to "no advisory", never delay the operator (ADR 0017).
    result = asyncio.run(
        assess_note(
            note_text="brake feels soft",
            item_marked_pass=True,
            model=SlowModel(delay=1.0),
            timeout_seconds=0.05,
        )
    )
    assert result.flagged is False
    assert result.status is AdvisoryStatus.UNAVAILABLE


# --- note text stays on-prem -------------------------------------------------------


def test_advisory_path_opens_no_network_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Note text never leaves the box (ADR 0018). Block outbound socket connections and confirm
    # the advisory path still completes: it talks only to the in-process model. Blocking connect
    # (not socket creation) targets network egress without breaking asyncio's own internals.
    def blocked_connect(*args: object, **kwargs: object) -> None:
        raise AssertionError("advisory path attempted an outbound network connection")

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked_connect)
    result = asyncio.run(
        assess_note(
            note_text="forks are bent",
            item_marked_pass=True,
            model=FakeModel(verdict=True),
        )
    )
    assert result.flagged is True


# --- ephemeral: nothing written to Inspection or Audit Chain ------------------------


def test_ai_service_has_no_persistence_client() -> None:
    # Ephemeral (ADR 0018): the advisory lives only in the HTTP response. The AI Service
    # holds no database or audit client, so it structurally cannot write to the Inspection or
    # the Audit Chain. Those tables live in core-api and audit-service.
    reqs = (Path(__file__).parent / "requirements.txt").read_text().lower()
    for forbidden in ("psycopg", "asyncpg", "sqlalchemy", "azure-storage", "boto3"):
        assert forbidden not in reqs, f"AI Service must not depend on {forbidden}"


# --- endpoint contract -------------------------------------------------------------


def _client_with_model(model: object | None) -> TestClient:
    app.dependency_overrides[get_advisory_model] = lambda: model
    return TestClient(app)


def test_endpoint_flags_defect_on_pass_item() -> None:
    client = _client_with_model(FakeModel(verdict=True))
    try:
        resp = client.post(
            "/advisory",
            json={"note_text": "coolant leak under the cab", "item_marked_pass": True},
        )
        assert resp.status_code == 200
        assert resp.json() == {"flagged": True, "status": "OK"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_200_unavailable_when_model_missing() -> None:
    # Fail-open at the HTTP layer too: no model means a 200 with UNAVAILABLE, not an error.
    # The PWA treats UNAVAILABLE the same as "no prompt" and submit is never blocked.
    client = _client_with_model(None)
    try:
        resp = client.post(
            "/advisory", json={"note_text": "brake soft", "item_marked_pass": True}
        )
        assert resp.status_code == 200
        assert resp.json() == {"flagged": False, "status": "UNAVAILABLE"}
    finally:
        app.dependency_overrides.clear()


def test_endpoint_never_errors_on_model_crash() -> None:
    client = _client_with_model(ExplodingModel())
    try:
        resp = client.post(
            "/advisory", json={"note_text": "brake soft", "item_marked_pass": True}
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "UNAVAILABLE"
    finally:
        app.dependency_overrides.clear()
