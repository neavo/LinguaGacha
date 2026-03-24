from api.Client.ApiStateStore import ApiStateStore


def test_api_state_store_hydrates_project_snapshot() -> None:
    store = ApiStateStore()

    store.hydrate_project({"loaded": True, "path": "demo.lg"})

    assert store.is_project_loaded() is True
    assert store.get_project_path() == "demo.lg"


def test_api_state_store_hydrates_task_snapshot() -> None:
    store = ApiStateStore()

    store.hydrate_task(
        {
            "task_type": "translation",
            "status": "TRANSLATING",
            "busy": True,
            "line": 2,
        }
    )

    assert store.get_task_snapshot()["task_type"] == "translation"
    assert store.is_busy() is True


def test_api_state_store_merges_task_progress_event_fields() -> None:
    store = ApiStateStore()
    store.hydrate_task(
        {
            "task_type": "translation",
            "status": "TRANSLATING",
            "busy": True,
            "line": 1,
            "total_output_tokens": 2,
            "total_input_tokens": 3,
            "start_time": 5.0,
        }
    )

    store.apply_event(
        "task.progress_changed",
        {
            "task_type": "translation",
            "line": 4,
            "total_output_tokens": 10,
            "total_input_tokens": 7,
            "start_time": 8.0,
        },
    )

    snapshot = store.get_task_snapshot()

    assert snapshot["line"] == 4
    assert snapshot["total_output_tokens"] == 10
    assert snapshot["total_input_tokens"] == 7
    assert snapshot["start_time"] == 8.0
