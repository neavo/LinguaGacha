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
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadKind,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult,
)


@dataclass(frozen=True)
class ProofreadingSnapshotPayload:
    """校对快照响应载荷。"""

    snapshot: ProofreadingSnapshot

    @classmethod
    def from_load_result(
        cls,
        load_result: ProofreadingLoadResult,
    ) -> Self:
        """把 core 加载结果收敛成稳定快照。"""

        items: list[ProofreadingItemView] = []
        warning_map = load_result.warning_map
        failed_terms_by_item_key = load_result.failed_terms_by_item_key
        for item in load_result.items:
            item_id = item.get_id()
            if not isinstance(item_id, int):
                item_id = 0

            warnings_raw = warning_map.get(id(item), [])
            warnings: list[str] = []
            for warning in warnings_raw:
                warning_value = getattr(warning, "value", warning)
                warnings.append(str(warning_value))

            failed_terms_raw = failed_terms_by_item_key.get(id(item), ())
            failed_terms: list[tuple[str, str]] = []
            for term in failed_terms_raw:
                if isinstance(term, (list, tuple)) and len(term) >= 2:
                    failed_terms.append((str(term[0]), str(term[1])))

            status = item.get_status()
            status_value = getattr(status, "value", status)
            items.append(
                ProofreadingItemView(
                    item_id=item_id,
                    file_path=item.get_file_path(),
                    row_number=int(item.get_row() or 0),
                    src=item.get_src(),
                    dst=item.get_dst(),
                    status=str(status_value),
                    warnings=tuple(warnings),
                    failed_glossary_terms=tuple(failed_terms),
                )
            )

        filters = ProofreadingFilterOptionsSnapshot.from_dict(
            load_result.filter_options.to_dict()
        )
        summary = ProofreadingSummary.from_dict(load_result.summary)
        readonly = load_result.kind != ProofreadingLoadKind.OK
        snapshot = ProofreadingSnapshot(
            revision=int(load_result.revision or 0),
            project_id=str(load_result.lg_path or ""),
            readonly=readonly,
            summary=summary,
            filters=filters,
            items=tuple(items),
        )
        return cls(snapshot=snapshot)

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
class ProofreadingFilterOptionsPayload:
    """校对筛选选项响应载荷。"""

    filters: ProofreadingFilterOptionsSnapshot

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把字典型筛选选项收口成稳定对象。"""

        return cls(filters=ProofreadingFilterOptionsSnapshot.from_dict(data))

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供路由层直接输出。"""

        return {"filters": self.filters.to_dict()}


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
