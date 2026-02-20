from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class QualityRuleMerger:
    """质量规则合并器（纯逻辑）。

    目标：统一不同入口的“重复判定 key”，并在写回前保证不变式：
    - 同 key 最终只保留 1 个有效条目
    - 空 src 永不落库
    - 顺序稳定：不主动排序，保留第一次出现的位置
    """

    class MergeMode(StrEnum):
        """合并模式。

        同一份规则会从 UI 手动保存/导入、以及翻译过程的自动术语表写回进入系统。
        显式入口应该以用户操作为准（OVERWRITE），隐式入口只能做安全补全（FILL_EMPTY）。
        """

        OVERWRITE = "OVERWRITE"  # 来者覆盖：用于手动保存/导入
        FILL_EMPTY = "FILL_EMPTY"  # 只补空：用于自动术语表写回

    class RuleType(StrEnum):
        """质量规则类型（值与数据库 RuleType 保持一致）。

        为什么要单独定义：合并器需要纯逻辑、可单测、可跨模块复用，避免直接依赖数据层实现细节。
        """

        GLOSSARY = "GLOSSARY"
        PRE_REPLACEMENT = "PRE_REPLACEMENT"
        POST_REPLACEMENT = "POST_REPLACEMENT"
        TEXT_PRESERVE = "TEXT_PRESERVE"

    @dataclass(frozen=True)
    class Conflict:
        """记录同一 key 下的字段冲突。

        为什么要记录：上层不一定展示细分原因，但测试与日志需要能断言/诊断“为什么发生了合并”。
        """

        rule_type: "QualityRuleMerger.RuleType"
        key: str
        field: str
        existing: str | bool
        incoming: str | bool

    @dataclass(frozen=True)
    class Report:
        """合并报告（用于 toast 决策与单测断言）。"""

        added: int
        updated: int
        filled: int
        deduped: int
        skipped_empty_src: int
        conflicts: tuple["QualityRuleMerger.Conflict", ...]

    @dataclass(frozen=True)
    class Item:
        entry: dict[str, Any]
        src_norm: str
        src_fold: str
        case_sensitive: bool
        order: int
        is_existing: bool

    @staticmethod
    def normalize_src(src: Any) -> str:
        if not isinstance(src, str):
            return ""
        return src.strip()

    @staticmethod
    def fold_src(src_norm: str) -> str:
        return src_norm.casefold()

    @staticmethod
    def normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
        """标准化字段，保证合并逻辑不被输入形态影响。

        约束：保持历史 JSON/XLSX 兼容，字段名不做强约束；但合并涉及的核心字段需要补默认值。
        """

        normalized = dict(entry)
        normalized["src"] = __class__.normalize_src(entry.get("src"))
        normalized["dst"] = str(entry.get("dst", "") or "").strip()
        normalized["info"] = str(entry.get("info", "") or "").strip()
        normalized["regex"] = bool(entry.get("regex", False))
        normalized["case_sensitive"] = bool(entry.get("case_sensitive", False))
        return normalized

    @staticmethod
    def merge(
        *,
        rule_type: "QualityRuleMerger.RuleType",
        existing: list[dict[str, Any]],
        incoming: list[dict[str, Any]],
        merge_mode: "QualityRuleMerger.MergeMode | None" = None,
    ) -> tuple[list[dict[str, Any]], "QualityRuleMerger.Report"]:
        """合并 existing 与 incoming，返回 (merged, report)。"""

        if merge_mode is None:
            merge_mode = __class__.MergeMode.OVERWRITE

        skipped_empty = 0

        def ingest(
            rows: list[dict[str, Any]], *, order_offset: int, is_existing: bool
        ) -> list["QualityRuleMerger.Item"]:
            nonlocal skipped_empty
            items: list[QualityRuleMerger.Item] = []

            for i, raw in enumerate(rows):
                if not isinstance(raw, dict):
                    continue

                normalized = __class__.normalize_entry(raw)
                src_norm = str(normalized.get("src", ""))
                if not src_norm:
                    skipped_empty += 1
                    continue

                items.append(
                    __class__.Item(
                        entry=normalized,
                        src_norm=src_norm,
                        src_fold=__class__.fold_src(src_norm),
                        case_sensitive=bool(normalized.get("case_sensitive", False)),
                        order=order_offset + i,
                        is_existing=is_existing,
                    )
                )

            return items

        # order_offset 必须基于原始列表长度：避免 existing 中存在空 src 被跳过时，
        # incoming 的 order 与 existing 的尾部条目产生重叠，破坏“顺序稳定”约束。
        existing_items = ingest(existing, order_offset=0, is_existing=True)
        incoming_items = ingest(incoming, order_offset=len(existing), is_existing=False)
        all_items = existing_items + incoming_items

        # 按 src_fold 分组，先整体判定该组是否需要收敛为 1 条。
        groups: dict[str, list[QualityRuleMerger.Item]] = {}
        for item in all_items:
            groups.setdefault(item.src_fold, []).append(item)

        # 计算“原始 existing 的 key 集合”，用于 added 统计。
        existing_keys: set[object] = set()
        for src_fold, items in groups.items():
            # key 策略只与规则类型及 case_sensitive 语义有关，regex 不参与判重。
            fold_only = rule_type == __class__.RuleType.TEXT_PRESERVE or any(
                not it.case_sensitive for it in items
            )
            if fold_only:
                if any(it.is_existing for it in items):
                    existing_keys.add(src_fold)
                continue

            for it in items:
                if it.is_existing:
                    existing_keys.add((src_fold, it.src_norm))

        added = 0
        updated = 0
        filled = 0
        deduped = 0
        conflicts: list[QualityRuleMerger.Conflict] = []

        @dataclass(frozen=True)
        class _Kept:
            order: int
            key: object
            entry: dict[str, Any]

        kept: list[_Kept] = []

        def record_conflict(
            *,
            key: str,
            field: str,
            existing_value: str | bool,
            incoming_value: str | bool,
        ) -> None:
            conflicts.append(
                __class__.Conflict(
                    rule_type=rule_type,
                    key=key,
                    field=field,
                    existing=existing_value,
                    incoming=incoming_value,
                )
            )

        def merge_into_base(
            *, base: dict[str, Any], other: dict[str, Any], key: str
        ) -> tuple[bool, bool]:
            """将 other 合并进 base。

            返回 (是否发生 overwrite 更新, 是否发生 fill-empty 填充)。
            """

            def get_text(d: dict[str, Any], field: str) -> str:
                return str(d.get(field, "") or "").strip()

            def get_flag(d: dict[str, Any], field: str) -> bool:
                return bool(d.get(field, False))

            overwrite_changed = False
            filled_changed = False

            if merge_mode == __class__.MergeMode.OVERWRITE:
                # OVERWRITE：incoming 覆盖 existing（包括覆盖为空）。
                other_src = __class__.normalize_src(other.get("src"))
                if other_src and base.get("src") != other_src:
                    base["src"] = other_src
                    overwrite_changed = True

                if rule_type == __class__.RuleType.TEXT_PRESERVE:
                    fields = ("info",)
                elif rule_type == __class__.RuleType.GLOSSARY:
                    fields = ("dst", "info", "case_sensitive")
                else:
                    # PRE/POST
                    fields = ("dst", "regex", "case_sensitive")

                for field in fields:
                    if field in ("dst", "info"):
                        before = get_text(base, field)
                        after = get_text(other, field)
                        if before and after and before != after:
                            record_conflict(
                                key=key,
                                field=field,
                                existing_value=before,
                                incoming_value=after,
                            )
                        if before != after:
                            base[field] = after
                            overwrite_changed = True
                        continue

                    # bool fields
                    before_flag = get_flag(base, field)
                    after_flag = get_flag(other, field)
                    if before_flag != after_flag:
                        record_conflict(
                            key=key,
                            field=field,
                            existing_value=before_flag,
                            incoming_value=after_flag,
                        )
                        base[field] = after_flag
                        overwrite_changed = True

                return overwrite_changed, False

            # FILL_EMPTY：只补空，不覆盖非空字段；且不改变 case_sensitive（同时避免改动 regex）。
            if rule_type == __class__.RuleType.TEXT_PRESERVE:
                fill_fields = ("info",)
                protected_flags: tuple[str, ...] = ()
            elif rule_type == __class__.RuleType.GLOSSARY:
                fill_fields = ("dst", "info")
                protected_flags = ("case_sensitive",)
            else:
                fill_fields = ("dst",)
                protected_flags = ("regex", "case_sensitive")

            for field in fill_fields:
                before = get_text(base, field)
                after = get_text(other, field)
                if before and after and before != after:
                    record_conflict(
                        key=key,
                        field=field,
                        existing_value=before,
                        incoming_value=after,
                    )
                if not before and after:
                    base[field] = after
                    filled_changed = True

            for field in protected_flags:
                before_flag = get_flag(base, field)
                after_flag = get_flag(other, field)
                if before_flag != after_flag:
                    record_conflict(
                        key=key,
                        field=field,
                        existing_value=before_flag,
                        incoming_value=after_flag,
                    )

            return False, filled_changed

        for src_fold, items in groups.items():
            # 保证顺序稳定：按“第一次出现”的位置作为锚点。
            items_sorted = sorted(items, key=lambda it: it.order)
            fold_only = rule_type == __class__.RuleType.TEXT_PRESERVE or any(
                not it.case_sensitive for it in items_sorted
            )

            if fold_only:
                base = dict(items_sorted[0].entry)
                key_str = src_fold
                for other in items_sorted[1:]:
                    deduped += 1
                    overwrite_changed, filled_changed = merge_into_base(
                        base=base, other=other.entry, key=key_str
                    )
                    if overwrite_changed:
                        updated += 1
                    if filled_changed:
                        filled += 1

                kept.append(
                    _Kept(order=items_sorted[0].order, key=src_fold, entry=base)
                )
                continue

            # 全组 case_sensitive=true：允许同 fold 下不同 src_norm 并存，但同 src_norm 仍需合并。
            by_norm: dict[str, list[QualityRuleMerger.Item]] = {}
            for it in items_sorted:
                by_norm.setdefault(it.src_norm, []).append(it)

            for src_norm, norm_items in by_norm.items():
                base = dict(norm_items[0].entry)
                key_obj = (src_fold, src_norm)
                key_str = f"{src_fold}::{src_norm}"
                for other in norm_items[1:]:
                    deduped += 1
                    overwrite_changed, filled_changed = merge_into_base(
                        base=base, other=other.entry, key=key_str
                    )
                    if overwrite_changed:
                        updated += 1
                    if filled_changed:
                        filled += 1
                kept.append(_Kept(order=norm_items[0].order, key=key_obj, entry=base))

        kept_sorted = sorted(kept, key=lambda k: k.order)
        merged = [k.entry for k in kept_sorted]

        for k in kept_sorted:
            if k.key not in existing_keys:
                added += 1

        report = __class__.Report(
            added=added,
            updated=updated,
            filled=filled,
            deduped=deduped,
            skipped_empty_src=skipped_empty,
            conflicts=tuple(conflicts),
        )
        return merged, report
