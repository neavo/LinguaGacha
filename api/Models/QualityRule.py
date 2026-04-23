from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


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
class QualityRuleSnapshot:
    """质量规则快照把规则类型、版本与条目一并冻结，避免跨层漂移。"""

    rule_type: str = ""
    revision: int = 0
    meta: dict[str, Any] = field(default_factory=dict)
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
            entries=entries,
        )

    def to_dict(self) -> dict[str, Any]:
        """把快照转换回显式字段字典，避免泄漏未建模状态。"""

        return {
            "rule_type": self.rule_type,
            "revision": self.revision,
            "meta": dict(self.meta),
            "entries": [entry.to_dict() for entry in self.entries],
        }
