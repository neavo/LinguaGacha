from api.Client.ApiStateStore import ApiStateStore


def test_api_state_store_hydrates_project_snapshot() -> None:
    store = ApiStateStore()

    store.hydrate_project({"loaded": True, "path": "demo.lg"})

    assert store.is_project_loaded() is True
    assert store.get_project_path() == "demo.lg"
