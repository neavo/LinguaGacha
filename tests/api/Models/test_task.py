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
    assert merged.to_dict()["status"] == "TRANSLATING"


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


def test_task_updates_distinguish_missing_fields_and_explicit_zero_values() -> None:
    status = TaskStatusUpdate.from_dict({})
    progress = TaskProgressUpdate.from_dict(
        {
            "request_in_flight_count": 0,
            "line": 0,
            "time": 0.0,
            "analysis_candidate_count": 0,
        }
    )

    assert status.task_type is None
    assert status.status is None
    assert status.busy is None
    assert progress.request_in_flight_count == 0
    assert progress.line == 0
    assert progress.time == 0.0
    assert progress.analysis_candidate_count == 0
