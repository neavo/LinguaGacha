from base.Base import Base
from api.Bridge.EventBridge import EventBridge


def test_translation_progress_is_mapped_to_task_progress() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"processed_line": 3, "total_line": 10},
    )

    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
    assert payload["processed_line"] == 3
