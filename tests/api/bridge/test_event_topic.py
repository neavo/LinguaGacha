from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.EventTopic import EventTopic


def test_proofreading_snapshot_invalidated_topic_value_matches_public_contract() -> (
    None
):
    # 准备
    topic = EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED

    # 执行
    topic_value = topic.value

    # 断言
    assert topic_value == "proofreading.snapshot_invalidated"


def test_quality_rule_update_maps_to_snapshot_invalidated_topic() -> None:
    # 准备
    event_bridge = EventBridge()

    # 执行
    topic, payload = event_bridge.map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_type": "glossary"},
    )

    # 断言
    assert topic == EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value
    assert payload["reason"] == "quality_rule_update"
    assert payload["rule_types"] == ["glossary"]
    assert payload["meta_keys"] == []


def test_irrelevant_quality_rule_update_does_not_emit_event() -> None:
    # 准备
    event_bridge = EventBridge()

    # 执行
    topic, payload = event_bridge.map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["translation_prompt"]},
    )

    # 断言
    assert topic is None
    assert payload == {}
