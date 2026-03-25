from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


@dataclass(frozen=True)
class ProofreadingLookupQuery:
    """校对页反查请求在质量规则边界内冻结，避免页面继续传递可变字典。"""

    keyword: str = ""
    is_regex: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把反查条件统一成稳定对象，避免前端分支解析。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            keyword=str(normalized.get("keyword", "")),
            is_regex=bool(normalized.get("is_regex", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把反查请求转回 JSON 字典，供边界层复用。"""

        return {
            "keyword": self.keyword,
            "is_regex": self.is_regex,
        }


@dataclass(frozen=True)
class QualityRuleEntry:
    """质量规则条目冻结后再传给前端，避免编辑态继续污染原始字典。"""

    entry_id: str = ""
    src: str = ""
    dst: str = ""
    info: str = ""
    regex: bool = False
    case_sensitive: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务端条目收敛成固定字段，避免前端继续猜字典结构。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            entry_id=str(normalized.get("entry_id", "")),
            src=str(normalized.get("src", "")),
            dst=str(normalized.get("dst", "")),
            info=str(normalized.get("info", "")),
            regex=bool(normalized.get("regex", False)),
            case_sensitive=bool(normalized.get("case_sensitive", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结条目转回 JSON 字典，供边界层复用。"""

        return {
            "entry_id": self.entry_id,
            "src": self.src,
            "dst": self.dst,
            "info": self.info,
            "regex": self.regex,
            "case_sensitive": self.case_sensitive,
        }


@dataclass(frozen=True)
class QualityRuleStatisticsResult:
    """质量规则统计结果冻结后传递，避免前端再拆字段。"""

    matched_item_count: int = 0
    subset_parents: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: int | dict[str, Any] | None) -> Self:
        """把统计结果统一归一化成命中数对象。"""

        if isinstance(data, dict):
            value = data.get("matched_item_count", 0)
            subset_parents_raw = data.get("subset_parents", [])
            subset_parents: tuple[str, ...] = ()
            if isinstance(subset_parents_raw, (list, tuple, set)):
                subset_parents = tuple(str(item) for item in subset_parents_raw)
            return cls(
                matched_item_count=int(value or 0),
                subset_parents=subset_parents,
            )

        if hasattr(data, "matched_item_count"):
            value = getattr(data, "matched_item_count", 0)
            subset_parents_raw = getattr(data, "subset_parents", ())
            subset_parents: tuple[str, ...] = ()
            if isinstance(subset_parents_raw, (list, tuple, set)):
                subset_parents = tuple(str(item) for item in subset_parents_raw)
            return cls(
                matched_item_count=int(value or 0),
                subset_parents=subset_parents,
            )

        if data is None:
            return cls()
        return cls(matched_item_count=int(data))

    def to_dict(self) -> dict[str, Any]:
        """把统计结果转回边界层 JSON 结构。"""

        return {
            "matched_item_count": self.matched_item_count,
            "subset_parents": list(self.subset_parents),
        }


@dataclass(frozen=True)
class QualityRuleSnapshot:
    """质量规则快照把规则类型、版本与条目一并冻结，避免跨层漂移。"""

    rule_type: str = ""
    revision: int = 0
    meta: dict[str, Any] = field(default_factory=dict)
    statistics: "QualityRuleStatisticsSnapshot" = field(
        default_factory=lambda: QualityRuleStatisticsSnapshot()
    )
    entries: tuple[QualityRuleEntry, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把质量规则响应统一转成不可变快照。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        entries_raw = normalized.get("entries", [])
        entries: tuple[QualityRuleEntry, ...] = ()
        if isinstance(entries_raw, (list, tuple)):
            normalized_entries: list[QualityRuleEntry] = []
            for entry in entries_raw:
                if isinstance(entry, QualityRuleEntry):
                    normalized_entries.append(entry)
                elif isinstance(entry, dict):
                    normalized_entries.append(QualityRuleEntry.from_dict(entry))
            entries = tuple(normalized_entries)

        return cls(
            rule_type=str(normalized.get("rule_type", "")),
            revision=int(normalized.get("revision", 0) or 0),
            meta=dict(normalized.get("meta", {}))
            if isinstance(normalized.get("meta", {}), dict)
            else {},
            statistics=(
                normalized["statistics"]
                if isinstance(
                    normalized.get("statistics"), QualityRuleStatisticsSnapshot
                )
                else QualityRuleStatisticsSnapshot.from_dict(
                    normalized.get("statistics", {})
                )
            ),
            entries=entries,
        )

    def to_dict(self) -> dict[str, Any]:
        """把快照转换回显式字段字典，避免泄漏未建模状态。"""

        return {
            "rule_type": self.rule_type,
            "revision": self.revision,
            "meta": dict(self.meta),
            "statistics": self.statistics.to_dict(),
            "entries": [entry.to_dict() for entry in self.entries],
        }


@dataclass(frozen=True)
class QualityRuleStatisticsSnapshot:
    """质量规则统计快照把结果和子父项关系一起冻结，供页面一次性消费。"""

    available: bool = False
    results: dict[str, QualityRuleStatisticsResult] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把统计响应归一化成对象，避免前端继续处理嵌套字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        available = bool(normalized.get("available", False))

        results_raw = normalized.get("results", {})
        results: dict[str, QualityRuleStatisticsResult] = {}
        subset_parents_raw = normalized.get("subset_parents", {})
        subset_parents: dict[str, tuple[str, ...]] = {}
        if isinstance(subset_parents_raw, dict):
            for key, value in subset_parents_raw.items():
                if isinstance(value, (list, tuple, set)):
                    subset_parents[str(key)] = tuple(str(item) for item in value)
                else:
                    subset_parents[str(key)] = ()
        if isinstance(results_raw, dict):
            for key, value in results_raw.items():
                if isinstance(value, dict):
                    result_payload = dict(value)
                else:
                    result_payload = {"matched_item_count": value}

                result_key = str(key)
                if "subset_parents" not in result_payload:
                    if result_key in subset_parents:
                        result_payload["subset_parents"] = list(
                            subset_parents[result_key]
                        )

                results[result_key] = QualityRuleStatisticsResult.from_dict(
                    result_payload
                )

        return cls(
            available=available,
            results=results,
        )

    def to_dict(self) -> dict[str, Any]:
        """把统计快照转换回 JSON 字典，保持边界层输入稳定。"""

        return {
            "available": self.available,
            "results": {key: value.to_dict() for key, value in self.results.items()},
        }
