from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WorkbenchFileEntryDto:
    """工作台文件行 DTO，避免直接外泄内部冻结快照对象。"""

    rel_path: str
    item_count: int
    file_type: str

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 与客户端共用。"""

        return {
            "rel_path": self.rel_path,
            "item_count": self.item_count,
            "file_type": self.file_type,
        }


@dataclass(frozen=True)
class WorkbenchSnapshotDto:
    """工作台整体快照 DTO。"""

    file_count: int
    total_items: int
    translated: int
    translated_in_past: int
    untranslated: int
    file_op_running: bool
    entries: tuple[WorkbenchFileEntryDto, ...]

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 与客户端共用。"""

        return {
            "file_count": self.file_count,
            "total_items": self.total_items,
            "translated": self.translated,
            "translated_in_past": self.translated_in_past,
            "untranslated": self.untranslated,
            "file_op_running": self.file_op_running,
            "entries": [entry.to_dict() for entry in self.entries],
        }
