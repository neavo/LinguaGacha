from __future__ import annotations

from enum import StrEnum


class DatabaseRuleType(StrEnum):
    # 工程规则类型契约，避免业务层依赖物理存储实现。

    GLOSSARY = "GLOSSARY"
    PRE_REPLACEMENT = "PRE_REPLACEMENT"
    POST_REPLACEMENT = "POST_REPLACEMENT"
    TEXT_PRESERVE = "TEXT_PRESERVE"
    TRANSLATION_PROMPT = "TRANSLATION_PROMPT"
    ANALYSIS_PROMPT = "ANALYSIS_PROMPT"


class DatabaseLegacyRuleType:
    # 旧工程规则槽位名称，只用于读取兼容数据。

    TRANSLATION_PROMPT_ZH: str = "CUSTOM_PROMPT_ZH"
    TRANSLATION_PROMPT_EN: str = "CUSTOM_PROMPT_EN"
