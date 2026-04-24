from api.Contract.TaskPayloads import TaskSnapshotPayload


def test_task_snapshot_payload_to_dict_keeps_progress_fields() -> None:
    payload = TaskSnapshotPayload(
        task_type="translation",
        status="RUNNING",
        busy=True,
        request_in_flight_count=2,
        line=3,
        total_line=10,
        processed_line=4,
        error_line=1,
        total_tokens=100,
        total_output_tokens=60,
        total_input_tokens=40,
        time=1.5,
        start_time=100.0,
    ).to_dict()

    assert payload == {
        "task_type": "translation",
        "status": "RUNNING",
        "busy": True,
        "request_in_flight_count": 2,
        "line": 3,
        "total_line": 10,
        "processed_line": 4,
        "error_line": 1,
        "total_tokens": 100,
        "total_output_tokens": 60,
        "total_input_tokens": 40,
        "time": 1.5,
        "start_time": 100.0,
    }
