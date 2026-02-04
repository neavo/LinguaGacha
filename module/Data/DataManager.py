import threading
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
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
from module.Filter.ProjectPrefilter import ProjectPrefilter
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Localizer.Localizer import Localizer
from module.Utils.ChunkLimiter import ChunkLimiter


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
        self.prefilter_token: int = 0
        self.prefilter_active_token: int = 0
        self.prefilter_request_seq: int = 0
        self.prefilter_last_handled_seq: int = 0
        self.prefilter_latest_request: ProjectPrefilterRequest | None = None

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
                except Exception:
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
            target=self._project_prefilter_worker, args=(token,), daemon=True
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
        self._project_prefilter_worker(token)

    def _project_prefilter_worker(self, token: int) -> None:
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
                "message": Localizer.get().data_processing,
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
                            self.info(
                                Localizer.get().engine_task_rule_filter.replace(
                                    "{COUNT}", str(last_result.stats.rule_skipped)
                                )
                            )
                            self.info(
                                Localizer.get().engine_task_language_filter.replace(
                                    "{COUNT}", str(last_result.stats.language_skipped)
                                )
                            )
                            self.info(
                                Localizer.get().translator_mtool_optimizer_pre_log.replace(
                                    "{COUNT}", str(last_result.stats.mtool_skipped)
                                )
                            )

                            # 仅在控制台输出统计信息，避免 UI Toast 产生噪音。
                            self.print("")
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
                result = self._apply_project_prefilter_once(request)

                with self.prefilter_cond:
                    self.prefilter_last_handled_seq = request.seq
                    self.prefilter_cond.notify_all()

                if result is not None:
                    updated = True
                    last_result = result
        except Exception as e:
            self.error("Project prefilter failed", e)
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

    def _apply_project_prefilter_once(
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
                "message": Localizer.get().data_processing,
                "indeterminate": False,
                "current": 0,
                "total": progress_total,
            },
        )

        def progress_cb(current: int, total: int) -> None:
            self.emit(
                Base.Event.PROGRESS_TOAST_UPDATE,
                {
                    "message": Localizer.get().data_processing,
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
        for item in ChunkLimiter.iter(items):
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
            except Exception:
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
        self.rule_service.set_rules_cached(rule_type, data, save)
        if save:
            self.emit_quality_rule_update(rule_types=[rule_type])

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
            except Exception:
                pass

        return __class__.TextPreserveMode.SMART

    def set_text_preserve_mode(self, mode: TextPreserveMode | str) -> None:
        try:
            normalized = (
                mode
                if isinstance(mode, __class__.TextPreserveMode)
                else __class__.TextPreserveMode(str(mode))
            )
        except Exception:
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
