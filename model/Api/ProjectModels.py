from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProjectSnapshot:
    """工程快照在客户端内冻结，避免页面再推断加载态默认值。"""

    path: str = ""
    loaded: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProjectSnapshot":
        """把工程响应统一转换为稳定的快照对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            path=str(normalized.get("path", "")),
            loaded=bool(normalized.get("loaded", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把工程快照转换回 JSON 字典，供 HTTP 边界复用。"""

        return {
            "path": self.path,
            "loaded": self.loaded,
        }


@dataclass(frozen=True)
class ProjectPreview:
    """工程预览对象显式建模摘要字段，避免页面退回字典式读取。"""

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
    has_progress: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProjectPreview":
        """把工程预览响应转换为冻结对象，统一页面消费入口。"""

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
            has_progress="progress" in normalized,
        )

    def to_dict(self) -> dict[str, Any]:
        """把预览对象转换回显式摘要字典，避免泄漏未建模字段。"""

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
