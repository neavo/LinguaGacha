from typing import Any

from base.Base import Base
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
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

    def start_translation(self, request: dict[str, str]) -> dict[str, object]:
        """请求启动翻译任务，并返回受理回执。"""

        mode = Base.TranslationMode(str(request.get("mode", Base.TranslationMode.NEW)))
        self.event_emitter(
            Base.Event.TRANSLATION_TASK,
            {"sub_event": Base.SubEvent.REQUEST, "mode": mode},
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("translation", "REQUEST", True),
        }

    def stop_translation(self, request: dict[str, str]) -> dict[str, object]:
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

    def reset_translation_all(self, request: dict[str, str]) -> dict[str, object]:
        """请求重置整个项目的翻译进度。"""

        return self.request_translation_reset(
            request,
            reset_all=True,
        )

    def reset_translation_failed(self, request: dict[str, str]) -> dict[str, object]:
        """请求仅重置整个项目中失败的翻译条目。"""

        return self.request_translation_reset(
            request,
            reset_all=False,
        )

    def start_analysis(self, request: dict[str, str]) -> dict[str, object]:
        """请求启动分析任务，并返回受理回执。"""

        mode = Base.AnalysisMode(str(request.get("mode", Base.AnalysisMode.NEW)))
        self.event_emitter(
            Base.Event.ANALYSIS_TASK,
            {"sub_event": Base.SubEvent.REQUEST, "mode": mode},
        )
        return {
            "accepted": True,
            "task": self.build_command_ack("analysis", "REQUEST", True),
        }

    def stop_analysis(self, request: dict[str, str]) -> dict[str, object]:
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

    def reset_analysis_all(self, request: dict[str, str]) -> dict[str, object]:
        """同步重置全部分析进度，并立即返回最新快照。"""

        return self.request_analysis_reset(request, reset_all=True)

    def reset_analysis_failed(self, request: dict[str, str]) -> dict[str, object]:
        """同步仅重置失败分析进度，并立即返回最新快照。"""

        return self.request_analysis_reset(request, reset_all=False)

    def import_analysis_glossary(self, request: dict[str, str]) -> dict[str, object]:
        """把分析候选同步导入术语表，并把最新候选数回传给 UI。"""

        del request
        expected_lg_path = self.ensure_analysis_mutation_ready()
        try:
            imported_count = self.data_manager.import_analysis_candidates(
                expected_lg_path=expected_lg_path
            )
            if imported_count is None:
                raise ValueError(Localizer.get().alert_project_not_loaded)

            refresh_candidate_count = getattr(
                self.data_manager,
                "sync_importable_analysis_candidate_count",
                None,
            )
            if callable(refresh_candidate_count):
                analysis_candidate_count = int(refresh_candidate_count() or 0)
            else:
                analysis_candidate_count = int(
                    self.data_manager.get_analysis_candidate_count() or 0
                )

            self.event_emitter(
                Base.Event.PROJECT_CHECK,
                {"sub_event": Base.SubEvent.REQUEST},
            )
            self.event_emitter(
                Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                {
                    "sub_event": Base.SubEvent.DONE,
                    "imported_count": int(imported_count),
                },
            )

            task_snapshot = self.build_task_snapshot("analysis")
            task_snapshot["analysis_candidate_count"] = analysis_candidate_count
            return {
                "accepted": True,
                "imported_count": int(imported_count),
                "task": task_snapshot,
            }
        except Exception:
            self.event_emitter(
                Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                {"sub_event": Base.SubEvent.ERROR},
            )
            raise

    def export_translation(self, request: dict[str, str]) -> dict[str, object]:
        """请求导出当前工程译文。"""

        del request
        self.event_emitter(Base.Event.TRANSLATION_EXPORT, {})
        return {"accepted": True}

    def request_translation_reset(
        self,
        request: dict[str, str],
        *,
        reset_all: bool,
    ) -> dict[str, object]:
        """同步完成翻译 reset，并直接把最新快照回给 Electron 前端。"""

        del request
        reset_event = (
            Base.Event.TRANSLATION_RESET_ALL
            if reset_all
            else Base.Event.TRANSLATION_RESET_FAILED
        )

        self.ensure_translation_mutation_ready()

        try:
            config = self.config_loader()
            if reset_all:
                items = self.data_manager.get_items_for_translation(
                    config,
                    Base.TranslationMode.RESET,
                )
                self.data_manager.replace_all_items(items)
                self.data_manager.set_translation_extras({})
                self.data_manager.set_project_status(Base.ProjectStatus.NONE)
                self.data_manager.run_project_prefilter(
                    config,
                    reason="translation_reset",
                    emit_refresh_events=False,
                )
            else:
                reset_result = self.data_manager.reset_failed_translation_items_sync()
                if reset_result is not None:
                    change, _extras = reset_result
                    self.emit_project_item_change_refresh(
                        change,
                        source_event=reset_event,
                    )

            # 为什么：重置完成后要沿用现有工程检查链，确保后续页面看到的项目状态与预过滤结果一致。
            self.event_emitter(
                Base.Event.PROJECT_CHECK,
                {"sub_event": Base.SubEvent.REQUEST},
            )
            # 为什么：同步 API 不能再发 REQUEST，否则会把旧事件 worker 也一起唤起来重复重置。
            self.event_emitter(reset_event, {"sub_event": Base.SubEvent.DONE})
        except Exception:
            self.event_emitter(reset_event, {"sub_event": Base.SubEvent.ERROR})
            raise

        return {
            "accepted": True,
            "task": self.build_task_snapshot("translation"),
        }

    def emit_project_item_change_refresh(
        self,
        change: Any,
        *,
        source_event: Base.Event,
    ) -> None:
        """把条目级变化统一映射成工作台/校对页刷新。"""

        item_ids = getattr(change, "item_ids", ())
        rel_paths = getattr(change, "rel_paths", ())
        reason = str(getattr(change, "reason", "") or "")

        if rel_paths:
            self.event_emitter(
                Base.Event.WORKBENCH_REFRESH,
                {
                    "reason": reason,
                    "scope": "file",
                    "rel_paths": list(rel_paths),
                },
            )

        if item_ids:
            self.event_emitter(
                Base.Event.PROOFREADING_REFRESH,
                {
                    "reason": reason,
                    "scope": "entry",
                    "source_event": source_event,
                    "item_ids": list(item_ids),
                    "rel_paths": list(rel_paths),
                },
            )

    def request_analysis_reset(
        self,
        request: dict[str, str],
        *,
        reset_all: bool,
    ) -> dict[str, object]:
        """分析重置直接同步落库，避免工作台还要额外等一轮旧事件线程。"""

        del request
        reset_event = (
            Base.Event.ANALYSIS_RESET_ALL
            if reset_all
            else Base.Event.ANALYSIS_RESET_FAILED
        )
        self.ensure_analysis_mutation_ready()
        try:
            if reset_all:
                self.data_manager.clear_analysis_candidates_and_progress()
            else:
                self.data_manager.reset_failed_analysis_checkpoints()

            self.data_manager.refresh_analysis_progress_snapshot_cache()
            self.event_emitter(
                Base.Event.PROJECT_CHECK,
                {"sub_event": Base.SubEvent.REQUEST},
            )
            self.event_emitter(reset_event, {"sub_event": Base.SubEvent.DONE})
        except Exception:
            self.event_emitter(reset_event, {"sub_event": Base.SubEvent.ERROR})
            raise

        return {
            "accepted": True,
            "task": self.build_task_snapshot("analysis"),
        }

    def ensure_analysis_mutation_ready(self) -> str:
        """分析同步命令统一复用同一组前置校验，避免不同入口口径漂移。"""

        if bool(getattr(self.engine, "is_busy", lambda: False)()):
            raise ValueError(Localizer.get().task_running)

        is_loaded = getattr(self.data_manager, "is_loaded", None)
        get_lg_path = getattr(self.data_manager, "get_lg_path", None)
        if not callable(is_loaded) or not callable(get_lg_path) or not is_loaded():
            raise ValueError(Localizer.get().alert_project_not_loaded)

        lg_path = str(get_lg_path() or "")
        if lg_path == "":
            raise ValueError(Localizer.get().alert_project_not_loaded)
        return lg_path

    def ensure_translation_mutation_ready(self) -> None:
        """翻译同步 reset 复用同一组前置校验，避免 API 与引擎侧判定不一致。"""

        if bool(getattr(self.engine, "is_busy", lambda: False)()):
            raise ValueError(Localizer.get().task_running)

        is_loaded = getattr(self.data_manager, "is_loaded", None)
        get_lg_path = getattr(self.data_manager, "get_lg_path", None)
        if not callable(is_loaded) or not callable(get_lg_path) or not is_loaded():
            raise ValueError(Localizer.get().alert_project_not_loaded)

        lg_path = str(get_lg_path() or "")
        if lg_path == "":
            raise ValueError(Localizer.get().alert_project_not_loaded)

    def get_task_snapshot(self, request: dict[str, str]) -> dict[str, object]:
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
