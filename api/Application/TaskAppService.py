from typing import Any

from base.Base import Base
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from api.Contract.TaskDtos import TaskDto


class TaskAppService:
    """统一收口任务命令与快照查询。"""

    def __init__(
        self,
        data_manager: Any | None = None,
        engine: Any | None = None,
        event_emitter: Any | None = None,
    ) -> None:
        self.data_manager = data_manager if data_manager is not None else DataManager.get()
        self.engine = engine if engine is not None else Engine.get()
        self.event_emitter = (
            event_emitter if event_emitter is not None else self.default_emit
        )

    def start_translation(self, request: dict[str, str]) -> dict[str, object]:
        """请求启动翻译任务，并返回受理回执。"""

        mode = Base.TranslationMode(str(request.get("mode", Base.TranslationMode.NEW)))
        self.event_emitter(
            Base.Event.TRANSLATION_TASK,
            {"sub_event": Base.SubEvent.REQUEST, "mode": mode},
        )
        return {"accepted": True, "task": self.build_task_snapshot("translation")}

    def stop_translation(self, request: dict[str, str]) -> dict[str, object]:
        """请求停止翻译任务。"""

        del request
        self.event_emitter(
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True, "task": self.build_task_snapshot("translation")}

    def start_analysis(self, request: dict[str, str]) -> dict[str, object]:
        """请求启动分析任务，并返回受理回执。"""

        mode = Base.AnalysisMode(str(request.get("mode", Base.AnalysisMode.NEW)))
        self.event_emitter(
            Base.Event.ANALYSIS_TASK,
            {"sub_event": Base.SubEvent.REQUEST, "mode": mode},
        )
        return {"accepted": True, "task": self.build_task_snapshot("analysis")}

    def stop_analysis(self, request: dict[str, str]) -> dict[str, object]:
        """请求停止分析任务。"""

        del request
        self.event_emitter(
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
        return {"accepted": True, "task": self.build_task_snapshot("analysis")}

    def get_task_snapshot(self, request: dict[str, str]) -> dict[str, object]:
        """显式查询当前任务快照。"""

        del request
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

        if task_type == "analysis":
            snapshot = self.data_manager.get_analysis_progress_snapshot()
        else:
            snapshot = self.data_manager.get_translation_extras()

        status = self.normalize_status()
        busy = bool(getattr(self.engine, "is_busy", lambda: False)())
        return TaskDto(
            task_type=task_type,
            status=status,
            busy=busy,
            line=int(snapshot.get("line", 0) or 0),
            total_line=int(snapshot.get("total_line", 0) or 0),
            processed_line=int(snapshot.get("processed_line", 0) or 0),
            error_line=int(snapshot.get("error_line", 0) or 0),
            total_tokens=int(snapshot.get("total_tokens", 0) or 0),
            time=float(snapshot.get("time", 0.0) or 0.0),
        ).to_dict()

    def normalize_status(self) -> str:
        """把引擎状态统一转换成字符串，兼容测试桩和真实枚举。"""

        status = self.engine.get_status()
        return str(getattr(status, "value", status))

    def default_emit(self, event: Base.Event, data: dict[str, object]) -> None:
        """默认事件出口直接复用 Base 事件总线。"""

        Base().emit(event, data)
