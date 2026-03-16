from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from module.Data.DataManager import DataManager


@dataclass
class QualityRuleSnapshot:
    """翻译用质量规则快照。

    约束：
    - 翻译过程中不应受到 UI 对规则的修改影响
    """

    glossary_enable: bool
    text_preserve_mode: DataManager.TextPreserveMode
    text_preserve_entries: tuple[dict[str, Any], ...]
    pre_replacement_enable: bool
    pre_replacement_entries: tuple[dict[str, Any], ...]
    post_replacement_enable: bool
    post_replacement_entries: tuple[dict[str, Any], ...]
    translation_prompt_enable: bool
    translation_prompt: str
    analysis_prompt_enable: bool
    analysis_prompt: str

    glossary_entries: list[dict[str, Any]]

    @staticmethod
    def copy_non_empty_entries(
        raw_entries: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], ...]:
        """统一复制有效规则项，避免不同规则各写一套筛选逻辑。"""
        return tuple(
            dict(entry)
            for entry in raw_entries
            if isinstance(entry, dict) and str(entry.get("src", "")).strip() != ""
        )

    @classmethod
    def capture(cls) -> "QualityRuleSnapshot":
        dm = DataManager.get()

        return cls(
            glossary_enable=dm.get_glossary_enable(),
            text_preserve_mode=dm.get_text_preserve_mode(),
            text_preserve_entries=cls.copy_non_empty_entries(dm.get_text_preserve()),
            pre_replacement_enable=dm.get_pre_replacement_enable(),
            pre_replacement_entries=cls.copy_non_empty_entries(
                dm.get_pre_replacement()
            ),
            post_replacement_enable=dm.get_post_replacement_enable(),
            post_replacement_entries=cls.copy_non_empty_entries(
                dm.get_post_replacement()
            ),
            translation_prompt_enable=dm.get_translation_prompt_enable(),
            translation_prompt=dm.get_translation_prompt(),
            analysis_prompt_enable=dm.get_analysis_prompt_enable(),
            analysis_prompt=dm.get_analysis_prompt(),
            glossary_entries=list(cls.copy_non_empty_entries(dm.get_glossary())),
        )

    def get_glossary_entries(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.glossary_entries)
