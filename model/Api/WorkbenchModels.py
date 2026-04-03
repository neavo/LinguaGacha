from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WorkbenchFileEntry:
    """工作台文件条目冻结后可安全在页面和线程间传递。"""

    rel_path: str = ""
    item_count: int = 0
    file_type: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "WorkbenchFileEntry":
        """把工作台文件条目统一归一化为稳定字段。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            rel_path=str(normalized.get("rel_path", "")),
            item_count=int(normalized.get("item_count", 0) or 0),
            file_type=str(normalized.get("file_type", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        """把文件条目转换回 JSON 结构，便于边界层复用。"""

        return {
            "rel_path": self.rel_path,
            "item_count": self.item_count,
            "file_type": self.file_type,
        }


@dataclass(frozen=True)
class WorkbenchSnapshot:
    """工作台快照收口统计字段和文件条目列表。"""

    file_count: int = 0
    total_items: int = 0
    translated: int = 0
    translated_in_past: int = 0
    untranslated: int = 0
    file_op_running: bool = False
    entries: tuple[WorkbenchFileEntry, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "WorkbenchSnapshot":
        """把工作台快照统一转换为不可变对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        entries_raw = normalized.get("entries", [])
        entries: tuple[WorkbenchFileEntry, ...] = ()
        if isinstance(entries_raw, list):
            entries = tuple(
                WorkbenchFileEntry.from_dict(entry)
                for entry in entries_raw
                if isinstance(entry, dict)
            )

        return cls(
            file_count=int(normalized.get("file_count", 0) or 0),
            total_items=int(normalized.get("total_items", 0) or 0),
            translated=int(normalized.get("translated", 0) or 0),
            translated_in_past=int(normalized.get("translated_in_past", 0) or 0),
            untranslated=int(normalized.get("untranslated", 0) or 0),
            file_op_running=bool(normalized.get("file_op_running", False)),
            entries=entries,
        )

    def to_dict(self) -> dict[str, Any]:
        """把工作台快照回写为 JSON 字典。"""

        return {
            "file_count": self.file_count,
            "total_items": self.total_items,
            "translated": self.translated,
            "translated_in_past": self.translated_in_past,
            "untranslated": self.untranslated,
            "file_op_running": self.file_op_running,
            "entries": [entry.to_dict() for entry in self.entries],
        }
