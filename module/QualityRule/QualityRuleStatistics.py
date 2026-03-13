from __future__ import annotations

import dataclasses
import re
from bisect import bisect_right
from collections import deque
from enum import StrEnum
from typing import Any
from typing import Callable

from module.Utils.GapTool import GapTool


class QualityRuleStatistics:
    """质量规则统计器（纯逻辑）。

    目标：
    - 把统计口径集中到一个纯逻辑类里，页面层和数据层统一复用
    - 命中次数与包含关系一起产出，避免调用方各自拼装
    - 在不改变统计语义的前提下，尽量缩小包含关系扫描的比较范围
    """

    class RuleStatMode(StrEnum):
        """规则统计模式。"""

        GLOSSARY = "glossary"
        PRE_REPLACEMENT = "pre_replacement"
        POST_REPLACEMENT = "post_replacement"
        TEXT_PRESERVE = "text_preserve"

    @dataclasses.dataclass(frozen=True)
    class RuleStatInput:
        """单条规则统计输入。"""

        key: str
        pattern: str
        mode: "QualityRuleStatistics.RuleStatMode"
        regex: bool = False
        case_sensitive: bool = False

    @dataclasses.dataclass(frozen=True)
    class RuleStatResult:
        """单条规则统计结果。"""

        matched_item_count: int

    @dataclasses.dataclass(frozen=True)
    class RuleStatisticsSnapshot:
        """一轮规则统计的完整快照。"""

        results: dict[str, "QualityRuleStatistics.RuleStatResult"]
        subset_parents: dict[str, tuple[str, ...]]

    @dataclasses.dataclass(frozen=True)
    class LiteralRuleTask:
        """字面量统计任务快照。"""

        key: str
        pattern: str

    @dataclasses.dataclass(frozen=True)
    class RegexRuleTask:
        """正则统计任务快照。"""

        key: str
        pattern: str
        flags: int

    @dataclasses.dataclass
    class AhoNode:
        """Aho-Corasick 自动机节点。"""

        children: dict[str, int] = dataclasses.field(default_factory=dict)
        fail_index: int = 0
        output_indexes: list[int] = dataclasses.field(default_factory=list)

    @dataclasses.dataclass(frozen=True)
    class RelationCandidate:
        """包含关系比较用的候选快照。"""

        key: str
        src: str
        src_fold: str
        length: int
        order: int

    @staticmethod
    def build_glossary_rule_stat_key(entry: dict[str, Any]) -> str:
        """构建术语统计 key，保证 UI 与导入过滤共用同一口径。"""

        src = str(entry.get("src", "")).strip()
        if src == "":
            return ""
        case_sensitive = bool(entry.get("case_sensitive", False))
        return f"{src}|{int(case_sensitive)}"

    @staticmethod
    def build_glossary_rule_stat_inputs(
        entries: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    ) -> list["QualityRuleStatistics.RuleStatInput"]:
        """把术语条目批量转换成统计输入。"""

        rules: list[QualityRuleStatistics.RuleStatInput] = []
        for entry in entries:
            src = str(entry.get("src", "")).strip()
            if src == "":
                continue
            rules.append(
                __class__.RuleStatInput(
                    key=__class__.build_glossary_rule_stat_key(entry),
                    pattern=src,
                    mode=__class__.RuleStatMode.GLOSSARY,
                    case_sensitive=bool(entry.get("case_sensitive", False)),
                )
            )
        return rules

    @staticmethod
    def build_subset_relation_candidates(
        entries: list[dict[str, Any]] | tuple[dict[str, Any], ...],
        *,
        key_builder: Callable[[dict[str, Any]], str],
    ) -> tuple[tuple[str, str], ...]:
        """把条目列表压成“统计 key + src”的候选集。"""

        candidates: list[tuple[str, str]] = []
        for entry in GapTool.iter(entries):
            key = str(key_builder(entry)).strip()
            src = str(entry.get("src", "")).strip()
            if key == "" or src == "":
                continue
            candidates.append((key, src))
        return tuple(candidates)

    @staticmethod
    def build_relation_candidate_snapshots(
        candidates: tuple[tuple[str, str], ...],
    ) -> tuple["QualityRuleStatistics.RelationCandidate", ...]:
        """把原始候选压成便于比较的快照。"""

        snapshots: list[QualityRuleStatistics.RelationCandidate] = []
        for order, candidate in enumerate(GapTool.iter(candidates)):
            key, src = candidate
            normalized_key = str(key).strip()
            normalized_src = str(src).strip()
            if normalized_key == "" or normalized_src == "":
                continue
            snapshots.append(
                __class__.RelationCandidate(
                    key=normalized_key,
                    src=normalized_src,
                    src_fold=normalized_src.casefold(),
                    length=len(normalized_src.casefold()),
                    order=order,
                )
            )
        return tuple(snapshots)

    @staticmethod
    def build_relation_scope_snapshots(
        candidates: tuple[tuple[str, str], ...],
    ) -> tuple["QualityRuleStatistics.RelationCandidate", ...]:
        """按 casefold 去重 scope，避免同一父文本被重复比较。"""

        snapshots = __class__.build_relation_candidate_snapshots(candidates)
        deduped: list[QualityRuleStatistics.RelationCandidate] = []
        seen_folds: set[str] = set()
        for snapshot in snapshots:
            if snapshot.src_fold in seen_folds:
                continue
            seen_folds.add(snapshot.src_fold)
            deduped.append(snapshot)
        return tuple(deduped)

    @staticmethod
    def build_relation_scope_buckets(
        scope_snapshots: tuple["QualityRuleStatistics.RelationCandidate", ...],
    ) -> dict[int, tuple["QualityRuleStatistics.RelationCandidate", ...]]:
        """按文本长度分桶，跳过不可能成为父项的候选。"""

        buckets: dict[int, list[QualityRuleStatistics.RelationCandidate]] = {}
        for snapshot in GapTool.iter(scope_snapshots):
            buckets.setdefault(snapshot.length, []).append(snapshot)
        return {length: tuple(items) for length, items in buckets.items()}

    @staticmethod
    def build_subset_relation_map(
        target_candidates: tuple[tuple[str, str], ...],
        *,
        scope_candidates: tuple[tuple[str, str], ...] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> dict[str, tuple[str, ...]]:
        """构建条目之间的包含关系映射。

        规则：
        - 比较时统一按 casefold 处理，和术语页现有提示口径保持一致
        - 只记录“child 被 parent 包含”的关系
        - 同一个 parent 文本只保留 1 次，避免 tooltip 重复刷屏
        """

        if not target_candidates:
            return {}

        actual_scope_candidates = (
            target_candidates if scope_candidates is None else scope_candidates
        )
        target_snapshots = __class__.build_relation_candidate_snapshots(
            target_candidates
        )
        if not target_snapshots:
            return {}

        scope_snapshots = __class__.build_relation_scope_snapshots(
            actual_scope_candidates
        )
        if not scope_snapshots:
            return {}

        scope_buckets = __class__.build_relation_scope_buckets(scope_snapshots)
        sorted_lengths = tuple(sorted(scope_buckets))
        subset_map: dict[str, tuple[str, ...]] = {}
        for target_snapshot in GapTool.iter(target_snapshots):
            if should_stop is not None and should_stop():
                return {}

            parents = __class__.collect_subset_parents_for_target(
                target_snapshot=target_snapshot,
                scope_buckets=scope_buckets,
                sorted_lengths=sorted_lengths,
                should_stop=should_stop,
            )
            if parents:
                subset_map[target_snapshot.key] = parents

        return subset_map

    @staticmethod
    def collect_subset_parents_for_target(
        *,
        target_snapshot: "QualityRuleStatistics.RelationCandidate",
        scope_buckets: dict[int, tuple["QualityRuleStatistics.RelationCandidate", ...]],
        sorted_lengths: tuple[int, ...],
        should_stop: Callable[[], bool] | None = None,
    ) -> tuple[str, ...]:
        """只对可能包含 child 的更长文本做扫描。"""

        if target_snapshot.src_fold == "":
            return tuple()

        matched_parents: list[QualityRuleStatistics.RelationCandidate] = []
        length_start = bisect_right(sorted_lengths, target_snapshot.length)
        for length in sorted_lengths[length_start:]:
            if should_stop is not None and should_stop():
                return tuple()

            for scope_snapshot in GapTool.iter(scope_buckets.get(length, tuple())):
                if should_stop is not None and should_stop():
                    return tuple()
                if target_snapshot.key == scope_snapshot.key:
                    continue
                if target_snapshot.src_fold == scope_snapshot.src_fold:
                    continue
                if target_snapshot.src_fold not in scope_snapshot.src_fold:
                    continue
                matched_parents.append(scope_snapshot)

        if not matched_parents:
            return tuple()

        matched_parents.sort(key=lambda item: item.order)
        return tuple(parent.src for parent in matched_parents)

    @staticmethod
    def build_rule_statistics_snapshot(
        *,
        rules: list["QualityRuleStatistics.RuleStatInput"]
        | tuple["QualityRuleStatistics.RuleStatInput", ...],
        src_texts: list[str] | tuple[str, ...],
        dst_texts: list[str] | tuple[str, ...],
        relation_candidates: tuple[tuple[str, str], ...],
        relation_target_candidates: tuple[tuple[str, str], ...] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> "QualityRuleStatistics.RuleStatisticsSnapshot":
        """一次性产出命中数与包含关系，保证调用方口径统一。"""

        if should_stop is not None and should_stop():
            return __class__.RuleStatisticsSnapshot(results={}, subset_parents={})

        results: dict[str, QualityRuleStatistics.RuleStatResult] = {}
        if rules:
            results = __class__.count_rule_occurrences(rules, src_texts, dst_texts)
            if should_stop is not None and should_stop():
                return __class__.RuleStatisticsSnapshot(
                    results={},
                    subset_parents={},
                )

        subset_parents = __class__.build_subset_relation_map(
            relation_candidates
            if relation_target_candidates is None
            else relation_target_candidates,
            scope_candidates=relation_candidates,
            should_stop=should_stop,
        )
        if should_stop is not None and should_stop():
            return __class__.RuleStatisticsSnapshot(results={}, subset_parents={})

        return __class__.RuleStatisticsSnapshot(
            results=results,
            subset_parents=subset_parents,
        )

    @staticmethod
    def count_rule_occurrences(
        rules: list["QualityRuleStatistics.RuleStatInput"]
        | tuple["QualityRuleStatistics.RuleStatInput", ...],
        src_texts: list[str] | tuple[str, ...],
        dst_texts: list[str] | tuple[str, ...],
    ) -> dict[str, "QualityRuleStatistics.RuleStatResult"]:
        """统计每条规则的命中条目数。"""

        src_snapshot = tuple(src_texts)
        dst_snapshot = tuple(dst_texts)
        results: dict[str, QualityRuleStatistics.RuleStatResult] = {}
        literal_buckets: dict[
            tuple[bool, bool],
            list[QualityRuleStatistics.LiteralRuleTask],
        ] = {}
        regex_buckets: dict[
            tuple[bool, int],
            list[QualityRuleStatistics.RegexRuleTask],
        ] = {}

        for rule in GapTool.iter(rules):
            key = str(rule.key)
            pattern = __class__.normalize_rule_pattern(rule.pattern)
            if pattern == "":
                results[key] = __class__.RuleStatResult(matched_item_count=0)
                continue

            use_dst = rule.mode == __class__.RuleStatMode.POST_REPLACEMENT
            if rule.mode == __class__.RuleStatMode.TEXT_PRESERVE:
                bucket_key = (use_dst, re.IGNORECASE)
                regex_buckets.setdefault(bucket_key, []).append(
                    __class__.RegexRuleTask(
                        key=key,
                        pattern=pattern,
                        flags=re.IGNORECASE,
                    )
                )
                continue

            if rule.mode == __class__.RuleStatMode.GLOSSARY:
                bucket_key = (False, bool(rule.case_sensitive))
                literal_buckets.setdefault(bucket_key, []).append(
                    __class__.LiteralRuleTask(
                        key=key,
                        pattern=pattern,
                    )
                )
                continue

            if rule.regex:
                flags = 0 if bool(rule.case_sensitive) else re.IGNORECASE
                bucket_key = (use_dst, flags)
                regex_buckets.setdefault(bucket_key, []).append(
                    __class__.RegexRuleTask(
                        key=key,
                        pattern=pattern,
                        flags=flags,
                    )
                )
                continue

            if not bool(rule.case_sensitive):
                # TextProcessor 运行时使用 re.escape(pattern) + re.IGNORECASE，
                # 直接 casefold 统计会在 Unicode 场景（如 ß/SS）与实际替换结果不一致。
                flags = re.IGNORECASE
                bucket_key = (use_dst, flags)
                regex_buckets.setdefault(bucket_key, []).append(
                    __class__.RegexRuleTask(
                        key=key,
                        pattern=re.escape(pattern),
                        flags=flags,
                    )
                )
                continue

            bucket_key = (use_dst, bool(rule.case_sensitive))
            literal_buckets.setdefault(bucket_key, []).append(
                __class__.LiteralRuleTask(
                    key=key,
                    pattern=pattern,
                )
            )

        src_fold_snapshot: tuple[str, ...] = ()
        if (False, False) in literal_buckets:
            src_fold_snapshot = tuple(
                text.casefold() for text in GapTool.iter(src_snapshot)
            )

        for (use_dst, case_sensitive), bucket_rules in literal_buckets.items():
            if case_sensitive:
                texts = dst_snapshot if use_dst else src_snapshot
                normalized_rules = tuple(bucket_rules)
            else:
                texts = src_fold_snapshot
                normalized_rules = tuple(
                    __class__.LiteralRuleTask(
                        key=task.key,
                        pattern=task.pattern.casefold(),
                    )
                    for task in bucket_rules
                )

            counts = __class__.count_literal_bucket_hit_items(texts, normalized_rules)
            for key, matched_count in counts.items():
                results[key] = __class__.RuleStatResult(
                    matched_item_count=matched_count
                )

        for (use_dst, _flags), bucket_rules in regex_buckets.items():
            texts = dst_snapshot if use_dst else src_snapshot
            counts = __class__.count_regex_bucket_hit_items(texts, tuple(bucket_rules))
            for key, matched_count in counts.items():
                results[key] = __class__.RuleStatResult(
                    matched_item_count=matched_count
                )

        return results

    @staticmethod
    def normalize_rule_pattern(raw_pattern: str) -> str:
        return raw_pattern

    @staticmethod
    def count_literal_bucket_hit_items(
        texts: tuple[str, ...],
        rules: tuple["QualityRuleStatistics.LiteralRuleTask", ...],
    ) -> dict[str, int]:
        """统计同一字面量桶的命中条目数。"""

        if not texts or not rules:
            return {}

        pattern_to_index: dict[str, int] = {}
        patterns: list[str] = []
        key_to_pattern_index: dict[str, int] = {}
        for rule in rules:
            pattern = rule.pattern
            if pattern == "":
                key_to_pattern_index[rule.key] = -1
                continue
            pattern_index = pattern_to_index.get(pattern)
            if pattern_index is None:
                pattern_index = len(patterns)
                pattern_to_index[pattern] = pattern_index
                patterns.append(pattern)
            key_to_pattern_index[rule.key] = pattern_index

        if not patterns:
            return {key: 0 for key in key_to_pattern_index}

        nodes = __class__.build_aho_nodes(tuple(patterns))
        matched_counts = [0] * len(patterns)
        for text in GapTool.iter(texts):
            matched_indexes = __class__.find_aho_matched_pattern_indexes(text, nodes)
            for pattern_index in matched_indexes:
                matched_counts[pattern_index] += 1

        result: dict[str, int] = {}
        for key, pattern_index in key_to_pattern_index.items():
            if pattern_index < 0:
                result[key] = 0
                continue
            result[key] = matched_counts[pattern_index]
        return result

    @staticmethod
    def count_regex_bucket_hit_items(
        texts: tuple[str, ...],
        rules: tuple["QualityRuleStatistics.RegexRuleTask", ...],
    ) -> dict[str, int]:
        """统计同一正则桶的命中条目数。"""

        if not texts or not rules:
            return {}

        compiled_by_pattern: dict[str, re.Pattern[str] | None] = {}
        keys_by_pattern: dict[str, list[str]] = {}
        for rule in rules:
            pattern = rule.pattern
            keys_by_pattern.setdefault(pattern, []).append(rule.key)
            if pattern in compiled_by_pattern:
                continue
            try:
                compiled_by_pattern[pattern] = re.compile(pattern, flags=rule.flags)
            except re.error:
                compiled_by_pattern[pattern] = None

        matched_by_pattern: dict[str, int] = {}
        for pattern, compiled in compiled_by_pattern.items():
            if compiled is None:
                matched_by_pattern[pattern] = 0
                continue
            matched_count = 0
            for text in GapTool.iter(texts):
                if compiled.search(text) is not None:
                    matched_count += 1
            matched_by_pattern[pattern] = matched_count

        results: dict[str, int] = {}
        for pattern, keys in keys_by_pattern.items():
            matched_count = matched_by_pattern.get(pattern, 0)
            for key in keys:
                results[key] = matched_count
        return results

    @staticmethod
    def build_aho_nodes(
        patterns: tuple[str, ...],
    ) -> list["QualityRuleStatistics.AhoNode"]:
        nodes: list[QualityRuleStatistics.AhoNode] = [__class__.AhoNode()]
        for pattern_index, pattern in enumerate(patterns):
            cursor = 0
            for char in pattern:
                next_index = nodes[cursor].children.get(char)
                if next_index is None:
                    next_index = len(nodes)
                    nodes[cursor].children[char] = next_index
                    nodes.append(__class__.AhoNode())
                cursor = next_index
            nodes[cursor].output_indexes.append(pattern_index)

        queue: deque[int] = deque()
        for next_index in nodes[0].children.values():
            nodes[next_index].fail_index = 0
            queue.append(next_index)

        while queue:
            node_index = queue.popleft()
            node = nodes[node_index]
            for char, child_index in node.children.items():
                queue.append(child_index)
                fallback = node.fail_index
                while fallback != 0 and char not in nodes[fallback].children:
                    fallback = nodes[fallback].fail_index
                nodes[child_index].fail_index = nodes[fallback].children.get(char, 0)
                nodes[child_index].output_indexes.extend(
                    nodes[nodes[child_index].fail_index].output_indexes
                )

        return nodes

    @staticmethod
    def find_aho_matched_pattern_indexes(
        text: str,
        nodes: list["QualityRuleStatistics.AhoNode"],
    ) -> set[int]:
        state = 0
        matched_indexes: set[int] = set()
        for char in text:
            while state != 0 and char not in nodes[state].children:
                state = nodes[state].fail_index
            state = nodes[state].children.get(char, 0)
            outputs = nodes[state].output_indexes
            if not outputs:
                continue
            for pattern_index in outputs:
                matched_indexes.add(pattern_index)
        return matched_indexes
