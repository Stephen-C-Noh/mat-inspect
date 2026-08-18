"""Category-accuracy benchmark for the Advisory Check (DEV-155, ADR 0028).

DEV-83's advisory_benchmark.py measures latency and thermals only. ADR 0028's "Consequences"
section leaves per-note classification accuracy on the real model an open question; this closes
it. It scores the shipped classifier (advisory_model.LlamaCppDefectModel, via the real prompt
and `_parse_category`) against a hand-labeled dataset of FAIL-item notes, reporting overall
accuracy, a confusion matrix, and abstain metrics.

The model is injected, exactly like advisory.assess_note: run_benchmark takes anything exposing
categorize_note(note_text) -> DefectCategory | None, so this module scores a stub in tests and
the real GGUF on the mini-PC. LlamaCppDefectModel is constructed only in main(), behind
--advisory-model, and advisory_model.py's own llama_cpp import stays lazy inside its __init__,
so this file, --help, and the test suite stay import-clean with no llama.cpp runtime installed.

Run (on the mini-PC, weights present locally):

    python category_accuracy.py --advisory-model /models/qwen2.5-1.5b-instruct-q4_k_m.gguf

Uses category_notes.jsonl by default; point --dataset elsewhere to score a different set.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

# Reuse the real prompt and parser rather than reimplementing them: import advisory.py the same
# way advisory_benchmark.py does, since this module lives one directory below services/ai.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from advisory import DefectCategory  # noqa: E402

# The model abstaining, or a note the dataset says has no defect, both score against this label.
# Not a DefectCategory member: OTHER is the only other non-suggestable value, and conflating the
# two would hide a model that wrongly emits OTHER (see out_of_taxonomy below).
NONE_LABEL = "NONE"

_LABELS = [category.value for category in DefectCategory] + [NONE_LABEL]
_LABEL_SET = set(_LABELS)


class DefectCategoryModel(Protocol):
    """Same shape as advisory.DefectCategoryModel: classify one note, or abstain (None)."""

    def categorize_note(self, note_text: str) -> DefectCategory | None: ...


@dataclass(frozen=True)
class LabeledNote:
    note: str
    expected: str  # one of the 7 DefectCategory values, or NONE


@dataclass(frozen=True)
class ScoredNote:
    note: str
    expected: str
    predicted: str


@dataclass
class BenchmarkResult:
    scored: list[ScoredNote] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.scored)

    @property
    def correct(self) -> int:
        return sum(1 for s in self.scored if s.predicted == s.expected)

    @property
    def accuracy(self) -> float:
        return self.correct / self.total if self.total else float("nan")

    def confusion_matrix(self) -> dict[str, Counter[str]]:
        matrix: dict[str, Counter[str]] = defaultdict(Counter)
        for s in self.scored:
            matrix[s.expected][s.predicted] += 1
        return matrix

    def abstain_stats(self) -> tuple[int, int, int, int]:
        """Returns (none_total, none_correct, category_total, category_wrongly_abstained).

        none_correct is specificity: how often the model abstained on a note that has no defect.
        wrongly_abstained is the opposite miss: a real category the model failed to suggest at
        all, which is the assistive feature quietly doing nothing rather than misleading anyone
        (fail-open, ADR 0028), but still worth tracking as a coverage gap.
        """
        none_rows = [s for s in self.scored if s.expected == NONE_LABEL]
        category_rows = [s for s in self.scored if s.expected != NONE_LABEL]
        none_correct = sum(1 for s in none_rows if s.predicted == NONE_LABEL)
        wrongly_abstained = sum(1 for s in category_rows if s.predicted == NONE_LABEL)
        return len(none_rows), none_correct, len(category_rows), wrongly_abstained

    def out_of_taxonomy(self) -> list[ScoredNote]:
        """Notes whose prediction is not one of the 7 labels or NONE.

        Structurally this should never happen: DefectCategory has no OTHER member, so the real
        model cannot return it. Kept as a live check rather than an assumption, in case a future
        model change (or a bug in _parse_category) starts emitting something out of taxonomy.
        """
        return [s for s in self.scored if s.predicted not in _LABEL_SET]


def load_dataset(path: Path) -> list[LabeledNote]:
    notes: list[LabeledNote] = []
    with path.open() as fh:
        for line_no, raw_line in enumerate(fh, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            expected = row["expected"]
            if expected != NONE_LABEL and expected not in {
                c.value for c in DefectCategory
            }:
                # OTHER is Operator-only, never a model output (ADR 0028): a dataset row
                # expecting the model to emit it would be testing an impossible outcome.
                raise ValueError(
                    f"{path}:{line_no}: expected {expected!r} is not one of the 7 "
                    "model-suggestable labels or NONE"
                )
            notes.append(LabeledNote(note=row["note"], expected=expected))
    return notes


def run_benchmark(
    notes: list[LabeledNote], model: DefectCategoryModel
) -> BenchmarkResult:
    """Scores the model against the labeled dataset, one categorize_note call per note.

    Model injection mirrors advisory.assess_note: the scorer runs against a stub in tests
    (test_category_accuracy.py) and the real GGUF via LlamaCppDefectModel on the mini-PC.
    """
    result = BenchmarkResult()
    for labeled in notes:
        category = model.categorize_note(labeled.note)
        if category is None:
            predicted = NONE_LABEL
        elif isinstance(category, DefectCategory):
            predicted = category.value
        else:
            # A model returning something outside DefectCategory violates its own contract
            # (Python does not enforce the Protocol at runtime). Record it rather than raise, so
            # one bad completion does not crash the whole run; out_of_taxonomy() surfaces it.
            predicted = str(category)
        result.scored.append(
            ScoredNote(
                note=labeled.note, expected=labeled.expected, predicted=predicted
            )
        )
    return result


def format_confusion_matrix(result: BenchmarkResult) -> str:
    matrix = result.confusion_matrix()
    col_width = max(len(label) for label in _LABELS) + 2
    header = "expected \\ predicted".ljust(22) + "".join(
        label.rjust(col_width) for label in _LABELS
    )
    lines = [header]
    for expected in _LABELS:
        row = matrix[expected]
        cells = "".join(str(row[predicted]).rjust(col_width) for predicted in _LABELS)
        lines.append(expected.ljust(22) + cells)
    return "\n".join(lines)


def format_report(result: BenchmarkResult) -> str:
    none_total, none_correct, category_total, wrongly_abstained = result.abstain_stats()
    out_of_taxonomy = result.out_of_taxonomy()
    none_pct = f" ({none_correct / none_total:.1%})" if none_total else ""
    wrong_pct = f" ({wrongly_abstained / category_total:.1%})" if category_total else ""
    taxonomy_note = (
        " (expected: DefectCategory has no OTHER member)"
        if not out_of_taxonomy
        else " -- BUG: model returned a label outside the taxonomy"
    )
    lines = [
        "## Category-accuracy results",
        "",
        f"- Notes scored: {result.total}",
        f"- Overall accuracy: {result.correct}/{result.total} ({result.accuracy:.1%})",
        f"- Abstain specificity (correct NONE): {none_correct}/{none_total}{none_pct}",
        f"- Wrongly abstained on a real category: {wrongly_abstained}/{category_total}{wrong_pct}",
        f"- Predictions outside the 7 labels + NONE: {len(out_of_taxonomy)}{taxonomy_note}",
        "",
        "### Confusion matrix (rows expected, cols predicted)",
        "",
        "```",
        format_confusion_matrix(result),
        "```",
    ]
    return "\n".join(lines)


def _load_advisory_model(model_path: str) -> DefectCategoryModel:
    # Lazy: llama_cpp is a heavy native dependency not installed in the test/CI environment.
    # Constructing the real model only here, behind --advisory-model, keeps --help and the test
    # suite import-clean with no runtime or weights present (mirrors advisory_model.py's own
    # lazy llama_cpp import).
    from advisory_model import LlamaCppDefectModel

    return LlamaCppDefectModel(model_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--advisory-model", required=True, help="path to the Q4 GGUF model"
    )
    default_dataset = Path(__file__).parent / "category_notes.jsonl"
    parser.add_argument(
        "--dataset",
        default=str(default_dataset),
        help="labeled notes, one JSON object per line (default: category_notes.jsonl)",
    )
    args = parser.parse_args()

    notes = load_dataset(Path(args.dataset))
    print(f"loaded {len(notes)} labeled notes from {args.dataset}")

    model = _load_advisory_model(args.advisory_model)
    result = run_benchmark(notes, model)

    print()
    print(format_report(result))


if __name__ == "__main__":
    main()
