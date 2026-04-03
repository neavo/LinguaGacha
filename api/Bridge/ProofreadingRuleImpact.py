from __future__ import annotations

from typing import Any


class ProofreadingRuleImpact:
    """统一维护校对页会受影响的质量规则定义与判断。"""

    PROOFREADING_RULE_TYPES: set[str] = {
        "glossary",
        "pre_replacement",
        "post_replacement",
        "text_preserve",
    }
    PROOFREADING_META_KEYS: set[str] = {
        "glossary_enable",
        "pre_translation_replacement_enable",
        "post_translation_replacement_enable",
        "text_preserve_mode",
    }

    @classmethod
    def normalize_strings(cls, value: Any) -> list[str]:
        """把单值或序列统一收口成字符串列表，方便做相关性判断。"""

        if isinstance(value, str):
            return [value]
        elif isinstance(value, (list, tuple, set)):
            return [str(item) for item in value]
        else:
            return []

    @classmethod
    def extract_relevant_rule_update(
        cls,
        data: dict[str, Any] | None,
    ) -> tuple[list[str], list[str]]:
        """提取校对页真正关心的规则类型与 meta key。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        normalized_rule_types = cls.normalize_strings(
            normalized.get("rule_types", normalized.get("rule_type", []))
        )
        normalized_meta_keys = cls.normalize_strings(
            normalized.get("meta_keys", normalized.get("meta_key", []))
        )

        relevant_rule_types = [
            rule_type
            for rule_type in normalized_rule_types
            if rule_type in cls.PROOFREADING_RULE_TYPES
        ]
        relevant_meta_keys = [
            meta_key
            for meta_key in normalized_meta_keys
            if meta_key in cls.PROOFREADING_META_KEYS
        ]
        return relevant_rule_types, relevant_meta_keys

    @classmethod
    def is_rule_update_relevant(cls, data: dict[str, Any] | None) -> bool:
        """给桥接层和前端页共享的统一判断入口。"""

        relevant_rule_types, relevant_meta_keys = cls.extract_relevant_rule_update(
            data
        )
        return bool(relevant_rule_types or relevant_meta_keys)
