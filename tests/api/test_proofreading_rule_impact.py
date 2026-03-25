from __future__ import annotations

from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact
from frontend.Proofreading.ProofreadingPage import ProofreadingPage


def test_proofreading_rule_impact_filters_relevant_quality_rule_updates() -> None:
    """单一来源必须只保留校对页真正关心的规则类型与 meta key。"""

    relevant_rule_types, relevant_meta_keys = (
        ProofreadingRuleImpact.extract_relevant_rule_update(
            {
                "rule_types": ["glossary", "translation_prompt"],
                "meta_keys": ["glossary_enable", "analysis_prompt_enable"],
            }
        )
    )

    assert relevant_rule_types == ["glossary"]
    assert relevant_meta_keys == ["glossary_enable"]


def test_event_bridge_and_proofreading_page_share_rule_impact_source(
    monkeypatch,
) -> None:
    """桥接层和前端页必须共用同一份相关性判断，而不是复制常量。"""

    def fake_extract_relevant_rule_update(data) -> tuple[list[str], list[str]]:
        del data
        return [], []

    monkeypatch.setattr(
        ProofreadingRuleImpact,
        "extract_relevant_rule_update",
        fake_extract_relevant_rule_update,
    )

    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["glossary"]},
    )
    proofreading_page = ProofreadingPage.__new__(ProofreadingPage)
    is_relevant = proofreading_page.is_quality_rule_update_relevant(
        {"rule_types": ["glossary"]}
    )

    assert topic is None
    assert payload == {}
    assert is_relevant is False
