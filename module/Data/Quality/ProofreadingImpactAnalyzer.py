from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Core.DataEnums import TextPreserveMode


@dataclass(frozen=True)
class ProofreadingImpactResult:
    """校对页精确影响范围。"""

    scope: str
    item_ids: tuple[int, ...] = ()
    rel_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProofreadingReplacementRule:
    """替换规则的最小语义快照。"""

    src: str
    dst: str
    regex: bool = False
    case_sensitive: bool = False


class ProofreadingImpactAnalyzer:
    """按当前规则语义估算会影响哪些校对条目。"""

    ENTRY_SCOPE: str = "entry"
    GLOBAL_SCOPE: str = "global"

    def __init__(
        self,
        data_manager: Any,
    ) -> None:
        self.data_manager = data_manager

    def analyze_rule_update(
        self,
        *,
        rule_type: str,
        old_entries: list[dict[str, Any]],
        new_entries: list[dict[str, Any]],
        old_meta: dict[str, Any],
        new_meta: dict[str, Any],
    ) -> ProofreadingImpactResult | None:
        """返回本次规则写入对校对页的最小影响范围。"""

        normalized_rule_type = str(rule_type).strip().casefold()
        if not getattr(self.data_manager, "is_loaded", lambda: False)():
            return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)

        review_items = self.build_review_items(
            getattr(self.data_manager, "get_all_items", lambda: [])()
        )
        if normalized_rule_type == "glossary":
            return self.analyze_glossary_update(
                review_items=review_items,
                old_entries=old_entries,
                new_entries=new_entries,
                old_meta=old_meta,
                new_meta=new_meta,
            )
        if normalized_rule_type == "pre_replacement":
            return self.analyze_pre_replacement_update(
                review_items=review_items,
                old_entries=old_entries,
                new_entries=new_entries,
                old_meta=old_meta,
                new_meta=new_meta,
            )
        if normalized_rule_type == "post_replacement":
            return self.analyze_post_replacement_update(
                review_items=review_items,
                old_entries=old_entries,
                new_entries=new_entries,
                old_meta=old_meta,
                new_meta=new_meta,
            )
        if normalized_rule_type == "text_preserve":
            return self.analyze_text_preserve_update(
                review_items=review_items,
                old_entries=old_entries,
                new_entries=new_entries,
                old_meta=old_meta,
                new_meta=new_meta,
            )

        return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)

    def analyze_glossary_update(
        self,
        *,
        review_items: list[Item],
        old_entries: list[dict[str, Any]],
        new_entries: list[dict[str, Any]],
        old_meta: dict[str, Any],
        new_meta: dict[str, Any],
    ) -> ProofreadingImpactResult | None:
        """术语改动按替换后的原文命中条目。"""

        old_terms = self.extract_src_dst_pairs(old_entries)
        new_terms = self.extract_src_dst_pairs(new_entries)
        old_enabled = bool(old_meta.get("enabled", True))
        new_enabled = bool(new_meta.get("enabled", True))
        if old_terms == new_terms and old_enabled == new_enabled:
            return None

        target_srcs = {term[0] for term in [*old_terms, *new_terms] if term[0] != ""}
        if not target_srcs:
            return None

        pre_rules = self.get_active_pre_replacements()
        return self.build_entry_impact(
            review_items,
            lambda item: any(
                src in self.apply_pre_replacements(item.get_src(), pre_rules)
                for src in target_srcs
            ),
        )

    def analyze_pre_replacement_update(
        self,
        *,
        review_items: list[Item],
        old_entries: list[dict[str, Any]],
        new_entries: list[dict[str, Any]],
        old_meta: dict[str, Any],
        new_meta: dict[str, Any],
    ) -> ProofreadingImpactResult | None:
        """前置替换按原文命中条目。"""

        old_rules = self.extract_replacement_rules(old_entries)
        new_rules = self.extract_replacement_rules(new_entries)
        old_enabled = bool(old_meta.get("enabled", True))
        new_enabled = bool(new_meta.get("enabled", True))
        if old_rules == new_rules and old_enabled == new_enabled:
            return None

        target_rules = self.merge_replacement_rules(old_rules, new_rules)
        if not target_rules:
            return None

        try:
            return self.build_entry_impact(
                review_items,
                lambda item: any(
                    self.match_replacement_rule_text(item.get_src(), rule)
                    for rule in target_rules
                ),
            )
        except re.error:
            return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)

    def analyze_post_replacement_update(
        self,
        *,
        review_items: list[Item],
        old_entries: list[dict[str, Any]],
        new_entries: list[dict[str, Any]],
        old_meta: dict[str, Any],
        new_meta: dict[str, Any],
    ) -> ProofreadingImpactResult | None:
        """后置替换按原始译文命中条目。"""

        old_rules = self.extract_replacement_rules(old_entries)
        new_rules = self.extract_replacement_rules(new_entries)
        old_enabled = bool(old_meta.get("enabled", True))
        new_enabled = bool(new_meta.get("enabled", True))
        if old_rules == new_rules and old_enabled == new_enabled:
            return None

        target_rules = self.merge_replacement_rules(old_rules, new_rules)
        if not target_rules:
            return None

        try:
            return self.build_entry_impact(
                review_items,
                lambda item: any(
                    self.match_replacement_rule_text(item.get_dst(), rule)
                    for rule in target_rules
                ),
            )
        except re.error:
            return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)

    def analyze_text_preserve_update(
        self,
        *,
        review_items: list[Item],
        old_entries: list[dict[str, Any]],
        new_entries: list[dict[str, Any]],
        old_meta: dict[str, Any],
        new_meta: dict[str, Any],
    ) -> ProofreadingImpactResult | None:
        """文本保护只在 CUSTOM 模式下按 regex 候选集收敛。"""

        old_mode = self.normalize_text_preserve_mode(old_meta.get("mode"))
        new_mode = self.normalize_text_preserve_mode(new_meta.get("mode"))
        if old_mode != new_mode:
            return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)
        if new_mode != TextPreserveMode.CUSTOM:
            return None

        old_patterns = self.extract_text_preserve_patterns(old_entries)
        new_patterns = self.extract_text_preserve_patterns(new_entries)
        if old_patterns == new_patterns:
            return None

        compiled_patterns: list[re.Pattern[str]] = []
        for pattern in [*old_patterns, *new_patterns]:
            try:
                compiled_patterns.append(re.compile(pattern, re.IGNORECASE))
            except re.error:
                return ProofreadingImpactResult(scope=self.GLOBAL_SCOPE)

        return self.build_entry_impact(
            review_items,
            lambda item: any(
                pattern.search(item.get_src()) is not None
                or pattern.search(item.get_dst()) is not None
                for pattern in compiled_patterns
            ),
        )

    def build_entry_impact(
        self,
        review_items: list[Item],
        matcher: Any,
    ) -> ProofreadingImpactResult | None:
        """把候选命中条目收口为 entry patch 所需最小范围。"""

        item_ids: list[int] = []
        rel_paths: list[str] = []
        seen_item_ids: set[int] = set()
        seen_rel_paths: set[str] = set()
        for item in review_items:
            if not matcher(item):
                continue

            item_id = item.get_id()
            if isinstance(item_id, int) and item_id not in seen_item_ids:
                seen_item_ids.add(item_id)
                item_ids.append(item_id)

            rel_path = str(item.get_file_path() or "")
            if rel_path != "" and rel_path not in seen_rel_paths:
                seen_rel_paths.add(rel_path)
                rel_paths.append(rel_path)

        if not item_ids:
            return None

        return ProofreadingImpactResult(
            scope=self.ENTRY_SCOPE,
            item_ids=tuple(item_ids),
            rel_paths=tuple(rel_paths),
        )

    def build_review_items(self, items_all: list[Item]) -> list[Item]:
        """镜像校对页当前 review 集构造口径。"""

        review_items: list[Item] = []
        for item in items_all:
            if not item.get_src().strip():
                continue
            if item.get_status() in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue
            review_items.append(item)
        return review_items

    def get_active_pre_replacements(self) -> tuple[dict[str, Any], ...]:
        """读取当前生效的前置替换规则。"""

        get_enable = getattr(self.data_manager, "get_pre_replacement_enable", None)
        if callable(get_enable) and not bool(get_enable()):
            return ()

        get_rules = getattr(self.data_manager, "get_pre_replacement", None)
        if not callable(get_rules):
            return ()

        raw_rules = get_rules()
        if not isinstance(raw_rules, list):
            return ()
        return tuple(dict(rule) for rule in raw_rules if isinstance(rule, dict))

    def apply_pre_replacements(
        self,
        src: str,
        rules: tuple[dict[str, Any], ...],
    ) -> str:
        """镜像 ResultChecker 当前对原文的前置替换语义。"""

        replaced_src = str(src)
        for replacement in rules:
            old_src = str(replacement.get("src", ""))
            new_dst = str(replacement.get("dst", ""))
            if old_src == "":
                continue
            replaced_src = replaced_src.replace(old_src, new_dst)
        return replaced_src

    def extract_src_dst_pairs(
        self,
        entries: list[dict[str, Any]],
    ) -> tuple[tuple[str, str], ...]:
        """提取真正影响语义的 src/dst 对。"""

        pairs: list[tuple[str, str]] = []
        seen_pairs: set[tuple[str, str]] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            src = str(entry.get("src", "")).strip()
            dst = str(entry.get("dst", "")).strip()
            if src == "" and dst == "":
                continue
            pair = (src, dst)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            pairs.append(pair)
        return tuple(pairs)

    def extract_replacement_rules(
        self,
        entries: list[dict[str, Any]],
    ) -> tuple[ProofreadingReplacementRule, ...]:
        """提取替换规则真实参与匹配的最小语义集合。"""

        rules: list[ProofreadingReplacementRule] = []
        seen_rules: set[ProofreadingReplacementRule] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            rule = ProofreadingReplacementRule(
                src=str(entry.get("src", "")).strip(),
                dst=str(entry.get("dst", "")).strip(),
                regex=bool(entry.get("regex", False)),
                case_sensitive=bool(entry.get("case_sensitive", False)),
            )
            if rule.src == "":
                continue
            if rule in seen_rules:
                continue
            seen_rules.add(rule)
            rules.append(rule)
        return tuple(rules)

    def merge_replacement_rules(
        self,
        old_rules: tuple[ProofreadingReplacementRule, ...],
        new_rules: tuple[ProofreadingReplacementRule, ...],
    ) -> tuple[ProofreadingReplacementRule, ...]:
        """合并旧新规则，保证影响分析不会漏掉语义变更前后的命中集。"""

        merged_rules: list[ProofreadingReplacementRule] = []
        seen_rules: set[ProofreadingReplacementRule] = set()
        for rule in [*old_rules, *new_rules]:
            if rule in seen_rules:
                continue
            seen_rules.add(rule)
            merged_rules.append(rule)
        return tuple(merged_rules)

    def match_replacement_rule_text(
        self,
        text: str,
        rule: ProofreadingReplacementRule,
    ) -> bool:
        """镜像替换规则的真实命中语义，避免 impact 分析与 TextProcessor 漂移。"""

        if rule.src == "":
            return False

        if rule.regex:
            flags = 0 if rule.case_sensitive else re.IGNORECASE
            return re.search(rule.src, text, flags) is not None

        if rule.case_sensitive:
            return rule.src in text

        return rule.src.casefold() in text.casefold()

    def extract_text_preserve_patterns(
        self,
        entries: list[dict[str, Any]],
    ) -> tuple[str, ...]:
        """提取文本保护真正生效的 regex 模式。"""

        patterns: list[str] = []
        seen_patterns: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            pattern = str(entry.get("src", "")).strip()
            if pattern == "" or pattern in seen_patterns:
                continue
            seen_patterns.add(pattern)
            patterns.append(pattern)
        return tuple(patterns)

    def normalize_text_preserve_mode(self, raw_value: Any) -> TextPreserveMode:
        """把文本保护模式收口成稳定枚举。"""

        if isinstance(raw_value, TextPreserveMode):
            return raw_value
        try:
            return TextPreserveMode(str(raw_value).lower())
        except ValueError:
            return TextPreserveMode.OFF
