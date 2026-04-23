import pytest

from api.Bridge.PublicEventBridge import PublicEventBridge
from base.Base import Base


def test_translation_progress_is_mapped_to_task_progress() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {
            "processed_line": 3,
            "total_line": 10,
            "total_output_tokens": 8,
            "total_input_tokens": 5,
            "start_time": 12.5,
            "request_in_flight_count": 2,
        },
    )

    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
    assert payload["processed_line"] == 3
    assert payload["total_output_tokens"] == 8
    assert payload["total_input_tokens"] == 5
    assert payload["start_time"] == 12.5
    assert payload["request_in_flight_count"] == 2


def test_translation_progress_patch_does_not_force_missing_fields_to_zero() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {
            "request_in_flight_count": 4,
        },
    )

    assert topic == "task.progress_changed"
    assert payload == {
        "task_type": "translation",
        "request_in_flight_count": 4,
    }


@pytest.mark.parametrize(
    ("event", "task_type", "sub_event", "expected_status", "expected_busy"),
    [
        (
            Base.Event.TRANSLATION_TASK,
            "translation",
            Base.SubEvent.DONE,
            "DONE",
            False,
        ),
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            "translation",
            Base.SubEvent.REQUEST,
            "STOPPING",
            True,
        ),
        (
            Base.Event.ANALYSIS_TASK,
            "analysis",
            Base.SubEvent.ERROR,
            "ERROR",
            False,
        ),
        (
            Base.Event.ANALYSIS_REQUEST_STOP,
            "analysis",
            Base.SubEvent.REQUEST,
            "STOPPING",
            True,
        ),
    ],
)
def test_task_status_events_are_mapped_to_public_status_contract(
    event: Base.Event,
    task_type: str,
    sub_event: Base.SubEvent,
    expected_status: str,
    expected_busy: bool,
) -> None:
    topic, payload = PublicEventBridge().map_event(
        event,
        {"sub_event": sub_event},
    )

    assert topic == "task.status_changed"
    assert payload == {
        "task_type": task_type,
        "status": expected_status,
        "busy": expected_busy,
    }


def test_translation_progress_maps_remaining_numeric_fields() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {
            "line": 2,
            "error_line": 1,
            "total_tokens": 20,
            "time": 6.5,
        },
    )

    assert topic == "task.progress_changed"
    assert payload == {
        "task_type": "translation",
        "line": 2,
        "error_line": 1,
        "total_tokens": 20,
        "time": 6.5,
    }


def test_config_updated_maps_settings_snapshot_when_available() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.CONFIG_UPDATED,
        {
            "keys": ["app_language"],
            "settings": {
                "app_language": "EN",
                "recent_projects": [],
            },
        },
    )

    assert topic == "settings.changed"
    assert payload == {
        "keys": ["app_language"],
        "settings": {
            "app_language": "EN",
            "recent_projects": [],
        },
    }


def test_config_updated_normalizes_keys_and_ignores_non_dict_settings() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.CONFIG_UPDATED,
        {
            "keys": "app_language",
            "settings": "invalid",
        },
    )

    assert topic == "settings.changed"
    assert payload == {"keys": []}


@pytest.mark.parametrize(
    ("event", "payload", "expected_loaded", "expected_path"),
    [
        (
            Base.Event.PROJECT_LOADED,
            {"path": "demo/project.lg"},
            True,
            "demo/project.lg",
        ),
        (
            Base.Event.PROJECT_UNLOADED,
            {"path": "demo/project.lg"},
            False,
            "demo/project.lg",
        ),
    ],
)
def test_project_events_map_to_project_changed(
    event: Base.Event,
    payload: dict[str, object],
    expected_loaded: bool,
    expected_path: str,
) -> None:
    topic, mapped_payload = PublicEventBridge().map_event(event, payload)

    assert topic == "project.changed"
    assert mapped_payload == {
        "loaded": expected_loaded,
        "path": expected_path,
    }


def test_analysis_progress_maps_candidate_count_to_task_progress() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.ANALYSIS_PROGRESS,
        {
            "processed_line": 4,
            "analysis_candidate_count": 7,
            "request_in_flight_count": 1,
        },
    )

    assert topic == "task.progress_changed"
    assert payload["task_type"] == "analysis"
    assert payload["processed_line"] == 4
    assert payload["analysis_candidate_count"] == 7
    assert payload["request_in_flight_count"] == 1


def test_event_bridge_maps_extra_progress_topic() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.EXTRA_TS_CONVERSION_PROGRESS,
        {
            "current": 2,
            "total": 10,
            "message": "running",
            "phase": "RUNNING",
        },
    )

    assert topic == "extra.ts_conversion_progress"
    assert payload["task_id"] == "extra_ts_conversion"
    assert payload["phase"] == "RUNNING"
    assert payload["current"] == 2
    assert payload["finished"] is False


def test_event_bridge_maps_extra_finished_topic() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.EXTRA_TS_CONVERSION_FINISHED,
        {
            "message": "done",
            "current": 10,
            "total": 10,
        },
    )

    assert topic == "extra.ts_conversion_finished"
    assert payload["task_id"] == "extra_ts_conversion"
    assert payload["phase"] == "FINISHED"
    assert payload["message"] == "done"
    assert payload["finished"] is True


def test_unknown_event_is_ignored() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.PROJECT_CHECK,
        {},
    )

    assert topic is None
    assert payload == {}


def test_event_bridge_ignores_reset_events_without_public_contract() -> None:
    topic, payload = PublicEventBridge().map_event(
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert topic is None
    assert payload == {}
