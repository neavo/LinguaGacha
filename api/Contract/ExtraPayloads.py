from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from model.Api.ExtraModels import NameFieldSnapshot
from model.Api.ExtraModels import NameFieldTranslateResult
from model.Api.ExtraModels import TsConversionOptionsSnapshot
from model.Api.ExtraModels import TsConversionTaskAccepted


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


@dataclass(frozen=True)
class NameFieldSnapshotPayload:
    """把姓名字段快照包装成稳定响应，避免路由层继续散拼 snapshot。"""

    snapshot: NameFieldSnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层姓名快照结果转换成冻结对象。"""

        return cls(snapshot=NameFieldSnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为客户端稳定消费的姓名快照结构。"""

        return {"snapshot": self.snapshot.to_dict()}


@dataclass(frozen=True)
class NameFieldTranslateResultPayload:
    """把姓名翻译结果包装成稳定响应，避免重复拼统计字段。"""

    result: NameFieldTranslateResult

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务层翻译结果转换成冻结对象。"""

        return cls(result=NameFieldTranslateResult.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为客户端稳定消费的翻译结果结构。"""

        return {"result": self.result.to_dict()}
