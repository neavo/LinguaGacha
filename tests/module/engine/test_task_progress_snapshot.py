from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot


def test_task_progress_snapshot_from_dict_normalizes_and_round_trips() -> None:
    snapshot = TaskProgressSnapshot.from_dict(
        {
            "start_time": 10,
            "time": 2,
            "total_line": "8",
            "line": 3,
            "processed_line": 2,
            "error_line": 1,
            "total_tokens": 9,
            "total_input_tokens": 4,
            "total_output_tokens": 5,
        }
    )

    assert snapshot.to_dict() == {
        "start_time": 10.0,
        "time": 2.0,
        "total_line": 8,
        "line": 3,
        "processed_line": 2,
        "error_line": 1,
        "total_tokens": 9,
        "total_input_tokens": 4,
        "total_output_tokens": 5,
    }


def test_task_progress_snapshot_updates_counts_tokens_and_elapsed() -> None:
    snapshot = TaskProgressSnapshot.empty(start_time=100.0)
    snapshot = snapshot.with_counts(processed_line=3, error_line=2, total_line=9)
    snapshot = snapshot.add_tokens(input_tokens=7, output_tokens=11)
    snapshot = snapshot.with_elapsed(now=112.5)

    assert snapshot.line == 5
    assert snapshot.total_line == 9
    assert snapshot.total_input_tokens == 7
    assert snapshot.total_output_tokens == 11
    assert snapshot.total_tokens == 18
    assert snapshot.time == 12.5
