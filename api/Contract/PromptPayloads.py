from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PromptSnapshotPayload:
    """提示词响应载荷占位类型，供后续 prompt API 复用。"""

    payload: dict[str, Any]

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "PromptSnapshotPayload":
        """把原始字典转成稳定载荷对象。"""

        if isinstance(data, dict):
            payload = dict(data)
        else:
            payload = {}
        return cls(payload=payload)

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 响应结构。"""

        return dict(self.payload)
