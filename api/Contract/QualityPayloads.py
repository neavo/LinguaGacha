from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from api.Models.QualityRule import ProofreadingLookupQuery
from api.Models.QualityRule import QualityRuleSnapshot


@dataclass(frozen=True)
class QualityRuleSnapshotPayload:
    """质量规则快照响应载荷。"""

    snapshot: QualityRuleSnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "QualityRuleSnapshotPayload":
        """把核心服务字典结果收口成稳定响应对象。"""

        return cls(snapshot=QualityRuleSnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为路由层可直接输出的 JSON 结构。"""

        return {"snapshot": self.snapshot.to_dict()}


@dataclass(frozen=True)
class ProofreadingLookupPayload:
    """质量规则跳转校对页时使用的查询载荷。"""

    query: ProofreadingLookupQuery

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProofreadingLookupPayload":
        """把查询参数统一成稳定对象。"""

        return cls(query=ProofreadingLookupQuery.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 响应结构。"""

        return {"query": self.query.to_dict()}
