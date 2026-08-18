"""On-prem defect-category model backed by a local llama.cpp GGUF model (DEV-154).

Runs entirely on the team mini-PC (ADR 0028): weights load from a local path, inference is
CPU-only, and no note text leaves the box. The primary candidate is Qwen2.5-1.5B-Instruct
(Q4_K_M); see docs/advisory-check-model-selection.md. The model is used zero-shot with a fixed
prompt and deterministic decoding (temperature 0, fixed seed) so the label is reproducible.

llama_cpp is imported lazily inside __init__ so the rest of the service, and the test suite, do
not need the runtime or the weights installed.
"""

from __future__ import annotations

import logging
import re

from advisory import DefectCategory

logger = logging.getLogger("ai.advisory")

# A one-line definition per label, not a bare list. On the mini-PC benchmark (DEV-155) the bare
# list scored 63.2%: DAMAGE was read as WEAR and non-defect notes were rarely abstained on. The
# definitions raise it to 71.9% (84.4% on genuine-defect notes), mainly by fixing DAMAGE and by
# keeping MALFUNCTION and NOISE_VIBRATION on their own sides of the "still operates" line. See
# services/ai/benchmark/CATEGORY_RESULTS.md and ADR 0028.
_SYSTEM_PROMPT = (
    "You review equipment pre-use inspection fail notes. Classify the failure mode the note "
    "describes into exactly one of these seven labels:\n"
    "LEAK: fluid or air escaping from a component, seal, or hose.\n"
    "DAMAGE: a discrete break, crack, dent, bend, or tear.\n"
    "WEAR: gradual material loss or thinning from use (worn, frayed, stretched, thinned).\n"
    "MALFUNCTION: a function does not operate or produces no output (does not turn on, will not "
    "raise, no response), but not merely an abnormal sound or vibration.\n"
    "MISSING: a required part or item is absent.\n"
    "CONTAMINATION: foreign material present (dirt, mud, dust, grease, spill, corrosion buildup).\n"
    "NOISE_VIBRATION: abnormal sound or vibration (grinding, squealing, rattling, shaking, "
    "screeching), even if the equipment still operates.\n"
    "Answer with one word, the label only. If the note describes no defect, or a problem that "
    "fits none of the seven, answer NONE."
)


def _user_prompt(note_text: str) -> str:
    return (
        f'Note: "{note_text}"\n'
        "Which failure mode does the note describe? Answer with one label, or NONE."
    )


_NEGATION_WORDS = {"NO", "NOT"}


def _parse_category(completion_text: str) -> DefectCategory | None:
    # Robust to minor formatting drift: trailing punctuation ("LEAK."), a surrounding word or two
    # ("The answer is DAMAGE"), or the model naming just half of NOISE_VIBRATION. Never guess past
    # an explicit NONE or an answer that names no known label.
    answer = completion_text.strip().upper()
    if not answer:
        return None
    tokens = re.findall(r"[A-Z]+", answer)
    if not tokens:
        return None
    if "NONE" in tokens:
        return None
    # "no damage" / "not a leak": a negated label is not a suggestion of that category. A leading
    # negation covers the whole answer; a negation word immediately before a label word covers a
    # negation stated mid-sentence. Either way, treat it as an abstain rather than matching the
    # negated word by coincidence.
    if tokens[0] in _NEGATION_WORDS:
        return None
    label_words = {category.value for category in DefectCategory} | {
        "NOISE",
        "VIBRATION",
    }
    for previous, word in zip(tokens, tokens[1:]):
        if previous in _NEGATION_WORDS and word in label_words:
            return None
    token_set = set(tokens)
    for category in DefectCategory:
        if category.value in token_set:
            return category
    if {"NOISE", "VIBRATION"} & token_set:
        return DefectCategory.NOISE_VIBRATION
    return None


class LlamaCppDefectModel:
    """Zero-shot failure-mode classifier over a local GGUF model."""

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

        # seed and temperature 0 make the label deterministic and reproducible.
        self._llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_threads=n_threads,
            seed=0,
            verbose=False,
        )
        logger.info("advisory model loaded from local path")

    def categorize_note(self, note_text: str) -> DefectCategory | None:
        completion = self._llm.create_chat_completion(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _user_prompt(note_text)},
            ],
            temperature=0.0,
            # The labels are one word; NOISE_VIBRATION is the longest at a few tokens. Kept small
            # so a rambling completion cannot eat the CPU budget, but large enough not to truncate it.
            max_tokens=8,
        )
        completion_text = completion["choices"][0]["message"]["content"]
        return _parse_category(completion_text)
