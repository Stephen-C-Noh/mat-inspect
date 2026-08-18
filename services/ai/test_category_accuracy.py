"""Tests for the category-accuracy benchmark scorer (DEV-155).

Exercises run_benchmark, the confusion matrix, and the abstain-metric bookkeeping against a
scripted stub model, so the suite needs no llama.cpp runtime or GGUF weights. Real classification
quality is measured by running benchmark/category_accuracy.py against the actual model on the
mini-PC; this test only checks that the scorer counts correctly, against the real
advisory.DefectCategory enum so a taxonomy drift there fails this suite too.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from advisory import DefectCategory

# category_accuracy.py lives in benchmark/, a subdirectory pytest does not add to sys.path on
# its own (no __init__.py makes it a package). Mirrors the sys.path trick category_accuracy.py
# itself uses to reach advisory.py one directory up.
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark")
)
from category_accuracy import (  # noqa: E402
    NONE_LABEL,
    LabeledNote,
    load_dataset,
    run_benchmark,
)


class ScriptedModel:
    """Returns each scripted verdict in turn, one per categorize_note call."""

    def __init__(self, verdicts: list[object]) -> None:
        self._verdicts = list(verdicts)
        self.calls: list[str] = []

    def categorize_note(self, note_text: str):
        self.calls.append(note_text)
        return self._verdicts.pop(0)


# --- run_benchmark: per-note scoring -------------------------------------------------


def test_correct_prediction_counts_as_correct() -> None:
    notes = [LabeledNote(note="hydraulic line leaking", expected="LEAK")]
    model = ScriptedModel([DefectCategory.LEAK])
    result = run_benchmark(notes, model)
    assert result.correct == 1
    assert result.accuracy == 1.0
    assert result.scored[0].predicted == "LEAK"
    assert model.calls == ["hydraulic line leaking"]


def test_wrong_prediction_counts_as_incorrect() -> None:
    notes = [LabeledNote(note="forks are bent", expected="DAMAGE")]
    model = ScriptedModel([DefectCategory.WEAR])
    result = run_benchmark(notes, model)
    assert result.correct == 0
    assert result.scored[0].predicted == "WEAR"


def test_correct_abstain_on_none_row() -> None:
    notes = [LabeledNote(note="all clear, unit ready for use", expected=NONE_LABEL)]
    model = ScriptedModel([None])
    result = run_benchmark(notes, model)
    assert result.correct == 1
    assert result.abstain_stats() == (1, 1, 0, 0)


def test_wrong_abstain_on_a_real_category_row() -> None:
    # The model abstaining on a genuine defect is a coverage miss, not a wrong label, but it
    # still counts against overall accuracy and shows up in the wrongly-abstained tally.
    notes = [LabeledNote(note="left rear tire is worn to the cords", expected="WEAR")]
    model = ScriptedModel([None])
    result = run_benchmark(notes, model)
    assert result.correct == 0
    assert result.abstain_stats() == (0, 0, 1, 1)


# --- confusion matrix -----------------------------------------------------------------


def test_confusion_matrix_tallies_expected_vs_predicted() -> None:
    notes = [
        LabeledNote(note="a", expected="LEAK"),
        LabeledNote(note="b", expected="LEAK"),
        LabeledNote(note="c", expected="DAMAGE"),
        LabeledNote(note="d", expected=NONE_LABEL),
    ]
    model = ScriptedModel(
        [DefectCategory.LEAK, DefectCategory.CONTAMINATION, DefectCategory.DAMAGE, None]
    )
    result = run_benchmark(notes, model)
    matrix = result.confusion_matrix()
    assert matrix["LEAK"]["LEAK"] == 1
    assert matrix["LEAK"]["CONTAMINATION"] == 1
    assert matrix["DAMAGE"]["DAMAGE"] == 1
    assert matrix[NONE_LABEL][NONE_LABEL] == 1
    # No other cell should have been touched.
    assert sum(sum(row.values()) for row in matrix.values()) == 4


# --- out-of-taxonomy guard -------------------------------------------------------------


def test_out_of_taxonomy_prediction_is_flagged_not_silently_dropped() -> None:
    # Structurally impossible from the real model: DefectCategory has no OTHER member, so
    # LlamaCppDefectModel cannot return it. The scorer still has to handle a model that violates
    # its own contract (Python does not enforce the Protocol at runtime) without crashing the run.
    notes = [LabeledNote(note="e", expected="LEAK")]
    model = ScriptedModel(["OTHER"])
    result = run_benchmark(notes, model)
    assert result.out_of_taxonomy() == result.scored
    assert result.correct == 0


# --- load_dataset -----------------------------------------------------------------------


def test_load_dataset_rejects_other_as_an_expected_label(tmp_path: Path) -> None:
    # OTHER is Operator-only, never a model output (ADR 0028): a dataset row expecting the model
    # to emit OTHER would be testing an impossible outcome, so the loader fails fast.
    dataset = tmp_path / "bad.jsonl"
    dataset.write_text('{"note": "torn seat cushion", "expected": "OTHER"}\n')
    with pytest.raises(ValueError, match="OTHER"):
        load_dataset(dataset)


def test_load_dataset_skips_blank_lines(tmp_path: Path) -> None:
    dataset = tmp_path / "notes.jsonl"
    dataset.write_text(
        '{"note": "a", "expected": "LEAK"}\n\n{"note": "b", "expected": "NONE"}\n'
    )
    notes = load_dataset(dataset)
    assert [n.note for n in notes] == ["a", "b"]
    assert [n.expected for n in notes] == ["LEAK", "NONE"]
