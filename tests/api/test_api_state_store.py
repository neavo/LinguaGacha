from api.Models.Extra import ExtraTaskState
from api.Client.ApiStateStore import ApiStateStore
from api.Bridge.EventTopic import EventTopic
from api.Models.Project import ProjectSnapshot
from api.Models.Task import TaskProgressUpdate
from api.Models.Task import TaskSnapshot


def test_api_state_store_hydrates_project_snapshot() -> None:
    # 准备
    store = ApiStateStore()

    # 执行
    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )

    # 断言
    assert store.is_project_loaded() is True
    assert store.get_project_path() == "demo.lg"


def test_api_state_store_hydrates_task_snapshot() -> None:
    # 准备
    store = ApiStateStore()

    # 执行
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

    # 断言
    assert store.get_task_snapshot().task_type == "translation"
    assert store.is_busy() is True


def test_api_state_store_merges_task_progress_event_fields() -> None:
    # 准备
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

    # 执行
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

    # 断言
    snapshot = store.get_task_snapshot()

    assert snapshot.line == 4
    assert snapshot.total_output_tokens == 10
    assert snapshot.total_input_tokens == 7
    assert snapshot.start_time == 8.0
    assert snapshot.status == "TRANSLATING"


def test_api_state_store_marks_proofreading_snapshot_invalidated() -> None:
    # 准备
    store = ApiStateStore()

    # 执行
    store.apply_event(EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value, {})

    # 断言
    assert store.is_proofreading_snapshot_invalidated() is True

    store.clear_proofreading_snapshot_invalidated()

    assert store.is_proofreading_snapshot_invalidated() is False


def test_api_state_store_clears_proofreading_snapshot_invalidated_on_project_change() -> (
    None
):
    # 准备
    store = ApiStateStore()

    store.mark_proofreading_snapshot_invalidated()

    # 执行
    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "project-b.lg"})
    )

    # 断言
    assert store.is_proofreading_snapshot_invalidated() is False

    store.mark_proofreading_snapshot_invalidated()
    store.reset_project()

    assert store.is_proofreading_snapshot_invalidated() is False


def test_api_state_store_reads_extra_task_state_as_frozen_snapshot() -> None:
    # 准备
    store = ApiStateStore()

    # 执行
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "RUNNING",
            "message": "running",
            "current": 2,
            "total": 10,
        },
    )

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert isinstance(snapshot, ExtraTaskState)
    assert snapshot.task_id == "extra_ts_conversion"
    assert snapshot.phase == "RUNNING"
    assert snapshot.message == "running"
    assert snapshot.current == 2
    assert snapshot.total == 10
    assert snapshot.finished is False


def test_api_state_store_merges_extra_task_finished_state() -> None:
    # 准备
    store = ApiStateStore()
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "RUNNING",
            "message": "running",
            "current": 2,
            "total": 10,
        },
    )

    # 执行
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_FINISHED.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "FINISHED",
            "message": "done",
            "current": 10,
            "total": 10,
        },
    )

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert isinstance(snapshot, ExtraTaskState)
    assert snapshot.task_id == "extra_ts_conversion"
    assert snapshot.phase == "FINISHED"
    assert snapshot.message == "done"
    assert snapshot.current == 10
    assert snapshot.total == 10
    assert snapshot.finished is True


def test_api_state_store_returns_none_for_missing_extra_task_state() -> None:
    # 准备
    store = ApiStateStore()

    # 执行
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    # 断言
    assert snapshot is None


def test_api_state_store_clears_extra_task_state_on_project_hydrate() -> None:
    # 准备
    store = ApiStateStore()
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "RUNNING",
            "message": "running",
            "current": 2,
            "total": 10,
        },
    )

    # 执行
    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "project-b.lg"})
    )

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert snapshot is None


def test_api_state_store_clears_extra_task_state_on_project_reset() -> None:
    # 准备
    store = ApiStateStore()
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "RUNNING",
            "message": "running",
            "current": 2,
            "total": 10,
        },
    )

    # 执行
    store.reset_project()

    # 断言
    snapshot = store.get_extra_task_state("extra_ts_conversion")

    assert snapshot is None
