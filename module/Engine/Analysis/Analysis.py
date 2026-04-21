from __future__ import annotations

import threading
from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisProgressTracker import AnalysisProgressTracker
from module.Engine.Analysis.AnalysisScheduler import AnalysisScheduler
from module.Engine.Analysis.AnalysisTask import AnalysisTask
from module.Engine.Analysis.AnalysisTaskHooks import AnalysisTaskHooks
from module.Engine.Engine import Engine
from module.Engine.TaskPipeline import TaskPipeline
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.Engine.TaskRunnerLifecycle import TaskRunnerExecutionPlan
from module.Engine.TaskRunnerLifecycle import TaskRunnerHooks
from module.Engine.TaskRunnerLifecycle import TaskRunnerLifecycle
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


# 主控制器只保留事件生命周期和任务总控，分析细节统一下沉到 hooks。
class Analysis(Base):
    def __init__(self) -> None:
        super().__init__()

        self.config: Config = Config().load()
        self.model: dict[str, Any] | None = None
        self.task_limiter: TaskLimiter | None = None
        self.stop_requested: bool = False
        self.extras: dict[str, Any] = {}
        self.quality_snapshot: QualityRuleSnapshot | None = None
        self.current_task_contexts: list[AnalysisTaskContext] = []
        self.scheduler = AnalysisScheduler(self)
        self.progress_tracker = AnalysisProgressTracker(self)

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

    def get_progress_snapshot(self) -> TaskProgressSnapshot:
        """分析控制器统一把运行态字典映射成共享快照。"""
        return TaskProgressSnapshot.from_dict(self.extras)

    def set_progress_snapshot(self, snapshot: TaskProgressSnapshot) -> dict[str, Any]:
        """控制器侧只接受共享快照，避免旧结构继续混入运行时。"""
        self.extras = snapshot.to_dict()
        return dict(self.extras)

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
        self.stop_requested = False
        mode = data.get("mode", Base.AnalysisMode.NEW)
        if not isinstance(mode, Base.AnalysisMode):
            mode = Base.AnalysisMode.NEW

        TaskRunnerLifecycle.start_background_run(
            self,
            busy_status=Base.TaskStatus.ANALYZING,
            task_event=Base.Event.ANALYSIS_TASK,
            mode=mode,
            worker=lambda: self.start(data),
            thread_factory=threading.Thread,
        )

    # 这里只切停止标记和全局状态，具体让 in-flight 请求怎么收尾交给流水线判断。
    def analysis_require_stop(self) -> None:
        TaskRunnerLifecycle.request_stop(
            self,
            stop_event=Base.Event.ANALYSIS_REQUEST_STOP,
            mark_stop_requested=lambda: setattr(self, "stop_requested", True),
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
        message = Localizer.get().task_processing
        LogManager.get().info(message)

    def finish_analysis_import_progress(self, *, failed: bool) -> None:
        """导入结束时统一收掉进度提示和日志分隔，避免不同分支各自收尾。"""
        del failed
        LogManager.get().print("")

    def emit_analysis_import_rejected(self, message: str) -> None:
        """前置条件不满足时统一发警告，避免入口分支重复堆同样的事件。"""
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
                    completion_event = {
                        "sub_event": Base.SubEvent.DONE,
                        "imported_count": imported_count,
                        "message": message,
                    }
            except Exception as e:
                progress_failed = True
                message = Localizer.get().task_failed
                LogManager.get().error(message, e)
                completion_event = {
                    "sub_event": Base.SubEvent.ERROR,
                    "message": message,
                }
            finally:
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

        dm = DataManager.get()

        def run_reset_worker() -> None:
            if is_reset_all:
                dm.clear_analysis_candidates_and_progress()
                refreshed_snapshot = dm.refresh_analysis_progress_snapshot_cache()
                self.extras = dict(refreshed_snapshot)
                self.emit(Base.Event.ANALYSIS_PROGRESS, dict(refreshed_snapshot))
            else:
                dm.reset_failed_analysis_checkpoints()
                refreshed_snapshot = dm.refresh_analysis_progress_snapshot_cache()
                self.extras = dict(refreshed_snapshot)
                self.emit(Base.Event.ANALYSIS_PROGRESS, dict(refreshed_snapshot))

            self.emit(
                Base.Event.PROJECT_CHECK,
                {"sub_event": Base.SubEvent.REQUEST},
            )

        TaskRunnerLifecycle.run_reset_flow(
            self,
            reset_event=reset_event,
            progress_message=None,
            worker=run_reset_worker,
            thread_factory=threading.Thread,
            ensure_loaded=dm.is_loaded,
        )

    # 启动主流程时只在这里串联准备、执行、收尾，其他细节都交给流水线。
    def start(self, data: dict[str, Any]) -> None:
        dm = DataManager.get()
        run_state: dict[str, Any] = {
            "mode": Base.AnalysisMode.NEW,
            "task_contexts": [],
        }

        def prepare() -> bool:
            config: Config | None = data.get("config")
            mode_raw = data.get("mode")
            mode = (
                mode_raw
                if isinstance(mode_raw, Base.AnalysisMode)
                else Base.AnalysisMode.NEW
            )
            run_state["mode"] = mode

            self.config = config if isinstance(config, Config) else Config().load()
            if not TaskRunnerLifecycle.ensure_project_loaded(
                self,
                dm=dm,
                task_event=Base.Event.ANALYSIS_TASK,
            ):
                return False

            self.model = TaskRunnerLifecycle.resolve_active_model(
                self,
                config=self.config,
                task_event=Base.Event.ANALYSIS_TASK,
            )
            if self.model is None:
                return False

            dm.open_db()
            TaskRunnerLifecycle.reset_request_runtime(reset_text_processor=False)
            snapshot_override = data.get("quality_snapshot")
            self.quality_snapshot = (
                snapshot_override
                if snapshot_override is not None
                else QualityRuleSnapshot.capture()
            )

            if mode in (Base.AnalysisMode.NEW, Base.AnalysisMode.RESET):
                self.extras = {}
                dm.clear_analysis_candidates_and_progress()
            else:
                self.extras = dm.get_analysis_progress_snapshot()
            return True

        def build_plan() -> TaskRunnerExecutionPlan:
            mode: Base.AnalysisMode = run_state["mode"]
            progress_snapshot = self.scheduler.build_progress_snapshot(
                previous_extras=self.extras,
                continue_mode=mode == Base.AnalysisMode.CONTINUE,
            )
            task_contexts = self.scheduler.build_analysis_task_contexts(self.config)
            run_state["task_contexts"] = task_contexts

            progress_snapshot_dict = self.set_progress_snapshot(progress_snapshot)
            idle_final_status = (
                "FAILED"
                if int(progress_snapshot_dict.get("error_line", 0) or 0) > 0
                else "SUCCESS"
            )
            return TaskRunnerExecutionPlan(
                total_line=int(progress_snapshot_dict.get("total_line", 0) or 0),
                line=int(progress_snapshot_dict.get("line", 0) or 0),
                has_pending_work=bool(task_contexts),
                idle_final_status=idle_final_status,
                payload=task_contexts,
            )

        def bind_task_limiter(
            max_workers: int,
            rps_limit: int,
            rpm_threshold: int,
        ) -> None:
            self.task_limiter = TaskLimiter(
                rps=rps_limit,
                rpm=rpm_threshold,
                max_concurrency=max_workers,
            )

        def execute(plan: TaskRunnerExecutionPlan, max_workers: int) -> str:
            task_contexts = plan.payload
            if not isinstance(task_contexts, list):
                return "FAILED"

            with LogManager.get().progress(transient=True) as progress:
                task_id = progress.new_task(
                    total=int(self.extras.get("total_line", 0) or 0),
                    completed=int(self.extras.get("line", 0) or 0),
                )
                self.progress_tracker.bind_console_progress(progress, task_id)
                try:
                    return self.execute_task_contexts(
                        task_contexts,
                        max_workers=max_workers,
                    )
                finally:
                    self.progress_tracker.clear_console_progress()

        TaskRunnerLifecycle.run_task_flow(
            self,
            task_event=Base.Event.ANALYSIS_TASK,
            hooks=TaskRunnerHooks(
                prepare=prepare,
                build_plan=build_plan,
                persist_progress=self.progress_tracker.persist_progress_snapshot,
                get_model=lambda: self.model,
                bind_task_limiter=bind_task_limiter,
                clear_task_limiter=lambda: setattr(self, "task_limiter", None),
                on_before_execute=lambda: AnalysisTask.log_run_start(self),
                execute=execute,
                on_after_execute=AnalysisTask.log_run_finish,
                finalize=lambda final_status: None,
                cleanup=dm.close_db,
                after_done=lambda final_status: self.after_analysis_done(
                    dm,
                    final_status,
                ),
            ),
        )

    def after_analysis_done(
        self,
        dm: DataManager,
        final_status: str,
    ) -> None:
        """分析任务进入 DONE 后，再决定是否桥接自动导入流程。"""
        if self.should_auto_import_glossary(dm, final_status):
            self.emit(
                Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                {"sub_event": Base.SubEvent.REQUEST},
            )

    # 并发和速率推导维持原有策略，只保留一个公开入口方便两边共用。
    def initialize_task_limits(self) -> tuple[int, int, int]:
        return TaskRunnerLifecycle.build_task_limits(self.model)

    # 停止判断收口成一个入口，流水线和主流程都不用重复看两处状态。
    def should_stop(self) -> bool:
        return (
            Engine.get().get_status() == Base.TaskStatus.STOPPING or self.stop_requested
        )

    def build_progress_snapshot(
        self,
        *,
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> TaskProgressSnapshot:
        """保留控制器公开入口，避免重置流程和测试直接依赖调度器实例。"""
        return self.scheduler.build_progress_snapshot(
            previous_extras=previous_extras,
            continue_mode=continue_mode,
        )

    def execute_task_contexts(
        self, task_contexts: list[AnalysisTaskContext], *, max_workers: int
    ) -> str:
        self.current_task_contexts = list(task_contexts)
        self.progress_tracker.reset_run_state()
        hooks = AnalysisTaskHooks(
            analysis=self,
            initial_contexts=task_contexts,
            max_workers=max_workers,
        )
        normal_queue_size, high_queue_size, commit_queue_size = (
            hooks.build_pipeline_sizes()
        )
        run_result = TaskPipeline[
            AnalysisTaskContext,
            object,
        ](
            hooks=hooks,
            max_workers=max_workers,
            normal_queue_size=normal_queue_size,
            high_queue_size=high_queue_size,
            commit_queue_size=commit_queue_size,
        ).run()
        self.progress_tracker.sync_progress_snapshot_after_commit(force=True)

        if run_result.stopped:
            return "STOPPED"
        if run_result.failed:
            return "FAILED"
        return "SUCCESS"

    def persist_progress_snapshot(self, *, save_state: bool) -> dict[str, Any]:
        return self.progress_tracker.persist_progress_snapshot(save_state)
