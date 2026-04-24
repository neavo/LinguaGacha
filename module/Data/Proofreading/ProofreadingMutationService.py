from __future__ import annotations

from typing import Any

from module.Data.Core.Item import Item
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionConflictError as ProofreadingRevisionConflictError,
)
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService as ProofreadingRevisionService,
)


class ProofreadingMutationService:
    """校对写入服务。

    这个服务只接收前端已经确认的 finalized payload，统一做 revision 校验、
    落库和变更范围计算。
    """

    REVISION_SCOPE: str = "proofreading"

    def __init__(
        self,
        data_manager: Any | None = None,
        *,
        revision_service: ProofreadingRevisionService | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if revision_service is None:
            self.revision_service = ProofreadingRevisionService(self.data_manager)
        else:
            self.revision_service = revision_service

    def _get_state_lock(self) -> Any:
        """复用工程会话锁，让 revision 检查和写入落在同一临界区。"""

        return self.data_manager.session.state_lock

    def _bump_revision(self, current_revision: int | None) -> None:
        """在写入成功后推进 revision。"""

        self.revision_service.bump_revision(self.REVISION_SCOPE, current_revision)

    def build_project_item_change(
        self,
        values: list[Item] | list[dict[str, Any]],
        *,
        reason: str,
    ) -> ProjectItemChange:
        """把本次写入条目整理成统一影响范围。"""

        item_ids: list[int] = []
        rel_paths: list[str] = []
        seen_item_ids: set[int] = set()
        seen_rel_paths: set[str] = set()
        for value in values:
            if isinstance(value, Item):
                item_id = value.get_id()
                rel_path = str(value.get_file_path() or "")
            elif isinstance(value, dict):
                raw_item_id = value.get("id", value.get("item_id"))
                item_id = raw_item_id if isinstance(raw_item_id, int) else None
                rel_path = str(value.get("file_path", "") or "")
            else:
                continue

            if isinstance(item_id, int) and item_id not in seen_item_ids:
                seen_item_ids.add(item_id)
                item_ids.append(item_id)
            if rel_path != "" and rel_path not in seen_rel_paths:
                seen_rel_paths.add(rel_path)
                rel_paths.append(rel_path)

        return ProjectItemChange(
            item_ids=tuple(item_ids),
            rel_paths=tuple(rel_paths),
            reason=reason,
        )

    def normalize_finalized_item_payload(
        self,
        payload: dict[str, Any],
        existing_items: dict[int, dict[str, Any]],
    ) -> dict[str, Any] | None:
        raw_item_id = payload.get("id", payload.get("item_id"))
        if not isinstance(raw_item_id, int):
            try:
                raw_item_id = int(raw_item_id)
            except TypeError:
                return None
            except ValueError:
                return None

        existing_item = existing_items.get(raw_item_id)
        if existing_item is None:
            return None

        normalized_item = dict(existing_item)
        normalized_item["id"] = raw_item_id

        if "file_path" in payload:
            normalized_item["file_path"] = str(payload.get("file_path", "") or "")
        if "row" in payload or "row_number" in payload:
            normalized_item["row"] = int(
                payload.get("row", payload.get("row_number", 0)) or 0
            )
        if "src" in payload:
            normalized_item["src"] = str(payload.get("src", "") or "")
        if "dst" in payload:
            normalized_item["dst"] = str(payload.get("dst", "") or "")
        if "status" in payload:
            normalized_item["status"] = DataManager.normalize_project_status_value(
                payload.get("status", "")
            )
        if "text_type" in payload:
            normalized_item["text_type"] = str(payload.get("text_type", "") or "")
        if "retry_count" in payload:
            normalized_item["retry_count"] = int(payload.get("retry_count", 0) or 0)

        return normalized_item

    def persist_finalized_items(
        self,
        items: list[dict[str, Any]],
        *,
        translation_extras: dict[str, Any],
        project_status: str,
        expected_section_revisions: dict[str, int] | None,
        reason: str,
    ) -> ProjectItemChange:
        with self._get_state_lock():
            proofreading_revision = self.revision_service.get_revision(
                self.REVISION_SCOPE
            )
            if expected_section_revisions is not None:
                if "proofreading" in expected_section_revisions:
                    proofreading_revision = self.revision_service.assert_revision(
                        self.REVISION_SCOPE,
                        int(expected_section_revisions["proofreading"]),
                    )
                if "items" in expected_section_revisions:
                    self.data_manager.assert_project_runtime_section_revision(
                        "items",
                        int(expected_section_revisions["items"]),
                    )

            existing_items = {
                int(item_dict["id"]): dict(item_dict)
                for item_dict in self.data_manager.get_all_item_dicts()
                if isinstance(item_dict.get("id"), int)
            }
            finalized_items = [
                normalized_item
                for normalized_item in (
                    self.normalize_finalized_item_payload(payload, existing_items)
                    for payload in items
                    if isinstance(payload, dict)
                )
                if normalized_item is not None
            ]

            self.data_manager.update_batch(
                items=finalized_items or None,
                meta={
                    "translation_extras": dict(translation_extras),
                    "project_status": DataManager.normalize_project_status_value(
                        project_status
                    ),
                },
            )
            self.data_manager.bump_project_runtime_section_revisions(("items",))
            self._bump_revision(proofreading_revision)
            change = self.build_project_item_change(
                finalized_items,
                reason=reason,
            )

        return change
