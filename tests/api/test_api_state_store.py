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
