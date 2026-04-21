from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProjectSnapshotPayload:
    """统一描述工程加载快照，避免把 DataManager 的内部状态直接外泄。"""

    path: str
    loaded: bool

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 响应载荷使用。"""

        return {
            "path": self.path,
            "loaded": self.loaded,
        }


@dataclass(frozen=True)
class ProjectPreviewPayload:
    """统一描述打开工程页使用的工程摘要载荷。"""

    path: str = ""
    name: str = ""
    source_language: str = ""
    target_language: str = ""
    file_count: int = 0
    created_at: str = ""
    updated_at: str = ""
    total_items: int = 0
    translated_items: int = 0
    progress: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProjectPreviewPayload":
        """把数据层返回的工程摘要字典规范化为响应载荷对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            path=str(normalized.get("path", "")),
            name=str(normalized.get("name", "")),
            source_language=str(normalized.get("source_language", "")),
            target_language=str(normalized.get("target_language", "")),
            file_count=int(normalized.get("file_count", 0) or 0),
            created_at=str(normalized.get("created_at", "")),
            updated_at=str(normalized.get("updated_at", "")),
            total_items=int(normalized.get("total_items", 0) or 0),
            translated_items=int(normalized.get("translated_items", 0) or 0),
            progress=float(normalized.get("progress", 0.0) or 0.0),
        )

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 响应载荷使用。"""

        return {
            "path": self.path,
            "name": self.name,
            "source_language": self.source_language,
            "target_language": self.target_language,
            "file_count": self.file_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "total_items": self.total_items,
            "translated_items": self.translated_items,
            "progress": self.progress,
        }
