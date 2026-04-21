from __future__ import annotations

from typing import Any

from api.v2.Contract.ProofreadingPayloads import ProofreadingEntryPatchPayload
from api.v2.Contract.ProofreadingPayloads import ProofreadingSnapshotPayload
from api.v2.Contract.ProofreadingPayloads import build_mutation_result_payload
from api.v2.Models.Proofreading import ProofreadingFilterOptionsSnapshot
from api.v2.Models.Proofreading import ProofreadingItemView
from api.v2.Models.Proofreading import ProofreadingSummary
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingEntryPatchService import (
    ProofreadingEntryPatchService,
)
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterService
from module.Data.Proofreading.ProofreadingMutationService import (
    ProofreadingMutationService,
)
from module.Data.Proofreading.ProofreadingRetranslateService import (
    ProofreadingRetranslateService,
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
        entry_patch_service: ProofreadingEntryPatchService | None = None,
        mutation_service: ProofreadingMutationService | None = None,
        retranslate_service: ProofreadingRetranslateService | None = None,
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

        if entry_patch_service is None:
            self.entry_patch_service = ProofreadingEntryPatchService(
                self.snapshot_service,
                self.filter_service,
            )
        else:
            self.entry_patch_service = entry_patch_service

        if mutation_service is None:
            self.mutation_service = ProofreadingMutationService(self.data_manager)
        else:
            self.mutation_service = mutation_service

        if retranslate_service is None:
            self.retranslate_service = ProofreadingRetranslateService(self.data_manager)
        else:
            self.retranslate_service = retranslate_service

    def resolve_lg_path(self, request: dict[str, Any]) -> str:
        """读取当前工程路径快照，确保同一请求内的后续读取口径一致。"""

        del request

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
        snapshot_dict = self.build_snapshot_dict(
            load_result,
            filtered_items,
            filters=self.resolve_filter_options(request, load_result),
        )
        return ProofreadingSnapshotPayload.from_dict(snapshot_dict).to_dict()

    def get_file_patch(self, request: dict[str, Any]) -> dict[str, object]:
        """按受影响文件返回校对页局部补丁。"""

        load_result = self.snapshot_service.load_snapshot(self.resolve_lg_path(request))
        applied_filters = self.resolve_filter_options(request, load_result)

        rel_paths_raw = request.get("rel_paths", [])
        rel_paths = (
            [str(rel_path) for rel_path in rel_paths_raw]
            if isinstance(rel_paths_raw, list)
            else []
        )
        removed_rel_paths_raw = request.get("removed_rel_paths", [])
        removed_rel_paths = (
            [str(rel_path) for rel_path in removed_rel_paths_raw]
            if isinstance(removed_rel_paths_raw, list)
            else []
        )
        target_file_paths = {
            rel_path for rel_path in [*rel_paths, *removed_rel_paths] if rel_path != ""
        }
        ordered_target_file_paths = list(
            dict.fromkeys([*rel_paths, *removed_rel_paths])
        )

        filtered_scan_result = self.filter_service.scan_filtered_items(
            load_result.items,
            load_result.warning_map,
            applied_filters,
            load_result.checker,
            failed_terms_by_item_key=load_result.failed_terms_by_item_key,
            collect_when=lambda item: item.get_file_path() in target_file_paths,
        )

        full_items = self.get_items_for_file_paths(
            load_result,
            ordered_target_file_paths,
        )

        return {
            "patch": {
                "revision": int(load_result.revision or 0),
                "project_id": str(load_result.lg_path or ""),
                "readonly": load_result.kind != ProofreadingLoadKind.OK,
                "removed_file_paths": [
                    rel_path for rel_path in removed_rel_paths if rel_path != ""
                ],
                "default_filters": self.load_result_filter_options_to_dict(
                    load_result.filter_options
                ),
                "applied_filters": self.load_result_filter_options_to_dict(
                    applied_filters
                ),
                "full_summary": self.build_summary_dict(load_result, load_result.items),
                "filtered_summary": self.build_summary_dict_from_counts(
                    load_result,
                    filtered_item_count=filtered_scan_result.filtered_item_count,
                    warning_item_count=filtered_scan_result.warning_item_count,
                ),
                "full_items": self.build_items_dict(full_items, load_result),
                "filtered_items": self.build_items_dict(
                    list(filtered_scan_result.items),
                    load_result,
                ),
            }
        }

    def get_entry_patch(self, request: dict[str, Any]) -> dict[str, object]:
        """按条目 id 返回校对页局部补丁。"""

        patch_result = self.entry_patch_service.get_patch(
            lg_path=self.resolve_lg_path(request),
            request=request,
        )
        load_result = patch_result.load_result

        full_item_dicts = self.build_items_dict(
            list(patch_result.full_items), load_result
        )
        filtered_item_dicts = self.build_items_dict(
            list(patch_result.filtered_items),
            load_result,
        )
        payload = ProofreadingEntryPatchPayload(
            revision=int(load_result.revision or 0),
            project_id=str(load_result.lg_path or ""),
            readonly=load_result.kind != ProofreadingLoadKind.OK,
            target_item_ids=tuple(patch_result.target_item_ids),
            default_filters=ProofreadingFilterOptionsSnapshot.from_dict(
                self.load_result_filter_options_to_dict(load_result.filter_options)
            ),
            applied_filters=ProofreadingFilterOptionsSnapshot.from_dict(
                self.load_result_filter_options_to_dict(patch_result.applied_filters)
            ),
            full_summary=ProofreadingSummary.from_dict(
                self.build_summary_dict(
                    load_result,
                    list(patch_result.full_items),
                )
            ),
            filtered_summary=ProofreadingSummary.from_dict(
                self.build_summary_dict_from_counts(
                    load_result,
                    filtered_item_count=patch_result.filtered_item_count,
                    warning_item_count=patch_result.filtered_warning_item_count,
                )
            ),
            full_items=tuple(
                ProofreadingItemView.from_dict(item_dict)
                for item_dict in full_item_dicts
            ),
            filtered_items=tuple(
                ProofreadingItemView.from_dict(item_dict)
                for item_dict in filtered_item_dicts
            ),
        )
        return {"patch": payload.to_dict()}

    def save_item(self, request: dict[str, Any]) -> dict[str, object]:
        """保存单条条目，并把 revision 冲突语义原样保留在 mutation 结果里。"""

        item = self.resolve_request_item(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.mutation_service.apply_manual_edit(
            item,
            str(item.get_dst()),
            expected_revision=expected_revision,
        )
        saved_item_id = (
            change.item_ids[0] if change.item_ids else int(item.get_id() or 0)
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

    def save_all(self, request: dict[str, Any]) -> dict[str, object]:
        """批量保存条目，并返回刷新后的 mutation 结果。"""

        items = self.resolve_request_items(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.mutation_service.save_all(
            items,
            expected_revision=expected_revision,
        )
        changed_item_ids = list(change.item_ids)
        refreshed_result = self.snapshot_service.load_snapshot(
            self.resolve_lg_path(request)
        )
        refreshed_items = self.find_items_in_snapshot(
            refreshed_result,
            changed_item_ids,
        )
        return {
            "result": build_mutation_result_payload(
                revision=refreshed_result.revision,
                changed_item_ids=list(changed_item_ids),
                items=self.build_items_dict(refreshed_items, refreshed_result),
                summary=refreshed_result.summary,
            )["result"],
        }

    def replace_all(self, request: dict[str, Any]) -> dict[str, object]:
        """批量替换所有命中项，并把写入结果统一收口成 mutation payload。"""

        items = self.resolve_request_items(request)
        search_text = str(request.get("search_text", ""))
        replace_text = str(request.get("replace_text", ""))
        is_regex = bool(request.get("is_regex", False))
        expected_revision = int(request.get("expected_revision", 0) or 0)

        change = self.mutation_service.replace_all(
            items,
            search_text=search_text,
            replace_text=replace_text,
            is_regex=is_regex,
            expected_revision=expected_revision,
        )
        refreshed_result = self.snapshot_service.load_snapshot(
            self.resolve_lg_path(request)
        )
        refreshed_items = self.find_items_in_snapshot(
            refreshed_result,
            list(change.item_ids),
        )

        return {
            "result": build_mutation_result_payload(
                revision=refreshed_result.revision,
                changed_item_ids=list(change.item_ids),
                items=self.build_items_dict(refreshed_items, refreshed_result),
                summary=refreshed_result.summary,
            )["result"],
        }

    def retranslate_items(self, request: dict[str, Any]) -> dict[str, object]:
        """单条/批量重译条目，并返回刷新后的 mutation 结果。"""

        items = self.resolve_request_items(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.retranslate_service.retranslate_items(
            items,
            expected_revision=expected_revision,
        )
        changed_item_ids = list(change.item_ids)
        refreshed_result = self.snapshot_service.load_snapshot(
            self.resolve_lg_path(request)
        )
        refreshed_items = self.find_items_in_snapshot(
            refreshed_result,
            changed_item_ids,
        )
        return {
            "result": build_mutation_result_payload(
                revision=int(refreshed_result.revision or 0),
                changed_item_ids=changed_item_ids,
                items=self.build_items_dict(refreshed_items, refreshed_result),
                summary=refreshed_result.summary,
            )["result"],
        }

    def resolve_filter_options(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
    ) -> ProofreadingFilterOptions:
        """统一解析筛选选项，避免路由各自拼一份不同的结构。"""

        filters_raw = request.get("filter_options")
        if not isinstance(filters_raw, dict):
            filters_raw = {}
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
            include_without_glossary_miss=(
                request_options.include_without_glossary_miss
                if request_options.include_without_glossary_miss is not None
                else base_options.include_without_glossary_miss
            ),
        )

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

    def filter_items_from_request(
        self,
        request: dict[str, Any],
        load_result: ProofreadingLoadResult,
    ) -> list[Item]:
        """执行实际筛选，供整页快照与局部补丁共用。"""

        options = self.resolve_filter_options(request, load_result)
        return self.filter_service.filter_items(
            load_result.items,
            load_result.warning_map,
            options,
            load_result.checker,
            failed_terms_by_item_key=load_result.failed_terms_by_item_key,
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

        applied_terms: list[list[str]] = []
        applied_terms_raw = load_result.applied_terms_by_item_key.get(id(item), ())
        for term in applied_terms_raw:
            if isinstance(term, (list, tuple)) and len(term) >= 2:
                applied_terms.append([str(term[0]), str(term[1])])

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
            "applied_glossary_terms": applied_terms,
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

        indexed_item = load_result.items_by_id.get(item_id)
        if indexed_item is not None:
            return indexed_item

        for snapshot_item in load_result.items:
            if snapshot_item.get_id() == item_id:
                return snapshot_item

        return None

    def find_items_in_snapshot(
        self,
        load_result: ProofreadingLoadResult,
        item_ids: list[int | str],
    ) -> list[Item]:
        """按条目 id 列表批量找回刷新后的对象。"""

        found_items: list[Item] = []
        for item_id in item_ids:
            if not isinstance(item_id, int):
                continue
            snapshot_item = load_result.items_by_id.get(item_id)
            if snapshot_item is None:
                snapshot_item = self.find_item_in_snapshot(load_result, item_id)
            if snapshot_item is not None:
                found_items.append(snapshot_item)
        return found_items

    def build_snapshot_dict(
        self,
        load_result: ProofreadingLoadResult,
        items: list[Item] | None = None,
        *,
        filters: ProofreadingFilterOptions | None = None,
    ) -> dict[str, Any]:
        """把当前快照整理成稳定字典，供 payload 统一序列化。"""

        target_items = items if items is not None else load_result.items
        item_dicts = self.build_items_dict(target_items, load_result)

        payload: dict[str, Any] = {
            "revision": int(load_result.revision or 0),
            "project_id": str(load_result.lg_path or ""),
            "readonly": load_result.kind != ProofreadingLoadKind.OK,
            "summary": self.build_summary_dict(load_result, target_items),
            "filters": self.load_result_filter_options_to_dict(
                filters if filters is not None else load_result.filter_options
            ),
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

    def build_summary_dict_from_counts(
        self,
        load_result: ProofreadingLoadResult,
        *,
        filtered_item_count: int,
        warning_item_count: int,
    ) -> dict[str, Any]:
        """按已有计数构建摘要，避免 patch 再次遍历整表。"""

        summary = dict(load_result.summary)
        total_items = int(summary.get("total_items", 0) or 0)
        if total_items <= 0:
            if load_result.total_item_count > 0:
                total_items = load_result.total_item_count
            else:
                total_items = len(load_result.items_all)

        summary["total_items"] = total_items
        summary["filtered_items"] = filtered_item_count
        summary["warning_items"] = warning_item_count
        return summary

    def build_summary_dict(
        self,
        load_result: ProofreadingLoadResult,
        items: list[Item],
    ) -> dict[str, Any]:
        """按给定条目集生成统一摘要，供整页和局部补丁共用。"""

        warning_item_count = 0
        for item in items:
            if load_result.warning_map.get(id(item)):
                warning_item_count += 1

        return self.build_summary_dict_from_counts(
            load_result,
            filtered_item_count=len(items),
            warning_item_count=warning_item_count,
        )

    def get_items_for_file_paths(
        self,
        load_result: ProofreadingLoadResult,
        file_paths: list[str],
    ) -> list[Item]:
        """按文件路径从快照索引里恢复条目，并保留请求顺序。"""

        if load_result.items_by_file_path:
            collected_items: list[Item] = []
            for file_path in file_paths:
                if file_path == "":
                    continue
                collected_items.extend(
                    load_result.items_by_file_path.get(file_path, ())
                )
            return collected_items

        target_file_path_set = {
            file_path for file_path in file_paths if file_path != ""
        }
        return [
            item
            for item in load_result.items
            if item.get_file_path() in target_file_path_set
        ]

    def load_result_filter_options_to_dict(
        self,
        filter_options: ProofreadingFilterOptions,
    ) -> dict[str, Any]:
        """把筛选对象统一转换成边界层稳定字典。"""

        return {
            "warning_types": sorted(
                str(value) for value in (filter_options.warning_types or set())
            ),
            "statuses": sorted(
                str(getattr(value, "value", value))
                for value in (filter_options.statuses or set())
            ),
            "file_paths": sorted(
                str(value) for value in (filter_options.file_paths or set())
            ),
            "glossary_terms": sorted(
                [
                    [str(term[0]), str(term[1])]
                    for term in (filter_options.glossary_terms or set())
                ],
                key=lambda term: f"{term[0]}->{term[1]}",
            ),
            "include_without_glossary_miss": (
                filter_options.include_without_glossary_miss is not False
            ),
        }
