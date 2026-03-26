from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from model.Api.ExtraModels import LaboratorySnapshot


@dataclass(frozen=True)
class LaboratorySnapshotPayload:
    """把实验室页快照统一包装成稳定响应，避免路由层重复拼字典。"""

    snapshot: LaboratorySnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层字典结果归一化成冻结快照对象。"""

        return cls(snapshot=LaboratorySnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为路由层可直接返回的 JSON 结构。"""

        return {"snapshot": self.snapshot.to_dict()}
