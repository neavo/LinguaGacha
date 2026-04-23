from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from api.Models.Model import ModelPageSnapshot


@dataclass(frozen=True)
class ModelPageSnapshotPayload:
    """把模型页快照包装成稳定响应，避免路由层重复拼字典。"""

    active_model_id: str
    models: list[dict[str, Any]]

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层字典结果归一化为稳定 payload 对象。"""

        snapshot = ModelPageSnapshot.from_dict(data)
        return cls.from_snapshot(snapshot)

    @classmethod
    def from_snapshot(cls, snapshot: ModelPageSnapshot) -> Self:
        """直接复用冻结快照，保证响应字段来源单一。"""

        return cls(
            active_model_id=snapshot.active_model_id,
            models=[model.to_dict() for model in snapshot.models],
        )

    def to_dict(self) -> dict[str, object]:
        """转换为 HTTP 层可直接返回的 JSON 结构。"""

        return {
            "active_model_id": self.active_model_id,
            "models": [dict(model) for model in self.models],
        }
