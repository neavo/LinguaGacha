from __future__ import annotations

from typing import Any

from api.v2.Contract.ProofreadingPayloads import build_mutation_result_payload
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService
from module.Data.Proofreading.ProofreadingMutationService import (
    ProofreadingMutationService,
)
from module.Data.Proofreading.ProofreadingRetranslateService import (
    ProofreadingRetranslateService,
)


class ProofreadingAppService:
    """校对用例层只保留 GUI 仍在使用的写入口。"""

    def __init__(
        self,
        *,
        data_manager: Any | None = None,
        mutation_service: ProofreadingMutationService | None = None,
        retranslate_service: ProofreadingRetranslateService | None = None,
        runtime_service: ProjectRuntimeService | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if mutation_service is None:
            self.mutation_service = ProofreadingMutationService(self.data_manager)
        else:
            self.mutation_service = mutation_service

        if retranslate_service is None:
            self.retranslate_service = ProofreadingRetranslateService(self.data_manager)
        else:
            self.retranslate_service = retranslate_service

        if runtime_service is None:
            self.runtime_service = ProjectRuntimeService(self.data_manager)
        else:
            self.runtime_service = runtime_service

    def save_item(self, request: dict[str, Any]) -> dict[str, object]:
        """保存单条条目，并返回最小 mutation ack。"""

        item = self.resolve_request_item(request)
        new_dst = str(request.get("new_dst", item.get_dst()))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.mutation_service.apply_manual_edit(
            item,
            new_dst,
            expected_revision=expected_revision,
        )
        return self.build_mutation_ack(change)

    def save_all(self, request: dict[str, Any]) -> dict[str, object]:
        """批量保存条目，并返回最小 mutation ack。"""

        items = self.resolve_request_items(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.mutation_service.save_all(
            items,
            expected_revision=expected_revision,
        )
        return self.build_mutation_ack(change)

    def replace_all(self, request: dict[str, Any]) -> dict[str, object]:
        """批量替换命中项，并返回最小 mutation ack。"""

        items = self.resolve_request_items(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.mutation_service.replace_all(
            items,
            search_text=str(request.get("search_text", "")),
            replace_text=str(request.get("replace_text", "")),
            is_regex=bool(request.get("is_regex", False)),
            expected_revision=expected_revision,
        )
        return self.build_mutation_ack(change)

    def retranslate_items(self, request: dict[str, Any]) -> dict[str, object]:
        """单条/批量重译条目，并返回最小 mutation ack。"""

        items = self.resolve_request_items(request)
        expected_revision = int(request.get("expected_revision", 0) or 0)
        change = self.retranslate_service.retranslate_items(
            items,
            expected_revision=expected_revision,
        )
        return self.build_mutation_ack(change)

    def build_mutation_ack(self, change: ProjectItemChange) -> dict[str, object]:
        """统一发 runtime patch，并把 proofreading revision 回包给前端。"""

        self.emit_runtime_patch_for_change(change)
        proofreading_revision = int(
            self.runtime_service.build_proofreading_block().get("revision", 0) or 0
        )
        return {
            "result": build_mutation_result_payload(
                revision=proofreading_revision,
                changed_item_ids=list(change.item_ids),
            )["result"]
        }

    def resolve_request_item(self, request: dict[str, Any]) -> Item:
        """把请求中的条目字典收口成 Item 对象。"""

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

    def emit_runtime_patch_for_change(self, change: ProjectItemChange) -> None:
        """写入口完成后把 item facts、task 与 proofreading revision 一起推给渲染层。"""

        changed_item_ids = [
            item_id for item_id in change.item_ids if isinstance(item_id, int)
        ]
        if not changed_item_ids:
            return

        proofreading_block = self.runtime_service.build_proofreading_block()
        proofreading_revision = int(proofreading_block.get("revision", 0) or 0)
        self.data_manager.emit_project_runtime_patch(
            reason=change.reason,
            updated_sections=("items", "proofreading", "task"),
            patch=[
                {
                    "op": "merge_items",
                    "items": self.runtime_service.build_item_records(changed_item_ids),
                },
                {
                    "op": "replace_proofreading",
                    "proofreading": proofreading_block,
                },
                {
                    "op": "replace_task",
                    "task": self.runtime_service.build_task_block(),
                },
            ],
            section_revisions={
                "proofreading": proofreading_revision,
            },
            project_revision=proofreading_revision,
        )
