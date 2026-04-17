from __future__ import annotations

import threading
from typing import Any
from typing import Callable

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService,
)
from module.Engine.Engine import Engine


class ProofreadingRetranslateService:
    """校对重译服务。

    这个服务把单条/批量重译封装到 API 边界后方，避免前端继续直接依赖 Engine。
    """

    REVISION_SCOPE: str = "proofreading"

    def __init__(
        self,
        data_manager: Any | None = None,
        *,
        config_loader: Callable[[], Config] | None = None,
        revision_service: ProofreadingRevisionService | None = None,
        translate_item_runner: Callable[
            [Item, Config, Callable[[Item, bool], None]],
            None,
        ]
        | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if config_loader is None:
            self.config_loader = lambda: Config().load()
        else:
            self.config_loader = config_loader

        if revision_service is None:
            self.revision_service = ProofreadingRevisionService(self.data_manager)
        else:
            self.revision_service = revision_service

        if translate_item_runner is None:
            self.translate_item_runner = Engine.get().translate_single_item
        else:
            self.translate_item_runner = translate_item_runner

    def retranslate_items(
        self,
        items: list[Item],
        *,
        expected_revision: int | None = None,
    ) -> dict[str, object]:
        """顺序重译条目并写回工程数据库。"""

        if expected_revision is None:
            current_revision: int | None = None
        else:
            current_revision = self.revision_service.assert_revision(
                self.REVISION_SCOPE,
                expected_revision,
            )

        config = self.config_loader()
        changed_item_ids: list[int] = []
        for item in items:
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)
            success = self.translate_item(item, config)
            if not success:
                item.set_status(Base.ProjectStatus.ERROR)

            item_id = self.data_manager.save_item(item)
            if isinstance(item_id, int):
                changed_item_ids.append(item_id)

        if current_revision is None:
            revision = self.revision_service.get_revision(self.REVISION_SCOPE)
        else:
            revision = self.revision_service.bump_revision(
                self.REVISION_SCOPE,
                current_revision,
            )
        self.sync_project_translation_state()

        return {
            "revision": revision,
            "changed_item_ids": changed_item_ids,
        }

    def translate_item(self, item: Item, config: Config) -> bool:
        """同步等待单条重译结果，保持 API 命令语义简单稳定。"""

        completed = threading.Event()
        result: dict[str, bool] = {"success": False}

        def callback(translated_item: Item, success: bool) -> None:
            del translated_item
            result["success"] = success
            completed.set()

        self.translate_item_runner(item, config, callback)
        completed.wait()
        return result["success"]

    def sync_project_translation_state(self) -> None:
        """重译后同步工程翻译状态与行数统计。"""

        if not self.data_manager.is_loaded():
            return

        review_items = [
            item
            for item in self.data_manager.get_all_items()
            if item.get_src().strip()
            and item.get_status()
            not in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            )
        ]
        untranslated_count = sum(
            1 for item in review_items if item.get_status() == Base.ProjectStatus.NONE
        )
        project_status = (
            Base.ProjectStatus.PROCESSING
            if untranslated_count > 0
            else Base.ProjectStatus.PROCESSED
        )
        self.data_manager.set_project_status(project_status)

        extras = self.data_manager.get_translation_extras()
        translated_count = sum(
            1
            for item in review_items
            if item.get_status()
            in (
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.PROCESSED_IN_PAST,
            )
        )
        extras["line"] = translated_count
        self.data_manager.set_translation_extras(extras)
