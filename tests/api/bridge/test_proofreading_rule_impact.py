from __future__ import annotations

from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact
from module.Data.Storage.LGDatabase import LGDatabase


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


def test_extract_relevant_rule_update_accepts_uppercase_rule_types_from_data_manager() -> (
    None
):
    # 准备
    update_payload = {
        "rule_types": [LGDatabase.RuleType.GLOSSARY.value],
        "meta_keys": ["GLOSSARY_ENABLE"],
    }

    # 执行
    relevant_rule_types, relevant_meta_keys = (
        ProofreadingRuleImpact.extract_relevant_rule_update(update_payload)
    )

    # 断言
    assert relevant_rule_types == ["glossary"]
    assert relevant_meta_keys == ["glossary_enable"]


def test_normalize_strings_accepts_single_value_and_sequences() -> None:
    # 准备
    single_value = " Glossary "
    sequence_value = ("Text_Preserve", " glossary_enable ")

    # 执行
    normalized_single = ProofreadingRuleImpact.normalize_strings(single_value)
    normalized_sequence = ProofreadingRuleImpact.normalize_strings(sequence_value)

    # 断言
    assert normalized_single == ["glossary"]
    assert normalized_sequence == ["text_preserve", "glossary_enable"]


def test_normalize_strings_rejects_non_string_like_values() -> None:
    # 准备
    invalid_value = None

    # 执行
    normalized = ProofreadingRuleImpact.normalize_strings(invalid_value)

    # 断言
    assert normalized == []


def test_extract_relevant_rule_update_accepts_legacy_singular_keys() -> None:
    # 准备
    update_payload = {
        "rule_type": "TEXT_PRESERVE",
        "meta_key": "TEXT_PRESERVE_MODE",
    }

    # 执行
    relevant_rule_types, relevant_meta_keys = (
        ProofreadingRuleImpact.extract_relevant_rule_update(update_payload)
    )

    # 断言
    assert relevant_rule_types == ["text_preserve"]
    assert relevant_meta_keys == ["text_preserve_mode"]


def test_is_rule_update_relevant_only_returns_true_for_supported_updates() -> None:
    # 准备
    relevant_payload = {"meta_key": "GLOSSARY_ENABLE"}
    irrelevant_payload = {"rule_type": "translation_prompt"}

    # 执行
    relevant = ProofreadingRuleImpact.is_rule_update_relevant(relevant_payload)
    irrelevant = ProofreadingRuleImpact.is_rule_update_relevant(irrelevant_payload)
    empty = ProofreadingRuleImpact.is_rule_update_relevant(None)

    # 断言
    assert relevant is True
    assert irrelevant is False
    assert empty is False
