import asyncio
import logging
import math
import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import TypeVar

if os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.formparsers import MultiPartParser

from advisory import (
    AdvisoryStatus,
    DefectCategory,
    DefectCategoryModel,
    SerializedDefectModel,
    assess_note,
)
from transcription import (
    DEFAULT_ACQUIRE_TIMEOUT_SECONDS,
    DEFAULT_INFERENCE_TIMEOUT_SECONDS,
    DEFAULT_MAX_CONCURRENCY,
    MAX_AUDIO_BYTES,
    AudioTooLarge,
    Transcriber,
    TranscriptionAtCapacity,
    TranscriptionFailed,
    TranscriptionUnavailable,
    transcribe_clip,
)

logger = logging.getLogger("ai")

T = TypeVar("T")


def _env(name: str, default: T, cast: Callable[[str], T]) -> T:
    """Read one env var, falling back to the default if it is unset or unparseable."""
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return cast(raw)
    except ValueError:
        logger.warning("invalid %s=%r; using default %r", name, raw, default)
        return default


def _parse_concurrency(raw: str) -> int:
    # Compose passes AI_MAX_CONCURRENCY and the container's `cpus` ceiling from one value (AI_CPUS,
    # ADR 0017), but Docker accepts a fractional CPU limit and a semaphore cannot be fractional.
    # Floor it, so the cap never exceeds the CPU the container may actually use: AI_CPUS=1.5 gives a
    # ceiling of 1.5 cores and a cap of 1. A plain int() would raise on "1.5" and fall back to the
    # default of 2, which is the desync this derivation exists to prevent.
    #
    # Floor to at least 1. AI_CPUS=0 means "unlimited" to Docker, but Semaphore(0) would admit
    # nothing and answer 429 to every clip forever, and a 429 is a soft failure the operator sees
    # only as "type the note instead". A silently dead transcription path is worse than a
    # conservative one.
    value = math.floor(float(raw))
    return max(1, value)


_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def _parse_bool(raw: str) -> bool:
    # Strict: bool("false") is True in Python, so a plain truthiness check would let
    # AI_TRANSCRIPTION_DISABLED=false silently disable transcription.
    value = raw.strip().lower()
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    raise ValueError(raw)


def _load_advisory_model() -> DefectCategoryModel | None:
    # The advisory model is optional and lazy. If ADVISORY_MODEL_PATH is unset, or the runtime
    # or weights are missing, the service still boots and the advisory path returns UNAVAILABLE
    # (fail-open), so the PWA simply shows no prompt (ADR 0017, ADR 0028).
    model_path = os.environ.get("ADVISORY_MODEL_PATH")
    if not model_path:
        return None
    try:
        from advisory_model import LlamaCppDefectModel

        model = SerializedDefectModel(LlamaCppDefectModel(model_path))
        # First inference on a freshly loaded model is far slower than a warm one: llama.cpp mmaps
        # the weights, so the first pass faults them in. On the mini-PC that cold pass took 4.4 s
        # and blew the 4 s advisory budget, which made the first advisory after every deploy
        # UNAVAILABLE. Pay it here, at boot, instead of on an operator's first note.
        model.categorize_note("warmup")
        return model
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
    if _env("AI_TRANSCRIPTION_DISABLED", False, _parse_bool):
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
    # ADR 0017: the cap is sized to the CPU ceiling on the ai container. Compose derives
    # AI_MAX_CONCURRENCY and the container's `cpus` ceiling from one value (AI_CPUS), so the two
    # cannot drift apart. The semaphore, not the event loop, bounds transcription.
    app.state.transcription_semaphore = asyncio.Semaphore(
        _env("AI_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY, _parse_concurrency)
    )
    app.state.transcription_acquire_timeout = _env(
        "AI_TRANSCRIPTION_ACQUIRE_TIMEOUT", DEFAULT_ACQUIRE_TIMEOUT_SECONDS, float
    )
    app.state.transcription_inference_timeout = _env(
        "AI_TRANSCRIPTION_TIMEOUT", DEFAULT_INFERENCE_TIMEOUT_SECONDS, float
    )
    yield
    app.state.advisory_model = None
    app.state.transcriber = None


app = FastAPI(lifespan=lifespan)

# Set at app creation as well as in lifespan(), so the accessors below always find state and can
# read it directly. The semaphore in particular has no safe per-request fallback: handing back a
# fresh Semaphore would silently remove the concurrency cap (ADR 0017).
app.state.advisory_model = None
app.state.transcriber = None
app.state.transcription_semaphore = asyncio.Semaphore(DEFAULT_MAX_CONCURRENCY)
app.state.transcription_acquire_timeout = DEFAULT_ACQUIRE_TIMEOUT_SECONDS
app.state.transcription_inference_timeout = DEFAULT_INFERENCE_TIMEOUT_SECONDS

# Multipart framing (boundary, part headers) wrapped around the clip itself.
MULTIPART_OVERHEAD_BYTES = 4 * 1024
MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES

# FOIP: audio is biometric PII. Starlette spools an upload part to a temp file on disk once it
# grows past this threshold (SpooledTemporaryFile), which at the 1 MB default would write most
# real voice notes to local disk before the app ever sees them. Raise it above the largest body
# the guard below admits, so a request that gets parsed at all is held only in memory.
#
# max_file_size is Starlette's own class attribute, not a public setting. If a version bump renames
# or drops it, a plain assignment would create a dead attribute, the parser would fall back to its
# 1 MB default, and voice notes would start landing on disk with nothing to say so. Fail the boot
# instead: a service that cannot honour the FOIP constraint must not accept audio.
if not hasattr(MultiPartParser, "max_file_size"):
    raise RuntimeError(
        "starlette MultiPartParser has no max_file_size attribute; the multipart spool threshold "
        "cannot be raised, so audio would be written to disk (FOIP). Pin starlette or port this "
        "guard to the new attribute."
    )
MultiPartParser.max_file_size = MAX_REQUEST_BYTES


@app.middleware("http")
async def limit_transcribe_body(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Runs before routing, so an oversized clip is rejected before the multipart parser reads
    # (and would spool) it. A dependency would be too late: FastAPI parses the form first.
    if request.url.path != "/transcribe" or request.method != "POST":
        return await call_next(request)

    declared = request.headers.get("content-length")
    if declared is None:
        # Without a length the body can only be measured by reading it, which is the thing this
        # guard exists to avoid. The PWA posts a Blob, so the browser always sets it.
        return JSONResponse(
            status_code=411, content={"detail": "content-length required"}
        )
    try:
        length = int(declared)
    except ValueError:
        return JSONResponse(
            status_code=400, content={"detail": "invalid content-length"}
        )
    if length > MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "audio clip too large"})
    return await call_next(request)


