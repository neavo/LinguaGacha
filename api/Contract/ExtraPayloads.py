from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from model.Api.ExtraModels import LaboratorySnapshot
from model.Api.ExtraModels import TsConversionOptionsSnapshot
from model.Api.ExtraModels import TsConversionTaskAccepted


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


@dataclass(frozen=True)
class TsConversionOptionsPayload:
    """把繁简转换默认选项包装成稳定响应，避免路由层继续散拼字典。"""

    options: TsConversionOptionsSnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层 options 结果转换成冻结快照对象。"""

        return cls(options=TsConversionOptionsSnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为客户端稳定消费的 options 结构。"""

        return {"options": self.options.to_dict()}


@dataclass(frozen=True)
class TsConversionTaskPayload:
    """把繁简转换任务受理结果包装成稳定响应，避免重复拼 task 字段。"""

    task: TsConversionTaskAccepted

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层任务受理结果转换成冻结对象。"""

        return cls(task=TsConversionTaskAccepted.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为客户端稳定消费的 task 结构。"""

        return {"task": self.task.to_dict()}
