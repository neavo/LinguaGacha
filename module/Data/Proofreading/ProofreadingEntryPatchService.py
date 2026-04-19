from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Callable

from module.Data.Core.Item import Item
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterScanResult,
)
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterOptions,
)
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterService,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingSnapshotService,
)


@dataclass(frozen=True)
class ProofreadingEntryPatchResult:
    """校对页条目补丁结果。"""

    load_result: ProofreadingLoadResult
    target_item_ids: tuple[int, ...]
    applied_filters: ProofreadingFilterOptions
    full_items: tuple[Item, ...]
    filtered_items: tuple[Item, ...]
    filtered_item_count: int
    filtered_warning_item_count: int


class ProofreadingEntryPatchService:
    """按条目粒度构造校对页局部补丁。"""

    def __init__(
        self,
        snapshot_service: ProofreadingSnapshotService,
        filter_service: ProofreadingFilterService,
    ) -> None:
        self.snapshot_service = snapshot_service
        self.filter_service = filter_service

    def get_patch(
        self,
        *,
        lg_path: str,
        request: dict[str, Any],
    ) -> ProofreadingEntryPatchResult:
        """按条目 id 构造双视图补丁。"""

        load_result = self.snapshot_service.load_snapshot(lg_path)
        applied_filters = self.resolve_filter_options(request, load_result)

        item_ids_raw = request.get("item_ids", [])
        normalized_item_ids = self.normalize_item_ids(item_ids_raw)
        target_item_id_set = set(normalized_item_ids)

        scan_result = self.filter_items_from_request(
            request,
            load_result,
            collect_when=lambda item: (
                isinstance(item.get_id(), int) and item.get_id() in target_item_id_set
            ),
        )
        if load_result.items_by_id:
            full_items = tuple(
                load_result.items_by_id[item_id]
                for item_id in normalized_item_ids
                if item_id in load_result.items_by_id
            )
        else:
            full_items = tuple(
                item
                for item in load_result.items
                if isinstance(item.get_id(), int)
                and item.get_id() in target_item_id_set
            )

        return ProofreadingEntryPatchResult(
            load_result=load_result,
            target_item_ids=tuple(normalized_item_ids),
            applied_filters=applied_filters,
            full_items=full_items,
            filtered_items=scan_result.items,
            filtered_item_count=scan_result.filtered_item_count,
            filtered_warning_item_count=scan_result.warning_item_count,
        )

    def resolve_filter_options(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
    ) -> ProofreadingFilterOptions:
        """统一解析筛选选项，和整页快照保持同一口径。"""

        filters_raw = request.get("filters")
        if not isinstance(filters_raw, dict):
            filters_raw = request.get("filter_options")
        if not isinstance(filters_raw, dict):
            filters_raw = request
        request_options = ProofreadingFilterOptions.from_dict(filters_raw)
        return self.merge_filter_options(load_result.filter_options, request_options)

    def merge_filter_options(
        self,
        base_options: ProofreadingFilterOptions,
        request_options: ProofreadingFilterOptions,
    ) -> ProofreadingFilterOptions:
        """把请求筛选按字段覆盖到快照默认值上。"""

        return ProofreadingFilterOptions(
            warning_types=(
                request_options.warning_types
                if request_options.warning_types is not None
                else base_options.warning_types
            ),
            statuses=(
                request_options.statuses
                if request_options.statuses is not None
                else base_options.statuses
            ),
            file_paths=(
                request_options.file_paths
                if request_options.file_paths is not None
                else base_options.file_paths
            ),
            glossary_terms=(
                request_options.glossary_terms
                if request_options.glossary_terms is not None
                else base_options.glossary_terms
            ),
        )

    def filter_items_from_request(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
        *,
        collect_when: Callable[[Item], bool] | None = None,
    ) -> ProofreadingFilterScanResult:
        """在当前筛选与搜索口径下重建可见条目集。"""

        options = self.resolve_filter_options(request, load_result)
        search_keyword, search_is_regex, search_dst_only = self.resolve_search_options(
            request
        )
        enable_search_filter = bool(
            request.get("enable_search_filter", search_keyword != "")
        )
        enable_glossary_term_filter = bool(
            request.get("enable_glossary_term_filter", True)
        )
        return self.filter_service.scan_filtered_items(
            load_result.items,
            load_result.warning_map,
            options,
            load_result.checker,
            failed_terms_by_item_key=load_result.failed_terms_by_item_key,
            search_keyword=search_keyword,
            search_is_regex=search_is_regex,
            search_dst_only=search_dst_only,
            enable_search_filter=enable_search_filter,
            enable_glossary_term_filter=enable_glossary_term_filter,
            collect_when=collect_when,
        )

    def resolve_search_options(
        self,
        request: dict[str, Any],
    ) -> tuple[str, bool, bool]:
        """兼容不同调用姿势下的搜索字段。"""

        keyword_raw = request.get("keyword", request.get("search_keyword", ""))
        keyword = str(keyword_raw)
        is_regex = bool(request.get("is_regex", request.get("search_is_regex", False)))
        search_dst_only = bool(
            request.get("search_dst_only", request.get("search_replace_mode", False))
        )
        return keyword, is_regex, search_dst_only

    def normalize_item_ids(self, raw_item_ids: Any) -> list[int]:
        """把请求里的条目 id 统一规整成整数列表。"""

        if not isinstance(raw_item_ids, list):
            return []

        normalized_item_ids: list[int] = []
        seen_item_ids: set[int] = set()
        for raw_item_id in raw_item_ids:
            if isinstance(raw_item_id, bool):
                continue
            try:
                item_id = int(raw_item_id)
            except TypeError, ValueError:
                continue
            if item_id in seen_item_ids:
                continue
            seen_item_ids.add(item_id)
            normalized_item_ids.append(item_id)
        return normalized_item_ids
