import logging
import os
from contextlib import asynccontextmanager

if os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field

from advisory import AdvisoryStatus, DefectSignalModel, assess_note

logger = logging.getLogger("ai")


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.advisory_model = _load_advisory_model()
    yield
    app.state.advisory_model = None


app = FastAPI(lifespan=lifespan)


def get_advisory_model(request: Request) -> DefectSignalModel | None:
    return getattr(request.app.state, "advisory_model", None)


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
