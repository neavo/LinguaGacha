import pytest

from base.Base import Base
from module.Localizer.Localizer import Localizer


def test_start_translation_returns_request_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.start_translation({"mode": "NEW"})

    assert result["accepted"] is True
    assert result["task"] == {
        "task_type": "translation",
        "status": "REQUEST",
        "busy": True,
        "request_in_flight_count": 0,
        "line": 0,
        "total_line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_output_tokens": 0,
        "total_input_tokens": 0,
        "time": 0.0,
        "start_time": 0.0,
    }
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.TranslationMode.NEW,
            },
        )
    ]


def test_stop_translation_returns_stopping_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.stop_translation({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert result["task"]["status"] == "STOPPING"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
    ]


def test_start_analysis_returns_request_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.start_analysis({"mode": "CONTINUE"})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["status"] == "REQUEST"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.AnalysisMode.CONTINUE,
            },
        )
    ]


def test_stop_analysis_returns_stopping_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.stop_analysis({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["status"] == "STOPPING"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
    ]


def test_get_task_snapshot_returns_translation_snapshot_fields(
    task_app_service,
    fake_engine,
    fake_task_data_manager,
) -> None:
    fake_engine.status = Base.TaskStatus.TRANSLATING
    fake_engine.request_in_flight_count = 2
    fake_task_data_manager.translation_extras["line"] = 3
    fake_task_data_manager.translation_extras["total_line"] = 9
    fake_task_data_manager.translation_extras["processed_line"] = 2
    fake_task_data_manager.translation_extras["total_tokens"] = 128

    result = task_app_service.get_task_snapshot({})

    assert result["task"]["task_type"] == "translation"
    assert result["task"]["status"] == Base.TaskStatus.TRANSLATING.value
    assert result["task"]["busy"] is True
    assert result["task"]["request_in_flight_count"] == 2
    assert result["task"]["line"] == 3
    assert result["task"]["processed_line"] == 2
    assert result["task"]["total_tokens"] == 128


def test_get_task_snapshot_prefers_engine_active_task_type(
    task_app_service,
    fake_engine,
    fake_task_data_manager,
) -> None:
    fake_engine.active_task_type = "analysis"
    fake_task_data_manager.translation_extras["line"] = 9
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_candidate_count = 2

    result = task_app_service.get_task_snapshot({})

    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["line"] == 4
    assert result["task"]["analysis_candidate_count"] == 2


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
    assert fake_task_data_manager.run_project_prefilter_calls == [
        (
            task_app_service.config_loader(),
            "translation_reset",
            False,
        )
    ]


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
            Base.Event.WORKBENCH_REFRESH,
            {
                "reason": "translation_reset_failed",
                "scope": "file",
                "rel_paths": ["script/a.txt", "script/b.txt"],
            },
        ),
        (
            Base.Event.PROOFREADING_REFRESH,
            {
                "reason": "translation_reset_failed",
                "scope": "entry",
                "source_event": Base.Event.TRANSLATION_RESET_FAILED,
                "item_ids": [1, 2],
                "rel_paths": ["script/a.txt", "script/b.txt"],
            },
        ),
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


def test_import_analysis_glossary_emits_error_event_when_import_fails_after_guard(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.import_analysis_candidates_result = None

    with pytest.raises(ValueError, match=Localizer.get().alert_project_not_loaded):
        task_app_service.import_analysis_glossary({})

    assert task_app_service.emitted_events == [
        (
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {"sub_event": Base.SubEvent.ERROR},
        )
    ]


def test_import_analysis_glossary_rejects_when_project_not_loaded(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.loaded = False

    with pytest.raises(ValueError, match=Localizer.get().alert_project_not_loaded):
        task_app_service.import_analysis_glossary({})
    assert task_app_service.emitted_events == []


def test_import_analysis_glossary_rejects_when_engine_busy(
    task_app_service,
    fake_engine,
) -> None:
    fake_engine.status = Base.TaskStatus.ANALYZING

    with pytest.raises(ValueError, match=Localizer.get().task_running):
        task_app_service.import_analysis_glossary({})
    assert task_app_service.emitted_events == []


def test_export_translation_emits_export_event_and_returns_accept_ack(
    task_app_service,
) -> None:
    result = task_app_service.export_translation({})

    assert result == {"accepted": True}
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_EXPORT,
            {},
        )
    ]
