import pytest

from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact
from module.Data.Storage.LGDatabase import LGDatabase


def test_translation_progress_is_mapped_to_task_progress() -> None:
    # 准备
    event_bridge = EventBridge()

    # 执行
    topic, payload = event_bridge.map_event(
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

    # 断言
    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
    assert payload["processed_line"] == 3
    assert payload["total_output_tokens"] == 8
    assert payload["total_input_tokens"] == 5
    assert payload["start_time"] == 12.5
    assert payload["request_in_flight_count"] == 2


def test_translation_progress_patch_does_not_force_missing_fields_to_zero() -> None:
    # 准备
    event_bridge = EventBridge()

    # 执行
    topic, payload = event_bridge.map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {
            "request_in_flight_count": 4,
        },
    )

    # 断言
    assert topic == "task.progress_changed"
    assert payload == {
        "task_type": "translation",
        "request_in_flight_count": 4,
    }


def test_config_updated_maps_settings_snapshot_when_available() -> None:
    topic, payload = EventBridge().map_event(
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


def test_workbench_refresh_maps_to_workbench_snapshot_changed() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.WORKBENCH_REFRESH,
        {"reason": "config_updated"},
    )

    assert topic == "workbench.snapshot_changed"
    assert payload == {
        "reason": "config_updated",
        "scope": "global",
    }


def test_proofreading_refresh_maps_to_snapshot_invalidated() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.PROOFREADING_REFRESH,
        {
            "reason": "project_file_update",
            "scope": "entry",
            "item_ids": [1, "2", "x"],
            "rel_paths": ["chapter/a.txt"],
            "removed_rel_paths": ["chapter/old.txt"],
            "source_event": Base.Event.PROJECT_FILE_UPDATE.value,
        },
    )

    assert topic == "proofreading.snapshot_invalidated"
    assert payload == {
        "reason": "project_file_update",
        "scope": "entry",
        "item_ids": [1, 2],
        "rel_paths": ["chapter/a.txt"],
        "removed_rel_paths": ["chapter/old.txt"],
        "source_event": Base.Event.PROJECT_FILE_UPDATE.value,
    }


def test_workbench_refresh_maps_file_scope_payload() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.WORKBENCH_REFRESH,
        {
            "reason": "project_file_update",
            "scope": "file",
            "rel_paths": ["chapter/a.txt", "chapter/b.txt"],
            "removed_rel_paths": ["chapter/old.txt"],
            "order_changed": False,
        },
    )

    assert topic == "workbench.snapshot_changed"
    assert payload == {
        "reason": "project_file_update",
        "scope": "file",
        "rel_paths": ["chapter/a.txt", "chapter/b.txt"],
        "removed_rel_paths": ["chapter/old.txt"],
        "order_changed": False,
    }


def test_analysis_progress_maps_candidate_count_to_task_progress() -> None:
    # 准备
    event_bridge = EventBridge()

    # 执行
    topic, payload = event_bridge.map_event(
        Base.Event.ANALYSIS_PROGRESS,
        {
            "processed_line": 4,
            "analysis_candidate_count": 7,
            "request_in_flight_count": 1,
        },
    )

    # 断言
    assert topic == "task.progress_changed"
    assert payload["task_type"] == "analysis"
    assert payload["processed_line"] == 4
    assert payload["analysis_candidate_count"] == 7
    assert payload["request_in_flight_count"] == 1


def test_quality_rule_update_uses_proofreading_rule_impact_single_source(
    monkeypatch,
) -> None:
    # 准备
    observed: list[dict[str, object] | None] = []

    def fake_extract(data: dict[str, object] | None) -> tuple[list[str], list[str]]:
        observed.append(data)
        return ["glossary"], []

    monkeypatch.setattr(
        ProofreadingRuleImpact,
        "extract_relevant_rule_update",
        fake_extract,
    )

    # 执行
    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["glossary"]},
    )

    # 断言
    assert observed == [{"rule_types": ["glossary"]}]
    assert topic == "proofreading.snapshot_invalidated"
    assert payload["reason"] == "quality_rule_update"
    assert payload["scope"] == "global"
    assert payload["rule_types"] == ["glossary"]
    assert payload["meta_keys"] == []


def test_quality_rule_update_maps_uppercase_rule_type_values_to_proofreading_invalidation() -> (
    None
):
    # 准备
    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": [LGDatabase.RuleType.GLOSSARY.value]},
    )

    # 断言
    assert topic == "proofreading.snapshot_invalidated"
    assert payload == {
        "reason": "quality_rule_update",
        "scope": "global",
        "rule_types": ["glossary"],
        "meta_keys": [],
    }


def test_quality_rule_update_preserves_entry_scope_item_ids_and_rel_paths() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {
            "rule_types": ["glossary"],
            "scope": "entry",
            "item_ids": ["1", 2, "oops"],
            "rel_paths": ["script/a.txt"],
        },
    )

    assert topic == "proofreading.snapshot_invalidated"
    assert payload == {
        "reason": "quality_rule_update",
        "scope": "entry",
        "rule_types": ["glossary"],
        "meta_keys": [],
        "item_ids": [1, 2],
        "rel_paths": ["script/a.txt"],
    }


def test_event_bridge_maps_extra_progress_topic() -> None:
    # 准备
    topic, payload = EventBridge().map_event(
        Base.Event.EXTRA_TS_CONVERSION_PROGRESS,
        {
            "current": 2,
            "total": 10,
            "message": "running",
            "phase": "RUNNING",
        },
    )

    # 断言
    assert topic == "extra.ts_conversion_progress"
    assert payload["task_id"] == "extra_ts_conversion"
    assert payload["phase"] == "RUNNING"
    assert payload["current"] == 2
    assert payload["finished"] is False


def test_event_bridge_maps_extra_finished_topic() -> None:
    # 准备
    topic, payload = EventBridge().map_event(
        Base.Event.EXTRA_TS_CONVERSION_FINISHED,
        {
            "message": "done",
            "current": 10,
            "total": 10,
        },
    )

    # 断言
    assert topic == "extra.ts_conversion_finished"
    assert payload["task_id"] == "extra_ts_conversion"
    assert payload["phase"] == "FINISHED"
    assert payload["message"] == "done"
    assert payload["finished"] is True


@pytest.mark.parametrize(
    ("event", "sub_event", "expected_reason", "expected_scope"),
    [
        (
            Base.Event.TRANSLATION_RESET_ALL,
            Base.SubEvent.DONE,
            "translation_reset",
            "all",
        ),
        (
            Base.Event.TRANSLATION_RESET_FAILED,
            Base.SubEvent.ERROR,
            "translation_reset_error",
            "failed",
        ),
    ],
)
def test_translation_reset_terminal_event_invalidates_proofreading_snapshot(
    event,
    sub_event,
    expected_reason,
    expected_scope,
) -> None:
    topic, payload = EventBridge().map_event(
        event,
        {"sub_event": sub_event},
    )

    assert topic == "proofreading.snapshot_invalidated"
    assert payload["reason"] == expected_reason
    assert payload["reset_scope"] == expected_scope


def test_translation_reset_failed_done_is_not_exposed_by_event_bridge() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_RESET_FAILED,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert topic is None
    assert payload == {}


def test_translation_reset_request_is_not_exposed_before_terminal_state() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert topic is None
    assert payload == {}
