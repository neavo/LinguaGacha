from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WorkbenchFileEntryPayload:
    """工作台文件行载荷，避免直接外泄内部冻结快照对象。"""

    rel_path: str
    item_count: int
    file_type: str

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 响应载荷使用。"""

        return {
            "rel_path": self.rel_path,
            "item_count": self.item_count,
            "file_type": self.file_type,
        }


@dataclass(frozen=True)
class WorkbenchSnapshotPayload:
    """工作台整体快照载荷。"""

    file_count: int
    total_items: int
    translated: int
    translated_in_past: int
    error_count: int
    untranslated: int
    file_op_running: bool
    entries: tuple[WorkbenchFileEntryPayload, ...]

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 响应载荷使用。"""

        return {
            "file_count": self.file_count,
            "total_items": self.total_items,
            "translated": self.translated,
            "translated_in_past": self.translated_in_past,
            "error_count": self.error_count,
            "untranslated": self.untranslated,
            "file_op_running": self.file_op_running,
            "entries": [entry.to_dict() for entry in self.entries],
        }
