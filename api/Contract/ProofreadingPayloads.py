from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self

from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingItemView
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Api.ProofreadingModels import ProofreadingSummary


@dataclass(frozen=True)
class ProofreadingSnapshotPayload:
    """校对快照响应载荷。"""

    snapshot: ProofreadingSnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把字典型快照收口成稳定对象。"""

        return cls(snapshot=ProofreadingSnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供路由层直接输出。"""

        return {"snapshot": self.snapshot.to_dict()}


@dataclass(frozen=True)
class ProofreadingSearchResultPayload:
    """校对搜索结果响应载荷。"""

    search_result: ProofreadingSearchResult

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把字典型搜索结果收口成稳定对象。"""

        return cls(search_result=ProofreadingSearchResult.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供路由层直接输出。"""

        return {"search_result": self.search_result.to_dict()}


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


@dataclass(frozen=True)
class ProofreadingEntryPatchPayload:
    """校对页条目级补丁载荷。"""

    revision: int
    project_id: str
    readonly: bool
    target_item_ids: tuple[int, ...]
    default_filters: ProofreadingFilterOptionsSnapshot
    applied_filters: ProofreadingFilterOptionsSnapshot
    full_summary: ProofreadingSummary
    filtered_summary: ProofreadingSummary
    full_items: tuple[ProofreadingItemView, ...]
    filtered_items: tuple[ProofreadingItemView, ...]

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供路由层直接输出。"""

        return {
            "revision": self.revision,
            "project_id": self.project_id,
            "readonly": self.readonly,
            "target_item_ids": list(self.target_item_ids),
            "default_filters": self.default_filters.to_dict(),
            "applied_filters": self.applied_filters.to_dict(),
            "full_summary": self.full_summary.to_dict(),
            "filtered_summary": self.filtered_summary.to_dict(),
            "full_items": [item.to_dict() for item in self.full_items],
            "filtered_items": [item.to_dict() for item in self.filtered_items],
        }


def build_mutation_result_payload(
    *,
    revision: int,
    changed_item_ids: list[int | str],
    items: list[dict[str, Any]],
    summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """把写入结果整理成统一字典，避免各路由重复拼结构。"""

    payload: dict[str, Any] = {
        "revision": revision,
        "changed_item_ids": list(changed_item_ids),
        "items": items,
    }
    if summary is not None:
        payload["summary"] = summary
    return ProofreadingMutationResultPayload.from_dict(payload).to_dict()


def build_search_result_payload(
    *,
    keyword: str,
    is_regex: bool,
    matched_item_ids: list[int],
) -> dict[str, Any]:
    """把搜索结果整理成统一字典，供客户端直接消费。"""

    payload = {
        "keyword": keyword,
        "is_regex": is_regex,
        "matched_item_ids": matched_item_ids,
    }
    return ProofreadingSearchResultPayload.from_dict(payload).to_dict()
