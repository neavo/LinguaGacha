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
