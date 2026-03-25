from api.Client.ApiStateStore import ApiStateStore
from api.Bridge.EventTopic import EventTopic
from model.Api.ProjectModels import ProjectSnapshot
from model.Api.TaskModels import TaskProgressUpdate
from model.Api.TaskModels import TaskSnapshot


def test_api_state_store_hydrates_project_snapshot() -> None:
    store = ApiStateStore()

    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    assert store.is_project_loaded() is True
    assert store.get_project_path() == "demo.lg"


def test_api_state_store_hydrates_task_snapshot() -> None:
    store = ApiStateStore()

    store.hydrate_task(
        TaskSnapshot.from_dict(
            {
                "task_type": "translation",
                "status": "TRANSLATING",
                "busy": True,
                "line": 2,
            }
        )
    )

    assert store.get_task_snapshot().task_type == "translation"
    assert store.is_busy() is True


def test_api_state_store_merges_task_progress_event_fields() -> None:
    store = ApiStateStore()
    store.hydrate_task(
        TaskSnapshot.from_dict(
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
    )

    store.merge_task_progress(
        TaskProgressUpdate.from_dict(
            {
                "task_type": "translation",
                "line": 4,
                "total_output_tokens": 10,
                "total_input_tokens": 7,
                "start_time": 8.0,
            }
        )
    )

    snapshot = store.get_task_snapshot()

    assert snapshot.line == 4
    assert snapshot.total_output_tokens == 10
    assert snapshot.total_input_tokens == 7
    assert snapshot.start_time == 8.0
    assert snapshot.status == "TRANSLATING"


def test_api_state_store_marks_proofreading_snapshot_invalidated() -> None:
    store = ApiStateStore()

    store.apply_event(EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value, {})

    assert store.is_proofreading_snapshot_invalidated() is True

    store.clear_proofreading_snapshot_invalidated()

    assert store.is_proofreading_snapshot_invalidated() is False
