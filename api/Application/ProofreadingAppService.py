from __future__ import annotations

from typing import Any

from api.Contract.ProofreadingPayloads import ProofreadingSnapshotPayload
from api.Contract.ProofreadingPayloads import build_mutation_result_payload
from api.Contract.ProofreadingPayloads import build_search_result_payload
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterService
from module.Data.Proofreading.ProofreadingMutationService import (
    ProofreadingMutationService,
)
from module.Data.Proofreading.ProofreadingRecheckService import (
    ProofreadingRecheckService,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadKind,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingSnapshotService,
)


class ProofreadingAppService:
    """校对用例层，负责把 core 快照与写入结果收口成稳定 API 载荷。"""

    def __init__(
        self,
        *,
        data_manager: Any | None = None,
        snapshot_service: ProofreadingSnapshotService | None = None,
        filter_service: ProofreadingFilterService | None = None,
        mutation_service: ProofreadingMutationService | None = None,
        recheck_service: ProofreadingRecheckService | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if snapshot_service is None:
            self.snapshot_service = ProofreadingSnapshotService(self.data_manager)
        else:
            self.snapshot_service = snapshot_service

        if filter_service is None:
            self.filter_service = ProofreadingFilterService()
        else:
            self.filter_service = filter_service

        if mutation_service is None:
            self.mutation_service = ProofreadingMutationService(self.data_manager)
        else:
            self.mutation_service = mutation_service

        if recheck_service is None:
            self.recheck_service = ProofreadingRecheckService()
        else:
            self.recheck_service = recheck_service

    def resolve_lg_path(self, request: dict[str, Any]) -> str:
        """统一解析工程路径，保证各个路由都从同一入口读当前工程。"""

        for key in ("lg_path", "path", "project_id"):
            raw_value = request.get(key)
            if isinstance(raw_value, str) and raw_value.strip() != "":
                return raw_value

        get_lg_path = getattr(self.data_manager, "get_lg_path", None)
        if callable(get_lg_path):
            return str(get_lg_path() or "")
        return ""

    def get_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """加载完整校对快照，并通过 payload 输出稳定 JSON。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        snapshot_dict = self.build_snapshot_dict(load_result)
        return ProofreadingSnapshotPayload.from_dict(snapshot_dict).to_dict()

    def filter_items(self, request: dict[str, Any]) -> dict[str, object]:
        """按筛选条件返回过滤后的快照，不在状态仓库里缓存整页结果。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        filtered_items = self.filter_items_from_request(request, load_result)
        snapshot_dict = self.build_snapshot_dict(load_result, filtered_items)
        return ProofreadingSnapshotPayload.from_dict(snapshot_dict).to_dict()

    def search(self, request: dict[str, Any]) -> dict[str, object]:
        """执行校对页搜索，并只返回匹配项 id 列表。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        search_keyword, search_is_regex, search_dst_only = self.resolve_search_options(
            request
        )
        options = self.resolve_filter_options(request, load_result)
        matched_items = self.filter_service.filter_items(
            load_result.items,
            load_result.warning_map,
            options,
            load_result.checker,
            failed_terms_by_item_key=load_result.failed_terms_by_item_key,
            search_keyword=search_keyword,
            search_is_regex=search_is_regex,
            search_dst_only=search_dst_only,
            enable_search_filter=True,
            enable_glossary_term_filter=True,
        )
        matched_item_ids: list[int] = []
        for item in matched_items:
            item_id = item.get_id()
            if isinstance(item_id, int):
                matched_item_ids.append(item_id)

        return build_search_result_payload(
            keyword=search_keyword,
            is_regex=search_is_regex,
            matched_item_ids=matched_item_ids,
        )

    def save_item(self, request: dict[str, Any]) -> dict[str, object]:
        """保存单条条目，并把 revision 冲突语义原样保留在 mutation 结果里。"""

        item = self.resolve_request_item(request)
        new_dst = self.resolve_new_dst(request, item)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        saved_item_id = self.mutation_service.apply_manual_edit(
            item,
            new_dst,
            expected_revision=expected_revision,
        )
        refreshed_result = self.snapshot_service.load_snapshot(
            self.resolve_lg_path(request)
        )
        refreshed_item = self.find_item_in_snapshot(refreshed_result, saved_item_id)
        if refreshed_item is None:
            refreshed_item = item

        raw_result = {
            "revision": refreshed_result.revision,
            "changed_item_ids": [saved_item_id],
            "items": [self.build_item_dict(refreshed_item, refreshed_result)],
            "summary": refreshed_result.summary,
        }
        return {
            "result": build_mutation_result_payload(
                revision=int(raw_result["revision"]),
                changed_item_ids=[saved_item_id],
                items=raw_result["items"],
                summary=raw_result["summary"],
            )["result"],
        }

    def replace_all(self, request: dict[str, Any]) -> dict[str, object]:
        """批量替换所有命中项，并把写入结果统一收口成 mutation payload。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        items = self.resolve_request_items(request)
        search_text = str(request.get("search_text", ""))
        replace_text = str(request.get("replace_text", ""))
        is_regex = bool(request.get("is_regex", False))
        expected_revision = int(request.get("expected_revision", 0) or 0)

        mutation_result = self.mutation_service.replace_all(
            items,
            search_text=search_text,
            replace_text=replace_text,
            is_regex=is_regex,
            expected_revision=expected_revision,
        )
        refreshed_result = self.snapshot_service.load_snapshot(
            self.resolve_lg_path(request)
        )
        if isinstance(mutation_result, dict):
            payload = dict(mutation_result)
        else:
            payload = {
                "revision": load_result.revision,
                "changed_item_ids": [],
                "items": [],
                "summary": load_result.summary,
            }

        refreshed_items = self.build_items_dict(
            refreshed_result.items,
            refreshed_result,
        )

        return {
            "result": build_mutation_result_payload(
                revision=refreshed_result.revision,
                changed_item_ids=list(payload.get("changed_item_ids", [])),
                items=refreshed_items,
                summary=refreshed_result.summary,
            )["result"],
        }

    def recheck_item(self, request: dict[str, Any]) -> dict[str, object]:
        """重检单条条目，只回传单条结果，不缓存整页复算状态。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        item = self.resolve_request_item(request)
        warnings, failed_terms = self.recheck_service.check_item(
            load_result.config,
            item,
        )
        item_dict = self.build_item_dict(item, load_result)
        item_dict["warnings"] = [
            str(getattr(warning, "value", warning)) for warning in warnings
        ]
        if failed_terms is None:
            item_dict["failed_glossary_terms"] = []
        else:
            item_dict["failed_glossary_terms"] = [
                [str(term[0]), str(term[1])] for term in failed_terms
            ]

        return {
            "result": build_mutation_result_payload(
                revision=load_result.revision,
                changed_item_ids=[item.get_id() or 0],
                items=[item_dict],
                summary=load_result.summary,
            )["result"],
        }

    def resolve_filter_options(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
    ) -> ProofreadingFilterOptions:
        """统一解析筛选选项，避免路由各自拼一份不同的结构。"""

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
        """把请求筛选按字段覆盖到快照默认值上，保留最小请求的页面语义。"""

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

    def resolve_search_options(
        self,
        request: dict[str, Any],
    ) -> tuple[str, bool, bool]:
        """统一解析搜索条件，兼容不同路由调用姿势。"""

        keyword_raw = request.get("keyword", request.get("search_keyword", ""))
        keyword = str(keyword_raw)
        is_regex = bool(request.get("is_regex", request.get("search_is_regex", False)))
        search_dst_only = bool(
            request.get("search_dst_only", request.get("search_replace_mode", False))
        )
        return keyword, is_regex, search_dst_only

    def resolve_request_item(self, request: dict[str, Any]) -> Item:
        """把请求中的条目字典收口成 Item 对象，避免各接口自己拼。"""

        item_raw = request.get("item", request)
        if isinstance(item_raw, Item):
            return item_raw
        if isinstance(item_raw, dict):
            return Item.from_dict(item_raw)
        return Item()

    def resolve_request_items(self, request: dict[str, Any]) -> list[Item]:
        """把请求中的条目列表收口成 Item 对象列表。"""

        items_raw = request.get("items", [])
        items: list[Item] = []
        if isinstance(items_raw, list):
            for item_raw in items_raw:
                if isinstance(item_raw, Item):
                    items.append(item_raw)
                elif isinstance(item_raw, dict):
                    items.append(Item.from_dict(item_raw))
        return items

    def resolve_new_dst(self, request: dict[str, Any], item: Item) -> str:
        """统一解析新译文，兼容前端直接传 item 或单独传 new_dst。"""

        new_dst_raw = request.get("new_dst", request.get("dst", item.get_dst()))
        return str(new_dst_raw)

    def filter_items_from_request(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
    ) -> list[Item]:
        """执行实际筛选，供 filter/search 两个接口复用。"""

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
        return self.filter_service.filter_items(
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
        )

    def build_item_dict(
        self,
        item: Item,
        load_result: ProofreadingLoadResult,
    ) -> dict[str, Any]:
        """把 Item 和当前 warning 快照整理成稳定字典。"""

        item_id = item.get_id()
        if not isinstance(item_id, int):
            item_id = 0

        warnings_raw = load_result.warning_map.get(id(item), [])
        warnings: list[str] = []
        for warning in warnings_raw:
            warning_value = getattr(warning, "value", warning)
            warnings.append(str(warning_value))

        failed_terms_raw = load_result.failed_terms_by_item_key.get(id(item), ())
        failed_terms: list[list[str]] = []
        for term in failed_terms_raw:
            if isinstance(term, (list, tuple)) and len(term) >= 2:
                failed_terms.append([str(term[0]), str(term[1])])

        status = item.get_status()
        status_value = getattr(status, "value", status)
        return {
            "item_id": item_id,
            "file_path": item.get_file_path(),
            "row_number": int(item.get_row() or 0),
            "src": item.get_src(),
            "dst": item.get_dst(),
            "status": str(status_value),
            "warnings": warnings,
            "failed_glossary_terms": failed_terms,
        }

    def find_item_in_snapshot(
        self,
        load_result: ProofreadingLoadResult,
        item_id: int,
    ) -> Item | None:
        """按条目 id 从刷新后的快照里找回对象，避免依赖请求里的旧数据。"""

        if not isinstance(item_id, int):
            return None

        for snapshot_item in load_result.items:
            if snapshot_item.get_id() == item_id:
                return snapshot_item

        for snapshot_item in load_result.items_all:
            if snapshot_item.get_id() == item_id:
                return snapshot_item

        return None

    def build_snapshot_dict(
        self,
        load_result: ProofreadingLoadResult,
        items: list[Item] | None = None,
    ) -> dict[str, Any]:
        """把当前快照整理成稳定字典，供 payload 统一序列化。"""

        target_items = items if items is not None else load_result.items
        item_dicts: list[dict[str, Any]] = [
            self.build_item_dict(item, load_result) for item in target_items
        ]
        warning_item_count = 0
        for item in target_items:
            if load_result.warning_map.get(id(item)):
                warning_item_count += 1

        summary = dict(load_result.summary)
        summary["total_items"] = int(summary.get("total_items", len(load_result.items_all)))
        summary["filtered_items"] = len(target_items)
        summary["warning_items"] = warning_item_count

        payload: dict[str, Any] = {
            "revision": int(load_result.revision or 0),
            "project_id": str(load_result.lg_path or ""),
            "readonly": load_result.kind != ProofreadingLoadKind.OK,
            "summary": summary,
            "filters": load_result.filter_options.to_dict(),
            "items": item_dicts,
        }
        if load_result.kind == ProofreadingLoadKind.OK:
            payload["readonly"] = False
        return payload

    def build_items_dict(
        self,
        items: list[Item],
        load_result: ProofreadingLoadResult,
    ) -> list[dict[str, Any]]:
        """把条目对象列表统一转成稳定字典列表，供 mutation 回包复用。"""

        item_dicts: list[dict[str, Any]] = []
        for item in items:
            item_dicts.append(self.build_item_dict(item, load_result))
        return item_dicts
