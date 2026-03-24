from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProjectDto:
    """统一描述工程快照，避免把 DataManager 的内部状态直接外泄。"""

    path: str
    loaded: bool

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 与客户端共用。"""

        return {
            "path": self.path,
            "loaded": self.loaded,
        }
