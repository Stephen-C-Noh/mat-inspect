"""Assistive Advisory Check logic (DEV-83).

The advisory flags when an Operator's free-text note appears to signal a defect on an item
they marked PASS. It is assistive only (OHS s.257): it never blocks submission, never changes
the Inspection Result, and is dismissible. It is ephemeral: nothing here is persisted. See
ADR 0018 (Advisory Check) and ADR 0017 (shared mini-PC CPU budget).

This module holds the pure decision logic and the model interface. The concrete on-prem model
(llama.cpp / GGUF) lives in advisory_model.py and is injected, so this logic is testable
without the model runtime or its weights.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Protocol

logger = logging.getLogger("ai.advisory")

# The advisory is non-blocking and must never delay submit. If the model does not answer inside
# this budget the path degrades to "no advisory" (ADR 0017). It is a safety valve, not the
# nominal latency target; the mini-PC benchmark sets the real per-note figure.
DEFAULT_TIMEOUT_SECONDS = 4.0


class AdvisoryStatus(str, Enum):
    OK = "OK"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass(frozen=True)
class AdvisoryResult:
    flagged: bool
    status: AdvisoryStatus


class DefectSignalModel(Protocol):
    """Judges whether note text reports a defect, damage, or problem with the item."""

    def signals_defect(self, note_text: str) -> bool: ...


class ModelBusy(Exception):
    """An inference is already in flight. Expected under load, not an error."""


class SerializedDefectModel:
    """Serializes inference so the underlying model never sees two calls at once.

    llama.cpp's context is not thread-safe. Two overlapping inferences corrupt its tensors and
    kill the process (`GGML_ASSERT(a->ne[2] == b->ne[0]) failed`, observed on the mini-PC in
    DEV-95), which takes transcription down with it: they share one process. Nothing else guards
    this path. The ADR 0017 semaphore covers transcription only, and two operators writing notes
    at the same time is ordinary, not peak, load.

    The lock is taken and released by the thread that runs the native call, which is what makes
    this hold under the timeout in assess_note. `asyncio.wait_for` cancels the coroutine that is
    waiting; it cannot stop native work already running in a thread. So a timed-out inference
    keeps running, and it keeps holding this lock until it truly returns, which is exactly when
    it becomes safe for another inference to start.

    A caller that arrives mid-inference is shed (ModelBusy, which the advisory reports as
    UNAVAILABLE), not queued behind it. The advisory is assistive and dismissible: an operator
    who has already submitted has no use for a prompt that arrives late, and queueing would let a
    backlog outlive the request that caused it.
    """

    def __init__(self, model: DefectSignalModel) -> None:
        self._model = model
        self._in_flight = threading.Lock()

    def signals_defect(self, note_text: str) -> bool:
        if not self._in_flight.acquire(blocking=False):
            raise ModelBusy
        try:
            return self._model.signals_defect(note_text)
        finally:
            self._in_flight.release()


async def assess_note(
    *,
    note_text: str,
    item_marked_pass: bool,
    model: DefectSignalModel | None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> AdvisoryResult:
    """Return whether the note should raise an advisory against a PASS mark.

    Fails open: a missing, slow, or erroring model yields UNAVAILABLE (no prompt), never an
    exception, so submit is never blocked or delayed.
    """
    # MVP direction: only a note on a PASS item can contradict the mark. A FAIL item is out of
    # scope, so the model is not consulted.
    if not item_marked_pass:
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.OK)

    if not note_text.strip():
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.OK)

    if model is None:
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.UNAVAILABLE)

    try:
        # Inference is synchronous CPU work; run it off the event loop with a hard timeout.
        flagged = await asyncio.wait_for(
            asyncio.to_thread(model.signals_defect, note_text),
            timeout=timeout_seconds,
        )
    except ModelBusy:
        # Load shed, not a failure: another note is being assessed. Logged at info so it does not
        # read as an incident when several operators are on shift at once.
        logger.info("advisory model busy; returning UNAVAILABLE")
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.UNAVAILABLE)
    except asyncio.TimeoutError:
        logger.warning("advisory model timed out; returning UNAVAILABLE")
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.UNAVAILABLE)
    except Exception:
        # Broad by design: the advisory must never propagate a failure to the caller (ADR 0018).
        logger.exception("advisory model failed; returning UNAVAILABLE")
        return AdvisoryResult(flagged=False, status=AdvisoryStatus.UNAVAILABLE)

    return AdvisoryResult(flagged=bool(flagged), status=AdvisoryStatus.OK)
