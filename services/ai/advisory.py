"""Assistive Advisory Check logic (DEV-154).

The advisory suggests a defect category for a note the Operator writes on an item they marked
FAIL. It is assistive only (OHS s.257): it never decides pass or fail, never blocks or delays
submission, and is dismissible. The Operator confirms, changes, or dismisses the suggestion; the
confirmed category is the Operator's, not the model's. It is ephemeral here: this module returns a
suggestion, nothing is persisted in the AI Service. See ADR 0028 (Advisory Check, retargeted) and
ADR 0017 (shared mini-PC CPU budget).

This module holds the pure decision logic and the model interface. The concrete on-prem model
(llama.cpp / GGUF) lives in advisory_model.py and is injected, so this logic is testable without
the model runtime or its weights.
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


class DefectCategory(str, Enum):
    """Failure-mode taxonomy (ADR 0028). Fixed enum shared with the Postgres enum, the Zod submit
    validation, and the PWA chip set.

    OTHER is deliberately absent: it is an Operator-only manual choice for a note that fits none
    of these seven, not something the model suggests.
    """

    LEAK = "LEAK"
    DAMAGE = "DAMAGE"
    WEAR = "WEAR"
    MALFUNCTION = "MALFUNCTION"
    MISSING = "MISSING"
    CONTAMINATION = "CONTAMINATION"
    NOISE_VIBRATION = "NOISE_VIBRATION"


@dataclass(frozen=True)
class AdvisoryResult:
    category: DefectCategory | None
    status: AdvisoryStatus


class DefectCategoryModel(Protocol):
    """Classifies the failure mode a note describes, or abstains."""

    def categorize_note(self, note_text: str) -> DefectCategory | None: ...


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

    def __init__(self, model: DefectCategoryModel) -> None:
        self._model = model
        self._in_flight = threading.Lock()

    def categorize_note(self, note_text: str) -> DefectCategory | None:
        if not self._in_flight.acquire(blocking=False):
            raise ModelBusy
        try:
            return self._model.categorize_note(note_text)
        finally:
            self._in_flight.release()


async def assess_note(
    *,
    note_text: str,
    model: DefectCategoryModel | None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> AdvisoryResult:
    """Suggest a defect category for a FAIL-item note.

    The caller (core-api) gates on FAIL plus non-empty note before calling this; this function
    only classifies the text it is given.

    Fails open: a missing, slow, or erroring model yields UNAVAILABLE (no suggestion), never an
    exception, so submit is never blocked or delayed. Abstaining is a normal OK outcome (the model
    ran and found no confident match), not UNAVAILABLE (the model did not run at all).
    """
    if not note_text.strip():
        return AdvisoryResult(category=None, status=AdvisoryStatus.OK)

    if model is None:
        return AdvisoryResult(category=None, status=AdvisoryStatus.UNAVAILABLE)

    try:
        # Inference is synchronous CPU work; run it off the event loop with a hard timeout.
        category = await asyncio.wait_for(
            asyncio.to_thread(model.categorize_note, note_text),
            timeout=timeout_seconds,
        )
    except ModelBusy:
        # Load shed, not a failure: another note is being assessed. Logged at info so it does not
        # read as an incident when several operators are on shift at once.
        logger.info("advisory model busy; returning UNAVAILABLE")
        return AdvisoryResult(category=None, status=AdvisoryStatus.UNAVAILABLE)
    except asyncio.TimeoutError:
        logger.warning("advisory model timed out; returning UNAVAILABLE")
        return AdvisoryResult(category=None, status=AdvisoryStatus.UNAVAILABLE)
    except Exception:
        # Broad by design: the advisory must never propagate a failure to the caller (ADR 0028).
        logger.exception("advisory model failed; returning UNAVAILABLE")
        return AdvisoryResult(category=None, status=AdvisoryStatus.UNAVAILABLE)

    return AdvisoryResult(category=category, status=AdvisoryStatus.OK)
