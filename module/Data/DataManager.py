import os
import threading
from collections import defaultdict
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
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
from module.Data.Type import RULE_META_KEYS
from module.Data.ZstdCodec import ZstdCodec
from module.Filter.ProjectPrefilter import ProjectPrefilter
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.Utils.GapTool import GapTool


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
    untranslated: int
    entries: tuple[WorkbenchFileEntrySnapshot, ...]


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
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_translation_activity)
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_activity)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED, self.on_translation_activity
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
            Base.Event.PROJECT_PREFILTER_RUN,
            {
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

        start_worker = False
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

        self.emit(
            Base.Event.PROJECT_PREFILTER_RUN,
            {
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
            Base.Event.PROGRESS_TOAST_SHOW,
            {
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
                            LogManager.get().info(
                                Localizer.get().translator_mtool_optimizer_pre_log.replace(
                                    "{COUNT}", str(last_result.stats.mtool_skipped)
                                )
                            )

                            # 仅在控制台输出统计信息，避免 UI Toast 产生噪音。
                            LogManager.get().print("")
                            self.emit(
                                Base.Event.PROJECT_PREFILTER_UPDATED,
                                {
                                    "reason": last_request.reason,
                                    "token": token,
                                    "lg_path": last_request.lg_path,
                                },
                            )

                        self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                        self.emit(
                            Base.Event.PROJECT_PREFILTER_DONE,
                            {
                                "reason": last_request.reason
                                if last_request
                                else "unknown",
                                "token": token,
                                "lg_path": last_request.lg_path if last_request else "",
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

            with self.prefilter_cond:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.emit(
                    Base.Event.PROJECT_PREFILTER_DONE,
                    {
                        "reason": last_request.reason if last_request else "unknown",
                        "token": token,
                        "lg_path": last_request.lg_path if last_request else "",
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
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": Localizer.get().toast_processing,
                "indeterminate": False,
                "current": 0,
                "total": progress_total,
            },
        )

        def progress_cb(current: int, total: int) -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_UPDATE,
                {
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
        }

        # 落库前二次确认工程未切换，避免把旧工程结果写入新工程。
        with self.state_lock:
            if self.session.db is None or self.session.lg_path != request.lg_path:
                return None
            self.batch_service.update_batch(items=items_dict, meta=meta)

        return result

    # ===================== meta =====================

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.meta_service.get_meta(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        self.meta_service.set_meta(key, value)
        if key in RULE_META_KEYS:
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

    def get_custom_prompt_zh(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH)

    def set_custom_prompt_zh(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, text)

    def get_custom_prompt_zh_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_zh_enable", False))

    def set_custom_prompt_zh_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_zh_enable", bool(enable))

    def get_custom_prompt_en(self) -> str:
        return self.get_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_EN)

    def set_custom_prompt_en(self, text: str) -> None:
        self.set_rule_text_cached(LGDatabase.RuleType.CUSTOM_PROMPT_EN, text)

    def get_custom_prompt_en_enable(self) -> bool:
        return bool(self.get_meta("custom_prompt_en_enable", False))

    def set_custom_prompt_en_enable(self, enable: bool) -> None:
        self.set_meta("custom_prompt_en_enable", bool(enable))

    # ===================== items =====================

    def clear_item_cache(self) -> None:
        self.item_service.clear_item_cache()

    def get_all_items(self) -> list[Item]:
        return self.item_service.get_all_items()

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
            keys = [k for k in meta.keys() if k in RULE_META_KEYS]
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

    def build_workbench_snapshot(self) -> WorkbenchSnapshot:
        """构建工作台文件列表快照。

        该方法不触达 UI，可安全在后台线程调用。
        """

        asset_paths = self.get_all_asset_paths()
        item_dicts = self.item_service.get_all_item_dicts()

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
            untranslated=untranslated,
            entries=tuple(entries),
        )

    def schedule_add_file(self, file_path: str) -> None:
        if not self.try_begin_file_operation():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        def worker() -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_SHOW,
                {
                    "message": Localizer.get().workbench_progress_adding_file,
                    "indeterminate": True,
                },
            )
            try:
                self.add_file(file_path)
                # 文件变更会引入/移除条目：需要重新跑预过滤，确保跳过/重复等状态一致。
                self.run_project_prefilter(Config().load(), reason="file_op")
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to add file: {file_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

    def schedule_update_file(self, rel_path: str, new_file_path: str) -> None:
        if not self.try_begin_file_operation():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        def worker() -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_SHOW,
                {
                    "message": Localizer.get().workbench_progress_updating_file,
                    "indeterminate": True,
                },
            )
            try:
                self.update_file(rel_path, new_file_path)
                self.run_project_prefilter(Config().load(), reason="file_op")
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(
                    f"Failed to update file: {rel_path} -> {new_file_path}",
                    e,
                )
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

    def schedule_reset_file(self, rel_path: str) -> None:
        if not self.try_begin_file_operation():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        def worker() -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_SHOW,
                {
                    "message": Localizer.get().workbench_progress_resetting_file,
                    "indeterminate": True,
                },
            )
            try:
                self.reset_file(rel_path)
                self.run_project_prefilter(Config().load(), reason="file_op")
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to reset file: {rel_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

    def schedule_delete_file(self, rel_path: str) -> None:
        if not self.try_begin_file_operation():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        def worker() -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_SHOW,
                {
                    "message": Localizer.get().workbench_progress_deleting_file,
                    "indeterminate": True,
                },
            )
            try:
                self.delete_file(rel_path)
                self.run_project_prefilter(Config().load(), reason="file_op")
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to delete file: {rel_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )
            finally:
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.finish_file_operation()

        threading.Thread(target=worker, daemon=True).start()

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

        compressed = ZstdCodec.compress(original_data)
        db.add_asset(rel_path, compressed, len(original_data))
        db.insert_items(items_dicts)

        self.item_service.clear_item_cache()
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
            for idx, cand in enumerate(candidates):
                dst = cand.get("dst")
                dst_key = dst if isinstance(dst, str) else ""
                dst_count[dst_key] = dst_count.get(dst_key, 0) + 1
                if dst_key not in first_index:
                    first_index[dst_key] = idx

            # max by (count desc, first_index asc)
            best_dst = min(
                dst_count,
                key=lambda d: (-dst_count[d], first_index.get(d, 10**9)),
            )
            # pick the earliest item with best_dst to preserve other fields (status/name_dst/etc.)
            for cand in candidates:
                dst = cand.get("dst")
                dst_key = dst if isinstance(dst, str) else ""
                if dst_key == best_dst:
                    src_best[src] = cand
                    break

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

        compressed = ZstdCodec.compress(original_data)
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
