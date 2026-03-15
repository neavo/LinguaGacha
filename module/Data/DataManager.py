import os
import sqlite3
import threading
from collections import defaultdict
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
import hashlib
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.AssetService import AssetService
from module.Data.BatchService import BatchService
from module.Data.ExportPathService import ExportPathService
from module.Data.ItemService import ItemService
from module.Data.LGDatabase import LGDatabase
from module.Data.MetaService import MetaService
from module.Data.ProjectSession import ProjectSession
from module.Data.RuleService import RuleService
from module.Filter.ProjectPrefilter import ProjectPrefilter
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics
from module.Utils.GapTool import GapTool
from module.Utils.JSONTool import JSONTool
from module.Utils.ZstdTool import ZstdTool


@dataclass(frozen=True)
class ProjectPrefilterRequest:
    """预过滤请求快照（跨线程传递）。"""

    token: int
    seq: int
    lg_path: str
    reason: str
    source_language: str
    target_language: str
    mtool_optimizer_enable: bool


@dataclass(frozen=True)
class WorkbenchFileEntrySnapshot:
    """工作台文件表的单行快照（跨线程传递）。"""

    rel_path: str
    item_count: int
    file_type: Item.FileType


@dataclass(frozen=True)
class WorkbenchSnapshot:
    """工作台文件列表与统计信息快照（跨线程传递）。"""

    file_count: int
    total_items: int
    translated: int
    translated_in_past: int
    untranslated: int
    entries: tuple[WorkbenchFileEntrySnapshot, ...]


@dataclass(frozen=True)
class AnalysisGlossaryImportPreviewEntry:
    """分析候选导入预演中的单条结果快照。"""

    entry: dict[str, Any]
    statistics_key: str
    is_new: bool
    incoming_indexes: tuple[int, ...]


@dataclass(frozen=True)
class AnalysisGlossaryImportPreview:
    """分析候选导入预演结果。

    为什么要显式建模：
    导入过滤需要同时拿到“预合并结果、哪些是新增、命中数、包含关系”，
    单靠一个 merged 列表已经不够表达这些决策信息。
    """

    merged_entries: tuple[dict[str, Any], ...]
    report: QualityRuleMerger.Report
    entries: tuple[AnalysisGlossaryImportPreviewEntry, ...]
    statistics_results: dict[str, QualityRuleStatistics.RuleStatResult]
    subset_parents: dict[str, tuple[str, ...]]


