from __future__ import annotations

from typing import Any

from base.Base import Base
from module.Data.Core.BatchService import BatchService
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
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

    def reset_failed_translation_items_sync(self) -> dict[str, Any] | None:
        """重置失败译文并同步翻译进度快照。"""

        with self.session.state_lock:
            if self.session.db is None:
                return None

        items = self.item_service.get_all_items()
        if not items:
            return None

        changed_items: list[dict[str, Any]] = []
        for item in items:
            if not TaskModeStrategy.should_reset_failed(item.get_status()):
                continue

            item.set_dst("")
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)

            item_dict = item.to_dict()
            if isinstance(item_dict.get("id"), int):
                changed_items.append(item_dict)

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
        return extras
