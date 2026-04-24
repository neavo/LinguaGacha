import threading
from typing import Any

from base.Base import Base
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.Core.Item import Item
from module.Engine.Engine import Engine
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from api.Contract.TaskPayloads import TaskSnapshotPayload


class TaskAppService:
    """统一收口任务命令与快照查询。"""

    def __init__(
        self,
        data_manager: Any | None = None,
        engine: Any | None = None,
        event_emitter: Any | None = None,
        config_loader: Any | None = None,
    ) -> None:
        self.data_manager = (
            data_manager if data_manager is not None else DataManager.get()
        )
        self.engine = engine if engine is not None else Engine.get()
        self.event_emitter = (
            event_emitter if event_emitter is not None else self.default_emit
        )
        self.config_loader = (
            config_loader if config_loader is not None else lambda: Config().load()
        )

    def start_translation(self, request: dict[str, Any]) -> dict[str, object]:
        """请求启动翻译任务，并返回受理回执。"""

        mode = Base.TranslationMode(str(request.get("mode", Base.TranslationMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        self.event_emitter(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("translation", "REQUEST", True),
        }

    def stop_translation(self, request: dict[str, Any]) -> dict[str, object]:
        """请求停止翻译任务。"""

        del request
        self.event_emitter(
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("translation", "STOPPING", True),
        }

    def start_analysis(self, request: dict[str, Any]) -> dict[str, object]:
        """请求启动分析任务，并返回受理回执。"""

        mode = Base.AnalysisMode(str(request.get("mode", Base.AnalysisMode.NEW)))
        quality_snapshot = self.resolve_quality_snapshot(request)
        self.event_emitter(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": mode,
                "quality_snapshot": quality_snapshot,
            },
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("analysis", "REQUEST", True),
        }

    def stop_analysis(self, request: dict[str, Any]) -> dict[str, object]:
        """请求停止分析任务。"""

        del request
        self.event_emitter(
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("analysis", "STOPPING", True),
        }

    def export_translation(self, request: dict[str, Any]) -> dict[str, object]:
        """请求导出当前工程译文。"""

        del request
        self.event_emitter(
            Base.Event.TRANSLATION_EXPORT,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True}

    def translate_single(self, request: dict[str, Any]) -> dict[str, object]:
        """同步等待单条临时翻译，供前端页面派生工具低频调用。"""

        text = str(request.get("text", "")).strip()
        if text == "":
            raise ValueError("待翻译文本不能为空。")

        config = self.config_loader()
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
            result["success"] = success
            result["status"] = "OK" if success else "TRANSLATION_FAILED"
            result["dst"] = translated_item.get_dst()
            completed.set()

        self.engine.translate_single_item(item, config, callback)
        completed.wait()
        return result

    def get_task_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """显式查询当前任务快照。"""

        requested_task_type = str(request.get("task_type", ""))
        if requested_task_type in ("translation", "analysis"):
            task_type = requested_task_type
        else:
            task_type = self.resolve_task_type()
        return {"task": self.build_task_snapshot(task_type)}

    def resolve_task_type(self) -> str:
        """根据引擎状态和历史快照推导当前最相关的任务类型。"""

        active_task_type = getattr(self.engine, "get_active_task_type", None)
        if callable(active_task_type):
            task_type = str(active_task_type())
            if task_type in ("translation", "analysis"):
                return task_type

        translation_snapshot = self.data_manager.get_translation_extras()
        if int(translation_snapshot.get("line", 0) or 0) > 0:
            return "translation"

        analysis_snapshot = self.data_manager.get_analysis_progress_snapshot()
        if int(analysis_snapshot.get("line", 0) or 0) > 0:
            return "analysis"

        return "translation"

    def build_task_snapshot(self, task_type: str) -> dict[str, object]:
        """任务摘要统一从数据层快照和引擎状态汇总生成。"""

        snapshot = self.data_manager.get_task_progress_snapshot(task_type)

        status = self.normalize_status()
        busy = bool(getattr(self.engine, "is_busy", lambda: False)())
        task_snapshot = TaskSnapshotPayload(
            task_type=task_type,
            status=status,
            busy=busy,
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
            get_analysis_candidate_count = getattr(
                self.data_manager,
                "get_analysis_candidate_count",
                None,
            )
            if callable(get_analysis_candidate_count):
                task_snapshot["analysis_candidate_count"] = int(
                    get_analysis_candidate_count() or 0
                )
        return task_snapshot

    def build_command_ack(
        self,
        task_type: str,
        status: str,
        busy: bool,
    ) -> dict[str, object]:
        """命令回执需要立即反映用户操作意图，避免等下一帧 SSE 才更新按钮。"""

        task_snapshot = self.build_task_snapshot(task_type)
        task_snapshot["status"] = status
        task_snapshot["busy"] = busy
        return task_snapshot

    def normalize_status(self) -> str:
        """把引擎状态统一转换成字符串，兼容测试桩和真实枚举。"""

        status = self.engine.get_status()
        return str(getattr(status, "value", status))

    def get_request_in_flight_count(self) -> int:
        """任务并发数只从引擎单一入口读取。"""

        get_request_in_flight_count = getattr(
            self.engine, "get_request_in_flight_count", None
        )
        if callable(get_request_in_flight_count):
            return int(get_request_in_flight_count() or 0)
        return 0

    def default_emit(self, event: Base.Event, data: dict[str, object]) -> None:
        """默认事件出口直接复用 Base 事件总线。"""

        Base().emit(event, data)

    def resolve_quality_snapshot(
        self,
        request: dict[str, Any],
    ) -> QualityRuleSnapshot | None:
        payload = request.get("quality_snapshot")
        if isinstance(payload, QualityRuleSnapshot):
            return payload
        if isinstance(payload, dict):
            return QualityRuleSnapshot.from_dict(payload)
        return None
