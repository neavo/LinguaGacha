from base.Base import Base


def test_start_translation_returns_accepted(task_app_service) -> None:
    result = task_app_service.start_translation({"mode": "NEW"})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"


def test_get_task_snapshot_returns_current_status(
    task_app_service,
    fake_engine,
    fake_task_data_manager,
) -> None:
    fake_engine.status = Base.TaskStatus.TRANSLATING
    fake_task_data_manager.translation_extras["line"] = 3

    result = task_app_service.get_task_snapshot({})

    assert "status" in result["task"]


def test_get_task_snapshot_supports_requested_task_type(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_candidate_count = 2

    result = task_app_service.get_task_snapshot({"task_type": "analysis"})

    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["analysis_candidate_count"] == 2


def test_reset_translation_all_returns_accepted_and_emits_request_event(
    task_app_service,
) -> None:
    result = task_app_service.reset_translation_all({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert task_app_service.emitted_events[-1] == (
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.REQUEST},
    )


def test_reset_translation_failed_returns_accepted_and_emits_request_event(
    task_app_service,
) -> None:
    result = task_app_service.reset_translation_failed({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert task_app_service.emitted_events[-1] == (
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )
