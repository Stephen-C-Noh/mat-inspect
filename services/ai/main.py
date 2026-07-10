import asyncio
import logging
import os
from contextlib import asynccontextmanager

if os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from advisory import AdvisoryStatus, DefectSignalModel, assess_note
from transcription import (
    DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    DEFAULT_MAX_CONCURRENCY,
    AudioTooLarge,
    Transcriber,
    TranscriptionAtCapacity,
    TranscriptionUnavailable,
    transcribe_clip,
)

logger = logging.getLogger("ai")


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("invalid %s=%r; using default %d", name, raw, default)
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("invalid %s=%r; using default %s", name, raw, default)
        return default


def _load_advisory_model() -> DefectSignalModel | None:
    # The advisory model is optional and lazy. If ADVISORY_MODEL_PATH is unset, or the runtime
    # or weights are missing, the service still boots and the advisory path returns UNAVAILABLE
    # (fail-open), so the PWA simply shows no prompt (ADR 0017, ADR 0018).
    model_path = os.environ.get("ADVISORY_MODEL_PATH")
    if not model_path:
        return None
    try:
        from advisory_model import LlamaCppDefectModel

        return LlamaCppDefectModel(model_path)
    except Exception:
        logger.exception(
            "advisory model failed to load; advisory path will be UNAVAILABLE"
        )
        return None


def _load_transcriber() -> Transcriber | None:
    # faster-whisper small.en, CPU. If the weights cannot be loaded (not mounted, download
    # blocked), the service still boots and /transcribe returns 503: a soft failure the caller
    # handles by keeping the note field editable (ADR 0017). Set AI_TRANSCRIPTION_DISABLED to skip
    # loading entirely (dev without the model).
    if os.environ.get("AI_TRANSCRIPTION_DISABLED"):
        return None
    try:
        from transcription_model import FasterWhisperTranscriber

        model_size = os.environ.get("AI_TRANSCRIPTION_MODEL", "small.en")
        return FasterWhisperTranscriber(model_size_or_path=model_size)
    except Exception:
        logger.exception("transcriber failed to load; /transcribe will return 503")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.advisory_model = _load_advisory_model()
    app.state.transcriber = _load_transcriber()
    # ADR 0017: cap sized to the reserved cores, applied as a matched pair with the Compose
    # cpus/mem_limit reservation. The semaphore, not the event loop, bounds transcription.
    app.state.transcription_semaphore = asyncio.Semaphore(
        _int_env("AI_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY)
    )
    app.state.transcription_acquire_timeout = _float_env(
        "AI_TRANSCRIPTION_ACQUIRE_TIMEOUT", DEFAULT_ACQUIRE_TIMEOUT_SECONDS
    )
    yield
    app.state.advisory_model = None
    app.state.transcriber = None


app = FastAPI(lifespan=lifespan)


def get_advisory_model(request: Request) -> DefectSignalModel | None:
    return getattr(request.app.state, "advisory_model", None)


def get_transcriber(request: Request) -> Transcriber | None:
    return getattr(request.app.state, "transcriber", None)


def get_transcription_semaphore(request: Request) -> asyncio.Semaphore:
    return request.app.state.transcription_semaphore


def get_acquire_timeout(request: Request) -> float:
    return getattr(
        request.app.state,
        "transcription_acquire_timeout",
        DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai"}


class AdvisoryRequest(BaseModel):
    # Note text is the voice transcript or a typed note. Identity and the mark come from the
    # caller; the advisory reads text only.
    note_text: str = Field(..., max_length=4000)
    item_marked_pass: bool


class AdvisoryResponse(BaseModel):
    flagged: bool
    status: AdvisoryStatus


@app.post("/advisory", response_model=AdvisoryResponse)
async def advisory(
    body: AdvisoryRequest,
    model: DefectSignalModel | None = Depends(get_advisory_model),
) -> AdvisoryResponse:
    # Ephemeral: the result is returned in the response only. Nothing is persisted here, and the
    # AI Service holds no client to the Inspection or the Audit Chain (ADR 0018).
    result = await assess_note(
        note_text=body.note_text,
        item_marked_pass=body.item_marked_pass,
        model=model,
    )
    return AdvisoryResponse(flagged=result.flagged, status=result.status)


class TranscriptionResponse(BaseModel):
    # The response carries the assistive transcript text only. It never carries a pass/fail
    # decision (OHS s.257). The PWA sets notesSource VOICE_TRANSCRIBED on the resulting note,
    # then VOICE_EDITED if the operator changes it, and reviews it before submit.
    text: str


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    clip: UploadFile = File(...),
    transcriber: Transcriber | None = Depends(get_transcriber),
    semaphore: asyncio.Semaphore = Depends(get_transcription_semaphore),
    acquire_timeout: float = Depends(get_acquire_timeout),
) -> TranscriptionResponse:
    # Audio stays in memory and on the box: it is read here, passed to the on-prem model, and
    # never written to disk or sent to an external host (FOIP). The three failure paths below are
    # all soft: the caller keeps the note field editable and the operator types instead, so
    # inspection submit is never blocked.
    audio = await clip.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio clip")
    try:
        text = await transcribe_clip(
            audio=audio,
            transcriber=transcriber,
            semaphore=semaphore,
            acquire_timeout_seconds=acquire_timeout,
        )
    except AudioTooLarge:
        raise HTTPException(status_code=413, detail="audio clip too large")
    except TranscriptionUnavailable:
        raise HTTPException(status_code=503, detail="transcription unavailable")
    except TranscriptionAtCapacity:
        raise HTTPException(status_code=429, detail="transcription at capacity")
    return TranscriptionResponse(text=text)
