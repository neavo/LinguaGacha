from __future__ import annotations

import threading
from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot

from module.Engine.Analyzer.AnalysisModels import AnalysisProgressSnapshot
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskResult
from module.Engine.Analyzer.AnalysisPipeline import AnalysisPipeline


# 主控制器只保留事件生命周期和任务总控，分析细节统一下沉到流水线类。
class Analyzer(Base):
    def __init__(self) -> None:
        super().__init__()

        self.config: Config = Config().load()
        self.model: dict[str, Any] | None = None
        self.task_limiter: TaskLimiter | None = None
        self.stop_requested: bool = False
        self.extras: dict[str, Any] = {}
        self.quality_snapshot: QualityRuleSnapshot | None = None
        self.pipeline = AnalysisPipeline(self)

        self.subscribe(Base.Event.ANALYSIS_TASK, self.analysis_run_event)
        self.subscribe(Base.Event.ANALYSIS_REQUEST_STOP, self.analysis_stop_event)
        self.subscribe(Base.Event.ANALYSIS_RESET_ALL, self.analysis_reset)
        self.subscribe(Base.Event.ANALYSIS_RESET_FAILED, self.analysis_reset)
        self.subscribe(
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            self.analysis_import_glossary_event,
        )

    # UI 只关心当前实际占用并发，这里保持薄包装方便以后替换限流器实现。
    def get_concurrency_in_use(self) -> int:
        limiter = self.task_limiter
        if limiter is None:
            return 0
        return limiter.get_concurrency_in_use()

    # UI 展示并发上限时也走同一个入口，避免直接读内部限流器对象。
    def get_concurrency_limit(self) -> int:
        limiter = self.task_limiter
        if limiter is None:
            return 0
        return limiter.get_concurrency_limit()

    # 事件入口只做筛选，让真正的业务逻辑继续待在同步方法里便于测试。
    def analysis_run_event(self, event: Base.Event, data: dict[str, Any]) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return
        self.analysis_run(data)

    # 停止事件同样保持薄包装，避免事件层和状态切换逻辑耦在一起。
    def analysis_stop_event(self, event: Base.Event, data: dict[str, Any]) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return
        self.analysis_require_stop()

    # 手动导入候选术语池也统一走事件链，避免页面直接跨线程碰数据层。
    def analysis_import_glossary_event(
        self, event: Base.Event, data: dict[str, Any]
    ) -> None:
        del event
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return
        self.analysis_import_glossary()

    # 这里先原子占用引擎状态，再把真正任务扔到后台线程，避免重复点击并发启动。
    def analysis_run(self, data: dict[str, Any]) -> None:
        engine = Engine.get()
        with engine.lock:
            if engine.status != Base.TaskStatus.IDLE:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().task_running,
                    },
                )
                self.emit(
                    Base.Event.ANALYSIS_TASK,
                    {
                        "sub_event": Base.SubEvent.ERROR,
                        "message": Localizer.get().task_running,
                    },
                )
                return

            engine.status = Base.TaskStatus.ANALYZING

        self.emit(
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.RUN,
                "mode": data.get("mode", Base.AnalysisMode.NEW),
            },
        )

        self.stop_requested = False
        try:
            threading.Thread(target=self.start, args=(data,), daemon=True).start()
        except Exception as e:
            engine.set_status(Base.TaskStatus.IDLE)
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            self.emit(
                Base.Event.ANALYSIS_TASK,
                {
                    "sub_event": Base.SubEvent.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )

    # 这里只切停止标记和全局状态，具体让 in-flight 请求怎么收尾交给流水线判断。
    def analysis_require_stop(self) -> None:
        self.stop_requested = True
        Engine.get().set_status(Base.TaskStatus.STOPPING)
        self.emit(
            Base.Event.ANALYSIS_REQUEST_STOP,
            {
                "sub_event": Base.SubEvent.RUN,
            },
        )

    def import_analysis_candidates_sync(
        self,
        dm: DataManager,
        *,
        expected_lg_path: str,
    ) -> int | None:
        """手动导入候选池时固定当前工程，避免后台线程串写到新工程。"""
        imported_count = dm.import_analysis_candidates(
            expected_lg_path=expected_lg_path
        )
        if imported_count is None:
            return None

        if dm.is_loaded() and dm.get_lg_path() == expected_lg_path:
            self.emit(
                Base.Event.PROJECT_CHECK,
                {"sub_event": Base.SubEvent.REQUEST},
            )
        return imported_count

    def emit_analysis_import_progress_start(self) -> None:
        """导入开始时统一显示处理中提示，并同步写入控制台日志。"""
        message = Localizer.get().toast_processing
        LogManager.get().info(message)
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": message,
                "indeterminate": True,
            },
        )

    def emit_analysis_import_progress_end(self, *, failed: bool) -> None:
        """统一结束导入中的进度提示，复用窗口层既有的延迟隐藏规则。"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.ERROR if failed else Base.SubEvent.DONE,
            },
        )

    def finish_analysis_import_progress(self, *, failed: bool) -> None:
        """导入结束时统一收掉进度提示和日志分隔，避免不同分支各自收尾。"""
        self.emit_analysis_import_progress_end(failed=failed)
        LogManager.get().print("")

    def emit_analysis_import_rejected(self, message: str) -> None:
        """前置条件不满足时统一发警告，避免入口分支重复堆同样的事件。"""
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": message,
            },
        )
        self.emit(
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": message,
            },
        )

    def build_analysis_import_context(self) -> tuple[DataManager, str] | None:
        """在主线程统一校验导入前提，避免无效请求也启动后台线程。"""
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit_analysis_import_rejected(Localizer.get().task_running)
            return None

        dm = DataManager.get()
        if not dm.is_loaded():
            self.emit_analysis_import_rejected(Localizer.get().alert_project_not_loaded)
            return None

        expected_lg_path = dm.get_lg_path()
        if not isinstance(expected_lg_path, str) or expected_lg_path == "":
            self.emit_analysis_import_rejected(Localizer.get().alert_project_not_loaded)
            return None
        return dm, expected_lg_path

    def analysis_import_glossary(self) -> None:
        """把候选池导入单独放后台线程，避免 UI 点击后卡住主线程。"""
        import_context = self.build_analysis_import_context()
        if import_context is None:
            return
        dm, expected_lg_path = import_context

        self.emit(
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {"sub_event": Base.SubEvent.RUN},
        )
        self.emit_analysis_import_progress_start()

        def task() -> None:
            progress_failed = False
            toast_payload: dict[str, Any] | None = None
            # 工程已切换时保持静默收口，只通知页面当前导入流程结束即可。
            completion_event: dict[str, Any] = {"sub_event": Base.SubEvent.ERROR}
            try:
                imported_count = self.import_analysis_candidates_sync(
                    dm,
                    expected_lg_path=expected_lg_path,
                )
                if imported_count is not None:
                    # 0 也视为成功：这里表示导入流程已完成，只是没有新增或补空条目。
                    message = Localizer.get().analysis_page_import_success.replace(
                        "{COUNT}", str(imported_count)
                    )
                    LogManager.get().info(message)
                    toast_payload = {
                        "type": Base.ToastType.SUCCESS,
                        "message": message,
                    }
                    completion_event = {
                        "sub_event": Base.SubEvent.DONE,
                        "imported_count": imported_count,
                    }
            except Exception as e:
                progress_failed = True
                message = Localizer.get().task_failed
                LogManager.get().error(message, e)
                toast_payload = {
                    "type": Base.ToastType.ERROR,
                    "message": message,
                }
                completion_event = {
                    "sub_event": Base.SubEvent.ERROR,
                    "message": message,
                }
            finally:
                if toast_payload is not None:
                    self.emit(Base.Event.TOAST, toast_payload)
                self.finish_analysis_import_progress(failed=progress_failed)
                self.emit(
                    Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                    completion_event,
                )

        threading.Thread(target=task, daemon=True).start()

    def should_auto_import_glossary(
        self,
        dm: DataManager,
        final_status: str,
    ) -> bool:
        """只要本轮分析成功且候选池非空，就自动桥接到导入术语表。"""
        if final_status != "SUCCESS":
            return False
        if not dm.is_loaded():
            return False

        return int(dm.get_analysis_candidate_count() or 0) > 0

    def emit_analysis_terminal_toast(self, final_status: str) -> None:
        """分析终态提示只维护一处，避免空跑和正常执行两条路径各改一遍。"""
        if final_status == "SUCCESS":
            toast_type = Base.ToastType.SUCCESS
            message = Localizer.get().engine_task_done
        elif final_status == "STOPPED":
            toast_type = Base.ToastType.SUCCESS
            message = Localizer.get().engine_task_stop
        else:
            toast_type = Base.ToastType.WARNING
            message = Localizer.get().engine_task_fail

        self.emit(
            Base.Event.TOAST,
            {
                "type": toast_type,
                "message": message,
            },
        )

    # 重置入口只管任务边界和事件发射，具体数据层操作交给 DataManager。
    def analysis_reset(self, event: Base.Event, data: dict[str, Any]) -> None:
        sub_event: Base.SubEvent = data.get("sub_event", Base.SubEvent.REQUEST)
        if sub_event != Base.SubEvent.REQUEST:
            return

        if event == Base.Event.ANALYSIS_RESET_ALL:
            reset_event = Base.Event.ANALYSIS_RESET_ALL
            is_reset_all = True
        else:
            reset_event = Base.Event.ANALYSIS_RESET_FAILED
            is_reset_all = False

        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            self.emit(reset_event, {"sub_event": Base.SubEvent.ERROR})
            return

        dm = DataManager.get()
        if not dm.is_loaded():
            return

        self.emit(reset_event, {"sub_event": Base.SubEvent.RUN})

        def task() -> None:
            try:
                if is_reset_all:
                    dm.clear_analysis_candidates_and_progress()
                    self.extras = {}
                    snapshot: dict[str, Any] = {}
                    self.emit(Base.Event.ANALYSIS_PROGRESS, snapshot)
                else:
                    dm.reset_failed_analysis_checkpoints()
                    previous_snapshot = dm.get_analysis_progress_snapshot()
                    snapshot = self.build_progress_snapshot(
                        previous_extras=previous_snapshot,
                        continue_mode=True,
                    ).to_dict()
                    self.extras = snapshot
                    self.persist_progress_snapshot(save_state=True)

                self.emit(
                    Base.Event.PROJECT_CHECK,
                    {"sub_event": Base.SubEvent.REQUEST},
                )
                self.emit(reset_event, {"sub_event": Base.SubEvent.DONE})
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
                self.emit(reset_event, {"sub_event": Base.SubEvent.ERROR})

        threading.Thread(target=task, daemon=True).start()

    # 启动主流程时只在这里串联准备、执行、收尾，其他细节都交给流水线。
    def start(self, data: dict[str, Any]) -> None:
        flow_final_status = "FAILED"
        dm = DataManager.get()
        has_active_snapshot = False

        try:
            config: Config | None = data.get("config")
            mode_raw = data.get("mode")
            if isinstance(mode_raw, Base.AnalysisMode):
                mode = mode_raw
            else:
                mode = Base.AnalysisMode.NEW

            if isinstance(config, Config):
                self.config = config
            else:
                self.config = Config().load()

            if not dm.is_loaded():
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().alert_project_not_loaded,
                    },
                )
                return

            self.model = self.config.get_active_model()
            if self.model is None:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().alert_no_active_model,
                    },
                )
                return

            dm.open_db()
            TaskRequester.reset()
            PromptBuilder.reset()
            self.quality_snapshot = QualityRuleSnapshot.capture()

            if mode in (Base.AnalysisMode.NEW, Base.AnalysisMode.RESET):
                self.extras = {}
                dm.clear_analysis_candidates_and_progress()
            else:
                self.extras = dm.get_analysis_progress_snapshot()

            progress_snapshot = self.build_progress_snapshot(
                previous_extras=self.extras,
                continue_mode=mode == Base.AnalysisMode.CONTINUE,
            )
            task_contexts = self.build_analysis_task_contexts(self.config)

            if progress_snapshot.total_line == 0:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().engine_no_items,
                    },
                )
                return

            progress_snapshot_dict = progress_snapshot.to_dict()
            self.extras = progress_snapshot_dict
            has_active_snapshot = True
            self.persist_progress_snapshot(save_state=True)

            if not task_contexts:
                if int(progress_snapshot_dict.get("error_line", 0) or 0) > 0:
                    flow_final_status = "FAILED"
                else:
                    flow_final_status = "SUCCESS"
                self.log_analysis_finish(flow_final_status)
                self.emit_analysis_terminal_toast(flow_final_status)
                return

            max_workers, rps_limit, rpm_threshold = self.initialize_task_limits()
            self.task_limiter = TaskLimiter(
                rps=rps_limit,
                rpm=rpm_threshold,
                max_concurrency=max_workers,
            )
            self.log_analysis_start()

            with ProgressBar(transient=True) as progress:
                task_id = progress.new(
                    total=int(self.extras.get("total_line", 0) or 0),
                    completed=int(self.extras.get("line", 0) or 0),
                )
                self.pipeline.bind_console_progress(progress, task_id)
                try:
                    flow_final_status = self.execute_task_contexts(
                        task_contexts,
                        max_workers=max_workers,
                    )
                finally:
                    self.pipeline.clear_console_progress()
            self.log_analysis_finish(flow_final_status)
            self.emit_analysis_terminal_toast(flow_final_status)
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
        finally:
            if has_active_snapshot:
                self.persist_progress_snapshot(save_state=True)
            dm.close_db()
            self.task_limiter = None
            Engine.get().set_status(Base.TaskStatus.IDLE)
            self.emit(
                Base.Event.ANALYSIS_TASK,
                {
                    "sub_event": Base.SubEvent.DONE,
                    "final_status": flow_final_status,
                },
            )
            if self.should_auto_import_glossary(
                dm,
                flow_final_status,
            ):
                self.emit(
                    Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                    {"sub_event": Base.SubEvent.REQUEST},
                )

    # 并发和速率推导维持原有策略，只保留一个公开入口方便两边共用。
    def initialize_task_limits(self) -> tuple[int, int, int]:
        if self.model is None:
            return 8, 8, 0

        threshold = self.model.get("threshold", {})
        max_concurrency = max(0, int(threshold.get("concurrency_limit", 0) or 0))
        rpm_limit = max(0, int(threshold.get("rpm_limit", 0) or 0))

        if max_concurrency == 0:
            if rpm_limit > 0:
                derived = (rpm_limit * 4 + 59) // 60
                max_concurrency = max(8, min(64, derived))
            else:
                max_concurrency = 8

        if rpm_limit > 0:
            rps_limit = 0
        else:
            rps_limit = max_concurrency
        return max_concurrency, rps_limit, rpm_limit

    # 停止判断收口成一个入口，流水线和主流程都不用重复看两处状态。
    def should_stop(self) -> bool:
        return (
            Engine.get().get_status() == Base.TaskStatus.STOPPING or self.stop_requested
        )

    # 公开方法统一委托给流水线，避免总控类再次堆积实现细节。
    def should_include_item(self, item: Item) -> bool:
        return self.pipeline.should_include_item(item)

    def build_analysis_source_text(self, item: Item) -> str:
        return self.pipeline.build_analysis_source_text(item)

    def get_input_token_threshold(self) -> int:
        return self.pipeline.get_input_token_threshold()

    def build_analysis_task_contexts(self, config: Config) -> list[AnalysisTaskContext]:
        return self.pipeline.build_analysis_task_contexts(config)

    def build_progress_snapshot(
        self,
        *,
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> AnalysisProgressSnapshot:
        return self.pipeline.build_progress_snapshot(
            previous_extras=previous_extras,
            continue_mode=continue_mode,
        )

    def execute_task_contexts(
        self, task_contexts: list[AnalysisTaskContext], *, max_workers: int
    ) -> str:
        return self.pipeline.execute_task_contexts(
            task_contexts,
            max_workers=max_workers,
        )

    def run_task_context(self, context: AnalysisTaskContext) -> AnalysisTaskResult:
        return self.pipeline.run_task_context(context)

    def persist_progress_snapshot(self, *, save_state: bool) -> dict[str, Any]:
        return self.pipeline.persist_progress_snapshot(save_state=save_state)

    def log_analysis_start(self) -> None:
        self.pipeline.log_analysis_start()

    def log_analysis_finish(self, final_status: str) -> None:
        self.pipeline.log_analysis_finish(final_status)