class DataManager(Base):
    """全局数据中间件（单入口）。

    设计目标：
    - 对外只暴露 DataManager.get().get_xxx()/set_xxx() 形式的 API
    - 对内将具体实现下沉到独立 Service，DataManager 仅做委派与事件出口
    """

    instance: ClassVar["DataManager | None"] = None
    lock: ClassVar[threading.Lock] = threading.Lock()

    # 对外提供统一的规则枚举入口，避免业务侧直接依赖数据库实现
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
    RULE_STATISTICS_COUNTED_STATUSES: ClassVar[frozenset[Base.ProjectStatus]] = (
        frozenset(
            {
                Base.ProjectStatus.NONE,
                Base.ProjectStatus.PROCESSING,
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.PROCESSED_IN_PAST,
                Base.ProjectStatus.ERROR,
            }
        )
    )
    # 这些 meta 代表规则开关本身，导入时需要和规则正文分开处理。
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

    class TextPreserveMode(StrEnum):
        OFF = "off"  # 完全关闭：不使用内置或自定义规则
        SMART = "smart"  # 智能：使用内置预置规则
        CUSTOM = "custom"  # 自定义：使用项目内自定义规则

    def __init__(self) -> None:
        super().__init__()

        self.session = ProjectSession()
        self.state_lock = self.session.state_lock

        self.meta_service = MetaService(self.session)
        self.rule_service = RuleService(self.session)
        self.item_service = ItemService(self.session)
        self.asset_service = AssetService(self.session)
        self.batch_service = BatchService(self.session)
        # 避免与 FileManager/文件解析模块形成循环依赖：这里使用延迟导入。
        from module.Data.ProjectService import ProjectService
        from module.Data.TranslationItemService import TranslationItemService

        self.translation_item_service = TranslationItemService(self.session)
        self.project_service = ProjectService()
        self.export_path_service = ExportPathService()

        # 监听翻译活动以失效 items 缓存，避免读到中间态
        self.subscribe(Base.Event.TRANSLATION_TASK, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_RESET_ALL, self.on_translation_activity)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED,
            self.on_translation_activity,
        )

        # 配置变更触发预过滤重算（确保校对/翻译读取同一份稳定状态）
        self.subscribe(Base.Event.CONFIG_UPDATED, self.on_config_updated)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)

        # 预过滤是工程级写库操作：统一串行化并做合并，避免竞态与重复工作。
        self.prefilter_lock = threading.Lock()
        self.prefilter_cond = threading.Condition(self.prefilter_lock)
        self.prefilter_running: bool = False
        self.prefilter_pending: bool = False

        # token：标记一次 worker 生命周期（用于事件关联/合并）；seq：标记请求顺序（用于等待/测试可观测性）。
        self.prefilter_token: int = 0
        self.prefilter_active_token: int = 0
        self.prefilter_request_seq: int = 0
        self.prefilter_last_handled_seq: int = 0
        self.prefilter_latest_request: ProjectPrefilterRequest | None = None

        # 工程级文件操作（增删改）统一串行化，避免 SQLite 多线程写冲突。
        self.file_op_lock = threading.Lock()
        self.file_op_running: bool = False

    @classmethod
    def get(cls) -> "DataManager":
        if cls.instance is None:
            with cls.lock:
                if cls.instance is None:
                    cls.instance = cls()
        return cls.instance

    # ===================== 生命周期 =====================

    def load_project(self, lg_path: str) -> None:
        """加载工程并初始化缓存（meta 立即可用）。"""
        with self.state_lock:
            if self.is_loaded():
                self.unload_project()

            if not Path(lg_path).exists():
                raise FileNotFoundError(f"工程文件不存在: {lg_path}")

            self.session.lg_path = lg_path
            self.session.db = LGDatabase(lg_path)

            # 更新最后访问时间（短连接写入即可）
            self.session.db.set_meta("updated_at", datetime.now().isoformat())

            # 载入 meta 强缓存
            self.meta_service.refresh_cache_from_db()

            # 兼容旧工程：早期使用 text_preserve_enable(bool) 表示是否启用自定义文本保护；
            # 新语义改为 text_preserve_mode(off/smart/custom)。这里只在工程加载时做一次迁移写回。
            raw_mode = self.session.meta_cache.get("text_preserve_mode")
            mode_valid = False
            if isinstance(raw_mode, str):
                try:
                    __class__.TextPreserveMode(raw_mode)
                    mode_valid = True
                except ValueError:
                    mode_valid = False

            if not mode_valid:
                legacy_enable = bool(
                    self.session.meta_cache.get("text_preserve_enable", False)
                )
                migrated = (
                    __class__.TextPreserveMode.CUSTOM.value
                    if legacy_enable
                    else __class__.TextPreserveMode.SMART.value
                )
                self.session.db.set_meta("text_preserve_mode", migrated)
                self.session.meta_cache["text_preserve_mode"] = migrated

            # 兼容旧工程：旧版翻译提示词正文按 ZH/EN 分槽存储；
            # 新语义收敛成单一 TRANSLATION_PROMPT，这里只迁移正文且仅执行一次。
            self.migrate_legacy_translation_prompt_text_once()

            # 清理其它缓存（避免跨工程串数据）
            self.session.rule_cache.clear()
            self.session.rule_text_cache.clear()
            self.item_service.clear_item_cache()
            self.asset_service.clear_decompress_cache()

        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload_project(self) -> None:
        """卸载工程并清理缓存。"""
        old_path: str | None = None
        with self.state_lock:
            old_path = self.session.lg_path

            if self.session.db is not None:
                self.session.db.close()

            self.session.db = None
            self.session.lg_path = None
            self.session.clear_all_caches()

        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def migrate_legacy_translation_prompt_text_once(self) -> None:
        """把旧工程里的翻译提示词正文一次性迁移到新字段。"""
        db = self.session.db
        if db is None:
            return

        if bool(
            self.session.meta_cache.get(
                __class__.LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
                False,
            )
        ):
            return

        current_prompt = db.get_rule_text(__class__.RuleType.TRANSLATION_PROMPT).strip()
        if current_prompt:
            self.mark_legacy_translation_prompt_migrated(db)
            return

        migrated_prompt = self.get_first_available_legacy_translation_prompt(db)
        if migrated_prompt:
            db.set_rule_text(__class__.RuleType.TRANSLATION_PROMPT, migrated_prompt)

        self.mark_legacy_translation_prompt_migrated(db)

    def get_preferred_legacy_translation_prompt_types(self) -> tuple[str, str]:
        """按当前 UI 语言决定旧 ZH/EN 提示词正文的优先级。"""
        app_language = Localizer.get_app_language()
        if app_language == BaseLanguage.Enum.EN:
            return (
                __class__.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE,
                __class__.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE,
            )

        return (
            __class__.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE,
            __class__.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE,
        )

    def get_first_available_legacy_translation_prompt(self, db: LGDatabase) -> str:
        """按当前 UI 语言优先级读取旧提示词正文，避免迁移主流程混入回退细节。"""
        for legacy_rule_type in self.get_preferred_legacy_translation_prompt_types():
            candidate = db.get_rule_text_by_name(legacy_rule_type).strip()
            if candidate != "":
                return candidate
        return ""

    def mark_legacy_translation_prompt_migrated(self, db: LGDatabase) -> None:
        """记录旧翻译提示词正文迁移已经完成，避免重复探测与覆盖。"""
        db.set_meta(__class__.LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY, True)
        self.session.meta_cache[
            __class__.LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY
        ] = True

    def is_loaded(self) -> bool:
        with self.state_lock:
            return self.session.db is not None and self.session.lg_path is not None

    def get_lg_path(self) -> str | None:
        with self.state_lock:
            return self.session.lg_path

    def open_db(self) -> None:
        """打开长连接（翻译期间用，提升高频写入性能）。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return
            db.open()

    def close_db(self) -> None:
        """关闭长连接（触发 WAL checkpoint 清理）。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return
            db.close()

    def on_translation_activity(self, event: Base.Event, data: dict) -> None:
        # 翻译过程中 items 会频繁写入 DB；items 缓存不追实时，统一失效更安全。
        self.item_service.clear_item_cache()

        # 翻译运行/重置会改变条目状态：工作台需要在终态触发一次聚合刷新。
        # 这里发 WORKBENCH_REFRESH，而不是 PROJECT_FILE_UPDATE，避免语义混叠。
        should_emit_refresh = False
        if event == Base.Event.TRANSLATION_TASK:
            sub_event = data.get("sub_event")
            should_emit_refresh = sub_event == Base.SubEvent.DONE
        elif event in (
            Base.Event.TRANSLATION_RESET_ALL,
            Base.Event.TRANSLATION_RESET_FAILED,
        ):
            sub_event: Base.SubEvent = data["sub_event"]
            should_emit_refresh = sub_event in (
                Base.SubEvent.DONE,
                Base.SubEvent.ERROR,
            )

        if not should_emit_refresh:
            return
        if not self.is_loaded():
            return
        self.emit(Base.Event.WORKBENCH_REFRESH, {"reason": event.value})

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        # 旧工程可能没有预过滤元信息；为避免移除翻译期过滤后出现跳过集合不一致，
        # 在工程加载后按当前配置补一次（若已一致则跳过）。
        config = Config().load()
        if not self.is_prefilter_needed(config):
            return
        self.schedule_project_prefilter(config, reason="project_loaded")

    def on_config_updated(self, event: Base.Event, data: dict) -> None:
        del event
        keys = data.get("keys", [])
        if not isinstance(keys, list):
            keys = []
        relevant = {"source_language", "target_language", "mtool_optimizer_enable"}
        if not any(isinstance(k, str) and k in relevant for k in keys):
            return
        if not self.is_loaded():
            return

        config = Config().load()
        if not self.is_prefilter_needed(config):
            return
        self.schedule_project_prefilter(config, reason="config_updated")

    def is_prefilter_needed(self, config: Config) -> bool:
        raw = self.get_meta("prefilter_config", {})
        if not isinstance(raw, dict):
            return True
        expected = {
            "source_language": str(config.source_language),
            "target_language": str(config.target_language),
            "mtool_optimizer_enable": bool(config.mtool_optimizer_enable),
        }
        return raw != expected

    def schedule_project_prefilter(self, config: Config, *, reason: str) -> None:
        """后台触发预过滤（自动合并短时间内的多次请求）。"""

        # 翻译过程中 UI 会禁用相关开关，但这里仍做一次兜底。
        from module.Engine.Engine import Engine

        if not self.is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            return

        source_language = str(config.source_language)
        target_language = str(config.target_language)
        mtool_optimizer_enable = bool(config.mtool_optimizer_enable)

        start_worker = False
        with self.prefilter_cond:
            if self.prefilter_running:
                token = self.prefilter_active_token
            else:
                self.prefilter_token += 1
                token = self.prefilter_token
                self.prefilter_active_token = token
                self.prefilter_running = True
                start_worker = True

            self.prefilter_request_seq += 1
            seq = self.prefilter_request_seq
            lg_path = self.get_lg_path() or ""
            self.prefilter_latest_request = ProjectPrefilterRequest(
                token=token,
                seq=seq,
                lg_path=lg_path,
                reason=reason,
                source_language=source_language,
                target_language=target_language,
                mtool_optimizer_enable=mtool_optimizer_enable,
            )
            self.prefilter_pending = True
            self.prefilter_cond.notify_all()

        if not start_worker:
            return

        # 先发事件锁 UI，避免“加载旧工程后立刻点击开始翻译”的竞态。
        self.emit(
            Base.Event.PROJECT_PREFILTER,
            {
                "sub_event": Base.ProjectPrefilterSubEvent.RUN,
                "reason": reason,
                "token": token,
                "lg_path": lg_path,
            },
        )
        threading.Thread(
            target=self.project_prefilter_worker, args=(token,), daemon=True
        ).start()

    def run_project_prefilter(self, config: Config, *, reason: str) -> None:
        """执行预过滤并落库（同步）。

        注意：该方法会写 DB 且可能耗时；GUI 模式下应在后台线程调用。
        """

        # 翻译过程中 UI 会禁用相关开关，但这里仍做一次兜底。
        from module.Engine.Engine import Engine

        if not self.is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            return

        source_language = str(config.source_language)
        target_language = str(config.target_language)
        mtool_optimizer_enable = bool(config.mtool_optimizer_enable)

        with self.prefilter_cond:
            if self.prefilter_running:
                # 同步调用遇到“已有 worker 正在跑”时：只更新最新请求并等待其落库完成，保证 meta/items 一致。
                token = self.prefilter_active_token
                self.prefilter_request_seq += 1
                seq = self.prefilter_request_seq
                lg_path = self.get_lg_path() or ""
                self.prefilter_latest_request = ProjectPrefilterRequest(
                    token=token,
                    seq=seq,
                    lg_path=lg_path,
                    reason=reason,
                    source_language=source_language,
                    target_language=target_language,
                    mtool_optimizer_enable=mtool_optimizer_enable,
                )
                self.prefilter_pending = True
                self.prefilter_cond.notify_all()
                self.prefilter_cond.wait_for(lambda: not self.prefilter_running)
                return

            self.prefilter_token += 1
            token = self.prefilter_token
            self.prefilter_active_token = token
            self.prefilter_running = True

            self.prefilter_request_seq += 1
            seq = self.prefilter_request_seq
            lg_path = self.get_lg_path() or ""
            self.prefilter_latest_request = ProjectPrefilterRequest(
                token=token,
                seq=seq,
                lg_path=lg_path,
                reason=reason,
                source_language=source_language,
                target_language=target_language,
                mtool_optimizer_enable=mtool_optimizer_enable,
            )
            self.prefilter_pending = True
            self.prefilter_cond.notify_all()

        self.emit(
            Base.Event.PROJECT_PREFILTER,
            {
                "sub_event": Base.ProjectPrefilterSubEvent.RUN,
                "reason": reason,
                "token": token,
                "lg_path": lg_path,
            },
        )
        self.project_prefilter_worker(token)

    def project_prefilter_worker(self, token: int) -> None:
        """预过滤工作线程/同步入口。

        - 串行执行：同一时间只允许一个 worker 运行
        - 合并请求：运行中不断吸收最新请求，最终只保证落库的是“最后一次配置”
        """

        last_request: ProjectPrefilterRequest | None = None
        last_result: ProjectPrefilterResult | None = None
        updated = False

        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().toast_processing,
                # 先显示不定进度：加载 items 前无法给出可信 total，避免进度条长时间停在 0%。
                "indeterminate": True,
            },
        )

        try:
            while True:
                with self.prefilter_cond:
                    if not self.prefilter_pending:
                        # 收尾事件放在锁内发出：避免新任务 show 被旧任务 hide 打断。
                        if (
                            updated
                            and last_result is not None
                            and last_request is not None
                        ):
                            LogManager.get().info(
                                Localizer.get().engine_task_rule_filter.replace(
                                    "{COUNT}", str(last_result.stats.rule_skipped)
                                )
                            )
                            LogManager.get().info(
                                Localizer.get().engine_task_language_filter.replace(
                                    "{COUNT}", str(last_result.stats.language_skipped)
                                )
                            )
                            # 仅在开关开启时输出 MTool 预处理日志，避免“未启用但仍提示已完成”的误导。
                            if last_request.mtool_optimizer_enable:
                                LogManager.get().info(
                                    Localizer.get().translator_mtool_optimizer_pre_log.replace(
                                        "{COUNT}", str(last_result.stats.mtool_skipped)
                                    )
                                )

                            # 仅在控制台输出统计信息，避免 UI Toast 产生噪音。
                            LogManager.get().print("")
                            self.emit(
                                Base.Event.PROJECT_PREFILTER,
                                {
                                    "sub_event": Base.ProjectPrefilterSubEvent.UPDATED,
                                    "reason": last_request.reason,
                                    "token": token,
                                    "lg_path": last_request.lg_path,
                                },
                            )

                        self.emit(
                            Base.Event.PROGRESS_TOAST,
                            {"sub_event": Base.SubEvent.DONE},
                        )
                        self.emit(
                            Base.Event.PROJECT_PREFILTER,
                            {
                                "sub_event": Base.ProjectPrefilterSubEvent.DONE,
                                "reason": last_request.reason
                                if last_request
                                else "unknown",
                                "token": token,
                                "lg_path": last_request.lg_path if last_request else "",
                                "updated": updated,
                                "error": False,
                            },
                        )

                        self.prefilter_running = False
                        self.prefilter_active_token = 0
                        self.prefilter_cond.notify_all()
                        return

                    request = self.prefilter_latest_request
                    self.prefilter_pending = False

                if request is None:
                    continue

                last_request = request
                result = self.apply_project_prefilter_once(request)

                with self.prefilter_cond:
                    self.prefilter_last_handled_seq = request.seq
                    self.prefilter_cond.notify_all()

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

            with self.prefilter_cond:
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )
                self.emit(
                    Base.Event.PROJECT_PREFILTER,
                    {
                        "sub_event": Base.ProjectPrefilterSubEvent.DONE,
                        "reason": last_request.reason if last_request else "unknown",
                        "token": token,
                        "lg_path": last_request.lg_path if last_request else "",
                        "updated": updated,
                        "error": True,
                    },
                )

                self.prefilter_running = False
                self.prefilter_active_token = 0
                self.prefilter_cond.notify_all()

    def apply_project_prefilter_once(
        self, request: ProjectPrefilterRequest
    ) -> ProjectPrefilterResult | None:
        """执行一次预过滤并写入 DB。

        返回 None 表示：工程已切换/卸载，本次结果被丢弃。
        """

        if not self.is_loaded():
            return None

        lg_path = self.get_lg_path()
        if not lg_path or lg_path != request.lg_path:
            return None

        self.item_service.clear_item_cache()
        items = self.get_all_items()
        total = len(items)
        progress_total = total * (3 if request.mtool_optimizer_enable else 2)
        # 加载完成后切换为确定进度模式。
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

        result = ProjectPrefilter.apply(
            items=items,
            source_language=request.source_language,
            target_language=request.target_language,
            mtool_optimizer_enable=request.mtool_optimizer_enable,
            progress_cb=progress_cb,
        )

        items_dict: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            items_dict.append(item.to_dict())

        meta = {
            "prefilter_config": result.prefilter_config,
            "source_language": request.source_language,
            "target_language": request.target_language,
            "analysis_extras": {},
            "analysis_state": {},
            "analysis_term_pool": {},
        }

        # 落库前二次确认工程未切换，避免把旧工程结果写入新工程。
        with self.state_lock:
            if self.session.db is None or self.session.lg_path != request.lg_path:
                return None
            self.batch_service.update_batch(items=items_dict, meta=meta)
            self.session.db.delete_analysis_item_checkpoints()
            self.session.db.clear_analysis_task_observations()
            self.session.db.clear_analysis_candidate_aggregates()

        return result

    # ===================== meta =====================

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

    def get_translation_extras(self) -> dict:
        extras = self.get_meta("translation_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_translation_extras(self, extras: dict) -> None:
        self.set_meta("translation_extras", extras)

    def get_analysis_extras(self) -> dict[str, Any]:
        extras = self.get_meta("analysis_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_analysis_extras(self, extras: dict[str, Any]) -> None:
        self.set_meta("analysis_extras", extras)

    @staticmethod
    def is_skipped_analysis_status(status: Base.ProjectStatus) -> bool:
        """统一维护分析链路的跳过状态，避免数据层和调度层各写一套判断。"""
        return status in (
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
            Base.ProjectStatus.DUPLICATED,
        )

    @staticmethod
    def build_analysis_source_text(item: Item) -> str:
        """分析同时依赖姓名和正文，这里统一生成唯一的分析输入口径。"""
        src = item.get_src().strip()

        names_raw = item.get_name_src()
        names: list[str] = []
        if isinstance(names_raw, str):
            name = names_raw.strip()
            if name != "":
                names.append(name)
        elif isinstance(names_raw, list):
            for raw_name in names_raw:
                if not isinstance(raw_name, str):
                    continue

                name = raw_name.strip()
                if name == "":
                    continue
                if name in names:
                    continue
                names.append(name)

        parts: list[str] = []
        if names:
            parts.append("\n".join(names))
        if src != "":
            parts.append(src)
        return "\n".join(parts).strip()

    @staticmethod
    def build_analysis_source_hash(source_text: str) -> str:
        """分析续跑只认稳定文本哈希，避免切块方式变化时重复提交。"""
        if source_text == "":
            return ""
        return hashlib.sha256(source_text.encode("utf-8")).hexdigest()

    @staticmethod
    def is_analysis_control_code_text(text: str) -> bool:
        """分析术语里只有纯控制码需要特殊放行，判断规则统一走这里。"""
        from module.Engine.Analyzer.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_text(str(text).strip())

    @classmethod
    def is_analysis_control_code_self_mapping(cls, src: str, dst: str) -> bool:
        """纯控制码自映射术语代表实体占位符本体，不走普通自映射过滤。"""
        from module.Engine.Analyzer.AnalysisFakeNameInjector import (
            AnalysisFakeNameInjector,
        )

        return AnalysisFakeNameInjector.is_control_code_self_mapping(
            str(src).strip(),
            str(dst).strip(),
        )

    def normalize_analysis_term_vote_map(self, raw_votes: object) -> dict[str, int]:
        """把候选票数字段收敛成稳定的 {文本: 票数} 结构。"""
        if not isinstance(raw_votes, dict):
            return {}

        normalized: dict[str, int] = {}
        for raw_key, raw_value in raw_votes.items():
            if not isinstance(raw_key, str):
                continue

            key = raw_key.strip()
            if key == "":
                key = ""

            try:
                votes = int(raw_value)
            except TypeError, ValueError:
                continue

            if votes <= 0:
                continue
            normalized[key] = normalized.get(key, 0) + votes
        return normalized

    def normalize_analysis_term_pool_entry(
        self, raw_src: str, raw_entry: object
    ) -> dict[str, Any] | None:
        """把候选池单项规整成固定结构，避免脏数据把票选逻辑带歪。"""
        if not isinstance(raw_entry, dict):
            return None

        src = str(raw_entry.get("src", raw_src)).strip()
        if src == "":
            return None

        dst_votes = self.normalize_analysis_term_vote_map(raw_entry.get("dst_votes"))
        info_votes = self.normalize_analysis_term_vote_map(raw_entry.get("info_votes"))
        if not dst_votes:
            return None

        try:
            first_seen_index = int(raw_entry.get("first_seen_index", 0))
        except TypeError, ValueError:
            first_seen_index = 0

        return {
            "src": src,
            "dst_votes": dst_votes,
            "info_votes": info_votes,
            "first_seen_index": max(0, first_seen_index),
            "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
        }

    def pick_analysis_term_pool_winner(self, votes: dict[str, int]) -> str:
        """同票时保留先出现者，避免重复导入时结果来回抖动。"""
        if not votes:
            return ""

        best_text = ""
        best_votes = -1
        for text, count in votes.items():
            if count > best_votes:
                best_text = text
                best_votes = count
        return best_text

    def normalize_analysis_state_value(
        self, raw_status: Base.ProjectStatus | str | object
    ) -> Base.ProjectStatus | None:
        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return None
        return None

    def get_analysis_state(self) -> dict[str, Base.ProjectStatus]:
        raw_state = self.get_meta("analysis_state", {})
        if not isinstance(raw_state, dict):
            return {}

        normalized: dict[str, Base.ProjectStatus] = {}
        for rel_path, raw_status in raw_state.items():
            if not isinstance(rel_path, str) or rel_path.strip() == "":
                continue
            status = self.normalize_analysis_state_value(raw_status)
            if status is not None:
                normalized[rel_path] = status
        return normalized

    def set_analysis_state(self, state: dict[str, Base.ProjectStatus | str]) -> None:
        normalized: dict[str, str] = {}
        for rel_path, raw_status in state.items():
            if not isinstance(rel_path, str) or rel_path.strip() == "":
                continue
            status = self.normalize_analysis_state_value(raw_status)
            if status is not None:
                normalized[rel_path] = status.value
        self.set_meta("analysis_state", normalized)

    # ===================== 新分析数据接口 =====================

    def normalize_analysis_item_checkpoint(
        self, raw_checkpoint: object
    ) -> dict[str, Any] | None:
        """把条目级检查点规整成固定结构。"""
        if not isinstance(raw_checkpoint, dict):
            return None

        item_id = raw_checkpoint.get("item_id")
        if not isinstance(item_id, int) or item_id <= 0:
            return None

        source_hash = str(raw_checkpoint.get("source_hash", "")).strip()
        if source_hash == "":
            return None

        status = self.normalize_analysis_state_value(raw_checkpoint.get("status"))
        if status not in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR):
            return None

        try:
            error_count = int(raw_checkpoint.get("error_count", 0))
        except TypeError, ValueError:
            error_count = 0

        updated_at_raw = raw_checkpoint.get("updated_at", "")
        if isinstance(updated_at_raw, str) and updated_at_raw.strip() != "":
            updated_at = updated_at_raw.strip()
        else:
            updated_at = datetime.now().isoformat()

        return {
            "item_id": item_id,
            "source_hash": source_hash,
            "status": status,
            "updated_at": updated_at,
            "error_count": max(0, error_count),
        }

    def normalize_analysis_task_observation(
        self, raw_observation: object
    ) -> dict[str, Any] | None:
        """把任务级 observation 规整成稳定结构，保证幂等键可比较。"""
        if not isinstance(raw_observation, dict):
            return None

        task_fingerprint = str(raw_observation.get("task_fingerprint", "")).strip()
        src = str(raw_observation.get("src", "")).strip()
        dst = str(raw_observation.get("dst", "")).strip()
        info = str(raw_observation.get("info", "")).strip()
        if task_fingerprint == "" or src == "" or dst == "":
            return None

        created_at_raw = raw_observation.get("created_at", "")
        if isinstance(created_at_raw, str) and created_at_raw.strip() != "":
            created_at = created_at_raw.strip()
        else:
            created_at = datetime.now().isoformat()

        return {
            "task_fingerprint": task_fingerprint,
            "src": src,
            "dst": dst,
            "info": info,
            "case_sensitive": bool(raw_observation.get("case_sensitive", False)),
            "created_at": created_at,
        }

    def normalize_analysis_candidate_aggregate_entry(
        self, raw_src: str, raw_entry: object
    ) -> dict[str, Any] | None:
        """把候选池单项规整成固定结构，避免脏数据把票选逻辑带歪。"""
        if not isinstance(raw_entry, dict):
            return None

        src = str(raw_entry.get("src", raw_src)).strip()
        if src == "":
            return None

        raw_dst_votes = raw_entry.get("dst_votes")
        if isinstance(raw_dst_votes, str):
            raw_dst_votes = JSONTool.loads(raw_dst_votes)
        raw_info_votes = raw_entry.get("info_votes")
        if isinstance(raw_info_votes, str):
            raw_info_votes = JSONTool.loads(raw_info_votes)

        dst_votes = self.normalize_analysis_term_vote_map(raw_dst_votes)
        info_votes = self.normalize_analysis_term_vote_map(raw_info_votes)
        if not dst_votes:
            return None

        try:
            observation_count = int(raw_entry.get("observation_count", 0))
        except TypeError, ValueError:
            observation_count = 0

        default_time = datetime.now().isoformat()
        first_seen_at_raw = raw_entry.get("first_seen_at", default_time)
        if isinstance(first_seen_at_raw, str) and first_seen_at_raw.strip() != "":
            first_seen_at = first_seen_at_raw.strip()
        else:
            first_seen_at = default_time

        last_seen_at_raw = raw_entry.get("last_seen_at", first_seen_at)
        if isinstance(last_seen_at_raw, str) and last_seen_at_raw.strip() != "":
            last_seen_at = last_seen_at_raw.strip()
        else:
            last_seen_at = first_seen_at

        try:
            first_seen_index = int(raw_entry.get("first_seen_index", 0))
        except TypeError, ValueError:
            first_seen_index = 0

        return {
            "src": src,
            "dst_votes": dst_votes,
            "info_votes": info_votes,
            "observation_count": max(
                observation_count,
                sum(dst_votes.values()),
                1,
            ),
            "first_seen_at": first_seen_at,
            "last_seen_at": last_seen_at,
            "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
            # 兼容旧内存格式：别处若还读这个字段，至少能拿到稳定顺序值。
            "first_seen_index": max(0, first_seen_index),
        }

    def normalize_analysis_item_checkpoint_rows(
        self, raw_rows: list[dict[str, Any]]
    ) -> dict[int, dict[str, Any]]:
        """把批量 checkpoint 行规整成以 item_id 为键的快照映射。"""
        normalized: dict[int, dict[str, Any]] = {}
        for raw_row in raw_rows:
            checkpoint = self.normalize_analysis_item_checkpoint(raw_row)
            if checkpoint is None:
                continue
            normalized[checkpoint["item_id"]] = checkpoint
        return normalized

    def normalize_analysis_candidate_aggregate_rows(
        self, raw_rows: list[dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """把候选池批量行规整成以 src 为键的映射，统一热路径和读接口口径。"""
        normalized: dict[str, dict[str, Any]] = {}
        for raw_row in raw_rows:
            src = str(raw_row.get("src", "")).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_row)
            if entry is None:
                continue
            normalized[entry["src"]] = entry
        return normalized

    def normalize_analysis_progress_snapshot(
        self, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        """把分析快照规整成固定字段，避免热路径和边界路径各自拼值。"""
        return {
            "start_time": float(snapshot.get("start_time", 0.0) or 0.0),
            "time": float(snapshot.get("time", 0.0) or 0.0),
            "total_line": int(snapshot.get("total_line", 0) or 0),
            "line": int(snapshot.get("line", 0) or 0),
            "processed_line": int(snapshot.get("processed_line", 0) or 0),
            "error_line": int(snapshot.get("error_line", 0) or 0),
            "total_tokens": int(snapshot.get("total_tokens", 0) or 0),
            "total_input_tokens": int(snapshot.get("total_input_tokens", 0) or 0),
            "total_output_tokens": int(snapshot.get("total_output_tokens", 0) or 0),
            "added_glossary": int(snapshot.get("added_glossary", 0) or 0),
        }

    def normalize_analysis_item_checkpoint_upsert_rows(
        self, checkpoints: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """把 checkpoint 输入规整成可直接写库的行，避免多个入口各自拼字段。"""
        normalized_rows: list[dict[str, Any]] = []
        for raw_checkpoint in checkpoints:
            checkpoint = self.normalize_analysis_item_checkpoint(raw_checkpoint)
            if checkpoint is None:
                continue
            normalized_rows.append(
                {
                    "item_id": checkpoint["item_id"],
                    "source_hash": checkpoint["source_hash"],
                    "status": checkpoint["status"].value,
                    "updated_at": checkpoint["updated_at"],
                    "error_count": checkpoint["error_count"],
                }
            )
        return normalized_rows

    def build_analysis_task_observations_for_commit(
        self,
        task_fingerprint: str,
        glossary_entries: list[dict[str, Any]],
        *,
        created_at: str,
    ) -> list[dict[str, Any]]:
        """把模型抽出的术语规整成 observation 行，避免提交入口重复拼值。"""
        normalized_observations: list[dict[str, Any]] = []
        for raw_entry in glossary_entries:
            observation = self.normalize_analysis_task_observation(
                {
                    "task_fingerprint": task_fingerprint,
                    "src": raw_entry.get("src", ""),
                    "dst": raw_entry.get("dst", ""),
                    "info": raw_entry.get("info", ""),
                    "case_sensitive": bool(raw_entry.get("case_sensitive", False)),
                    "created_at": created_at,
                }
            )
            if observation is None:
                continue
            normalized_observations.append(observation)
        return normalized_observations

    def collect_new_analysis_task_observations(
        self,
        existing_rows: list[dict[str, Any]],
        observations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """只保留当前任务真正新增的 observation，避免重复写库和重复累票。"""
        existing_keys = {
            (
                str(row.get("src", "")),
                str(row.get("dst", "")),
                str(row.get("info", "")),
                bool(row.get("case_sensitive", False)),
            )
            for row in existing_rows
        }

        new_observations: list[dict[str, Any]] = []
        pending_keys = set(existing_keys)
        for observation in observations:
            observation_key = (
                observation["src"],
                observation["dst"],
                observation["info"],
                observation["case_sensitive"],
            )
            if observation_key in pending_keys:
                continue
            pending_keys.add(observation_key)
            new_observations.append(observation)
        return new_observations

    def build_analysis_task_observation_insert_rows(
        self, observations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """把 observation 快照转换成写库行，避免事务入口重复展开字段。"""
        return [
            {
                "task_fingerprint": observation["task_fingerprint"],
                "src": observation["src"],
                "dst": observation["dst"],
                "info": observation["info"],
                "case_sensitive": observation["case_sensitive"],
                "created_at": observation["created_at"],
            }
            for observation in observations
        ]

    def merge_analysis_observations_into_candidate_aggregates(
        self,
        observations: list[dict[str, Any]],
        aggregate_map: dict[str, dict[str, Any]],
    ) -> None:
        """把新增 observation 合并进候选池快照，避免提交入口把增量规则铺开。"""
        for observation in observations:
            src = observation["src"]
            existing_entry = aggregate_map.get(src)
            if existing_entry is None:
                aggregate_map[src] = {
                    "src": src,
                    "dst_votes": {observation["dst"]: 1},
                    "info_votes": {observation["info"]: 1},
                    "observation_count": 1,
                    "first_seen_at": observation["created_at"],
                    "last_seen_at": observation["created_at"],
                    "case_sensitive": observation["case_sensitive"],
                    # 兼容旧内存格式：增量路径不维护真实序号，只保留稳定占位值。
                    "first_seen_index": 0,
                }
                continue

            dst_votes = existing_entry["dst_votes"]
            dst = observation["dst"]
            dst_votes[dst] = int(dst_votes.get(dst, 0)) + 1

            info_votes = existing_entry["info_votes"]
            info = observation["info"]
            info_votes[info] = int(info_votes.get(info, 0)) + 1

            existing_entry["observation_count"] = (
                int(existing_entry.get("observation_count", 0)) + 1
            )
            existing_entry["last_seen_at"] = observation["created_at"]
            existing_entry["case_sensitive"] = bool(
                existing_entry.get("case_sensitive", False)
                or observation["case_sensitive"]
            )

    def build_analysis_candidate_aggregate_upsert_rows(
        self,
        aggregate_map: dict[str, dict[str, Any]],
        srcs: list[str],
    ) -> list[dict[str, Any]]:
        """把指定 src 的候选池快照转换成写库行，避免事务入口重复展开字段。"""
        rows: list[dict[str, Any]] = []
        for src in srcs:
            entry = aggregate_map.get(src)
            if entry is None:
                continue
            rows.append(
                {
                    "src": entry["src"],
                    "dst_votes": dict(entry["dst_votes"]),
                    "info_votes": dict(entry["info_votes"]),
                    "observation_count": entry["observation_count"],
                    "first_seen_at": entry["first_seen_at"],
                    "last_seen_at": entry["last_seen_at"],
                    "case_sensitive": entry["case_sensitive"],
                }
            )
        return rows

    def persist_analysis_progress_snapshot_with_db(
        self,
        db: LGDatabase,
        conn: sqlite3.Connection,
        snapshot: dict[str, Any] | None,
        *,
        added_glossary_delta: int = 0,
    ) -> dict[str, Any] | None:
        """在现有事务内持久化分析快照，并同步会话缓存，避免成功失败路径各写一遍。"""
        if snapshot is None:
            return None

        persisted_snapshot = dict(snapshot)
        persisted_snapshot["added_glossary"] = (
            int(persisted_snapshot.get("added_glossary", 0) or 0) + added_glossary_delta
        )
        db.upsert_meta_entries({"analysis_extras": persisted_snapshot}, conn=conn)
        self.session.meta_cache["analysis_extras"] = dict(persisted_snapshot)
        return persisted_snapshot

    def build_analysis_error_checkpoint_rows(
        self,
        checkpoints: list[dict[str, Any]],
        existing: dict[int, dict[str, Any]],
        *,
        updated_at: str,
    ) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
        """把失败任务规整成写库行和最新快照，避免错误计数规则散在事务入口。"""
        error_rows: list[dict[str, Any]] = []
        updated_checkpoints = dict(existing)

        for raw_checkpoint in checkpoints:
            checkpoint = self.normalize_analysis_item_checkpoint(
                {
                    "item_id": raw_checkpoint.get("item_id"),
                    "source_hash": raw_checkpoint.get("source_hash"),
                    "status": Base.ProjectStatus.ERROR.value,
                    "updated_at": updated_at,
                    "error_count": raw_checkpoint.get("error_count", 0),
                }
            )
            if checkpoint is None:
                continue

            previous = existing.get(checkpoint["item_id"])
            error_count = 1
            if (
                previous is not None
                and previous["status"] == Base.ProjectStatus.ERROR
                and previous["source_hash"] == checkpoint["source_hash"]
            ):
                error_count = int(previous.get("error_count", 0)) + 1

            row = {
                "item_id": checkpoint["item_id"],
                "source_hash": checkpoint["source_hash"],
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }
            error_rows.append(row)
            updated_checkpoints[checkpoint["item_id"]] = {
                "item_id": checkpoint["item_id"],
                "source_hash": checkpoint["source_hash"],
                "status": Base.ProjectStatus.ERROR,
                "updated_at": checkpoint["updated_at"],
                "error_count": error_count,
            }

        return error_rows, updated_checkpoints

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        """返回条目级检查点快照，以 item_id 为键。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return {}

            raw_rows = db.get_analysis_item_checkpoints()

        return self.normalize_analysis_item_checkpoint_rows(raw_rows)

    def upsert_analysis_item_checkpoints(
        self, checkpoints: list[dict[str, Any]]
    ) -> dict[int, dict[str, Any]]:
        """批量写入条目级检查点，并返回最新快照。"""
        normalized_rows = self.normalize_analysis_item_checkpoint_upsert_rows(
            checkpoints
        )

        if not normalized_rows:
            return self.get_analysis_item_checkpoints()

        with self.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_item_checkpoints(normalized_rows)

        return self.get_analysis_item_checkpoints()

    def get_analysis_task_observations(
        self, *, task_fingerprint: str | None = None
    ) -> list[dict[str, Any]]:
        """返回任务级 observation 快照。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return []

            raw_rows = db.get_analysis_task_observations(
                task_fingerprint=task_fingerprint
            )

        normalized_rows: list[dict[str, Any]] = []
        for raw_row in raw_rows:
            observation = self.normalize_analysis_task_observation(raw_row)
            if observation is None:
                continue
            normalized_rows.append(observation)
        return normalized_rows

    def get_analysis_candidate_aggregate(self) -> dict[str, dict[str, Any]]:
        """返回项目级候选池汇总，以 src 为键。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return {}

            raw_rows = db.get_analysis_candidate_aggregates()

        return self.normalize_analysis_candidate_aggregate_rows(raw_rows)

    def get_analysis_candidate_count(self) -> int:
        """候选数量只统计真正能导入正式术语表的条目。"""
        return len(self.build_analysis_glossary_from_candidates())

    def upsert_analysis_candidate_aggregate(
        self, aggregates: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """批量写入项目级候选池汇总。"""
        normalized_rows: list[dict[str, Any]] = []
        for raw_src, raw_entry in aggregates.items():
            src = str(raw_src).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_entry)
            if entry is None:
                continue

            normalized_rows.append(
                {
                    "src": entry["src"],
                    "dst_votes": dict(entry["dst_votes"]),
                    "info_votes": dict(entry["info_votes"]),
                    "observation_count": entry["observation_count"],
                    "first_seen_at": entry["first_seen_at"],
                    "last_seen_at": entry["last_seen_at"],
                    "case_sensitive": entry["case_sensitive"],
                }
            )

        if not normalized_rows:
            return self.get_analysis_candidate_aggregate()

        with self.state_lock:
            db = self.session.db
            if db is None:
                return {}
            db.upsert_analysis_candidate_aggregates(normalized_rows)

        return self.get_analysis_candidate_aggregate()

    def merge_analysis_candidate_aggregate(
        self, incoming_pool: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """兼容旧调用口径：直接把票池合并进 aggregate。"""
        if not incoming_pool:
            return self.get_analysis_candidate_aggregate()

        merged_pool = self.get_analysis_candidate_aggregate()
        for raw_src, raw_entry in incoming_pool.items():
            src = str(raw_src).strip()
            incoming_entry = self.normalize_analysis_candidate_aggregate_entry(
                src,
                raw_entry,
            )
            if incoming_entry is None:
                continue

            existing_entry = merged_pool.get(incoming_entry["src"])
            if existing_entry is None:
                merged_pool[incoming_entry["src"]] = incoming_entry
                continue

            for dst, votes in incoming_entry["dst_votes"].items():
                existing_votes = existing_entry["dst_votes"].get(dst, 0)
                existing_entry["dst_votes"][dst] = existing_votes + votes
            for info, votes in incoming_entry["info_votes"].items():
                existing_votes = existing_entry["info_votes"].get(info, 0)
                existing_entry["info_votes"][info] = existing_votes + votes

            existing_entry["observation_count"] = int(
                existing_entry.get("observation_count", 0)
            ) + int(incoming_entry["observation_count"])
            existing_entry["first_seen_at"] = min(
                str(
                    existing_entry.get("first_seen_at", incoming_entry["first_seen_at"])
                ),
                incoming_entry["first_seen_at"],
            )
            existing_entry["last_seen_at"] = max(
                str(existing_entry.get("last_seen_at", incoming_entry["last_seen_at"])),
                incoming_entry["last_seen_at"],
            )
            existing_entry["case_sensitive"] = bool(
                existing_entry.get("case_sensitive", False)
                or incoming_entry["case_sensitive"]
            )

        return self.upsert_analysis_candidate_aggregate(merged_pool)

    def commit_analysis_task_result(
        self,
        *,
        task_fingerprint: str = "",
        checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        """原子提交单个分析任务的结果，并把进度快照和候选池保持同事务。"""
        task_key = task_fingerprint.strip()
        if task_key == "":
            return 0
        if checkpoints is None:
            checkpoints = []
        if glossary_entries is None:
            glossary_entries = []

        normalized_checkpoints = self.normalize_analysis_item_checkpoint_upsert_rows(
            checkpoints
        )
        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        now = datetime.now().isoformat()
        normalized_observations = self.build_analysis_task_observations_for_commit(
            task_key,
            glossary_entries,
            created_at=now,
        )

        with self.state_lock:
            db = self.session.db
            if db is None:
                return 0

            with db.connection() as conn:
                existing_rows = db.get_analysis_task_observations(
                    task_fingerprint=task_key,
                    conn=conn,
                )
                new_observations = self.collect_new_analysis_task_observations(
                    existing_rows,
                    normalized_observations,
                )

                inserted_count = db.insert_analysis_task_observations(
                    self.build_analysis_task_observation_insert_rows(new_observations),
                    conn=conn,
                )

                touched_srcs = sorted(
                    {observation["src"] for observation in new_observations}
                )
                if touched_srcs:
                    aggregate_map = self.normalize_analysis_candidate_aggregate_rows(
                        db.get_analysis_candidate_aggregates_by_srcs(
                            touched_srcs,
                            conn=conn,
                        )
                    )
                    self.merge_analysis_observations_into_candidate_aggregates(
                        new_observations,
                        aggregate_map,
                    )

                    db.upsert_analysis_candidate_aggregates(
                        self.build_analysis_candidate_aggregate_upsert_rows(
                            aggregate_map,
                            touched_srcs,
                        ),
                        conn=conn,
                    )

                if normalized_checkpoints:
                    db.upsert_analysis_item_checkpoints(
                        normalized_checkpoints, conn=conn
                    )

                self.persist_analysis_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_progress_snapshot,
                    added_glossary_delta=inserted_count,
                )

                conn.commit()

        return inserted_count

    def build_analysis_glossary_entry_from_candidate(
        self, src: str, entry: dict[str, Any]
    ) -> dict[str, Any] | None:
        """把候选池单项票选成正式术语；不可导入时返回 None。"""
        dst = self.pick_analysis_term_pool_winner(entry.get("dst_votes", {}))
        info = self.pick_analysis_term_pool_winner(entry.get("info_votes", {}))
        normalized_info = info.strip().lower()
        is_control_code_self_mapping = self.is_analysis_control_code_self_mapping(
            src, dst
        )

        # 分析导入要求术语类型完整，避免把缺少标签的候选直接写进正式术语表。
        if src == "" or dst == "" or normalized_info == "":
            return None
        if dst == src and not is_control_code_self_mapping:
            return None
        if normalized_info in {"其它", "其他", "other"}:
            return None

        return {
            "src": src,
            "dst": dst,
            "info": info,
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

    def build_analysis_glossary_from_candidates(self) -> list[dict[str, Any]]:
        """把项目级候选池票选成可直接导入的正式术语条目。"""
        glossary_entries: list[dict[str, Any]] = []
        aggregate = self.get_analysis_candidate_aggregate()

        for src, entry in sorted(aggregate.items()):
            glossary_entry = self.build_analysis_glossary_entry_from_candidate(
                src, entry
            )
            if glossary_entry is None:
                continue
            glossary_entries.append(glossary_entry)

        return glossary_entries

    def build_analysis_glossary_import_preview(
        self, glossary_entries: list[dict[str, Any]]
    ) -> AnalysisGlossaryImportPreview:
        """在内存中预演候选导入，并附带命中统计与包含关系。

        为什么需要预演：
        新规则要求“先和现有术语表合并，再看命中效果，再决定要不要导入”，
        如果直接走写入口，缓存会先被改脏，后面的过滤就没法保持只读决策。
        """

        current_glossary = self.get_glossary()
        preview = QualityRuleMerger.preview_merge(
            rule_type=QualityRuleMerger.RuleType.GLOSSARY,
            existing=current_glossary,
            incoming=glossary_entries,
            merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
        )

        merged_entries = tuple(dict(entry) for entry in preview.merged)
        preview_entries: list[AnalysisGlossaryImportPreviewEntry] = []
        relation_target_candidates: list[tuple[str, str]] = []
        for preview_entry in preview.entries:
            statistics_key = QualityRuleStatistics.build_glossary_rule_stat_key(
                preview_entry.entry
            )
            if statistics_key == "":
                continue
            preview_entries.append(
                AnalysisGlossaryImportPreviewEntry(
                    entry=dict(preview_entry.entry),
                    statistics_key=statistics_key,
                    is_new=preview_entry.is_new,
                    incoming_indexes=preview_entry.incoming_indexes,
                )
            )
            if not preview_entry.is_new:
                continue
            src = str(preview_entry.entry.get("src", "")).strip()
            if src == "":
                continue
            relation_target_candidates.append((statistics_key, src))

        src_texts, dst_texts = self.collect_rule_statistics_texts()
        statistics_snapshot = QualityRuleStatistics.build_rule_statistics_snapshot(
            rules=tuple(
                QualityRuleStatistics.build_glossary_rule_stat_inputs(merged_entries)
            ),
            src_texts=src_texts,
            dst_texts=dst_texts,
            relation_candidates=QualityRuleStatistics.build_subset_relation_candidates(
                merged_entries,
                key_builder=QualityRuleStatistics.build_glossary_rule_stat_key,
            ),
            relation_target_candidates=tuple(relation_target_candidates),
        )

        return AnalysisGlossaryImportPreview(
            merged_entries=merged_entries,
            report=preview.report,
            entries=tuple(preview_entries),
            statistics_results=statistics_snapshot.results,
            subset_parents=statistics_snapshot.subset_parents,
        )

    def filter_analysis_glossary_import_candidates(
        self,
        glossary_entries: list[dict[str, Any]],
        preview: AnalysisGlossaryImportPreview,
    ) -> list[dict[str, Any]]:
        """按预演统计结果过滤低价值新增候选。

        约束：
        - 只过滤新增条目，不动现有正式术语的补空机会
        - 命中数 <= 1 的新增条目直接过滤
        - 和更长条目互相包含、且命中数相同的新增短条目过滤
        """

        filtered_indexes: set[int] = set()
        key_by_src: dict[str, str] = {}

        def get_matched_item_count(statistics_key: str) -> int:
            result = preview.statistics_results.get(statistics_key)
            if result is None:
                return 0
            return int(result.matched_item_count)

        for preview_entry in preview.entries:
            src = str(preview_entry.entry.get("src", "")).strip()
            if src == "":
                continue
            key_by_src[src] = preview_entry.statistics_key

        for preview_entry in preview.entries:
            if not preview_entry.is_new:
                continue

            if self.is_analysis_control_code_self_mapping(
                str(preview_entry.entry.get("src", "")).strip(),
                str(preview_entry.entry.get("dst", "")).strip(),
            ):
                continue

            matched_item_count = get_matched_item_count(preview_entry.statistics_key)
            if matched_item_count <= 1:
                filtered_indexes.update(preview_entry.incoming_indexes)
                continue

            child_src = str(preview_entry.entry.get("src", "")).strip()
            if child_src == "":
                continue

            for parent_src in preview.subset_parents.get(
                preview_entry.statistics_key,
                tuple(),
            ):
                parent_key = key_by_src.get(parent_src, "")
                if parent_key == "":
                    continue

                parent_count = get_matched_item_count(parent_key)
                if parent_count != matched_item_count:
                    continue
                if len(parent_src) < len(child_src):
                    continue

                filtered_indexes.update(preview_entry.incoming_indexes)
                break

        if not filtered_indexes:
            return [dict(entry) for entry in glossary_entries]

        filtered_entries: list[dict[str, Any]] = []
        for index, entry in enumerate(glossary_entries):
            if index in filtered_indexes:
                continue
            filtered_entries.append(dict(entry))
        return filtered_entries

    def import_analysis_candidates(
        self, expected_lg_path: str | None = None
    ) -> int | None:
        """把候选池按“新增 + 补空”导入正式术语表。

        返回值约定：
        - `None`：当前工程会话无效，或后台线程已经切换到别的工程
        - `0`：导入流程成功结束，但没有新增或补空条目
        - `> 0`：实际写入正式术语表的条目数量
        """
        with self.state_lock:
            if self.session.db is None or self.session.lg_path is None:
                return None
            if (
                expected_lg_path is not None
                and self.session.lg_path != expected_lg_path
            ):
                return None

            glossary_entries = self.build_analysis_glossary_from_candidates()
            if not glossary_entries:
                # 没有可导入候选不算失败；上层会统一提示“完成但新增 0 条”。
                return 0

            preview = self.build_analysis_glossary_import_preview(glossary_entries)
            filtered_glossary_entries = self.filter_analysis_glossary_import_candidates(
                glossary_entries,
                preview,
            )
            if not filtered_glossary_entries:
                return 0

            merged, report = self.merge_glossary_incoming(
                filtered_glossary_entries,
                merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
                save=False,
            )
            if merged is None:
                # 与现有术语表完全一致时也按成功收口，避免把“无变化”误报成错误。
                return 0

            self.batch_service.update_batch(
                items=None,
                rules={DataManager.RuleType.GLOSSARY: merged},
                meta=None,
            )
            imported_count = int(report.added) + int(report.filled)

        self.emit_quality_rule_update(rule_types=[DataManager.RuleType.GLOSSARY])
        return imported_count

    def clear_analysis_progress(self) -> None:
        """清空分析快照、检查点和候选池，保证整个分析状态完全重置。"""
        with self.state_lock:
            db = self.session.db
            if db is not None:
                with db.connection() as conn:
                    db.delete_analysis_item_checkpoints(conn=conn)
                    db.clear_analysis_task_observations(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

        self.set_analysis_extras({})
        # 兼容旧调用口径：这里继续把 legacy meta 清空，但它们不再是权威来源。
        self.set_meta("analysis_state", {})
        self.set_meta("analysis_term_pool", {})

    def clear_analysis_candidates_and_progress(self) -> None:
        """新口径下的“重置全部”入口。"""
        self.clear_analysis_progress()

    def reset_failed_analysis_checkpoints(self) -> int:
        """仅清除失败检查点，不动候选池和成功检查点。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return 0
            return db.delete_analysis_item_checkpoints(
                status=Base.ProjectStatus.ERROR.value
            )

    def get_analysis_status_summary(self) -> dict[str, Any]:
        """按当前条目文本重新计算分析覆盖率，避免 UI 读到陈旧快照。"""
        checkpoints = self.get_analysis_item_checkpoints()
        total_line = 0
        processed_line = 0
        error_line = 0

        for item in self.get_all_items():
            if self.is_skipped_analysis_status(item.get_status()):
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            source_text = self.build_analysis_source_text(item)
            if source_text == "":
                continue

            total_line += 1
            source_hash = self.build_analysis_source_hash(source_text)
            checkpoint = checkpoints.get(item_id)
            if checkpoint is None:
                continue
            if checkpoint["source_hash"] != source_hash:
                continue

            status = checkpoint["status"]
            if status == Base.ProjectStatus.PROCESSED:
                processed_line += 1
            elif status == Base.ProjectStatus.ERROR:
                error_line += 1

        pending_line = max(0, total_line - processed_line - error_line)
        return {
            "total_line": total_line,
            "processed_line": processed_line,
            "error_line": error_line,
            "line": processed_line + error_line,
            "pending_line": pending_line,
        }

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        """把持久化快照和当前覆盖率合并，供 UI 和调度层统一消费。"""
        snapshot = {
            "start_time": 0.0,
            "time": 0.0,
            "total_line": 0,
            "line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "added_glossary": 0,
        }
        snapshot.update(self.get_analysis_extras())

        status_summary = self.get_analysis_status_summary()
        snapshot["total_line"] = status_summary["total_line"]
        snapshot["line"] = status_summary["line"]
        snapshot["processed_line"] = status_summary["processed_line"]
        snapshot["error_line"] = status_summary["error_line"]
        return snapshot

    def update_analysis_progress_snapshot(
        self, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        """统一写入分析进度快照，避免多个入口各自拼字段。"""
        normalized_snapshot = self.normalize_analysis_progress_snapshot(snapshot)
        self.set_analysis_extras(normalized_snapshot)
        return normalized_snapshot

    def get_pending_analysis_items(self) -> list[Item]:
        """找出当前仍需进入分析任务的条目。"""
        checkpoints = self.get_analysis_item_checkpoints()
        pending_items: list[Item] = []

        for item in self.get_all_items():
            if self.is_skipped_analysis_status(item.get_status()):
                continue

            item_id = item.get_id()
            if not isinstance(item_id, int):
                continue

            source_text = self.build_analysis_source_text(item)
            if source_text == "":
                continue

            source_hash = self.build_analysis_source_hash(source_text)
            checkpoint = checkpoints.get(item_id)
            if checkpoint is not None:
                if (
                    checkpoint["status"] == Base.ProjectStatus.PROCESSED
                    and checkpoint["source_hash"] == source_hash
                ):
                    continue

            pending_items.append(item)

        return pending_items

    def update_analysis_task_error(
        self,
        checkpoints: list[dict[str, Any]],
        progress_snapshot: dict[str, Any] | None = None,
    ) -> dict[int, dict[str, Any]]:
        """任务失败后只记录当前 hash 的失败检查点，并与进度快照同事务落库。"""
        normalized_progress_snapshot = None
        if progress_snapshot is not None:
            normalized_progress_snapshot = self.normalize_analysis_progress_snapshot(
                progress_snapshot
            )

        now_text = datetime.now().isoformat()
        with self.state_lock:
            db = self.session.db
            if db is None:
                return {}

            with db.connection() as conn:
                existing = self.normalize_analysis_item_checkpoint_rows(
                    db.get_analysis_item_checkpoints(conn=conn)
                )
                error_rows, updated_checkpoints = (
                    self.build_analysis_error_checkpoint_rows(
                        checkpoints,
                        existing,
                        updated_at=now_text,
                    )
                )

                if error_rows:
                    db.upsert_analysis_item_checkpoints(error_rows, conn=conn)

                self.persist_analysis_progress_snapshot_with_db(
                    db,
                    conn,
                    normalized_progress_snapshot,
                )

                conn.commit()
                return updated_checkpoints

    def get_analysis_term_pool(self) -> dict[str, dict[str, Any]]:
        """兼容旧接口：直接返回 aggregate 映射。"""
        return self.get_analysis_candidate_aggregate()

    def set_analysis_term_pool(self, pool: dict[str, dict[str, Any]]) -> None:
        """兼容旧接口：用旧票池结构重建 aggregate。"""
        with self.state_lock:
            db = self.session.db
            if db is not None:
                with db.connection() as conn:
                    db.clear_analysis_task_observations(conn=conn)
                    db.clear_analysis_candidate_aggregates(conn=conn)
                    conn.commit()

        normalized: dict[str, dict[str, Any]] = {}
        for raw_src, raw_entry in pool.items():
            src = str(raw_src).strip()
            entry = self.normalize_analysis_candidate_aggregate_entry(src, raw_entry)
            if entry is None:
                continue
            normalized[entry["src"]] = entry

        if normalized:
            self.upsert_analysis_candidate_aggregate(normalized)
        self.set_meta("analysis_term_pool", {})

    def clear_analysis_term_pool(self) -> None:
        """兼容旧接口：清空候选池相关表，但不动 checkpoint。"""
        with self.state_lock:
            db = self.session.db
            if db is None:
                return

            with db.connection() as conn:
                db.clear_analysis_task_observations(conn=conn)
                db.clear_analysis_candidate_aggregates(conn=conn)
                conn.commit()

        self.set_meta("analysis_term_pool", {})

    def merge_analysis_term_votes(
        self, incoming_pool: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """兼容旧接口：把旧票池结构并入 aggregate。"""
        return self.merge_analysis_candidate_aggregate(incoming_pool)

    def build_analysis_glossary_from_term_pool(self) -> list[dict[str, Any]]:
        """兼容旧接口：候选池来源已切到 aggregate。"""
        return self.build_analysis_glossary_from_candidates()

    def import_analysis_term_pool(
        self, expected_lg_path: str | None = None
    ) -> int | None:
        """兼容旧接口：导入逻辑改为“新增 + 补空”且不清空候选池。"""
        return self.import_analysis_candidates(expected_lg_path=expected_lg_path)

    def reset_failed_items_sync(self) -> dict[str, Any] | None:
        """重置失败条目并同步进度元数据。

        用途：
        - GUI 的“重置失败项”按钮
        - CLI 的 --reset_failed

        约束：该方法会写 DB；GUI 模式下应在后台线程调用。
        """

        if not self.is_loaded():
            return None

        items = self.get_all_items()
        if not items:
            return None

        changed_items: list[dict[str, Any]] = []
        for item in items:
            if item.get_status() != Base.ProjectStatus.ERROR:
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
            if item.get_status()
            in (
                Base.ProjectStatus.NONE,
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.ERROR,
            )
        )

        extras = self.get_translation_extras()
        extras["processed_line"] = processed_line
        extras["error_line"] = error_line
        extras["line"] = processed_line + error_line
        extras["total_line"] = total_line

        project_status = (
            Base.ProjectStatus.PROCESSING
            if any(item.get_status() == Base.ProjectStatus.NONE for item in items)
            else Base.ProjectStatus.PROCESSED
        )

        # 单次事务写入：确保 items/meta 一致。
        self.update_batch(
            items=changed_items or None,
            meta={
                "translation_extras": extras,
                "project_status": project_status,
            },
        )

        return extras

    # ===================== rules =====================

    def get_rules_cached(self, rule_type: LGDatabase.RuleType) -> list[dict[str, Any]]:
        return self.rule_service.get_rules_cached(rule_type)

    def set_rules_cached(
        self,
        rule_type: LGDatabase.RuleType,
        data: list[dict[str, Any]],
        save: bool = True,
    ) -> None:
        normalized = self.normalize_quality_rules_for_write(rule_type, data)
        self.rule_service.set_rules_cached(rule_type, normalized, save)
        if save:
            self.emit_quality_rule_update(rule_types=[rule_type])

    def normalize_quality_rules_for_write(
        self, rule_type: LGDatabase.RuleType, data: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """写入口兜底：落库前统一收敛重复与空 src。

        为什么放在 DataManager：这里是规则写入的权威入口，能覆盖 UI 手动保存/导入、
        自动术语表写回、以及未来新增入口，保证落库后不变式成立。
        """

        try:
            quality_type = QualityRuleMerger.RuleType(rule_type.value)
        except ValueError:
            return data

        merged, _ = QualityRuleMerger.merge(
            rule_type=quality_type,
            existing=[],
            incoming=data,
            merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
        )
        return merged

    def get_rule_text_cached(self, rule_type: LGDatabase.RuleType) -> str:
        return self.rule_service.get_rule_text_cached(rule_type)

    def set_rule_text_cached(self, rule_type: LGDatabase.RuleType, text: str) -> None:
        self.rule_service.set_rule_text_cached(rule_type, text)
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
        return self.get_rules_cached(LGDatabase.RuleType.GLOSSARY)

    def set_glossary(self, data: list[dict[str, Any]], save: bool = True) -> None:
        self.set_rules_cached(LGDatabase.RuleType.GLOSSARY, data, save)

    def merge_glossary_incoming(
        self,
        incoming: list[dict[str, Any]],
        *,
        merge_mode: QualityRuleMerger.MergeMode,
        save: bool = False,
    ) -> tuple[list[dict[str, Any]] | None, QualityRuleMerger.Report]:
        """将 incoming 合并进当前 glossary，并按 merge_mode 收敛重复。

        自动术语表写回是隐式入口，必须用 FILL_EMPTY（只补空、且不改变
        case_sensitive），避免在翻译过程中覆盖用户的显式编辑。
        """

        with self.state_lock:
            current = self.get_glossary()
            merged, report = QualityRuleMerger.merge(
                rule_type=QualityRuleMerger.RuleType.GLOSSARY,
                existing=current,
                incoming=incoming,
                merge_mode=merge_mode,
            )

            changed = any(
                (
                    report.added,
                    report.updated,
                    report.filled,
                    report.deduped,
                    report.skipped_empty_src,
                )
            )
            if not changed:
                return None, report

            # 仅更新缓存；实际写入由调用方决定是否通过 update_batch 提交。
            self.set_glossary(merged, save=save)
            return merged, report

    def get_glossary_enable(self) -> bool:
        return bool(self.get_meta("glossary_enable", True))

    def set_glossary_enable(self, enable: bool) -> None:
        self.set_meta("glossary_enable", bool(enable))

    def get_text_preserve(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE)

    def set_text_preserve(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.TEXT_PRESERVE, data, True)

    def get_text_preserve_mode(self) -> TextPreserveMode:
        raw = self.get_meta(
            "text_preserve_mode", __class__.TextPreserveMode.SMART.value
        )
        if isinstance(raw, str):
            try:
                return __class__.TextPreserveMode(raw)
            except ValueError:
                pass

        return __class__.TextPreserveMode.SMART

    def set_text_preserve_mode(self, mode: TextPreserveMode | str) -> None:
        try:
            normalized = (
                mode
                if isinstance(mode, __class__.TextPreserveMode)
                else __class__.TextPreserveMode(str(mode))
            )
        except ValueError:
            normalized = __class__.TextPreserveMode.OFF

        # 新语义的唯一权威来源
        self.set_meta("text_preserve_mode", normalized.value)

    def get_pre_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT)

    def set_pre_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.PRE_REPLACEMENT, data, True)

    def get_pre_replacement_enable(self) -> bool:
        return bool(self.get_meta("pre_translation_replacement_enable", True))

    def set_pre_replacement_enable(self, enable: bool) -> None:
        self.set_meta("pre_translation_replacement_enable", bool(enable))

    def get_post_replacement(self) -> list[dict[str, Any]]:
        return self.get_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT)

    def set_post_replacement(self, data: list[dict[str, Any]]) -> None:
        self.set_rules_cached(LGDatabase.RuleType.POST_REPLACEMENT, data, True)

    def get_post_replacement_enable(self) -> bool:
        return bool(self.get_meta("post_translation_replacement_enable", True))

    def set_post_replacement_enable(self, enable: bool) -> None:
        self.set_meta("post_translation_replacement_enable", bool(enable))

    def get_translation_prompt(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.TRANSLATION_PROMPT)

    def set_translation_prompt(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.TRANSLATION_PROMPT, text)

    def get_translation_prompt_enable(self) -> bool:
        return bool(self.get_meta("translation_prompt_enable", False))

    def set_translation_prompt_enable(self, enable: bool) -> None:
        self.set_meta("translation_prompt_enable", bool(enable))

    def get_analysis_prompt(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.ANALYSIS_PROMPT)

    def set_analysis_prompt(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.ANALYSIS_PROMPT, text)

    def get_analysis_prompt_enable(self) -> bool:
        return bool(self.get_meta("analysis_prompt_enable", False))

    def set_analysis_prompt_enable(self, enable: bool) -> None:
        self.set_meta("analysis_prompt_enable", bool(enable))

    # ===================== items =====================

    def clear_item_cache(self) -> None:
        self.item_service.clear_item_cache()

    def get_all_items(self) -> list[Item]:
        return self.item_service.get_all_items()

    @staticmethod
    def normalize_rule_statistics_text(value: Any) -> str:
        """把统计输入统一转成字符串，避免页面与导入过滤各自兜底。"""

        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)

    @staticmethod
    def normalize_rule_statistics_status(value: Any) -> Base.ProjectStatus:
        """把条目状态规整成枚举，避免统计口径被脏数据带偏。"""

        if isinstance(value, Base.ProjectStatus):
            return value
        if isinstance(value, str):
            try:
                return Base.ProjectStatus(value)
            except ValueError:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE

    def collect_rule_statistics_texts(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """提取规则统计使用的 src/dst 文本快照。

        为什么放在 DataManager：
        术语页统计和分析导入过滤都依赖同一份工程条目口径，
        由数据层集中维护，能避免两边状态筛选慢慢漂移。
        """

        item_dicts = self.get_all_item_dicts()
        src_texts: list[str] = []
        dst_texts: list[str] = []
        for item in item_dicts:
            if not isinstance(item, dict):
                continue

            status = self.normalize_rule_statistics_status(item.get("status"))
            if status not in self.RULE_STATISTICS_COUNTED_STATUSES:
                continue

            src_texts.append(self.normalize_rule_statistics_text(item.get("src", "")))
            dst_texts.append(self.normalize_rule_statistics_text(item.get("dst", "")))

        return tuple(src_texts), tuple(dst_texts)

    def get_all_item_dicts(self) -> list[dict[str, Any]]:
        """获取 items 的原始 dict 快照。

        统计类后台任务只需要只读文本数据；直接复用 ItemService 的快照接口，
        可以避免在 UI 线程构造大量 Item 对象。
        """

        # 返回浅拷贝快照，防止后台统计流程意外修改 ItemService 缓存中的原始 dict。
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
            keys = [k for k in meta.keys() if k in self.RULE_META_KEYS]
            if keys:
                self.emit_quality_rule_update(meta_keys=keys)

    def get_items_for_translation(
        self,
        config: Config,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        return self.translation_item_service.get_items_for_translation(config, mode)

    # ===================== assets =====================

    def get_all_asset_paths(self) -> list[str]:
        return self.asset_service.get_all_asset_paths()

    def get_asset(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset(rel_path)

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        return self.asset_service.get_asset_decompressed(rel_path)

    # ===================== project file ops =====================

    def is_file_op_running(self) -> bool:
        with self.file_op_lock:
            return self.file_op_running

    def try_begin_file_operation(self) -> bool:
        with self.file_op_lock:
            if self.file_op_running:
                return False
            self.file_op_running = True
            return True

    def finish_file_operation(self) -> None:
        with self.file_op_lock:
            self.file_op_running = False

    def emit_task_running_warning(self) -> None:
        """统一忙碌态提示，避免不同文件操作入口把同一句话写散。"""

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().task_running,
            },
        )

    def try_begin_guarded_file_operation(self) -> bool:
        """在数据层兜底拦住忙碌态文件操作，避免非 UI 入口把刷新链卡住。"""

        # 文件操作会依赖后续 prefilter 收尾来刷新工作台，因此这里必须和 UI 一样拦住忙碌态。
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
        action: Callable[[], None],
        error_message: str,
    ) -> None:
        """统一封装文件操作线程，保证四个入口的提示、预过滤与收尾一致。"""

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
                action()
                # 文件变更会引入/移除条目：需要重新跑预过滤，确保跳过/重复等状态一致。
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
                self.emit(
                    Base.Event.PROGRESS_TOAST,
                    {"sub_event": Base.SubEvent.DONE},
                )
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

    def build_workbench_snapshot(self) -> WorkbenchSnapshot:
        """构建工作台文件列表快照。

        该方法不触达 UI，可安全在后台线程调用。
        """

        asset_paths = self.get_all_asset_paths()
        item_dicts = self.get_all_item_dicts()

        # 工作台的条目统计口径对齐“可翻译条目”，避免把预过滤跳过项也算作未翻译。
        counted_statuses = {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSING,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
            Base.ProjectStatus.ERROR,
        }
        translated_statuses = {
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }

        total_items = 0
        translated = 0
        translated_in_past = 0
        count_by_path: dict[str, int] = defaultdict(int)
        file_type_by_path: dict[str, Item.FileType] = {}
        for item in GapTool.iter(item_dicts):
            rel_path = item.get("file_path")
            if not isinstance(rel_path, str) or rel_path == "":
                continue

            if rel_path not in file_type_by_path:
                raw_type = item.get("file_type")
                if (
                    isinstance(raw_type, str)
                    and raw_type
                    and raw_type != Item.FileType.NONE
                ):
                    try:
                        file_type_by_path[rel_path] = Item.FileType(raw_type)
                    except ValueError:
                        # 旧数据或外部导入可能存在未知类型，这里保持 NONE。
                        pass

            status = item.get("status", Base.ProjectStatus.NONE)
            if status not in counted_statuses:
                continue

            total_items += 1
            count_by_path[rel_path] += 1
            if status in translated_statuses:
                translated += 1
            if status == Base.ProjectStatus.PROCESSED_IN_PAST:
                translated_in_past += 1

        untranslated = max(0, total_items - translated)
        entries: list[WorkbenchFileEntrySnapshot] = []
        for rel_path in GapTool.iter(asset_paths):
            entries.append(
                WorkbenchFileEntrySnapshot(
                    rel_path=rel_path,
                    item_count=count_by_path.get(rel_path, 0),
                    file_type=file_type_by_path.get(rel_path, Item.FileType.NONE),
                )
            )

        return WorkbenchSnapshot(
            file_count=len(asset_paths),
            total_items=total_items,
            translated=translated,
            translated_in_past=translated_in_past,
            untranslated=untranslated,
            entries=tuple(entries),
        )

    def schedule_add_file(self, file_path: str) -> None:
        def run_action() -> None:
            self.add_file(file_path)

        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_adding_file,
            run_action,
            f"Failed to add file: {file_path}",
        )

    def schedule_update_file(self, rel_path: str, new_file_path: str) -> None:
        def run_action() -> None:
            self.update_file(rel_path, new_file_path)

        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_updating_file,
            run_action,
            f"Failed to update file: {rel_path} -> {new_file_path}",
        )

    def schedule_reset_file(self, rel_path: str) -> None:
        def run_action() -> None:
            self.reset_file(rel_path)

        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_resetting_file,
            run_action,
            f"Failed to reset file: {rel_path}",
        )

    def schedule_delete_file(self, rel_path: str) -> None:
        def run_action() -> None:
            self.delete_file(rel_path)

        self.schedule_guarded_file_operation(
            Localizer.get().workbench_progress_deleting_file,
            run_action,
            f"Failed to delete file: {rel_path}",
        )

    def add_file(self, file_path: str) -> None:
        ext = Path(file_path).suffix.lower()
        if ext not in self.get_supported_extensions():
            raise ValueError(Localizer.get().workbench_msg_unsupported_format)

        rel_path = os.path.basename(file_path)

        with self.state_lock:
            db = self.session.db
        if db is None:
            raise RuntimeError("工程未加载")

        if db.asset_path_exists(rel_path):
            raise ValueError(Localizer.get().workbench_msg_file_exists)

        with open(file_path, "rb") as f:
            original_data = f.read()

        # 避免循环依赖：延迟导入 FileManager
        from module.File.FileManager import FileManager

        file_manager = FileManager(Config().load())
        items = file_manager.parse_asset(rel_path, original_data)
        items_dicts: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            items_dicts.append(item.to_dict())

        compressed = ZstdTool.compress(original_data)
        db.add_asset(rel_path, compressed, len(original_data))
        db.insert_items(items_dicts)

        self.item_service.clear_item_cache()
        self.clear_analysis_progress()
        self.emit(Base.Event.PROJECT_FILE_UPDATE, {"rel_path": rel_path})

    def update_file(self, rel_path: str, new_file_path: str) -> dict:
        """更新工程内文件：以新文件为准，仅继承旧工程的完成态译文成果。"""
        with self.state_lock:
            db = self.session.db
        if db is None:
            raise RuntimeError("工程未加载")

        def build_target_rel_path(old_rel_path: str, file_path: str) -> str:
            # 更新时只跟随“文件名”变化，目录层级保持不变，避免隐式移动文件。
            new_name = os.path.basename(file_path)
            if not new_name:
                return old_rel_path
            parent = Path(old_rel_path).parent
            if str(parent) in {".", ""}:
                return new_name
            return str(parent / new_name)

        target_rel_path = build_target_rel_path(rel_path, new_file_path)
        if target_rel_path.casefold() == rel_path.casefold():
            target_rel_path = rel_path

        old_items = db.get_items_by_file_path(rel_path)

        with open(new_file_path, "rb") as f:
            original_data = f.read()

        from module.File.FileManager import FileManager

        file_manager = FileManager(Config().load())
        new_items = file_manager.parse_asset(target_rel_path, original_data)
        new_items_dicts: list[dict[str, Any]] = []
        for item in GapTool.iter(new_items):
            new_items_dicts.append(item.to_dict())

        def pick_file_type(items: list[dict[str, Any]]) -> str:
            for item in GapTool.iter(items):
                raw = item.get("file_type")
                if isinstance(raw, str) and raw and raw != Item.FileType.NONE:
                    return raw
            return str(Item.FileType.NONE)

        old_type = pick_file_type(old_items)
        new_type = pick_file_type(new_items_dicts)
        if old_type != new_type:
            raise ValueError(Localizer.get().workbench_msg_update_format_mismatch)

        if not db.asset_path_exists(rel_path):
            raise ValueError(Localizer.get().workbench_msg_file_not_found)

        if target_rel_path.casefold() != rel_path.casefold():
            for existing in db.get_all_asset_paths():
                if not isinstance(existing, str) or existing == "":
                    continue
                if existing.casefold() == rel_path.casefold():
                    continue
                if existing.casefold() == target_rel_path.casefold():
                    raise ValueError(
                        Localizer.get().workbench_msg_update_name_conflict.replace(
                            "{NAME}", existing
                        )
                    )

        # 同一 src 可能对应多种译法：优先选择出现次数最多的 dst；若并列则取最早出现的。
        src_best: dict[str, dict[str, Any]] = {}
        src_seen_order: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in GapTool.iter(old_items):
            src = item.get("src")
            if isinstance(src, str):
                src_seen_order[src].append(item)

        for src, candidates in src_seen_order.items():
            dst_count: dict[str, int] = {}
            first_index: dict[str, int] = {}
            first_item: dict[str, dict[str, Any]] = {}
            for idx, cand in enumerate(candidates):
                dst = cand.get("dst")
                dst_key = dst if isinstance(dst, str) else ""
                dst_count[dst_key] = dst_count.get(dst_key, 0) + 1
                if dst_key not in first_index:
                    first_index[dst_key] = idx
                    # best_dst 的 tie-break 依赖“最早出现”，因此这里缓存第一个候选即可。
                    first_item[dst_key] = cand

            # max by (count desc, first_index asc)
            best_dst = min(
                dst_count,
                key=lambda d: (-dst_count[d], first_index.get(d, 10**9)),
            )
            # 选择最早出现的 best_dst 条目以保留其他字段（status/name_dst/etc.）。
            src_best[src] = first_item[best_dst]

        # “更新文件”的语义：新文件为权威来源；旧工程只允许提供“已完成译文成果”。
        inheritable_statuses = {
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }
        # 结构性状态来自解析/预过滤的可重算结果（例如 EXCLUDED），不应被旧工程完成态覆盖。
        structural_statuses = {
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
            Base.ProjectStatus.DUPLICATED,
        }

        def normalize_status(raw: object) -> Base.ProjectStatus:
            if isinstance(raw, Base.ProjectStatus):
                return raw
            if isinstance(raw, str):
                try:
                    return Base.ProjectStatus(raw)
                except ValueError:
                    return Base.ProjectStatus.NONE
            return Base.ProjectStatus.NONE

        matched = 0
        for item in GapTool.iter(new_items_dicts):
            src = item.get("src")
            if not isinstance(src, str):
                continue

            old = src_best.get(src)
            if not old:
                continue

            old_status = normalize_status(old.get("status", Base.ProjectStatus.NONE))
            if old_status in inheritable_statuses:
                item["dst"] = old.get("dst", "")
                item["name_dst"] = old.get("name_dst")
                item["retry_count"] = old.get("retry_count", 0)

                new_status = normalize_status(
                    item.get("status", Base.ProjectStatus.NONE)
                )
                if new_status not in structural_statuses:
                    item["status"] = old_status

            # matched 表示“按 src 找到旧条目候选”，不等价于“发生了继承”。
            matched += 1

        compressed = ZstdTool.compress(original_data)
        with db.connection() as conn:
            db.update_asset(rel_path, compressed, len(original_data), conn=conn)
            if target_rel_path != rel_path:
                db.update_asset_path(rel_path, target_rel_path, conn=conn)
            db.delete_items_by_file_path(rel_path, conn=conn)
            db.insert_items(new_items_dicts, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.state_lock:
            self.session.asset_decompress_cache.pop(rel_path, None)
            if target_rel_path != rel_path:
                self.session.asset_decompress_cache.pop(target_rel_path, None)

        self.clear_analysis_progress()
        payload: dict[str, Any] = {"rel_path": target_rel_path}
        if target_rel_path.casefold() != rel_path.casefold():
            payload["old_rel_path"] = rel_path
        self.emit(Base.Event.PROJECT_FILE_UPDATE, payload)

        total = len(new_items_dicts)
        return {"matched": matched, "new": total - matched, "total": total}

    def reset_file(self, rel_path: str) -> None:
        with self.state_lock:
            db = self.session.db
        if db is None:
            raise RuntimeError("工程未加载")

        items = db.get_items_by_file_path(rel_path)
        for item in GapTool.iter(items):
            item["dst"] = ""
            item["name_dst"] = None
            item["status"] = Base.ProjectStatus.NONE
            item["retry_count"] = 0

        if items:
            db.update_batch(items=items)

        self.item_service.clear_item_cache()
        self.clear_analysis_progress()
        self.emit(Base.Event.PROJECT_FILE_UPDATE, {"rel_path": rel_path})

    def delete_file(self, rel_path: str) -> None:
        with self.state_lock:
            db = self.session.db
        if db is None:
            raise RuntimeError("工程未加载")

        with db.connection() as conn:
            db.delete_items_by_file_path(rel_path, conn=conn)
            db.delete_asset(rel_path, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.state_lock:
            self.session.asset_decompress_cache.pop(rel_path, None)
        self.clear_analysis_progress()
        self.emit(Base.Event.PROJECT_FILE_UPDATE, {"rel_path": rel_path})

    # ===================== export path =====================

    def timestamp_suffix_context(self) -> AbstractContextManager[None]:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.timestamp_suffix_context(lg_path)

    def export_custom_suffix_context(self, suffix: str) -> AbstractContextManager[None]:
        return self.export_path_service.custom_suffix_context(suffix)

    def get_translated_path(self) -> str:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.get_translated_path(lg_path)

    def get_bilingual_path(self) -> str:
        lg_path = self.get_lg_path()
        if not self.is_loaded() or not lg_path:
            raise RuntimeError("工程未加载，无法获取输出路径")
        return self.export_path_service.get_bilingual_path(lg_path)

    # ===================== project =====================

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

    def get_project_preview(self, lg_path: str) -> dict:
        return self.project_service.get_project_preview(lg_path)
