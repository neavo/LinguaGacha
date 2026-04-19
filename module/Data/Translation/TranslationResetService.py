from __future__ import annotations

from typing import Any

from base.Base import Base
from module.Data.Core.BatchService import BatchService
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Core.DataTypes import ProjectItemChange
from module.Engine.TaskModeStrategy import TaskModeStrategy


class TranslationResetService:
    """只负责翻译失败条目的重置，避免分析域继续背这个职责。"""

    def __init__(
        self,
        session: ProjectSession,
        batch_service: BatchService,
        meta_service: MetaService,
        item_service: ItemService,
    ) -> None:
        self.session = session
        self.batch_service = batch_service
        self.meta_service = meta_service
        self.item_service = item_service

    def reset_failed_translation_items_sync(
        self,
    ) -> tuple[ProjectItemChange, dict[str, Any]] | None:
        """重置失败译文并同步翻译进度快照。"""

        with self.session.state_lock:
            if self.session.db is None:
                return None

        items = self.item_service.get_all_items()
        if not items:
            return None

        changed_items: list[dict[str, Any]] = []
        changed_item_ids: list[int] = []
        changed_rel_paths: list[str] = []
        seen_rel_paths: set[str] = set()
        for item in items:
            if not TaskModeStrategy.should_reset_failed(item.get_status()):
                continue

            item.set_dst("")
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)

            item_dict = item.to_dict()
            if isinstance(item_dict.get("id"), int):
                changed_items.append(item_dict)
                changed_item_ids.append(int(item_dict["id"]))
                rel_path = str(item_dict.get("file_path", "") or "")
                if rel_path != "" and rel_path not in seen_rel_paths:
                    seen_rel_paths.add(rel_path)
                    changed_rel_paths.append(rel_path)

        processed_line = sum(
            1 for item in items if item.get_status() == Base.ProjectStatus.PROCESSED
        )
        error_line = sum(
            1 for item in items if item.get_status() == Base.ProjectStatus.ERROR
        )
        total_line = sum(
            1
            for item in items
            if TaskModeStrategy.is_tracked_progress_status(item.get_status())
        )

        extras = self.meta_service.get_meta("translation_extras", {})
        if not isinstance(extras, dict):
            extras = {}
        extras["processed_line"] = processed_line
        extras["error_line"] = error_line
        extras["line"] = processed_line + error_line
        extras["total_line"] = total_line

        project_status = (
            Base.ProjectStatus.PROCESSING
            if any(item.get_status() == Base.ProjectStatus.NONE for item in items)
            else Base.ProjectStatus.PROCESSED
        )

        self.batch_service.update_batch(
            items=changed_items or None,
            meta={
                "translation_extras": extras,
                "project_status": project_status,
            },
        )
        return (
            ProjectItemChange(
                item_ids=tuple(changed_item_ids),
                rel_paths=tuple(changed_rel_paths),
                reason="translation_reset_failed",
            ),
            extras,
        )
