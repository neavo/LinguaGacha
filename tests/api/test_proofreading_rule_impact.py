from __future__ import annotations

from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact


def test_extract_relevant_rule_update_filters_rule_types_and_meta_keys() -> None:
    # 准备
    update_payload = {
        "rule_types": ["glossary", "translation_prompt"],
        "meta_keys": ["glossary_enable", "analysis_prompt_enable"],
    }

    # 执行
    relevant_rule_types, relevant_meta_keys = (
        ProofreadingRuleImpact.extract_relevant_rule_update(update_payload)
    )

    # 断言
    assert relevant_rule_types == ["glossary"]
    assert relevant_meta_keys == ["glossary_enable"]
