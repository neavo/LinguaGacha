from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from typing import Any

from api.Application.AppLanguageNormalizer import AppLanguageNormalizer
from base.Base import Base
from module.Engine.Engine import Engine
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer


class RuntimeBridgeAppService:
    """Electron main TS Gateway 专用的内部运行时同步入口。"""

    TOKEN_HEADER: str = "X-LinguaGacha-Core-Token"

    def __init__(self, *, instance_token: str) -> None:
        """初始化 RuntimeBridgeAppService 依赖和状态，保持对象写入口明确。"""

        self.instance_token = instance_token.strip()
        self.data_manager = DataManager.get()
        self.engine = Engine.get()

    def get_project_state(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """读取当前项目状态，供 TS Gateway 内部桥构建同步回执。"""

        del request
        self.assert_token(handler)
        project_path = self.data_manager.get_lg_path() or ""
        return {
            "loaded": self.data_manager.is_loaded(),
            "projectPath": project_path,
            "busy": self.is_engine_busy(),
        }

    def sync(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """同步 TS 写入口后的运行时缓存，保持 Python Core 内存态一致。"""

        self.assert_token(handler)
        sync_type = str(request.get("type", ""))
        payload_raw = request.get("payload", {})
        payload = dict(payload_raw) if isinstance(payload_raw, dict) else {}

        if sync_type == "settings_changed":
            self.sync_settings(payload)
        elif sync_type == "models_changed":
            self.sync_models()
        elif sync_type == "project_rules_changed":
            self.clear_project_quality_caches(clear_prompt_cache=False)
        elif sync_type == "project_prompts_changed":
            self.clear_project_quality_caches(clear_prompt_cache=True)
        elif sync_type == "project_data_changed":
            self.clear_project_data_caches(payload)
        elif sync_type == "project_file_operation_begin":
            self.begin_project_file_operation()
        elif sync_type == "project_file_operation_end":
            self.finish_project_file_operation()
        else:
            raise ValueError(f"未知 runtime sync 类型：{sync_type}")

        return {"accepted": True}

    def assert_token(self, handler: BaseHTTPRequestHandler) -> None:
        """校验内部 runtime token，防止公开路由误触内部桥。"""

        received_token = handler.headers.get(self.TOKEN_HEADER, "").strip()
        if self.instance_token == "" or received_token != self.instance_token:
            raise ValueError("Core 内部 runtime 令牌无效。")

    def sync_settings(self, payload: dict[str, Any]) -> None:
        """刷新设置运行态，保证语言等配置改动立即生效。"""

        config = Config().load()
        app_language = AppLanguageNormalizer.normalize(config.app_language)
        config.app_language = app_language
        Localizer.set_app_language(app_language)

        keys_raw = payload.get("keys", [])
        keys = [str(key) for key in keys_raw] if isinstance(keys_raw, list) else []
        settings = payload.get("settings")
        event_payload: dict[str, object] = {"keys": keys}
        if isinstance(settings, dict):
            event_payload["settings"] = dict(settings)
        Base().emit(Base.Event.CONFIG_UPDATED, event_payload)

    def sync_models(self) -> None:
        """刷新模型运行态，保证 TS 配置写入后任务使用最新模型。"""

        config = Config().load()
        config.initialize_models()

    def is_engine_busy(self) -> bool:
        """读取 Engine 忙碌态，保持 TS 同步 mutation 与任务生命周期互斥。"""

        return bool(getattr(self.engine, "is_busy", lambda: False)())

    def begin_project_file_operation(self) -> None:
        """进入工作台文件操作临界区，复用 Python Core 侧文件互斥锁。"""

        if self.is_engine_busy():
            raise ValueError(Localizer.get().task_running)
        if not self.data_manager.try_begin_file_operation():
            raise ValueError(Localizer.get().task_running)

    def finish_project_file_operation(self) -> None:
        """释放工作台文件操作临界区，允许后续文件 mutation 继续执行。"""

        self.data_manager.finish_file_operation()

    def clear_project_quality_caches(self, *, clear_prompt_cache: bool) -> None:
        """清理项目质量缓存，确保规则和提示词改动后重新读取数据库。"""

        session = self.data_manager.session
        with session.state_lock:
            session.meta_cache = {}
            session.rule_cache.clear()
            if clear_prompt_cache:
                session.rule_text_cache.clear()

    def clear_project_data_caches(self, payload: dict[str, Any]) -> None:
        """按 TS 写入影响的 section 清理项目缓存，保留 Py 读侧重新取库能力。"""

        sections_raw = payload.get("sections", [])
        sections = (
            {str(section) for section in sections_raw if isinstance(section, str)}
            if isinstance(sections_raw, list)
            else set()
        )
        session = self.data_manager.session
        with session.state_lock:
            if (
                not sections
                or {"project", "files", "items", "analysis", "quality"} & sections
            ):
                session.meta_cache = {}
            if {"files", "items", "analysis"} & sections:
                session.item_cache = None
                session.item_cache_index = {}
            if "files" in sections:
                session.asset_decompress_cache.clear()
            if "quality" in sections:
                session.rule_cache.clear()
                session.rule_text_cache.clear()
