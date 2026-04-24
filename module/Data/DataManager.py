from __future__ import annotations

import threading
from contextlib import AbstractContextManager
from typing import Any
from typing import ClassVar
from typing import TYPE_CHECKING

from base.Base import Base
from base.LogManager import LogManager
from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Analysis.AnalysisService import AnalysisService
from module.Data.Core.AssetService import AssetService
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataEnums import TextPreserveMode as DataTextPreserveMode
from module.Data.Core.ItemService import ItemService
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Core.RuleService import RuleService
from module.Data.Project.ExportPathService import ExportPathService
from module.Data.Project.ProjectFileService import ProjectFileService
from module.Data.Project.ProjectLifecycleService import ProjectLifecycleService
from module.Data.Project.ProjectPrefilterService import ProjectPrefilterService
from module.Data.Project.ProjectRuntimeRevisionService import (
    ProjectRuntimeRevisionService,
)
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Localizer.Localizer import Localizer
from module.Utils.ZstdTool import ZstdTool

if TYPE_CHECKING:
    from module.Data.Core.DataTypes import ProjectItemChange
    from module.Data.Core.DataTypes import ProjectPrefilterRequest


class DataManager(Base):
    """全局数据中间件。"""

    instance: ClassVar["DataManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    RuleType = LGDatabase.RuleType
    LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE: ClassVar[str] = (
        LGDatabase.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE
    )
    LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE: ClassVar[str] = (
        LGDatabase.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE
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
        self.prefilter_service = ProjectPrefilterService(
            self.session,
            self.item_service,
            self.batch_service,
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
        self.runtime_revision_service = ProjectRuntimeRevisionService(self.meta_service)

        self.subscribe(Base.Event.TRANSLATION_TASK, self.on_translation_activity)

    @classmethod
    def get(cls) -> "DataManager":
        if cls.instance is None:
            with cls.lock:
                if cls.instance is None:
                    cls.instance = cls()
        return cls.instance

    def load_project(self, lg_path: str) -> None:
        """加载工程并发出工程已加载事件。"""

        if self.is_loaded():
            self.unload_project()
        self.lifecycle_service.load_project(lg_path)
        self.handle_project_loaded_post_actions()
        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload_project(self) -> None:
        """卸载工程并发出工程已卸载事件。"""

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
        """打开长连接。"""

        with self.state_lock:
            db = self.session.db
            if db is not None:
                db.open()

    def close_db(self) -> None:
        """关闭长连接。"""

        with self.state_lock:
            db = self.session.db
            if db is not None:
                db.close()

    def on_translation_activity(self, event: Base.Event, data: dict) -> None:
        """翻译活动结束后清理条目缓存。"""

        del event
        del data
        self.item_service.clear_item_cache()

    def handle_project_loaded_post_actions(self) -> None:
        """在工程真正对外可见前完成加载后补处理与语言镜像同步。"""

        self.sync_project_language_meta()
        if self.schedule_prefilter_if_needed(reason="project_loaded"):
            return
        self.refresh_analysis_progress_snapshot_cache()

    def sync_project_language_meta(self) -> None:
        """把当前运行时语言镜像回已加载工程，避免项目摘要长期滞后。"""

        if not self.is_loaded():
            return

        config = Config().load()
        self.set_meta("source_language", str(config.source_language))
        self.set_meta("target_language", str(config.target_language))

    def schedule_prefilter_if_needed(self, *, reason: str) -> bool:
        """按当前配置判断是否需要补跑预过滤。"""

        config = Config().load()
        if not self.is_prefilter_needed(config):
            return False

        self.schedule_project_prefilter(config, reason=reason)
        return True

    def is_prefilter_needed(self, config: Config) -> bool:
        """判断当前工程是否需要重跑预过滤。"""

        return self.prefilter_service.is_prefilter_needed(
            self.get_meta("prefilter_config", {}),
            config,
        )

    def schedule_project_prefilter(
        self,
        config: Config,
        *,
        reason: str,
    ) -> bool:
        """后台触发预过滤。"""

        from module.Engine.Engine import Engine

        lg_path = self.get_lg_path()
        if not lg_path or not self.is_loaded():
            return False
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            return False

        _request, start_worker = self.prefilter_service.enqueue_request(
            config,
            reason=reason,
            lg_path=lg_path,
        )
        if not start_worker:
            return True

        threading.Thread(
            target=self.project_prefilter_worker,
            daemon=True,
        ).start()
        return True

    def project_prefilter_worker(self) -> None:
        """预过滤工作线程入口。"""

        last_request: ProjectPrefilterRequest | None = None
        last_result: ProjectPrefilterResult | None = None
        updated = False

        try:
            while True:
                request = self.prefilter_service.pop_pending_request()
                if request is None:
                    if updated and last_request is not None and last_result is not None:
                        self.refresh_analysis_progress_snapshot_cache()
                        self.log_prefilter_result(last_request, last_result)

                    self.prefilter_service.finish_worker()
                    return

                last_request = request
                result = self.apply_project_prefilter_once(request)
                if result is not None:
                    updated = True
                    last_result = result
        except Exception as e:
            reason = last_request.reason if last_request else "unknown"
            lg_path = last_request.lg_path if last_request else ""
            LogManager.get().error(
                f"Project prefilter failed: reason={reason} lg_path={lg_path}",
                e,
            )
            self.prefilter_service.finish_worker()

    def log_prefilter_result(
        self,
        request: ProjectPrefilterRequest,
        result: ProjectPrefilterResult,
    ) -> None:
        """输出预过滤统计日志。"""

        logger = LogManager.get()
        logger.info(
            Localizer.get().engine_task_rule_filter.replace(
                "{COUNT}",
                str(result.stats.rule_skipped),
            )
        )
        logger.info(
            Localizer.get().engine_task_language_filter.replace(
                "{COUNT}",
                str(result.stats.language_skipped),
            )
        )
        if request.mtool_optimizer_enable:
            logger.info(
                Localizer.get().translation_mtool_optimizer_pre_log.replace(
                    "{COUNT}",
                    str(result.stats.mtool_skipped),
                )
            )
        logger.print("")

    def apply_project_prefilter_once(
        self,
        request: ProjectPrefilterRequest,
    ) -> ProjectPrefilterResult | None:
        """执行一次预过滤并写回数据库。"""

        if not self.is_loaded():
            return None
        lg_path = self.get_lg_path()
        if not lg_path or lg_path != request.lg_path:
            return None

        items = self.get_all_items()
        result = self.prefilter_service.apply_once(
            request,
            items=items,
        )
        if result is not None:
            self.bump_project_runtime_section_revisions(("items", "analysis"))
        return result

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.meta_service.get_meta(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.meta_service.set_meta(key, value)

    def assert_project_runtime_section_revision(
        self,
        section: str,
        expected_revision: int,
    ) -> int:
        return self.runtime_revision_service.assert_revision(
            section,
            expected_revision,
        )

    def bump_project_runtime_section_revision(self, section: str) -> int:
        return self.runtime_revision_service.bump_revision(section)

    def bump_project_runtime_section_revisions(
        self,
        sections: tuple[str, ...] | list[str],
    ) -> dict[str, int]:
        return self.runtime_revision_service.bump_revisions(sections)

    def get_project_status(self) -> Base.ProjectStatus:
        raw = self.get_meta("project_status", Base.ProjectStatus.NONE.value)
        if isinstance(raw, Base.ProjectStatus):
            return raw
        if isinstance(raw, str):
            try:
                return Base.ProjectStatus(raw)
            except ValueError:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE

    def set_project_status(self, status: Base.ProjectStatus) -> None:
        self.set_meta("project_status", status.value)

    def get_translation_extras(self) -> dict[str, Any]:
        extras = self.get_meta("translation_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_translation_extras(self, extras: dict[str, Any]) -> None:
        self.set_meta("translation_extras", extras)

    @staticmethod
    def is_skipped_analysis_status(status: Base.ProjectStatus) -> bool:
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

    def preview_analysis_reset_failed(self) -> dict[str, Any]:
        return self.analysis_service.preview_failed_reset_status_summary()

    def apply_analysis_reset_all_payload(
        self,
        *,
        analysis_extras: dict[str, Any],
        expected_section_revisions: dict[str, int] | None,
    ) -> dict[str, Any]:
        with self.state_lock:
            if not self.is_loaded():
                raise RuntimeError("工程未加载")

            self.assert_expected_runtime_revisions(
                expected_section_revisions,
                ("analysis",),
            )
            normalized_snapshot = (
                self.analysis_service.clear_analysis_progress_with_snapshot(
                    analysis_extras
                )
            )
            self.bump_project_runtime_section_revision("analysis")
            return normalized_snapshot

    def apply_analysis_reset_failed_payload(
        self,
        *,
        analysis_extras: dict[str, Any],
        expected_section_revisions: dict[str, int] | None,
    ) -> tuple[int, dict[str, Any]]:
        with self.state_lock:
            if not self.is_loaded():
                raise RuntimeError("工程未加载")

            self.assert_expected_runtime_revisions(
                expected_section_revisions,
                ("analysis",),
            )
            deleted, normalized_snapshot = (
                self.analysis_service.reset_failed_analysis_with_snapshot(
                    analysis_extras
                )
            )
            self.bump_project_runtime_section_revision("analysis")
            return deleted, normalized_snapshot

    def get_analysis_status_summary(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_status_summary()

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_progress_snapshot()

    def get_task_progress_snapshot(self, task_type: str) -> dict[str, Any]:
        """任务 API 统一从这里读取进度快照，避免调用方自己分支。"""

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

    def preview_translation_reset_all(
        self,
        config: Config,
    ) -> list[dict[str, Any]]:
        if not self.is_loaded():
            raise RuntimeError("工程未加载")

        items = self.translation_item_service.get_items_for_translation(
            config,
            Base.TranslationMode.RESET,
        )
        preview_ids = self.item_service.preview_replace_all_item_ids(items)

        preview_payloads: list[dict[str, Any]] = []
        for item, item_id in zip(items, preview_ids):
            payload = item.to_dict()
            payload["id"] = int(item_id)
            preview_payloads.append(payload)

        return preview_payloads

    def apply_translation_reset_all_payload(
        self,
        *,
        item_payloads: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None,
    ) -> list[dict[str, Any]]:
        with self.state_lock:
            if not self.is_loaded():
                raise RuntimeError("工程未加载")

            self.assert_expected_runtime_revisions(
                expected_section_revisions,
                ("items", "analysis"),
            )
            normalized_items = self.normalize_full_item_payloads(item_payloads)
            self.persist_replaced_items_meta_and_clear_analysis_state(
                items=normalized_items,
                meta=self.build_analysis_reset_meta(
                    translation_extras=translation_extras,
                    project_status=project_status,
                    prefilter_config=prefilter_config,
                ),
            )
            self.bump_project_runtime_section_revisions(("items", "analysis"))
            return normalized_items

    def apply_translation_reset_failed_payload(
        self,
        *,
        item_payloads: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        expected_section_revisions: dict[str, int] | None,
    ) -> list[dict[str, Any]]:
        with self.state_lock:
            if not self.is_loaded():
                raise RuntimeError("工程未加载")

            self.assert_expected_runtime_revisions(
                expected_section_revisions,
                ("items",),
            )
            merged_items = self.merge_partial_item_payloads(item_payloads)
            self.update_batch(
                items=merged_items or None,
                meta={
                    "translation_extras": dict(translation_extras),
                    "project_status": str(project_status),
                },
            )
            self.bump_project_runtime_section_revision("items")
            return merged_items

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        self.quality_rule_service.set_rules_cached(rule_type, data, save)

    def normalize_quality_rules_for_write(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return self.quality_rule_service.normalize_quality_rules_for_write(
            rule_type,
            data,
        )

    def get_rule_text_cached(self, rule_type: LGDatabase.RuleType) -> str:
        return self.quality_rule_service.get_rule_text_cached(rule_type)

    def set_rule_text_cached(self, rule_type: LGDatabase.RuleType, text: str) -> None:
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
    def normalize_rule_statistics_status(value: Any) -> Base.ProjectStatus:
        return QualityRuleService.normalize_rule_statistics_status(value)

    def collect_rule_statistics_texts(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        return self.quality_rule_service.collect_rule_statistics_texts()

    def clear_item_cache(self) -> None:
        self.item_service.clear_item_cache()

    def get_all_items(self) -> list[Item]:
        return self.item_service.get_all_items()

    def get_all_item_dicts(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.item_service.get_all_item_dicts()]

    def get_items_all(self) -> list[Item]:
        """提供项目运行态使用的全量条目对象视图。"""

        return [Item.from_dict(item_dict) for item_dict in self.get_all_item_dicts()]

    def save_item(self, item: Item) -> int:
        return self.item_service.save_item(item)

    def replace_all_items(self, items: list[Item]) -> list[int]:
        return self.item_service.replace_all_items(items)

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[LGDatabase.RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.batch_service.update_batch(items=items, rules=rules, meta=meta)

    def build_project_item_change(
        self,
        values: list[Item] | list[dict[str, Any]],
        *,
        reason: str,
    ) -> "ProjectItemChange":
        """把条目对象或条目字典整理成稳定影响范围。"""

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
                merged_item["status"] = str(payload.get("status", "") or "")
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
                    "status": str(payload.get("status", "NONE") or "NONE"),
                    "retry_count": int(payload.get("retry_count", 0) or 0),
                }
            )

        return normalized_items

    def build_analysis_reset_meta(
        self,
        *,
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
    ) -> dict[str, Any]:
        """统一收口会重建分析事实的同步 mutation meta 镜像。"""

        return {
            "translation_extras": dict(translation_extras),
            "project_status": str(project_status),
            "prefilter_config": dict(prefilter_config),
            "analysis_extras": {},
            "analysis_candidate_count": 0,
        }

    def persist_replaced_items_meta_and_clear_analysis_state(
        self,
        *,
        items: list[dict[str, Any]],
        meta: dict[str, Any],
    ) -> None:
        """在同一事务里整段替换 items，并同步 meta 与分析持久化事实。"""

        with self.state_lock:
            db = self.session.db
            if db is None:
                raise RuntimeError("工程未加载")

            with db.connection() as conn:
                db.set_items(items, conn=conn)
                self.write_meta_in_connection(conn=conn, meta=meta)
                db.delete_analysis_item_checkpoints(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                conn.commit()

            self.replace_session_item_cache(items)
            self.sync_session_meta_cache(meta)

    def persist_items_meta_and_clear_analysis_state(
        self,
        *,
        items: list[dict[str, Any]] | None,
        meta: dict[str, Any],
        deleted_rel_paths: list[str] | None = None,
    ) -> None:
        """在同一事务里写 items/meta，并同时清空分析持久化事实。"""

        with self.state_lock:
            db = self.session.db
            if db is None:
                raise RuntimeError("工程未加载")

            item_params = db.prepare_item_update_params(items)
            meta_params = db.prepare_meta_upsert_params(meta)

            with db.connection() as conn:
                for rel_path in deleted_rel_paths or []:
                    db.delete_items_by_file_path(rel_path, conn=conn)
                    db.delete_asset(rel_path, conn=conn)

                if item_params:
                    conn.executemany(
                        "UPDATE items SET data = ? WHERE id = ?",
                        item_params,
                    )

                if meta_params:
                    conn.executemany(
                        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                        meta_params,
                    )

                db.delete_analysis_item_checkpoints(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                conn.commit()

            self.batch_service.sync_session_caches(
                items=items,
                rules=None,
                meta=meta,
            )

    def apply_prefilter_payload(
        self,
        *,
        item_payloads: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None,
    ) -> None:
        with self.state_lock:
            if not self.is_loaded():
                raise RuntimeError("工程未加载")

            if expected_section_revisions is not None:
                if "items" in expected_section_revisions:
                    self.assert_project_runtime_section_revision(
                        "items",
                        int(expected_section_revisions["items"]),
                    )
                if "analysis" in expected_section_revisions:
                    self.assert_project_runtime_section_revision(
                        "analysis",
                        int(expected_section_revisions["analysis"]),
                    )

            merged_items = self.merge_partial_item_payloads(item_payloads)
            self.persist_items_meta_and_clear_analysis_state(
                items=merged_items or None,
                meta=self.build_analysis_reset_meta(
                    translation_extras=translation_extras,
                    project_status=project_status,
                    prefilter_config=prefilter_config,
                ),
            )
            self.bump_project_runtime_section_revisions(("items", "analysis"))

    def sync_project_settings_meta(
        self,
        *,
        source_language: str,
        target_language: str,
    ) -> None:
        if not self.is_loaded():
            return

        self.update_batch(
            meta={
                "source_language": str(source_language),
                "target_language": str(target_language),
            }
        )

    def apply_translation_batch_update(
        self,
        finalized_items: list[dict[str, Any]],
        extras_snapshot: dict[str, Any],
    ) -> "ProjectItemChange":
        """翻译提交统一走数据层显式入口，保证落库和刷新顺序一致。"""

        self.update_batch(
            items=finalized_items,
            meta={
                "translation_extras": extras_snapshot,
                "project_status": Base.ProjectStatus.PROCESSING,
            },
        )
        change = self.build_project_item_change(
            finalized_items,
            reason="translation_batch_update",
        )
        if change.item_ids:
            from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService

            runtime_service = ProjectRuntimeService(self)
            self.emit_project_runtime_patch(
                reason=change.reason,
                updated_sections=("items",),
                patch=[
                    {
                        "op": "merge_items",
                        "items": runtime_service.build_item_records(
                            list(change.item_ids)
                        ),
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
        """直接推送项目运行态补丁，避免前端再整段重拉 bootstrap。"""

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

        runtime_service = None
        if section_revisions is None or project_revision is None:
            from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService

            runtime_service = ProjectRuntimeService(self)

        if section_revisions:
            normalized_section_revisions = {
                str(section): int(revision)
                for section, revision in section_revisions.items()
                if section in normalized_sections
            }
            if normalized_section_revisions:
                payload["sectionRevisions"] = normalized_section_revisions
        elif runtime_service is not None:
            payload["sectionRevisions"] = {
                section: int(runtime_service.get_section_revision(section) or 0)
                for section in normalized_sections
            }

        if project_revision is not None:
            payload["projectRevision"] = int(project_revision)
        elif runtime_service is not None:
            payload["projectRevision"] = max(
                runtime_service.build_section_revisions().values(),
                default=0,
            )

        self.emit(Base.Event.PROJECT_RUNTIME_PATCH, payload)

    def try_begin_guarded_file_operation(self) -> None:
        """在数据层兜底拦住忙碌态文件操作。"""

        from module.Engine.Engine import Engine

        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            raise ValueError(Localizer.get().task_running)
        if not self.try_begin_file_operation():
            raise ValueError(Localizer.get().task_running)

    def require_loaded_lg_path(self) -> str:
        """读取当前工程路径；未加载工程时统一抛出同一条错误。"""

        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return lg_path

    def assert_expected_runtime_revisions(
        self,
        expected_section_revisions: dict[str, int] | None,
        sections: tuple[str, ...] | list[str],
    ) -> None:
        if expected_section_revisions is None:
            return

        for section in sections:
            if section not in expected_section_revisions:
                continue
            self.assert_project_runtime_section_revision(
                str(section),
                int(expected_section_revisions[section]),
            )

    def persist_reordered_files(
        self,
        ordered_rel_paths: list[str],
        *,
        expected_section_revisions: dict[str, int] | None = None,
    ) -> None:
        """按前端确认后的完整顺序持久化文件顺序。"""

        from module.Engine.Engine import Engine

        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            raise ValueError(Localizer.get().task_running)
        if not self.try_begin_file_operation():
            raise ValueError(Localizer.get().task_running)

        try:
            with self.state_lock:
                if not self.is_loaded():
                    raise RuntimeError("工程未加载")

                self.assert_expected_runtime_revisions(
                    expected_section_revisions,
                    ("files",),
                )
                self.project_file_service.reorder_files(ordered_rel_paths)
                self.bump_project_runtime_section_revision("files")
        finally:
            self.finish_file_operation()

    def persist_reset_file(
        self,
        rel_path: str,
        *,
        item_payloads: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None = None,
    ) -> None:
        """持久化前端已确认的文件重置结果。"""

        self.try_begin_guarded_file_operation()
        try:
            with self.state_lock:
                if not self.is_loaded():
                    raise RuntimeError("工程未加载")

                self.assert_expected_runtime_revisions(
                    expected_section_revisions,
                    ("items", "analysis"),
                )
                if self.session.db is None:
                    raise RuntimeError("工程未加载")
                if not self.session.db.asset_path_exists(rel_path):
                    raise ValueError(Localizer.get().workbench_msg_file_not_found)

                merged_items = self.merge_partial_item_payloads(item_payloads)
                self.persist_items_meta_and_clear_analysis_state(
                    items=merged_items or None,
                    meta=self.build_analysis_reset_meta(
                        translation_extras=translation_extras,
                        project_status=project_status,
                        prefilter_config=prefilter_config,
                    ),
                )
                self.bump_project_runtime_section_revisions(("items", "analysis"))

            self.item_service.clear_item_cache()
        finally:
            self.finish_file_operation()

    def persist_delete_files(
        self,
        rel_paths: list[str],
        *,
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None = None,
    ) -> None:
        """持久化前端已确认的文件删除结果。"""

        normalized_rel_paths = self.project_file_service.normalize_batch_rel_paths(
            rel_paths
        )
        self.try_begin_guarded_file_operation()
        try:
            with self.state_lock:
                if not self.is_loaded():
                    raise RuntimeError("工程未加载")

                self.assert_expected_runtime_revisions(
                    expected_section_revisions,
                    ("files", "items", "analysis"),
                )
                self.persist_items_meta_and_clear_analysis_state(
                    items=None,
                    meta=self.build_analysis_reset_meta(
                        translation_extras=translation_extras,
                        project_status=project_status,
                        prefilter_config=prefilter_config,
                    ),
                    deleted_rel_paths=normalized_rel_paths,
                )
                self.bump_project_runtime_section_revisions(
                    ("files", "items", "analysis")
                )

                for rel_path in normalized_rel_paths:
                    self.session.asset_decompress_cache.pop(rel_path, None)

            self.item_service.clear_item_cache()
        finally:
            self.finish_file_operation()

    def sync_session_meta_cache(self, meta: dict[str, Any]) -> None:
        for key, value in meta.items():
            self.session.meta_cache[str(key)] = value

    def replace_session_item_cache(self, items: list[dict[str, Any]]) -> None:
        self.session.item_cache = [dict(item) for item in items]
        self.session.item_cache_index = {
            int(item["id"]): index
            for index, item in enumerate(self.session.item_cache)
            if isinstance(item.get("id"), int)
        }

    def normalize_workbench_parsed_items(
        self,
        parsed_items: list[dict[str, Any]],
        *,
        target_rel_path: str,
    ) -> list[dict[str, Any]]:
        normalized_items: list[dict[str, Any]] = []
        for payload in parsed_items:
            item_id = payload.get("id")
            normalized_item: dict[str, Any] = {
                "src": str(payload.get("src", "") or ""),
                "dst": str(payload.get("dst", "") or ""),
                "name_src": payload.get("name_src"),
                "name_dst": payload.get("name_dst"),
                "extra_field": payload.get("extra_field", ""),
                "tag": str(payload.get("tag", "") or ""),
                "row": int(payload.get("row", 0) or 0),
                "file_type": str(payload.get("file_type", "NONE") or "NONE"),
                "file_path": target_rel_path,
                "text_type": str(payload.get("text_type", "NONE") or "NONE"),
                "status": str(payload.get("status", "NONE") or "NONE"),
                "retry_count": int(payload.get("retry_count", 0) or 0),
            }
            if item_id is not None:
                normalized_item["id"] = int(item_id)
            normalized_items.append(normalized_item)
        return normalized_items

    def write_meta_in_connection(
        self,
        *,
        conn: Any,
        meta: dict[str, Any],
    ) -> None:
        if self.session.db is None:
            raise RuntimeError("工程未加载")

        meta_params = self.session.db.prepare_meta_upsert_params(meta)
        if meta_params:
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                meta_params,
            )

    def persist_add_file_payload(
        self,
        source_path: str,
        target_rel_path: str,
        *,
        file_record: dict[str, Any],
        parsed_items: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None = None,
    ) -> None:
        """持久化前端已确认的新增文件结果。"""

        self.try_begin_guarded_file_operation()
        try:
            with self.state_lock:
                if not self.is_loaded():
                    raise RuntimeError("工程未加载")

                self.assert_expected_runtime_revisions(
                    expected_section_revisions,
                    ("files", "items", "analysis"),
                )
                db = self.session.db
                if db is None:
                    raise RuntimeError("工程未加载")
                if db.asset_path_exists(target_rel_path):
                    raise ValueError(Localizer.get().workbench_msg_file_exists)

                record_rel_path = str(file_record.get("rel_path", "") or "")
                if record_rel_path not in {"", target_rel_path}:
                    raise ValueError("工作台文件记录无效")

                with open(source_path, "rb") as f:
                    original_data = f.read()

                next_items = [dict(item) for item in self.get_all_item_dicts()]
                next_items.extend(
                    self.normalize_workbench_parsed_items(
                        parsed_items,
                        target_rel_path=target_rel_path,
                    )
                )
                meta = self.build_analysis_reset_meta(
                    translation_extras=translation_extras,
                    project_status=project_status,
                    prefilter_config=prefilter_config,
                )
                sort_index = int(
                    file_record.get(
                        "sort_index",
                        len(self.get_all_asset_records()),
                    )
                    or 0
                )

                compressed_data = ZstdTool.compress(original_data)
                with db.connection() as conn:
                    db.add_asset(
                        target_rel_path,
                        compressed_data,
                        len(original_data),
                        sort_order=sort_index,
                        conn=conn,
                    )
                    db.set_items(next_items, conn=conn)
                    self.write_meta_in_connection(conn=conn, meta=meta)
                    db.delete_analysis_item_checkpoints(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

                self.replace_session_item_cache(next_items)
                self.sync_session_meta_cache(meta)
                self.session.asset_decompress_cache.pop(target_rel_path, None)
                self.bump_project_runtime_section_revisions(
                    ("files", "items", "analysis")
                )
        finally:
            self.finish_file_operation()

    def persist_replace_file_payload(
        self,
        source_path: str,
        rel_path: str,
        target_rel_path: str,
        *,
        file_record: dict[str, Any],
        parsed_items: list[dict[str, Any]],
        translation_extras: dict[str, Any],
        project_status: str,
        prefilter_config: dict[str, Any],
        expected_section_revisions: dict[str, int] | None = None,
    ) -> None:
        """持久化前端已确认的替换文件结果。"""

        self.try_begin_guarded_file_operation()
        try:
            with self.state_lock:
                if not self.is_loaded():
                    raise RuntimeError("工程未加载")

                self.assert_expected_runtime_revisions(
                    expected_section_revisions,
                    ("files", "items", "analysis"),
                )
                db = self.session.db
                if db is None:
                    raise RuntimeError("工程未加载")
                if not db.asset_path_exists(rel_path):
                    raise ValueError(Localizer.get().workbench_msg_file_not_found)

                record_rel_path = str(file_record.get("rel_path", "") or "")
                if record_rel_path not in {"", target_rel_path}:
                    raise ValueError("工作台文件记录无效")

                if target_rel_path.casefold() != rel_path.casefold():
                    self.project_file_service.ensure_replace_target_path_not_conflict(
                        db.get_all_asset_paths(),
                        rel_path,
                        target_rel_path,
                    )

                with open(source_path, "rb") as f:
                    original_data = f.read()

                next_items = [
                    dict(item)
                    for item in self.get_all_item_dicts()
                    if str(item.get("file_path", "")) != rel_path
                ]
                next_items.extend(
                    self.normalize_workbench_parsed_items(
                        parsed_items,
                        target_rel_path=target_rel_path,
                    )
                )
                meta = self.build_analysis_reset_meta(
                    translation_extras=translation_extras,
                    project_status=project_status,
                    prefilter_config=prefilter_config,
                )

                compressed_data = ZstdTool.compress(original_data)
                with db.connection() as conn:
                    db.update_asset(
                        rel_path,
                        compressed_data,
                        len(original_data),
                        conn=conn,
                    )
                    if target_rel_path != rel_path:
                        db.update_asset_path(
                            rel_path,
                            target_rel_path,
                            conn=conn,
                        )
                    db.set_items(next_items, conn=conn)
                    self.write_meta_in_connection(conn=conn, meta=meta)
                    db.delete_analysis_item_checkpoints(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

                self.replace_session_item_cache(next_items)
                self.sync_session_meta_cache(meta)
                self.session.asset_decompress_cache.pop(rel_path, None)
                self.session.asset_decompress_cache.pop(target_rel_path, None)
                self.bump_project_runtime_section_revisions(
                    ("files", "items", "analysis")
                )
        finally:
            self.finish_file_operation()

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

    def collect_source_files(self, source_path: str) -> list[str]:
        return self.project_service.collect_source_files(source_path)

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

    def get_project_preview(self, lg_path: str) -> dict[str, Any]:
        return self.project_service.get_project_preview(lg_path)
