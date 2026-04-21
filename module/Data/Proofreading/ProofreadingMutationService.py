from __future__ import annotations

import re
from typing import Any

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterService
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionConflictError as ProofreadingRevisionConflictError,
)
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService as ProofreadingRevisionService,
)


class ProofreadingMutationService:
    """校对写入服务。

    这个服务把保存、批量保存、批量更新与人工编辑后的状态推导收口到一起，
    避免页面继续自己拼写回逻辑。
    """

    REVISION_SCOPE: str = "proofreading"
    SAVE_ITEM_REASON: str = "proofreading_save_item"
    SAVE_ALL_REASON: str = "proofreading_save_all"
    REPLACE_ALL_REASON: str = "proofreading_replace_all"

    def __init__(
        self,
        data_manager: Any | None = None,
        *,
        filter_service: ProofreadingFilterService | None = None,
        revision_service: ProofreadingRevisionService | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if filter_service is None:
            self.filter_service = ProofreadingFilterService()
        else:
            self.filter_service = filter_service

        if revision_service is None:
            self.revision_service = ProofreadingRevisionService(self.data_manager)
        else:
            self.revision_service = revision_service

    def _get_state_lock(self) -> Any:
        """复用工程会话锁，让 revision 检查和写入落在同一临界区。"""

        return self.data_manager.session.state_lock

    def _guard_revision(self, expected_revision: int | None) -> int | None:
        """在写入前按需校验 revision。"""

        if expected_revision is None:
            return None
        return self.revision_service.assert_revision(
            self.REVISION_SCOPE,
            expected_revision,
        )

    def _bump_revision(self, current_revision: int | None) -> None:
        """在写入成功后推进 revision。"""

        self.revision_service.bump_revision(self.REVISION_SCOPE, current_revision)

    def sync_project_translation_state(self) -> None:
        """写入后同步工程翻译状态，避免页面继续直接维护 DataManager。"""

        # 这里依赖的是正式 DataManager 同步契约，缺少能力必须直接暴露，
        # 否则会把“写入后没有刷新工程翻译态”的真实问题静默吞掉。
        if self.data_manager.is_loaded():
            review_items = self.filter_service.build_review_items(
                self.data_manager.get_all_items()
            )
            untranslated_count = sum(
                1
                for item in review_items
                if item.get_status() == Base.ProjectStatus.NONE
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
        else:
            pass

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

    def save_item(
        self,
        item: Item,
        *,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        """保存单条条目。"""

        with self._get_state_lock():
            current_revision = self._guard_revision(expected_revision)
            saved_item_id = self.data_manager.save_item(item)
            self._bump_revision(current_revision)
            self.sync_project_translation_state()
            saved_item = Item.from_dict(item.to_dict())
            saved_item.set_id(saved_item_id)
            change = self.build_project_item_change(
                [saved_item],
                reason=self.SAVE_ITEM_REASON,
            )
        return change

    def save_all(
        self,
        items: list[Item],
        *,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        """批量保存整页条目。"""

        with self._get_state_lock():
            current_revision = self._guard_revision(expected_revision)
            self.data_manager.replace_all_items(items)
            self._bump_revision(current_revision)
            self.sync_project_translation_state()
            change = self.build_project_item_change(
                items,
                reason=self.SAVE_ALL_REASON,
            )
        return change

    def replace_batch(
        self,
        items: list[dict[str, Any]],
        *,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        """批量写回字典型 payload，供 Replace 场景使用。"""

        with self._get_state_lock():
            current_revision = self._guard_revision(expected_revision)
            self.data_manager.update_batch(items=items)
            self._bump_revision(current_revision)
            self.sync_project_translation_state()
            change = self.build_project_item_change(
                items,
                reason=self.REPLACE_ALL_REASON,
            )
        return change

    @staticmethod
    def replace_once_in_text(
        *,
        text: str,
        search_text: str,
        replace_text: str,
        is_regex: bool,
    ) -> tuple[str, int]:
        """执行一次替换，和页面现有匹配语义保持一致。"""

        if is_regex:
            pattern = re.compile(search_text, re.IGNORECASE)
            return pattern.subn(replace_text, text, count=1)
        if not search_text:
            return text, 0

        pattern = re.compile(re.escape(search_text), re.IGNORECASE)
        return pattern.subn(lambda match: replace_text, text, count=1)

    @staticmethod
    def replace_all_in_text(
        *,
        text: str,
        search_text: str,
        replace_text: str,
        is_regex: bool,
    ) -> tuple[str, int]:
        """执行全量替换，保持页面现有批量替换语义。"""

        if is_regex:
            pattern = re.compile(search_text, re.IGNORECASE)
            return pattern.subn(replace_text, text)
        if not search_text:
            return text, 0

        pattern = re.compile(re.escape(search_text), re.IGNORECASE)
        return pattern.subn(lambda match: replace_text, text)

    def replace_all(
        self,
        items: list[Item],
        *,
        search_text: str,
        replace_text: str,
        is_regex: bool = False,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        """统一处理批量替换，避免页面自己拼 payload。"""

        with self._get_state_lock():
            current_revision = self._guard_revision(expected_revision)

            changed_payload: list[dict[str, Any]] = []
            changed_states: list[tuple[Item, str, Base.ProjectStatus]] = []
            for item in items:
                item_id = item.get_id()
                if not isinstance(item_id, int):
                    continue

                old_dst = item.get_dst()
                old_status = item.get_status()
                new_dst, replaced_count = self.replace_all_in_text(
                    text=old_dst,
                    search_text=search_text,
                    replace_text=replace_text,
                    is_regex=is_regex,
                )
                if replaced_count <= 0 or new_dst == old_dst:
                    continue

                new_status = self.filter_service.resolve_status_after_manual_edit(
                    old_status,
                    new_dst,
                )
                changed_payload.append(
                    {
                        "id": item_id,
                        "file_path": item.get_file_path(),
                        "dst": new_dst,
                        "status": new_status,
                    }
                )
                changed_states.append((item, new_dst, new_status))

            if changed_payload:
                self.data_manager.update_batch(items=changed_payload)
                for target_item, new_dst, new_status in changed_states:
                    target_item.set_dst(new_dst)
                    target_item.set_status(new_status)
                self.revision_service.bump_revision(
                    self.REVISION_SCOPE,
                    current_revision,
                )
                self.sync_project_translation_state()
                change = self.build_project_item_change(
                    changed_payload,
                    reason=self.REPLACE_ALL_REASON,
                )
            else:
                change = ProjectItemChange(reason=self.REPLACE_ALL_REASON)

        return change

    def apply_manual_edit(
        self,
        item: Item,
        new_dst: str,
        *,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        """保存单条人工编辑，并统一状态推导。"""

        with self._get_state_lock():
            current_revision = self._guard_revision(expected_revision)
            new_status = self.filter_service.resolve_status_after_manual_edit(
                item.get_status(),
                new_dst,
            )
            saved_item = Item.from_dict(item.to_dict())
            saved_item.set_dst(new_dst)
            saved_item.set_status(new_status)
            saved_item_id = self.data_manager.save_item(saved_item)
            item.set_dst(new_dst)
            item.set_status(new_status)
            self._bump_revision(current_revision)
            self.sync_project_translation_state()
            saved_item.set_id(saved_item_id)
            change = self.build_project_item_change(
                [saved_item],
                reason=self.SAVE_ITEM_REASON,
            )
        return change
