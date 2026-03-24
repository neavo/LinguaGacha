from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any
from typing import ClassVar
from typing import TYPE_CHECKING

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
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
from module.Data.Project.WorkbenchService import WorkbenchService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.Data.Translation.TranslationResetService import TranslationResetService
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Engine.Analysis.AnalysisFakeNameInjector import AnalysisFakeNameInjector
from module.Localizer.Localizer import Localizer

if TYPE_CHECKING:
    from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
    from module.Data.Core.DataTypes import ProjectFileMutationResult
    from module.Data.Core.DataTypes import ProjectPrefilterRequest
    from module.Data.Core.DataTypes import WorkbenchSnapshot


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
    RULE_META_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "glossary_enable",
            "text_preserve_mode",
            "pre_translation_replacement_enable",
            "post_translation_replacement_enable",
            "translation_prompt_enable",
            "analysis_prompt_enable",
        }
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
        self.workbench_service = WorkbenchService()
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
            self.quality_rule_service,
        )
        self.translation_reset_service = TranslationResetService(
            self.session,
            self.batch_service,
            self.meta_service,
            self.item_service,
        )
        self.project_file_service = ProjectFileService(
            self.session,
            self.item_service,
            self.analysis_service,
            self.project_service.SUPPORTED_EXTENSIONS,
        )

        self.subscribe(Base.Event.TRANSLATION_TASK, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_RESET_ALL, self.on_translation_activity)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED,
            self.on_translation_activity,
        )
        self.subscribe(Base.Event.CONFIG_UPDATED, self.on_config_updated)

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

    def migrate_legacy_translation_prompt_text_once(self) -> None:
        self.lifecycle_service.migrate_legacy_translation_prompt_text_once()

    def get_preferred_legacy_translation_prompt_types(self) -> tuple[str, str]:
        return self.lifecycle_service.get_preferred_legacy_translation_prompt_types()

    def get_first_available_legacy_translation_prompt(self, db: LGDatabase) -> str:
        return self.lifecycle_service.get_first_available_legacy_translation_prompt(db)

    def mark_legacy_translation_prompt_migrated(self, db: LGDatabase) -> None:
        self.lifecycle_service.mark_legacy_translation_prompt_migrated(db)

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
        """翻译活动结束后刷新工作台。"""

        self.item_service.clear_item_cache()

        should_emit_refresh = False
        if event == Base.Event.TRANSLATION_TASK:
            should_emit_refresh = data.get("sub_event") == Base.SubEvent.DONE
        elif event in (
            Base.Event.TRANSLATION_RESET_ALL,
            Base.Event.TRANSLATION_RESET_FAILED,
        ):
            sub_event = data["sub_event"]
            should_emit_refresh = sub_event in (
                Base.SubEvent.DONE,
                Base.SubEvent.ERROR,
            )

        if should_emit_refresh and self.is_loaded():
            self.emit(Base.Event.WORKBENCH_REFRESH, {"reason": event.value})

    def handle_project_loaded_post_actions(self) -> None:
        """在工程真正对外可见前完成加载后补处理。"""
        if self.schedule_prefilter_if_needed(reason="project_loaded"):
            return
        self.refresh_analysis_progress_snapshot_cache()

    def on_config_updated(self, event: Base.Event, data: dict) -> None:
        """关键配置变化后补跑预过滤。"""

        del event

        keys = data.get("keys", [])
        if not isinstance(keys, list):
            keys = []
        relevant = {"source_language", "target_language", "mtool_optimizer_enable"}
        if not any(isinstance(key, str) and key in relevant for key in keys):
            return
        if not self.is_loaded():
            return

        self.schedule_prefilter_if_needed(reason="config_updated")

    def schedule_prefilter_if_needed(self, *, reason: str) -> bool:
        """按当前配置判断是否需要补跑预过滤。"""

        config = Config().load()
        if self.is_prefilter_needed(config):
            self.schedule_project_prefilter(config, reason=reason)
            return True
        return False

    def is_prefilter_needed(self, config: Config) -> bool:
        """判断当前工程是否需要重跑预过滤。"""

        return self.prefilter_service.is_prefilter_needed(
            self.get_meta("prefilter_config", {}),
            config,
        )

    def schedule_project_prefilter(self, config: Config, *, reason: str) -> None:
        """后台触发预过滤。"""

        from module.Engine.Engine import Engine

        lg_path = self.get_lg_path()
        if not lg_path or not self.is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            return

        request, start_worker = self.prefilter_service.enqueue_request(
            config,
            reason=reason,
            lg_path=lg_path,
        )
        if not start_worker:
            return

        self.emit_prefilter_run(request)
        threading.Thread(
            target=self.project_prefilter_worker,
            args=(request.token,),
            daemon=True,
        ).start()

    def run_project_prefilter(self, config: Config, *, reason: str) -> None:
        """同步执行预过滤。"""

        from module.Engine.Engine import Engine

        lg_path = self.get_lg_path()
        if not lg_path or not self.is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            return

        request, should_run = self.prefilter_service.enqueue_sync_request(
            config,
            reason=reason,
            lg_path=lg_path,
        )
        if not should_run or request is None:
            return

        self.emit_prefilter_run(request)
        self.project_prefilter_worker(request.token)

    def emit_prefilter_run(self, request: ProjectPrefilterRequest) -> None:
        """预过滤开始时统一发 RUN 事件。"""

        self.emit(
            Base.Event.PROJECT_PREFILTER,
            {
                "sub_event": Base.ProjectPrefilterSubEvent.RUN,
                "reason": request.reason,
                "token": request.token,
                "lg_path": request.lg_path,
            },
        )

    def project_prefilter_worker(self, token: int) -> None:
        """预过滤工作线程入口。"""

        last_request: ProjectPrefilterRequest | None = None
        last_result: ProjectPrefilterResult | None = None
        updated = False

        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().toast_processing,
                "indeterminate": True,
            },
        )

        try:
            while True:
                request = self.prefilter_service.pop_pending_request()
                if request is None:
                    if updated and last_request is not None and last_result is not None:
                        self.refresh_analysis_progress_snapshot_cache()
                        self.log_prefilter_result(last_request, last_result)
                        self.emit(
                            Base.Event.PROJECT_PREFILTER,
                            {
                                "sub_event": Base.ProjectPrefilterSubEvent.UPDATED,
                                "reason": last_request.reason,
                                "token": token,
                                "lg_path": last_request.lg_path,
                            },
                        )

                    self.emit_prefilter_finish(
                        token=token,
                        request=last_request,
                        updated=updated,
                        error=False,
                    )
                    self.prefilter_service.finish_worker()
                    return

                last_request = request
                result = self.apply_project_prefilter_once(request)
                self.prefilter_service.mark_request_handled(request)
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
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            self.emit(
                Base.Event.PROJECT_PREFILTER,
                {
                    "sub_event": Base.ProjectPrefilterSubEvent.ERROR,
                    "reason": reason,
                    "token": token,
                    "lg_path": lg_path,
                    "message": Localizer.get().task_failed,
                },
            )
            self.emit_prefilter_finish(
                token=token,
                request=last_request,
                updated=updated,
                error=True,
            )
            self.prefilter_service.finish_worker()

    def emit_prefilter_finish(
        self,
        *,
        token: int,
        request: ProjectPrefilterRequest | None,
        updated: bool,
        error: bool,
    ) -> None:
        """预过滤收尾时统一发 DONE 事件和隐藏进度。"""

        self.emit(Base.Event.PROGRESS_TOAST, {"sub_event": Base.SubEvent.DONE})
        self.emit(
            Base.Event.PROJECT_PREFILTER,
            {
                "sub_event": Base.ProjectPrefilterSubEvent.DONE,
                "reason": request.reason if request else "unknown",
                "token": token,
                "lg_path": request.lg_path if request else "",
                "updated": updated,
                "error": error,
            },
        )

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
        progress_total = len(items) * (3 if request.mtool_optimizer_enable else 2)
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().toast_processing,
                "indeterminate": False,
                "current": 0,
                "total": progress_total,
            },
        )

        def progress_cb(current: int, total: int) -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.UPDATE,
                    "message": Localizer.get().toast_processing,
                    "current": current,
                    "total": total,
                },
            )

        return self.prefilter_service.apply_once(
            request,
            items=items,
            progress_cb=progress_cb,
        )

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.meta_service.get_meta(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.meta_service.set_meta(key, value)
        if key in self.RULE_META_KEYS:
            self.emit_quality_rule_update(meta_keys=[key])

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

    @staticmethod
    def is_analysis_control_code_text(text: str) -> bool:
        return AnalysisFakeNameInjector.is_control_code_text(str(text).strip())

    @classmethod
    def is_analysis_control_code_self_mapping(cls, src: str, dst: str) -> bool:
        return AnalysisFakeNameInjector.is_control_code_self_mapping(
            str(src).strip(),
            str(dst).strip(),
        )

    def get_analysis_extras(self) -> dict[str, Any]:
        return self.analysis_service.get_analysis_extras()

    def set_analysis_extras(self, extras: dict[str, Any]) -> None:
        self.analysis_service.set_analysis_extras(extras)

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

    def build_analysis_glossary_from_candidates(self) -> list[dict[str, Any]]:
        return self.analysis_service.build_analysis_glossary_from_candidates()

    def build_analysis_glossary_import_preview(
        self,
        glossary_entries: list[dict[str, Any]],
    ) -> AnalysisGlossaryImportPreview:
        return self.analysis_service.build_analysis_glossary_import_preview(
            glossary_entries
        )

    def filter_analysis_glossary_import_candidates(
        self,
        glossary_entries: list[dict[str, Any]],
        preview: AnalysisGlossaryImportPreview,
    ) -> list[dict[str, Any]]:
        return self.analysis_service.filter_analysis_glossary_import_candidates(
            glossary_entries,
            preview,
        )

    def import_analysis_candidates(
        self,
        expected_lg_path: str | None = None,
    ) -> int | None:
        imported = self.analysis_service.import_analysis_candidates(expected_lg_path)
        if imported and imported > 0:
            self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.GLOSSARY])
        return imported

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

    def reset_failed_translation_items_sync(self) -> dict[str, Any] | None:
        """翻译域统一入口，避免继续从分析服务借道。"""

        return self.translation_reset_service.reset_failed_translation_items_sync()

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        self.quality_rule_service.set_rules_cached(rule_type, data, save)
        if save:
            self.emit_quality_rule_update(rule_types=[rule_type])

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
        self.emit_quality_rule_update(rule_types=[rule_type])

    def emit_quality_rule_update(
        self,
        rule_types: list[LGDatabase.RuleType] | None = None,
        meta_keys: list[str] | None = None,
    ) -> None:
        payload: dict[str, Any] = {}
        if rule_types:
            payload["rule_types"] = [rule_type.value for rule_type in rule_types]
        if meta_keys:
            payload["meta_keys"] = meta_keys
        self.emit(Base.Event.QUALITY_RULE_UPDATE, payload)

    def get_glossary(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_glossary()

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        self.quality_rule_service.set_glossary(data, save)
        if save:
            self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.GLOSSARY])

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
        if merged is not None and save:
            self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.GLOSSARY])
        return merged, report

    def get_glossary_enable(self) -> bool:
        return self.quality_rule_service.get_glossary_enable()

    def set_glossary_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_glossary_enable(enable)

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_text_preserve()

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_text_preserve(data)
        self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.TEXT_PRESERVE])

    def get_text_preserve_mode(self) -> TextPreserveMode:
        return self.quality_rule_service.get_text_preserve_mode()

    def set_text_preserve_mode(self, mode: TextPreserveMode | str) -> None:
        self.quality_rule_service.set_text_preserve_mode(mode)

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_pre_replacement()

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_pre_replacement(data)
        self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.PRE_REPLACEMENT])

    def get_pre_replacement_enable(self) -> bool:
        return self.quality_rule_service.get_pre_replacement_enable()

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_pre_replacement_enable(enable)

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.quality_rule_service.get_post_replacement()

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        self.quality_rule_service.set_post_replacement(data)
        self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.POST_REPLACEMENT])

    def get_post_replacement_enable(self) -> bool:
        return self.quality_rule_service.get_post_replacement_enable()

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_post_replacement_enable(enable)

    def get_translation_prompt(self) -> str:
        return self.quality_rule_service.get_translation_prompt()

    def set_translation_prompt(self, text: str) -> None:
        self.quality_rule_service.set_translation_prompt(text)
        self.emit_quality_rule_update(
            rule_types=[LGDatabase.RuleType.TRANSLATION_PROMPT]
        )

    def get_translation_prompt_enable(self) -> bool:
        return self.quality_rule_service.get_translation_prompt_enable()

    def set_translation_prompt_enable(self, enable: bool) -> None:
        self.quality_rule_service.set_translation_prompt_enable(enable)

    def get_analysis_prompt(self) -> str:
        return self.quality_rule_service.get_analysis_prompt()

    def set_analysis_prompt(self, text: str) -> None:
        self.quality_rule_service.set_analysis_prompt(text)
        self.emit_quality_rule_update(rule_types=[LGDatabase.RuleType.ANALYSIS_PROMPT])

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
        if rules:
            self.emit_quality_rule_update(rule_types=list(rules.keys()))
        if meta:
            keys = [key for key in meta.keys() if key in self.RULE_META_KEYS]
            if keys:
                self.emit_quality_rule_update(meta_keys=keys)

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        return self.translation_item_service.get_items_for_translation(config, mode)

    def get_all_asset_paths(self) -> list[str]:
        return self.asset_service.get_all_asset_paths()

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

    def emit_task_running_warning(self) -> None:
        """统一忙碌态提示。"""

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().task_running,
            },
        )

    def try_begin_guarded_file_operation(self) -> bool:
        """在数据层兜底拦住忙碌态文件操作。"""

        from module.Engine.Engine import Engine

        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit_task_running_warning()
            return False
        if not self.try_begin_file_operation():
            self.emit_task_running_warning()
            return False
        return True

    def schedule_guarded_file_operation(
        self,
        progress_message: str,
        action: Callable[[], ProjectFileMutationResult],
        error_message: str,
    ) -> None:
        """统一封装文件操作线程。"""

        if not self.try_begin_guarded_file_operation():
            return

        def worker() -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "message": progress_message,
                    "indeterminate": True,
                },
            )
            try:
                result = action()
                self.emit_project_file_update(result)
                self.run_project_prefilter(Config().load(), reason="file_op")
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(error_message, e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST, {"sub_event": Base.SubEvent.DONE})
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

    def emit_project_file_update(self, result: ProjectFileMutationResult) -> None:
        """统一发工程文件更新事件。"""

        payload: dict[str, Any] = {"rel_path": result.rel_path}
        if result.old_rel_path:
            payload["old_rel_path"] = result.old_rel_path
        self.emit(Base.Event.PROJECT_FILE_UPDATE, payload)

    def require_loaded_lg_path(self) -> str:
        """读取当前工程路径；未加载工程时统一抛出同一条错误。"""

        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return lg_path

    def build_workbench_snapshot(self) -> WorkbenchSnapshot:
        return self.workbench_service.build_snapshot(
            self.get_all_asset_paths(),
            self.get_all_item_dicts(),
        )

    def schedule_add_file(self, file_path: str) -> None:
        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_adding_file,
            lambda: self.project_file_service.add_file(file_path),
            f"Failed to add file: {file_path}",
        )

    def schedule_replace_file(self, rel_path: str, new_file_path: str) -> None:
        self.schedule_guarded_file_operation(
            Localizer.get().toast_processing,
            lambda: self.project_file_service.replace_file(rel_path, new_file_path),
            f"Failed to replace file: {rel_path} -> {new_file_path}",
        )

    def schedule_reset_file(self, rel_path: str) -> None:
        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_resetting_file,
            lambda: self.project_file_service.reset_file(rel_path),
            f"Failed to reset file: {rel_path}",
        )

    def schedule_delete_file(self, rel_path: str) -> None:
        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_deleting_file,
            lambda: self.project_file_service.delete_file(rel_path),
            f"Failed to delete file: {rel_path}",
        )

    def add_file(self, file_path: str) -> None:
        self.emit_project_file_update(self.project_file_service.add_file(file_path))

    def replace_file(self, rel_path: str, new_file_path: str) -> dict[str, int]:
        result = self.project_file_service.replace_file(rel_path, new_file_path)
        self.emit_project_file_update(result)
        return {
            "matched": result.matched,
            "new": result.new,
            "total": result.total,
        }

    def reset_file(self, rel_path: str) -> None:
        self.emit_project_file_update(self.project_file_service.reset_file(rel_path))

    def delete_file(self, rel_path: str) -> None:
        self.emit_project_file_update(self.project_file_service.delete_file(rel_path))

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

    def get_supported_extensions(self) -> set[str]:
        return set(self.project_service.SUPPORTED_EXTENSIONS)

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
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_default_preset_loaded_toast.format(
                        NAME=" | ".join(loaded_presets)
                    ),
                },
            )

    def get_project_preview(self, lg_path: str) -> dict[str, Any]:
        return self.project_service.get_project_preview(lg_path)
