from dataclasses import dataclass
from types import MappingProxyType
from typing import Any
from typing import Mapping


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
    """工程预览对象保留具名字段，并允许页面读取附加摘要信息。"""

    path: str = ""
    name: str = ""
    source_language: str = ""
    file_count: int = 0
    created_at: str = ""
    updated_at: str = ""
    progress: float = 0.0
    payload: Mapping[str, Any] = MappingProxyType({})

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProjectPreview":
        """把工程预览响应转换为冻结对象，同时保留原始摘要字段。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = dict(data)
        else:
            normalized = {}

        return cls(
            path=str(normalized.get("path", "")),
            name=str(normalized.get("name", "")),
            source_language=str(normalized.get("source_language", "")),
            file_count=int(normalized.get("file_count", 0) or 0),
            created_at=str(normalized.get("created_at", "")),
            updated_at=str(normalized.get("updated_at", "")),
            progress=float(normalized.get("progress", 0.0) or 0.0),
            payload=MappingProxyType(normalized),
        )

    def to_dict(self) -> dict[str, Any]:
        """把预览对象恢复为字典，便于现有 UI 渐进迁移。"""

        return dict(self.payload)
