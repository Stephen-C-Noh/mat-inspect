"""On-prem defect-signal model backed by a local llama.cpp GGUF model (DEV-83).

Runs entirely on the team mini-PC (ADR 0018): weights load from a local path, inference is
CPU-only, and no note text leaves the box. The primary candidate is Qwen2.5-1.5B-Instruct
(Q4_K_M); see docs/advisory-check-model-selection.md. The model is used zero-shot with a fixed
prompt and deterministic decoding (temperature 0, fixed seed) so the signal is reproducible.

llama_cpp is imported lazily inside __init__ so the rest of the service, and the test suite, do
not need the runtime or the weights installed.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("ai.advisory")

_SYSTEM_PROMPT = (
    "You review equipment pre-use inspection notes. Decide whether the note reports a defect, "
    "damage, malfunction, or safety problem with the item. Answer with one word: YES or NO."
)


def _user_prompt(note_text: str) -> str:
    return (
        f'Note: "{note_text}"\n'
        "Does the note report a defect, damage, or problem? Answer YES or NO."
    )


class LlamaCppDefectModel:
    """Zero-shot defect-signal judge over a local GGUF model."""

    def __init__(
        self,
        model_path: str,
        *,
        n_ctx: int = 2048,
        n_threads: int | None = None,
    ) -> None:
        from llama_cpp import (
            Llama,
        )  # lazy: heavy import, only when a model is configured

        # seed and temperature 0 make the verdict deterministic and reproducible.
        self._llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_threads=n_threads,
            seed=0,
            verbose=False,
        )
        logger.info("advisory model loaded from local path")

    def signals_defect(self, note_text: str) -> bool:
        completion = self._llm.create_chat_completion(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _user_prompt(note_text)},
            ],
            temperature=0.0,
            max_tokens=4,
        )
        answer = completion["choices"][0]["message"]["content"].strip().upper()
        return answer.startswith("Y")
