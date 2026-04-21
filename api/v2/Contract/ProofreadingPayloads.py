from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from api.v2.Models.Proofreading import ProofreadingMutationResult


@dataclass(frozen=True)
class ProofreadingMutationResultPayload:
    """校对写入结果响应载荷。"""

    result: ProofreadingMutationResult

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把字典型写入结果收口成稳定对象。"""

        return cls(result=ProofreadingMutationResult.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供路由层直接输出。"""

        return {"result": self.result.to_dict()}


def build_mutation_result_payload(
    *,
    revision: int,
    changed_item_ids: list[int | str],
) -> dict[str, Any]:
    """把写入结果整理成最小 ack，避免继续回传整页派生结果。"""

    return ProofreadingMutationResultPayload.from_dict(
        {
            "revision": revision,
            "changed_item_ids": list(changed_item_ids),
        }
    ).to_dict()
