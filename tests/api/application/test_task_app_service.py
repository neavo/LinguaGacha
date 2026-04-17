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


def test_reset_translation_all_returns_latest_snapshot_and_emits_terminal_event(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.translation_extras["line"] = 6
    fake_task_data_manager.translation_extras["total_line"] = 9
    fake_task_data_manager.translation_extras["error_line"] = 2
    fake_task_data_manager.translation_reset_items = ["line-1", "line-2"]

    result = task_app_service.reset_translation_all({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert result["task"]["line"] == 0
    assert result["task"]["error_line"] == 0
    assert task_app_service.emitted_events == [
        (
            Base.Event.PROJECT_CHECK,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.TRANSLATION_RESET_ALL,
            {"sub_event": Base.SubEvent.DONE},
        ),
    ]
    assert fake_task_data_manager.replace_all_items_calls == [["line-1", "line-2"]]
    assert fake_task_data_manager.set_translation_extras_calls == [{}]
    assert fake_task_data_manager.set_project_status_calls == [Base.ProjectStatus.NONE]
    assert len(fake_task_data_manager.run_project_prefilter_calls) == 1


def test_reset_translation_failed_returns_latest_snapshot_and_emits_terminal_event(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.translation_extras["line"] = 6
    fake_task_data_manager.translation_extras["total_line"] = 9
    fake_task_data_manager.translation_extras["error_line"] = 2

    result = task_app_service.reset_translation_failed({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert result["task"]["error_line"] == 0
    assert task_app_service.emitted_events == [
        (
            Base.Event.PROJECT_CHECK,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.TRANSLATION_RESET_FAILED,
            {"sub_event": Base.SubEvent.DONE},
        ),
    ]
    assert fake_task_data_manager.reset_failed_translation_items_sync_calls == 1


def test_reset_analysis_all_returns_latest_snapshot(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_snapshot["total_line"] = 9
    fake_task_data_manager.analysis_candidate_count = 5

    result = task_app_service.reset_analysis_all({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["line"] == 0
    assert result["task"]["analysis_candidate_count"] == 0
    assert task_app_service.emitted_events == [
        (
            Base.Event.PROJECT_CHECK,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.ANALYSIS_RESET_ALL,
            {"sub_event": Base.SubEvent.DONE},
        ),
    ]
    assert fake_task_data_manager.clear_analysis_candidates_and_progress_calls == 1
    assert fake_task_data_manager.refresh_analysis_progress_snapshot_cache_calls == 1


def test_reset_analysis_failed_returns_latest_snapshot(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_snapshot["total_line"] = 9
    fake_task_data_manager.analysis_snapshot["error_line"] = 2
    fake_task_data_manager.analysis_candidate_count = 3

    result = task_app_service.reset_analysis_failed({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["error_line"] == 0
    assert result["task"]["analysis_candidate_count"] == 3
    assert task_app_service.emitted_events == [
        (
            Base.Event.PROJECT_CHECK,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.ANALYSIS_RESET_FAILED,
            {"sub_event": Base.SubEvent.DONE},
        ),
    ]
    assert fake_task_data_manager.reset_failed_analysis_checkpoints_calls == 1
    assert fake_task_data_manager.refresh_analysis_progress_snapshot_cache_calls == 1


def test_import_analysis_glossary_returns_import_count_and_latest_candidate_count(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 8
    fake_task_data_manager.analysis_snapshot["total_line"] = 10
    fake_task_data_manager.analysis_candidate_count = 1
    fake_task_data_manager.import_analysis_candidates_result = 3

    result = task_app_service.import_analysis_glossary({})

    assert result["accepted"] is True
    assert result["imported_count"] == 3
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["analysis_candidate_count"] == 1
    assert task_app_service.emitted_events == [
        (
            Base.Event.PROJECT_CHECK,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {
                "sub_event": Base.SubEvent.DONE,
                "imported_count": 3,
            },
        ),
    ]


def test_import_analysis_glossary_rejects_when_project_not_loaded(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.loaded = False

    try:
        task_app_service.import_analysis_glossary({})
    except ValueError as error:
        assert str(error) != ""
    else:
        raise AssertionError("expected ValueError")


def test_import_analysis_glossary_rejects_when_engine_busy(
    task_app_service,
    fake_engine,
) -> None:
    fake_engine.status = Base.TaskStatus.ANALYZING

    try:
        task_app_service.import_analysis_glossary({})
    except ValueError as error:
        assert str(error) != ""
    else:
        raise AssertionError("expected ValueError")
