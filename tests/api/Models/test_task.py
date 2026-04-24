from api.Models.Task import TaskSnapshot


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
