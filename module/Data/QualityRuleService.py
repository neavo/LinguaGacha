from __future__ import annotations

from collections.abc import Callable
from typing import Any

from base.Base import Base
from module.Data.LGDatabase import LGDatabase
from module.Data.RuleService import RuleService
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


class QualityRuleService:
    """质量规则业务服务。"""

    RULE_STATISTICS_COUNTED_STATUSES = frozenset(
        {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSING,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
            Base.ProjectStatus.ERROR,
        }
    )

    def __init__(
        self,
        rule_service: RuleService,
        get_meta: Callable[[str, Any], Any],
        set_meta: Callable[[str, Any], None],
        get_all_item_dicts: Callable[[], list[dict[str, Any]]],
        text_preserve_mode_type: type,
    ) -> None:
        self.rule_service = rule_service
        self.get_meta = get_meta
        self.set_meta = set_meta
        self.get_all_item_dicts = get_all_item_dicts
        self.text_preserve_mode_type = text_preserve_mode_type

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        return self.rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> list[dict[str, Any]]:
        normalized = self.normalize_quality_rules_for_write(rule_type, data)
        self.rule_service.set_rules_cached(rule_type, normalized, save)
        return normalized

    def normalize_quality_rules_for_write(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """统一收敛重复规则和空 src。"""

        try:
            quality_type = QualityRuleMerger.RuleType(rule_type.value)
        except ValueError:
            return data

        merged, _report = QualityRuleMerger.merge(
            rule_type=quality_type,
            existing=[],
            incoming=data,
            merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
        )
        return merged

    def get_rule_text_cached(self, rule_type: LGDatabase.RuleType) -> str:
        return self.rule_service.get_rule_text_cached(rule_type)

    def set_rule_text_cached(self, rule_type: LGDatabase.RuleType, text: str) -> None:
        self.rule_service.set_rule_text_cached(rule_type, text)

    def get_glossary(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.GLOSSARY)

    def set_glossary(
        self,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> list[dict[str, Any]]:
        return self.set_rules_cached(LGDatabase.RuleType.GLOSSARY, data, save)

    def merge_glossary_incoming(
        self,
        incoming: list[dict[str, Any]],
        *,
        merge_mode: QualityRuleMerger.MergeMode,
        save: bool = False,
    ) -> tuple[list[dict[str, Any]] | None, QualityRuleMerger.Report]:
        """把来料术语并入当前术语表。"""

        current = self.get_glossary()
        merged, report = QualityRuleMerger.merge(
            rule_type=QualityRuleMerger.RuleType.GLOSSARY,
            existing=current,
            incoming=incoming,
            merge_mode=merge_mode,
        )

        changed = any(
            (
                report.added,
                report.updated,
                report.filled,
                report.deduped,
                report.skipped_empty_src,
            )
        )
        if not changed:
            return None, report

        self.set_glossary(merged, save=save)
        return merged, report

    def get_glossary_enable(self) -> bool:
        return bool(self.get_meta("glossary_enable", True))

    def set_glossary_enable(self, enable: bool) -> None:
        self.set_meta("glossary_enable", bool(enable))

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE)

    def set_text_preserve(self, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.set_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE, data, True)

    def get_text_preserve_mode(self) -> Any:
        raw = self.get_meta(
            "text_preserve_mode",
            self.text_preserve_mode_type.SMART.value,
        )
        if isinstance(raw, str):
            try:
                return self.text_preserve_mode_type(raw)
            except ValueError:
                return self.text_preserve_mode_type.SMART
        return self.text_preserve_mode_type.SMART

    def set_text_preserve_mode(self, mode: Any) -> Any:
        try:
            normalized = (
                mode
                if isinstance(mode, self.text_preserve_mode_type)
                else self.text_preserve_mode_type(str(mode))
            )
        except ValueError:
            normalized = self.text_preserve_mode_type.OFF

        self.set_meta("text_preserve_mode", normalized.value)
        return normalized

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT)

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.set_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT, data, True)

    def get_pre_replacement_enable(self) -> bool:
        return bool(self.get_meta("pre_translation_replacement_enable", True))

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.set_meta("pre_translation_replacement_enable", bool(enable))

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT)

    def set_post_replacement(self, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.set_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT, data, True)

    def get_post_replacement_enable(self) -> bool:
        return bool(self.get_meta("post_translation_replacement_enable", True))

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.set_meta("post_translation_replacement_enable", bool(enable))

    def get_translation_prompt(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.TRANSLATION_PROMPT)

    def set_translation_prompt(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.TRANSLATION_PROMPT, text)

    def get_translation_prompt_enable(self) -> bool:
        return bool(self.get_meta("translation_prompt_enable", False))

    def set_translation_prompt_enable(self, enable: bool) -> None:
        self.set_meta("translation_prompt_enable", bool(enable))

    def get_analysis_prompt(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.ANALYSIS_PROMPT)

    def set_analysis_prompt(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.ANALYSIS_PROMPT, text)

    def get_analysis_prompt_enable(self) -> bool:
        return bool(self.get_meta("analysis_prompt_enable", False))

    def set_analysis_prompt_enable(self, enable: bool) -> None:
        self.set_meta("analysis_prompt_enable", bool(enable))

    @staticmethod
    def normalize_rule_statistics_text(value: Any) -> str:
        """把统计输入统一成字符串。"""

        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)

    @staticmethod
    def normalize_rule_statistics_status(value: Any) -> Base.ProjectStatus:
        """把条目状态统一成枚举。"""

        if isinstance(value, Base.ProjectStatus):
            return value
        if isinstance(value, str):
            try:
                return Base.ProjectStatus(value)
            except ValueError:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE

    def collect_rule_statistics_texts(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """提取规则统计需要的 src/dst 文本快照。"""

        src_texts: list[str] = []
        dst_texts: list[str] = []
        for item in self.get_all_item_dicts():
            if not isinstance(item, dict):
                continue

            status = self.normalize_rule_statistics_status(item.get("status"))
            if status not in self.RULE_STATISTICS_COUNTED_STATUSES:
                continue

            src_texts.append(self.normalize_rule_statistics_text(item.get("src", "")))
            dst_texts.append(self.normalize_rule_statistics_text(item.get("dst", "")))

        return tuple(src_texts), tuple(dst_texts)
