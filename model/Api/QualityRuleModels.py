from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


@dataclass(frozen=True)
class QualityRuleEntry:
    """质量规则条目冻结后再传给前端，避免编辑态继续污染原始字典。"""

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
            src=str(normalized.get("src", "")),
            dst=str(normalized.get("dst", "")),
            info=str(normalized.get("info", "")),
            regex=bool(normalized.get("regex", False)),
            case_sensitive=bool(normalized.get("case_sensitive", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结条目转回 JSON 字典，供边界层复用。"""

        return {
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

    @classmethod
    def from_dict(cls, data: int | dict[str, Any] | None) -> Self:
        """把统计结果统一归一化成命中数对象。"""

        if isinstance(data, dict):
            value = data.get("matched_item_count", 0)
            return cls(matched_item_count=int(value or 0))

        if hasattr(data, "matched_item_count"):
            value = getattr(data, "matched_item_count", 0)
            return cls(matched_item_count=int(value or 0))

        if data is None:
            return cls()
        return cls(matched_item_count=int(data))

    def to_dict(self) -> dict[str, int]:
        """把统计结果转回边界层 JSON 结构。"""

        return {"matched_item_count": self.matched_item_count}


@dataclass(frozen=True)
class QualityRuleSnapshot:
    """质量规则快照把规则类型、版本与条目一并冻结，避免跨层漂移。"""

    rule_type: str = ""
    revision: int = 0
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
            entries=entries,
        )

    def to_dict(self) -> dict[str, Any]:
        """把快照转换回显式字段字典，避免泄漏未建模状态。"""

        return {
            "rule_type": self.rule_type,
            "revision": self.revision,
            "entries": [entry.to_dict() for entry in self.entries],
        }


@dataclass(frozen=True)
class QualityRuleStatisticsSnapshot:
    """质量规则统计快照把结果和包含关系一起冻结，供页面一次性消费。"""

    results: dict[str, QualityRuleStatisticsResult] = field(default_factory=dict)
    subset_parents: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把统计响应归一化成对象，避免前端继续处理嵌套字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        results_raw = normalized.get("results", {})
        results: dict[str, QualityRuleStatisticsResult] = {}
        if isinstance(results_raw, dict):
            for key, value in results_raw.items():
                results[str(key)] = QualityRuleStatisticsResult.from_dict(value)

        subset_parents_raw = normalized.get("subset_parents", {})
        subset_parents: dict[str, tuple[str, ...]] = {}
        if isinstance(subset_parents_raw, dict):
            for key, value in subset_parents_raw.items():
                if isinstance(value, (list, tuple)):
                    subset_parents[str(key)] = tuple(str(item) for item in value)
                else:
                    subset_parents[str(key)] = ()

        return cls(results=results, subset_parents=subset_parents)

    def to_dict(self) -> dict[str, Any]:
        """把统计快照转换回 JSON 字典，保持边界层输入稳定。"""

        return {
            "results": {key: value.to_dict() for key, value in self.results.items()},
            "subset_parents": {
                key: list(value) for key, value in self.subset_parents.items()
            },
        }
