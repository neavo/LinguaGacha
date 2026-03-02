from __future__ import annotations

import dataclasses
import re
from collections import deque
from enum import StrEnum

from module.Utils.GapTool import GapTool


class RuleStatMode(StrEnum):
    """规则统计模式。

    用枚举而不是字符串常量，避免页面层传参时出现魔术值拼写错误。
    """

    GLOSSARY = "glossary"
    PRE_REPLACEMENT = "pre_replacement"
    POST_REPLACEMENT = "post_replacement"
    TEXT_PRESERVE = "text_preserve"


@dataclasses.dataclass(frozen=True)
class RuleStatInput:
    """单条规则统计输入。

    key 用于回填到页面行；pattern/mode/regex/case_sensitive 仅描述匹配语义。
    """

    key: str
    pattern: str
    mode: RuleStatMode
    regex: bool = False
    case_sensitive: bool = False


@dataclasses.dataclass(frozen=True)
class RuleStatResult:
    """单条规则统计结果。

    matched_item_count 是“命中条目数”。
    """

    matched_item_count: int


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


def count_rule_occurrences(
    rules: list[RuleStatInput] | tuple[RuleStatInput, ...],
    src_texts: list[str] | tuple[str, ...],
    dst_texts: list[str] | tuple[str, ...],
) -> dict[str, RuleStatResult]:
    """统计每条规则的命中条目数。

    约定：
    - 命中条目数：同一条文本内命中多次仅记 1
    - 术语：按字符串包含匹配
    - 译前/译后替换：regex/case_sensitive 语义与 TextProcessor 对齐
    - 文本保护：始终按 ignore-case 正则匹配
    """

    src_snapshot = tuple(src_texts)
    dst_snapshot = tuple(dst_texts)
    results: dict[str, RuleStatResult] = {}
    literal_buckets: dict[tuple[bool, bool], list[LiteralRuleTask]] = {}
    regex_buckets: dict[tuple[bool, int], list[RegexRuleTask]] = {}

    # 第一步：按“文本来源 + 匹配模式”分桶，避免每条规则都全量扫一遍文本。
    for rule in GapTool.iter(rules):
        key = str(rule.key)
        pattern = normalize_rule_pattern(rule.pattern)
        if pattern == "":
            results[key] = RuleStatResult(matched_item_count=0)
            continue

        use_dst = rule.mode == RuleStatMode.POST_REPLACEMENT
        if rule.mode == RuleStatMode.TEXT_PRESERVE:
            bucket_key = (use_dst, re.IGNORECASE)
            regex_buckets.setdefault(bucket_key, []).append(
                RegexRuleTask(
                    key=key,
                    pattern=pattern,
                    flags=re.IGNORECASE,
                )
            )
            continue

        if rule.mode == RuleStatMode.GLOSSARY:
            # 术语规则固定统计源文，不随 use_dst 变化。
            bucket_key = (False, bool(rule.case_sensitive))
            literal_buckets.setdefault(bucket_key, []).append(
                LiteralRuleTask(
                    key=key,
                    pattern=pattern,
                )
            )
            continue

        if rule.regex:
            flags = 0 if bool(rule.case_sensitive) else re.IGNORECASE
            bucket_key = (use_dst, flags)
            regex_buckets.setdefault(bucket_key, []).append(
                RegexRuleTask(
                    key=key,
                    pattern=pattern,
                    flags=flags,
                )
            )
            continue

        if not bool(rule.case_sensitive):
            # 为什么把“非正则 + 忽略大小写”转为正则桶：
            # TextProcessor 运行时使用 re.escape(pattern) + re.IGNORECASE，
            # 直接 casefold 统计会在 Unicode 场景（如 ß/SS）与实际替换结果不一致。
            flags = re.IGNORECASE
            bucket_key = (use_dst, flags)
            regex_buckets.setdefault(bucket_key, []).append(
                RegexRuleTask(
                    key=key,
                    pattern=re.escape(pattern),
                    flags=flags,
                )
            )
            continue

        bucket_key = (use_dst, bool(rule.case_sensitive))
        literal_buckets.setdefault(bucket_key, []).append(
            LiteralRuleTask(
                key=key,
                pattern=pattern,
            )
        )

    src_fold_snapshot: tuple[str, ...] = ()
    if (False, False) in literal_buckets:
        # 字面量忽略大小写目前只来自术语桶，提前构建一次 src 的 casefold 快照。
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
                LiteralRuleTask(
                    key=task.key,
                    pattern=task.pattern.casefold(),
                )
                for task in bucket_rules
            )

        counts = count_literal_bucket_hit_items(texts, normalized_rules)
        for key, matched_count in counts.items():
            results[key] = RuleStatResult(matched_item_count=matched_count)

    for (use_dst, _flags), bucket_rules in regex_buckets.items():
        texts = dst_snapshot if use_dst else src_snapshot
        counts = count_regex_bucket_hit_items(texts, tuple(bucket_rules))
        for key, matched_count in counts.items():
            results[key] = RuleStatResult(matched_item_count=matched_count)

    return results


def normalize_rule_pattern(raw_pattern: str) -> str:
    return raw_pattern


def count_literal_bucket_hit_items(
    texts: tuple[str, ...],
    rules: tuple[LiteralRuleTask, ...],
) -> dict[str, int]:
    """统计同一字面量桶的命中条目数。

    为什么使用 Aho-Corasick：
    - 旧实现是“每条规则扫一遍全量文本”，复杂度接近 O(R * T)。
    - 新实现把同桶规则构建成自动机，每条文本只扫描一次，显著降低大样本耗时。
    """

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

    nodes = build_aho_nodes(tuple(patterns))
    matched_counts = [0] * len(patterns)
    for text in GapTool.iter(texts):
        matched_indexes = find_aho_matched_pattern_indexes(text, nodes)
        for pattern_index in matched_indexes:
            matched_counts[pattern_index] += 1

    result: dict[str, int] = {}
    for key, pattern_index in key_to_pattern_index.items():
        if pattern_index < 0:
            result[key] = 0
            continue
        result[key] = matched_counts[pattern_index]
    return result


def count_regex_bucket_hit_items(
    texts: tuple[str, ...],
    rules: tuple[RegexRuleTask, ...],
) -> dict[str, int]:
    """统计同一正则桶的命中条目数。

    说明：
    - 正则规则在保存时已校验，本阶段不再收集错误文本。
    - 为兼容历史脏数据，编译失败按 0 命中处理，保持统计流程不中断。
    """

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


def build_aho_nodes(patterns: tuple[str, ...]) -> list[AhoNode]:
    nodes: list[AhoNode] = [AhoNode()]
    for pattern_index, pattern in enumerate(patterns):
        cursor = 0
        for char in pattern:
            next_index = nodes[cursor].children.get(char)
            if next_index is None:
                next_index = len(nodes)
                nodes[cursor].children[char] = next_index
                nodes.append(AhoNode())
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


def find_aho_matched_pattern_indexes(text: str, nodes: list[AhoNode]) -> set[int]:
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
