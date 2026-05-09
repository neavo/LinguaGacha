from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler
from typing import Any

from api.Application.AppLanguageNormalizer import AppLanguageNormalizer
from api.Contract.TaskPayloads import TaskSnapshotPayload
from base.Base import Base
from module.Engine.Engine import Engine
from module.Config import Config
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


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

    def get_task_state(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """读取内部 Engine 任务状态，公开 task snapshot 由 TS Gateway 组装。"""

        del request
        self.assert_token(handler)
        return self.build_task_state()

    def start_translation(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部翻译启动命令，并转发到 Engine 事件总线。"""

        self.assert_token(handler)
        mode = Base.TranslationMode(str(request.get("mode", Base.TranslationMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        Base().emit(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {"accepted": True}

    def stop_translation(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部翻译停止命令。"""

        del request
        self.assert_token(handler)
        Base().emit(
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True}

    def start_analysis(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部分析启动命令，并转发到 Engine 事件总线。"""

        self.assert_token(handler)
        mode = Base.AnalysisMode(str(request.get("mode", Base.AnalysisMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        Base().emit(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {"accepted": True}

    def stop_analysis(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部分析停止命令。"""

        del request
        self.assert_token(handler)
        Base().emit(
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True}

    def start_retranslate(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部重翻启动命令，Python 只负责 Engine 运行态。"""

        self.assert_token(handler)
        item_ids = self.resolve_item_ids(request.get("item_ids", []))
        if not item_ids:
            raise ValueError("请选择要重新翻译的条目。")
        if self.is_engine_busy():
            raise ValueError(Localizer.get().task_running)
        set_active_retranslate_item_ids = getattr(
            self.engine,
            "set_active_retranslate_item_ids",
            None,
        )
        if callable(set_active_retranslate_item_ids):
            set_active_retranslate_item_ids(item_ids)
        Base().emit(
            Base.Event.RETRANSLATE_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "item_ids": item_ids,
            },
        )
        return {"accepted": True}

    def translate_single(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """接收 TS Gateway 的内部单条翻译请求，继续复用 Python Engine。"""

        self.assert_token(handler)
        text = str(request.get("text", "")).strip()
        if text == "":
            raise ValueError("待翻译文本不能为空。")

        config = Config().load()
        get_active_model = getattr(config, "get_active_model", None)
        if callable(get_active_model) and get_active_model() is None:
            return {
                "success": False,
                "status": "NO_ACTIVE_MODEL",
                "dst": "",
            }

        item = Item(src=text)
        completed = threading.Event()
        result: dict[str, object] = {
            "success": False,
            "status": "TRANSLATION_FAILED",
            "dst": "",
        }

        def callback(translated_item: Item, success: bool) -> None:
            """Engine 回调只写入单条翻译结果，再释放同步等待。"""

            result["success"] = success
            result["status"] = "OK" if success else "TRANSLATION_FAILED"
            result["dst"] = translated_item.get_dst()
            completed.set()

        self.engine.translate_single_item(item, config, callback)
        completed.wait()
        return result

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
        elif sync_type == "project_load":
            self.load_project(payload)
        elif sync_type == "project_unload":
            self.unload_project()
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

    def build_task_state(self) -> dict[str, object]:
        """把 Engine 实时状态整理成内部 bridge 响应，不夹带公开进度字段。"""

        return {
            "status": self.normalize_status(),
            "busy": self.is_engine_busy(),
            "request_in_flight_count": self.get_request_in_flight_count(),
            "active_task_type": self.get_active_task_type(),
            "retranslating_item_ids": self.get_active_retranslate_item_ids(),
        }

    def build_task_snapshot(self, task_type: str) -> dict[str, object]:
        """供 Python 事件桥内部使用的临时快照，公开查询已迁到 TS。"""

        snapshot = self.data_manager.get_task_progress_snapshot(task_type)
        task_snapshot = TaskSnapshotPayload(
            task_type=task_type,
            status=self.normalize_status(),
            busy=self.is_engine_busy(),
            request_in_flight_count=self.get_request_in_flight_count(),
            line=int(snapshot.get("line", 0) or 0),
            total_line=int(snapshot.get("total_line", 0) or 0),
            processed_line=int(snapshot.get("processed_line", 0) or 0),
            error_line=int(snapshot.get("error_line", 0) or 0),
            total_tokens=int(snapshot.get("total_tokens", 0) or 0),
            total_output_tokens=int(snapshot.get("total_output_tokens", 0) or 0),
            total_input_tokens=int(snapshot.get("total_input_tokens", 0) or 0),
            time=float(snapshot.get("time", 0.0) or 0.0),
            start_time=float(snapshot.get("start_time", 0.0) or 0.0),
        ).to_dict()
        for key, value in snapshot.items():
            if key not in task_snapshot:
                task_snapshot[key] = value
        if task_type == "analysis":
            task_snapshot["analysis_candidate_count"] = int(
                self.data_manager.get_analysis_candidate_count() or 0
            )
        if task_type == "retranslate":
            task_snapshot["retranslating_item_ids"] = (
                self.get_active_retranslate_item_ids()
            )
        return task_snapshot

    def normalize_status(self) -> str:
        """把 Engine 状态统一转换成字符串，兼容真实枚举和测试桩。"""

        status = self.engine.get_status()
        return str(getattr(status, "value", status))

    def get_request_in_flight_count(self) -> int:
        """任务并发数只从 Engine 单一入口读取。"""

        get_request_in_flight_count = getattr(
            self.engine,
            "get_request_in_flight_count",
            None,
        )
        if callable(get_request_in_flight_count):
            return int(get_request_in_flight_count() or 0)
        return 0

    def get_active_task_type(self) -> str:
        """读取 Engine 当前活跃任务类型，缺失时回落 idle。"""

        get_active_task_type = getattr(self.engine, "get_active_task_type", None)
        if callable(get_active_task_type):
            return str(get_active_task_type())
        return "idle"

    def get_active_retranslate_item_ids(self) -> list[int]:
        """读取重翻运行态条目 id，并过滤非整数值。"""

        get_active_retranslate_item_ids = getattr(
            self.engine,
            "get_active_retranslate_item_ids",
            None,
        )
        raw_item_ids = (
            get_active_retranslate_item_ids()
            if callable(get_active_retranslate_item_ids)
            else []
        )
        if not isinstance(raw_item_ids, list):
            return []
        return [item_id for item_id in raw_item_ids if isinstance(item_id, int)]

    def resolve_quality_snapshot(
        self,
        request: dict[str, object],
    ) -> QualityRuleSnapshot | None:
        """把 TS 传入的质量快照还原为任务侧不可变规则输入。"""

        payload = request.get("quality_snapshot")
        if isinstance(payload, QualityRuleSnapshot):
            return payload
        if isinstance(payload, dict):
            return QualityRuleSnapshot.from_dict(payload)
        return None

    def resolve_item_ids(self, raw_item_ids: object) -> list[int]:
        """归一内部重翻 item_ids，保留请求顺序并去重。"""

        if not isinstance(raw_item_ids, list):
            return []
        item_ids: list[int] = []
        seen_ids: set[int] = set()
        for raw_item_id in raw_item_ids:
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            item_ids.append(item_id)
        return item_ids

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

    def unload_project(self) -> None:
        """经内部桥卸载 Python 工程会话，保持公开 TS 响应与 Core 状态一致。"""

        self.data_manager.unload_project()

    def load_project(self, payload: dict[str, Any]) -> None:
        """经内部桥加载 Python 工程会话，只作为未迁 Engine 的读侧同步层。"""

        project_path = str(payload.get("project_path", "") or "")
        if project_path == "":
            raise ValueError("project_load 缺少 project_path。")
        self.data_manager.load_project(project_path)

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