def get_advisory_model(request: Request) -> DefectCategoryModel | None:
    return request.app.state.advisory_model


def get_transcriber(request: Request) -> Transcriber | None:
    return request.app.state.transcriber


def get_transcription_semaphore(request: Request) -> asyncio.Semaphore:
    return request.app.state.transcription_semaphore


def get_acquire_timeout(request: Request) -> float:
    return request.app.state.transcription_acquire_timeout


def get_inference_timeout(request: Request) -> float:
    return request.app.state.transcription_inference_timeout


@app.get("/health")
def health() -> dict[str, str]:
    # revision: the commit this image was built from (DEV-99), so a deployed stack can be asked
    # from outside whether it is on the commit it is supposed to be on, not just whether it is alive.
    return {
        "status": "ok",
        "service": "ai",
        "revision": os.environ.get("GIT_SHA", "unknown"),
    }


class AdvisoryRequest(BaseModel):
    # Note text is the voice transcript or a typed note on a FAIL item. Identity and the mark come
    # from the caller (core-api gates on FAIL plus non-empty note); the advisory reads text only.
    note_text: str = Field(..., max_length=4000)


class AdvisoryResponse(BaseModel):
    category: DefectCategory | None
    status: AdvisoryStatus


@app.post("/advisory", response_model=AdvisoryResponse)
async def advisory(
    body: AdvisoryRequest,
    model: DefectCategoryModel | None = Depends(get_advisory_model),
) -> AdvisoryResponse:
    # Ephemeral: the result is returned in the response only. Nothing is persisted here, and the
    # AI Service holds no client to the Inspection or the Audit Chain (ADR 0028).
    result = await assess_note(
        note_text=body.note_text,
        model=model,
    )
    return AdvisoryResponse(category=result.category, status=result.status)


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
    inference_timeout: float = Depends(get_inference_timeout),
) -> TranscriptionResponse:
    # Audio stays in memory and on the box: the body-size guard and the raised spool threshold
    # above keep the clip out of a temp file, and it goes only to the on-prem model, never to an
    # external host (FOIP). Every failure path below is soft: the caller keeps the note field
    # editable and the operator types instead, so inspection submit is never blocked.
    audio = await clip.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio clip")
    try:
        text = await transcribe_clip(
            audio=audio,
            transcriber=transcriber,
            semaphore=semaphore,
            acquire_timeout_seconds=acquire_timeout,
            inference_timeout_seconds=inference_timeout,
        )
    except AudioTooLarge:
        raise HTTPException(status_code=413, detail="audio clip too large")
    except (TranscriptionUnavailable, TranscriptionFailed):
        # A missing model and a model that raised or hung are the same thing to the caller: no
        # transcript this time, type the note instead.
        raise HTTPException(status_code=503, detail="transcription unavailable")
    except TranscriptionAtCapacity:
        raise HTTPException(status_code=429, detail="transcription at capacity")
    return TranscriptionResponse(text=text)
