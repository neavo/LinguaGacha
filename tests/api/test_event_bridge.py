from base.Base import Base
from api.Bridge.EventBridge import EventBridge


def test_translation_progress_is_mapped_to_task_progress() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {
            "processed_line": 3,
            "total_line": 10,
            "total_output_tokens": 8,
            "total_input_tokens": 5,
            "start_time": 12.5,
        },
    )

    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
    assert payload["processed_line"] == 3
    assert payload["total_output_tokens"] == 8
    assert payload["total_input_tokens"] == 5
    assert payload["start_time"] == 12.5


def test_quality_rule_update_maps_to_snapshot_invalidated_topic() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_type": "glossary"},
    )

    assert topic == "proofreading.snapshot_invalidated"
    assert payload["reason"] == "quality_rule_update"
