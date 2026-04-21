from api.Bridge.EventBridge import EventBridge
from api.Bridge.EventTopic import EventTopic
from base.Base import Base


def test_event_topic_no_longer_exposes_v1_invalidation_topics() -> None:
    actual_topics = {topic.name for topic in EventTopic}

    assert "WORKBENCH_SNAPSHOT_CHANGED" not in actual_topics
    assert "PROOFREADING_SNAPSHOT_INVALIDATED" not in actual_topics


def test_event_bridge_ignores_v1_invalidation_events() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.WORKBENCH_REFRESH,
        {"reason": "config_updated"},
    )

    assert topic is None
    assert payload == {}

    topic, payload = EventBridge().map_event(
        Base.Event.PROOFREADING_REFRESH,
        {"reason": "project_file_update"},
    )

    assert topic is None
    assert payload == {}


def test_event_bridge_ignores_v1_quality_and_reset_invalidation_events() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["glossary"]},
    )

    assert topic is None
    assert payload == {}

    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_RESET_ALL,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert topic is None
    assert payload == {}
