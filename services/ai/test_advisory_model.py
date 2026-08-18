"""Tests for the completion-parsing logic in advisory_model.py (DEV-154).

Covers only `_parse_category`: turning a raw model completion into a DefectCategory or an
abstain (None). Does not exercise LlamaCppDefectModel itself, since that requires the llama.cpp
runtime and GGUF weights, neither of which the test suite has.
"""

from __future__ import annotations

import pytest

from advisory import DefectCategory
from advisory_model import _parse_category


@pytest.mark.parametrize(
    "completion_text,expected",
    [
        ("LEAK", DefectCategory.LEAK),
        ("DAMAGE", DefectCategory.DAMAGE),
        ("WEAR", DefectCategory.WEAR),
        ("MALFUNCTION", DefectCategory.MALFUNCTION),
        ("MISSING", DefectCategory.MISSING),
        ("CONTAMINATION", DefectCategory.CONTAMINATION),
        ("NOISE_VIBRATION", DefectCategory.NOISE_VIBRATION),
    ],
)
def test_parses_each_label_exactly(
    completion_text: str, expected: DefectCategory
) -> None:
    assert _parse_category(completion_text) is expected


@pytest.mark.parametrize(
    "completion_text,expected",
    [
        ("leak", DefectCategory.LEAK),
        ("Leak.", DefectCategory.LEAK),
        ("  DAMAGE  ", DefectCategory.DAMAGE),
        ("The failure mode is WEAR.", DefectCategory.WEAR),
        ("Answer: MALFUNCTION", DefectCategory.MALFUNCTION),
        ("NOISE", DefectCategory.NOISE_VIBRATION),
        ("VIBRATION", DefectCategory.NOISE_VIBRATION),
        ("noise_vibration", DefectCategory.NOISE_VIBRATION),
    ],
)
def test_parses_labels_wrapped_in_extra_text_or_case(
    completion_text: str, expected: DefectCategory
) -> None:
    assert _parse_category(completion_text) is expected


@pytest.mark.parametrize(
    "completion_text",
    [
        "NONE",
        "none",
        "I am not sure, NONE",
        "",
        "   ",
        "not a real answer",
        "OTHER",
        "SEVERITY_HIGH",
    ],
)
def test_unparseable_or_out_of_taxonomy_answers_abstain(completion_text: str) -> None:
    # OTHER is explicitly not model-suggestable (ADR 0028): the model abstains, it never returns
    # OTHER, even if the completion happens to contain that word.
    assert _parse_category(completion_text) is None


@pytest.mark.parametrize(
    "completion_text",
    [
        "no damage",
        "No damage found.",
        "not a leak",
        "The note describes no leak.",
        "not wear",
        "no noise",
        "not vibration",
    ],
)
def test_negated_label_abstains_instead_of_matching(completion_text: str) -> None:
    # "no damage" / "not a leak": the model is saying the category does NOT apply, not
    # suggesting it. Without the negation guard this matched the negated word (DAMAGE, LEAK...)
    # and surfaced a suggestion opposite to what the note said.
    assert _parse_category(completion_text) is None
