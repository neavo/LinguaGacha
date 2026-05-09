from __future__ import annotations

import threading
from contextlib import AbstractContextManager
from typing import Any
from typing import ClassVar

from base.Base import Base
from base.LogManager import LogManager
from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Analysis.AnalysisService import AnalysisService
from module.Data.Core.AssetService import AssetService
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.Core.DataEnums import TextPreserveMode as DataTextPreserveMode
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Core.RuleService import RuleService
from module.Data.Project.ExportPathService import ExportPathService
from module.Data.Project.ProjectFileService import ProjectFileService
from module.Data.Project.ProjectLifecycleService import ProjectLifecycleService
from module.Data.Database.DatabaseContracts import DatabaseLegacyRuleType
from module.Data.Database.DatabaseContracts import DatabaseRuleType
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.Localizer.Localizer import Localizer
from module.Migration.ItemStatusMigrationService import ItemStatusMigrationService


class DataManager(Base):
    # 全局数据中间件。

    instance: ClassVar["DataManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    RuleType = DatabaseRuleType
    LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE: ClassVar[str] = (
        DatabaseLegacyRuleType.TRANSLATION_PROMPT_ZH
    )
    LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE: ClassVar[str] = (
        DatabaseLegacyRuleType.TRANSLATION_PROMPT_EN
    )
    LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY: ClassVar[str] = (
        "translation_prompt_legacy_migrated"
    )
    TextPreserveMode = DataTextPreserveMode

    def __init__(self) -> None:
        super().__init__()

        self.session = ProjectSession()
        self.state_lock = self.session.state_lock

        self.meta_service = MetaService(self.session)
        self.rule_service = RuleService(self.session)
        self.item_service = ItemService(self.session)
        self.asset_service = AssetService(self.session)
        self.batch_service = BatchService(self.session)
        from module.Data.Project.ProjectService import ProjectService
        from module.Data.Translation.TranslationItemService import (
            TranslationItemService,
        )

        self.translation_item_service = TranslationItemService(self.session)
        self.project_service = ProjectService()
        self.export_path_service = ExportPathService()

        self.lifecycle_service = ProjectLifecycleService(
            self.session,
            self.meta_service,
            self.item_service,
            self.asset_service,
            __class__.RuleType,
            __class__.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE,
            __class__.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE,
            __class__.LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
        )
        self.quality_rule_service = QualityRuleService(
            self.session,
            self.rule_service,
            self.meta_service,
            self.item_service,
        )
        self.analysis_service = AnalysisService(
            self.session,
            self.batch_service,
            self.meta_service,
            self.item_service,
        )
        self.project_file_service = ProjectFileService(
            self.session,
            self.project_service.SUPPORTED_EXTENSIONS,
        )
        self.subscribe(Base.Event.TRANSLATION_TASK, self.on_translation_activity)

    @classmethod
    def get(cls) -> "DataManager":
        if cls.instance is None:
            with cls.lock:
                if cls.instance is None:
                    cls.instance = cls()
        return cls.instance

    def load_project(self, lg_path: str) -> None:
        # 加载工程并发出工程已加载事件。

        if self.is_loaded():
            self.unload_project()
        self.lifecycle_service.load_project(lg_path)
        self.handle_project_loaded_post_actions()
        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload_project(self) -> None:
        # 卸载工程并发出工程已卸载事件。

        old_path = self.lifecycle_service.unload_project()
        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def is_loaded(self) -> bool:
        with self.state_lock:
            return self.session.db is not None and self.session.lg_path is not None

    def get_lg_path(self) -> str | None:
        with self.state_lock:
            return self.session.lg_path

    def open_db(self) -> None:
        # 打开长连接。

        with self.state_lock:
            db = self.session.db
            if db is not None:
                db.open()

    def close_db(self) -> None:
        # 关闭长连接。

        with self.state_lock:
            db = self.session.db
            if db is not None:
                db.close()

    def on_translation_activity(self, event: Base.Event, data: dict) -> None:
        # 翻译活动结束后清理条目缓存。

        del event
        del data
        self.item_service.clear_item_cache()

    def handle_project_loaded_post_actions(self) -> None:
        # 在工程真正对外可见前刷新加载后派生缓存。

        self.refresh_analysis_progress_snapshot_cache()

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.meta_service.get_meta(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.meta_service.set_meta(key, value)

    def assert_task_runtime_section_revision(
        self,
        section: str,
        expected_revision: int,
    ) -> int:
        current_revision = int(
            self.get_meta(f"project_runtime_revision.{section}", 0) or 0
        )
        if current_revision != expected_revision:
            raise RuntimeError(
                f"运行态 revision 冲突：section={section} 当前={current_revision} 期望={expected_revision}"
            )
        return current_revision

    def bump_task_runtime_section_revisions(
        self,
        sections: tuple[str, ...] | list[str],
    ) -> dict[str, int]:
        with self.state_lock:
            db = self.session.db
        if db is None:
            return {}
        return db.bump_runtime_section_revisions([str(section) for section in sections])

    @staticmethod
    def normalize_item_status_value(status: Any) -> str:
        return ItemStatusMigrationService.normalize_item_status_value(status)

    def get_translation_extras(self) -> dict[str, Any]:
        extras = self.get_meta("translation_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_translation_extras(self, extras: dict[str, Any]) -> None:
        self.set_meta("translation_extras", extras)

    @staticmethod
    def is_skipped_analysis_status(status: Base.ItemStatus) -> bool:
        return AnalysisService.is_skipped_analysis_status(status)

    def get_analysis_extras(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_extras()

    def normalize_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        return self.analysis_service.normalize_analysis_progress_snapshot(snapshot)

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        return self.analysis_service.get_analysis_item_checkpoints()

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        return self.analysis_service.upsert_analysis_item_checkpoints(checkpoints)

    def get_analysis_candidate_aggregate(self) -> dict[str, dict[str, Any]]:
        return self.analysis_service.get_analysis_candidate_aggregate()

    def get_analysis_candidate_count(self) -> int:
        return self.analysis_service.get_analysis_candidate_count()

    def upsert_analysis_candidate_aggregate(
        self,
        aggregates: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        return self.analysis_service.upsert_analysis_candidate_aggregate(aggregates)

    def merge_analysis_candidate_aggregate(
        self,
        incoming_pool: dict[str, dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        return self.analysis_service.merge_analysis_candidate_aggregate(incoming_pool)

    def commit_analysis_task_result(
        self,
        *,
        checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        return self.analysis_service.commit_analysis_task_result(
            checkpoints=checkpoints,
            glossary_entries=glossary_entries,
            progress_snapshot=progress_snapshot,
        )

    def commit_analysis_task_batch(
        self,
        *,
        success_checkpoints: list[dict[str, Any]] | None = None,
        error_checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        return self.analysis_service.commit_analysis_task_batch(
            success_checkpoints=success_checkpoints,
            error_checkpoints=error_checkpoints,
            glossary_entries=glossary_entries,
            progress_snapshot=progress_snapshot,
        )

    def clear_analysis_progress(self) -> None:
        self.analysis_service.clear_analysis_progress()

    def clear_analysis_candidates_and_progress(self) -> None:
        self.analysis_service.clear_analysis_candidates_and_progress()

    def reset_failed_analysis_checkpoints(self) -> int:
        return self.analysis_service.reset_failed_analysis_checkpoints()

    def get_analysis_status_summary(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_status_summary()

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_progress_snapshot()

    def get_task_progress_snapshot(self, task_type: str) -> dict[str, Any]:
        # 任务 API 统一从这里读取进度快照，避免调用方自己分支。

        if task_type == "analysis":
            return self.get_analysis_progress_snapshot()
        return self.get_translation_extras()

    def refresh_analysis_progress_snapshot_cache(self) -> dict[str, Any]:
        return self.analysis_service.refresh_analysis_progress_snapshot_cache()

    def update_analysis_progress_snapshot(
        self,
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        return self.analysis_service.update_analysis_progress_snapshot(snapshot)

    def get_pending_analysis_items(self) -> list[Item]:
        return self.analysis_service.get_pending_analysis_items()

    def update_analysis_task_error(
        self,
        checkpoints: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None = None,
    ) -> dict[int, dict[str, Any]]:
        return self.analysis_service.update_analysis_task_error(
            checkpoints,
            progress_snapshot=progress_snapshot,
        )

    def get_rules_cached(self, rule_type: DatabaseRuleType) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: DatabaseRuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        self.quality_rule_service.set_rules_cached(rule_type, data, save)

    def normalize_quality_rules_for_write(
        self,
        rule_type: DatabaseRuleType,
        data: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return self.quality_rule_service.normalize_quality_rules_for_write(
            rule_type,
            data,
        )

    def get_rule_text_cached(self, rule_type: DatabaseRuleType) -> str:
        return self.quality_rule_service.get_rule_text_cached(rule_type)

    def set_rule_text_cached(self, rule_type: DatabaseRuleType, text: str) -> None:
        self.quality_rule_service.set_rule_text_cached(rule_type, text)

    def get_glossary(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_glossary()

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        self.quality_rule_service.set_glossary(data, save)

    def merge_glossary_incoming(
        self,
        incoming: list[dict[str, Any]],
        *,
        merge_mode: Any,
        save: bool = False,
    ) -> tuple[list[dict[str, Any]] | None, Any]:
        merged, report = self.quality_rule_service.merge_glossary_incoming(
            incoming,
            merge_mode=merge_mode,
            save=save,
        )
        return merged, report

    def get_glossary_enable(self) -> bool:
        return self.quality_rule_service.get_glossary_enable()

    def set_glossary_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_glossary_enable(enable)

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_text_preserve()

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_text_preserve(data)

    def get_text_preserve_mode(self) -> TextPreserveMode:
        return self.quality_rule_service.get_text_preserve_mode()

    def set_text_preserve_mode(self, mode: TextPreserveMode | str) -> None:
        self.quality_rule_service.set_text_preserve_mode(mode)

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_pre_replacement()

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_pre_replacement(data)

    def get_pre_replacement_enable(self) -> bool:
        return self.quality_rule_service.get_pre_replacement_enable()

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_pre_replacement_enable(enable)

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_post_replacement()

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_post_replacement(data)

    def get_post_replacement_enable(self) -> bool:
        return self.quality_rule_service.get_post_replacement_enable()

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_post_replacement_enable(enable)

    def get_translation_prompt(self) -> str:
        return self.quality_rule_service.get_translation_prompt()

    def set_translation_prompt(self, text: str) -> None:
        self.quality_rule_service.set_translation_prompt(text)

    def get_translation_prompt_enable(self) -> bool:
        return self.quality_rule_service.get_translation_prompt_enable()

    def set_translation_prompt_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_translation_prompt_enable(enable)

    def get_analysis_prompt(self) -> str:
        return self.quality_rule_service.get_analysis_prompt()

    def set_analysis_prompt(self, text: str) -> None:
        self.quality_rule_service.set_analysis_prompt(text)

    def get_analysis_prompt_enable(self) -> bool:
        return self.quality_rule_service.get_analysis_prompt_enable()

    def set_analysis_prompt_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_analysis_prompt_enable(enable)

    @staticmethod
    def normalize_rule_statistics_text(value: Any) -> str:
        return QualityRuleService.normalize_rule_statistics_text(value)

    @staticmethod
    def normalize_rule_statistics_status(value: Any) -> Base.ItemStatus:
        return QualityRuleService.normalize_rule_statistics_status(value)

    def collect_rule_statistics_texts(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        return self.quality_rule_service.collect_rule_statistics_texts()

    def clear_item_cache(self) -> None:
        self.item_service.clear_item_cache()

    def get_all_items(self) -> list[Item]:
        return self.item_service.get_all_items()

    def get_all_item_dicts(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.item_service.get_all_item_dicts()]

    def get_item_dicts_by_ids(self, item_ids: list[int]) -> list[dict[str, Any]]:
        return [
            dict(item) for item in self.item_service.get_item_dicts_by_ids(item_ids)
        ]

    def get_items_all(self) -> list[Item]:
        # 提供项目运行态使用的全量条目对象视图。

        return [Item.from_dict(item_dict) for item_dict in self.get_all_item_dicts()]

    def save_item(self, item: Item) -> int:
        return self.item_service.save_item(item)

    def replace_all_items(self, items: list[Item]) -> list[int]:
        return self.item_service.replace_all_items(items)

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[DatabaseRuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.batch_service.update_batch(items=items, rules=rules, meta=meta)

    def build_project_item_change(
        self,
        values: list[Item] | list[dict[str, Any]],
        *,
        reason: str,
    ) -> "ProjectItemChange":
        # 把条目对象或条目字典整理成稳定影响范围。

        from module.Data.Core.DataTypes import ProjectItemChange

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

    def merge_partial_item_payloads(
        self,
        item_payloads: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        existing_items = {
            int(item_dict["id"]): dict(item_dict)
            for item_dict in self.get_all_item_dicts()
            if isinstance(item_dict.get("id"), int)
        }
        merged_items: list[dict[str, Any]] = []

        for payload in item_payloads:
            raw_item_id = payload.get("id", payload.get("item_id"))
            if not isinstance(raw_item_id, int):
                try:
                    raw_item_id = int(raw_item_id)
                except TypeError:
                    continue
                except ValueError:
                    continue

            existing_item = existing_items.get(raw_item_id)
            if existing_item is None:
                continue

            merged_item = dict(existing_item)
            merged_item["id"] = raw_item_id
            if "file_path" in payload:
                merged_item["file_path"] = str(payload.get("file_path", "") or "")
            if "row" in payload or "row_number" in payload:
                merged_item["row"] = int(
                    payload.get("row", payload.get("row_number", 0)) or 0
                )
            if "src" in payload:
                merged_item["src"] = str(payload.get("src", "") or "")
            if "dst" in payload:
                merged_item["dst"] = str(payload.get("dst", "") or "")
            if "name_dst" in payload:
                merged_item["name_dst"] = payload.get("name_dst")
            if "status" in payload:
                merged_item["status"] = self.normalize_item_status_value(
                    payload.get("status", Base.ItemStatus.NONE.value)
                )
            if "text_type" in payload:
                merged_item["text_type"] = str(payload.get("text_type", "") or "")
            if "retry_count" in payload:
                merged_item["retry_count"] = int(payload.get("retry_count", 0) or 0)
            merged_items.append(merged_item)

        return merged_items

    def normalize_full_item_payloads(
        self,
        item_payloads: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        normalized_items: list[dict[str, Any]] = []

        for payload in item_payloads:
            raw_item_id = payload.get("id")
            if not isinstance(raw_item_id, int):
                try:
                    raw_item_id = int(raw_item_id)
                except TypeError:
                    continue
                except ValueError:
                    continue

            if raw_item_id <= 0:
                continue

            normalized_items.append(
                {
                    "id": raw_item_id,
                    "src": str(payload.get("src", "") or ""),
                    "dst": str(payload.get("dst", "") or ""),
                    "name_src": payload.get("name_src"),
                    "name_dst": payload.get("name_dst"),
                    "extra_field": payload.get("extra_field", ""),
                    "tag": str(payload.get("tag", "") or ""),
                    "row": int(payload.get("row", payload.get("row_number", 0)) or 0),
                    "file_type": str(payload.get("file_type", "NONE") or "NONE"),
                    "file_path": str(payload.get("file_path", "") or ""),
                    "text_type": str(payload.get("text_type", "NONE") or "NONE"),
                    "status": self.normalize_item_status_value(
                        payload.get("status", Base.ItemStatus.NONE.value)
                    ),
                    "retry_count": int(payload.get("retry_count", 0) or 0),
                }
            )

        return normalized_items

    def apply_translation_batch_update(
        self,
        finalized_items: list[dict[str, Any]],
        extras_snapshot: dict[str, Any],
    ) -> "ProjectItemChange":
        # 翻译提交统一走数据层显式入口，保证落库和刷新顺序一致。

        self.update_batch(
            items=finalized_items,
            meta={
                "translation_extras": extras_snapshot,
            },
        )
        change = self.build_project_item_change(
            finalized_items,
            reason="translation_batch_update",
        )
        if change.item_ids:
            self.emit_project_runtime_patch(
                reason=change.reason,
                updated_sections=("items",),
                patch=[
                    {
                        "op": "merge_items",
                        "item_ids": list(change.item_ids),
                    }
                ],
            )
        return change

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        return self.translation_item_service.get_items_for_translation(config, mode)

    def get_all_asset_paths(self) -> list[str]:
        return self.asset_service.get_all_asset_paths()

    def get_all_asset_records(self) -> list[dict[str, Any]]:
        return self.asset_service.get_all_asset_records()

    def get_asset(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset(rel_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset_decompressed(rel_path)

    def is_file_op_running(self) -> bool:
        return self.project_file_service.is_file_op_running()

    def try_begin_file_operation(self) -> bool:
        return self.project_file_service.try_begin_file_operation()

    def finish_file_operation(self) -> None:
        self.project_file_service.finish_file_operation()

    def emit_project_runtime_patch(
        self,
        *,
        reason: str,
        updated_sections: tuple[str, ...],
        patch: list[dict[str, Any]],
        section_revisions: dict[str, int] | None = None,
        project_revision: int | None = None,
    ) -> None:
        # 直接推送项目运行态补丁，避免前端再整段重拉 bootstrap。

        normalized_sections = [
            section
            for section in updated_sections
            if section
            in (
                "project",
                "files",
                "items",
                "quality",
                "prompts",
                "analysis",
                "proofreading",
                "task",
            )
        ]
        if not normalized_sections or not patch:
            return

        payload: dict[str, Any] = {
            "source": reason,
            "updatedSections": normalized_sections,
            "patch": patch,
        }

        if section_revisions:
            normalized_section_revisions = {
                str(section): int(revision)
                for section, revision in section_revisions.items()
                if section in normalized_sections
            }
            if normalized_section_revisions:
                payload["sectionRevisions"] = normalized_section_revisions

        if project_revision is not None:
            payload["projectRevision"] = int(project_revision)

        self.emit(Base.Event.PROJECT_RUNTIME_PATCH, payload)

    def require_loaded_lg_path(self) -> str:
        # 读取当前工程路径；未加载工程时统一抛出同一条错误。

        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return lg_path

    def timestamp_suffix_context(self) -> AbstractContextManager[None]:
        return self.export_path_service.timestamp_suffix_context(
            self.require_loaded_lg_path()
        )

    def export_custom_suffix_context(self, suffix: str) -> AbstractContextManager[None]:
        return self.export_path_service.custom_suffix_context(suffix)

    def get_translated_path(self) -> str:
        return self.export_path_service.get_translated_path(
            self.require_loaded_lg_path()
        )

    def get_bilingual_path(self) -> str:
        return self.export_path_service.get_bilingual_path(
            self.require_loaded_lg_path()
        )

    def create_project(
        self,
        source_path: str,
        output_path: str,
        progress_callback: Any | None = None,
    ) -> None:
        old_callback = self.project_service.progress_callback
        self.project_service.set_progress_callback(progress_callback)
        try:
            loaded_presets = self.project_service.create(
                source_path,
                output_path,
                init_rules=self.rule_service.initialize_project_rules,
            )
        finally:
            self.project_service.set_progress_callback(old_callback)

        if loaded_presets:
            LogManager.get().info(
                Localizer.get().quality_default_preset_loaded_message.format(
                    NAME=" | ".join(loaded_presets)
                )
            )

    def build_create_project_preview(
        self,
        source_paths: list[str],
    ) -> dict[str, object]:
        return self.project_service.build_create_preview(source_paths)

    def commit_create_project_preview(
        self,
        *,
        source_paths: list[str],
        output_path: str,
        files: list[dict[str, object]],
        items: list[dict[str, object]],
        project_settings: dict[str, object],
        translation_extras: dict[str, object],
        prefilter_config: dict[str, object],
    ) -> None:
        loaded_presets = self.project_service.commit_create_preview(
            source_paths=source_paths,
            output_path=output_path,
            files=files,
            items=items,
            project_settings=project_settings,
            translation_extras=translation_extras,
            prefilter_config=prefilter_config,
            init_rules=self.rule_service.initialize_project_rules,
        )
        if loaded_presets:
            LogManager.get().info(
                Localizer.get().quality_default_preset_loaded_message.format(
                    NAME=" | ".join(loaded_presets)
                )
            )

    def build_open_project_alignment_preview(self, lg_path: str) -> dict[str, object]:
        return self.project_service.build_open_alignment_preview(
            lg_path,
            Config().load(),
        )
