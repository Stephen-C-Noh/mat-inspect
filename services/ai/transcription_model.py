"""faster-whisper transcriber (DEV-31).

Wraps faster-whisper small.en for CPU inference. Imported lazily so unit tests and the advisory
path do not pull in CTranslate2 or the model weights. The model loads once at service start
(main.lifespan); transcribe() is local inference and opens no network connection, so audio never
leaves the box. int8 compute matches the mini-PC benchmark in ADR 0017.
"""

from __future__ import annotations

import io
import logging

logger = logging.getLogger("ai.transcription_model")


class FasterWhisperTranscriber:
    def __init__(
        self,
        *,
        model_size_or_path: str = "small.en",
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        # Imported here so the dependency (and the ~450 MB weights, downloaded or mounted) is only
        # required when transcription is actually enabled.
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            model_size_or_path, device=device, compute_type=compute_type
        )

    def transcribe(self, audio: bytes) -> str:
        # faster-whisper accepts a binary file object; wrap the bytes so nothing touches disk.
        # segments is a generator, so iterating it is what runs inference.
        segments, _info = self._model.transcribe(io.BytesIO(audio))
        return "".join(segment.text for segment in segments).strip()
