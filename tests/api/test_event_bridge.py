from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact


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
        },
    )

    # 断言
    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
    assert payload["processed_line"] == 3
    assert payload["total_output_tokens"] == 8
    assert payload["total_input_tokens"] == 5
    assert payload["start_time"] == 12.5


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
    assert payload["rule_types"] == ["glossary"]
    assert payload["meta_keys"] == []
