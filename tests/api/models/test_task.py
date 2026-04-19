from api.Models.Task import AnalysisGlossaryImportResult
from api.Models.Task import TaskProgressUpdate
from api.Models.Task import TaskSnapshot
from api.Models.Task import TaskStatusUpdate


def test_task_snapshot_from_dict_keeps_analysis_specific_fields() -> None:
    snapshot = TaskSnapshot.from_dict(
        {
            "task_type": "analysis",
            "status": "RUN",
            "busy": True,
            "analysis_candidate_count": 3,
        }
    )

    assert snapshot.task_type == "analysis"
    assert snapshot.analysis_candidate_count == 3


def test_task_snapshot_merge_progress_preserves_existing_status() -> None:
    snapshot = TaskSnapshot.from_dict(
        {"task_type": "translation", "status": "TRANSLATING", "busy": True, "line": 1}
    )

    merged = snapshot.merge_progress(
        TaskProgressUpdate.from_dict({"line": 3, "total_input_tokens": 9})
    )

    assert merged.status == "TRANSLATING"
    assert merged.line == 3
    assert merged.total_input_tokens == 9


def test_task_snapshot_merge_status_preserves_progress_fields() -> None:
    snapshot = TaskSnapshot.from_dict(
        {
            "task_type": "translation",
            "status": "REQUEST",
            "busy": True,
            "line": 4,
            "processed_line": 2,
        }
    )

    merged = snapshot.merge_status(
        TaskStatusUpdate.from_dict({"status": "STOPPING", "busy": True})
    )

    assert merged.status == "STOPPING"
    assert merged.line == 4
    assert merged.processed_line == 2


def test_analysis_glossary_import_result_from_dict_keeps_import_count_and_task() -> (
    None
):
    result = AnalysisGlossaryImportResult.from_dict(
        {
            "accepted": True,
            "imported_count": 7,
            "task": {
                "task_type": "analysis",
                "status": "IDLE",
                "analysis_candidate_count": 2,
            },
        }
    )

    assert result.accepted is True
    assert result.imported_count == 7
    assert result.task.task_type == "analysis"
    assert result.task.analysis_candidate_count == 2


def test_analysis_glossary_import_result_to_dict_keeps_nested_snapshot() -> None:
    result = AnalysisGlossaryImportResult.from_dict(
        {
            "accepted": True,
            "imported_count": 3,
            "task": {
                "task_type": "analysis",
                "status": "IDLE",
                "busy": False,
            },
        }
    )

    payload = result.to_dict()

    assert payload["accepted"] is True
    assert payload["imported_count"] == 3
    assert payload["task"]["task_type"] == "analysis"
    assert payload["task"]["status"] == "IDLE"
