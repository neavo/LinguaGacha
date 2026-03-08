from __future__ import annotations

import threading
from typing import Any

from rich.table import Table

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot

from module.Engine.Analyzer.AnalysisModels import AnalysisChunkResult
from module.Engine.Analyzer.AnalysisModels import AnalysisFilePlan
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
        self.analysis_state: dict[str, Base.ProjectStatus] = {}
        self.quality_snapshot: QualityRuleSnapshot | None = None
        self.pipeline = AnalysisPipeline(self)

        self.subscribe(Base.Event.ANALYSIS_TASK, self.analysis_run_event)
        self.subscribe(Base.Event.ANALYSIS_REQUEST_STOP, self.analysis_stop_event)
        self.subscribe(Base.Event.ANALYSIS_RESET_ALL, self.analysis_reset)
        self.subscribe(Base.Event.ANALYSIS_RESET_FAILED, self.analysis_reset)

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

    # 重置入口只管任务边界和事件发射，具体进度重建仍复用流水线能力。
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
            self.emit(
                reset_event,
                {"sub_event": Base.SubEvent.ERROR},
            )
            return

        dm = DataManager.get()
        if not dm.is_loaded():
            return

        self.emit(
            reset_event,
            {"sub_event": Base.SubEvent.RUN},
        )

        def task() -> None:
            try:
                if is_reset_all:
                    dm.clear_analysis_progress()
                    self.analysis_state = {}
                    self.extras = {}
                    snapshot: dict[str, Any] = {}
                else:
                    self.config = Config().load()
                    self.model = self.config.get_active_model()
                    state = {
                        rel_path: status
                        for rel_path, status in dm.get_analysis_state().items()
                        if status != Base.ProjectStatus.ERROR
                    }
                    dm.set_analysis_state(state)
                    file_plans = self.build_analysis_file_plans(self.config)
                    previous_extras = dm.get_analysis_extras()
                    self.analysis_state = state
                    self.extras = self.build_extras_from_state(
                        file_plans=file_plans,
                        state=state,
                        previous_extras=previous_extras,
                        continue_mode=True,
                    )
                    snapshot = self.persist_progress_snapshot(save_state=True)

                if is_reset_all:
                    self.emit(Base.Event.ANALYSIS_PROGRESS, snapshot)
                self.emit(
                    Base.Event.PROJECT_CHECK,
                    {"sub_event": Base.SubEvent.REQUEST},
                )
                self.emit(
                    reset_event,
                    {"sub_event": Base.SubEvent.DONE},
                )
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
                self.emit(
                    reset_event,
                    {"sub_event": Base.SubEvent.ERROR},
                )

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
                self.analysis_state = {}
                self.extras = {}
                dm.clear_analysis_progress()
            else:
                self.analysis_state = dm.get_analysis_state()
                self.extras = dm.get_analysis_extras()

            file_plans = self.build_analysis_file_plans(self.config)
            if not file_plans:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().engine_no_items,
                    },
                )
                return

            self.extras = self.build_extras_from_state(
                file_plans=file_plans,
                state=self.analysis_state,
                previous_extras=self.extras,
                continue_mode=mode == Base.AnalysisMode.CONTINUE,
            )
            has_active_snapshot = True
            self.persist_progress_snapshot(save_state=True)

            max_workers, rps_limit, rpm_threshold = self.initialize_task_limits()
            self.task_limiter = TaskLimiter(
                rps=rps_limit,
                rpm=rpm_threshold,
                max_concurrency=max_workers,
            )
            self.log_analysis_start()

            remaining_plans = [
                plan
                for plan in file_plans
                if self.analysis_state.get(plan.file_path)
                not in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR)
            ]
            if not remaining_plans:
                has_error_file = any(
                    status == Base.ProjectStatus.ERROR
                    for status in self.analysis_state.values()
                )
                if has_error_file:
                    flow_final_status = "FAILED"
                    toast_type = Base.ToastType.WARNING
                    toast_message = Localizer.get().engine_task_fail
                else:
                    flow_final_status = "SUCCESS"
                    toast_type = Base.ToastType.SUCCESS
                    toast_message = Localizer.get().engine_task_done

                self.log_analysis_finish(flow_final_status)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": toast_type,
                        "message": toast_message,
                    },
                )
                return

            for plan in remaining_plans:
                if self.should_stop():
                    flow_final_status = "STOPPED"
                    break

                file_status = self.run_file_plan(plan, max_workers=max_workers)
                if file_status is None:
                    flow_final_status = "STOPPED"
                    break

                self.analysis_state[plan.file_path] = file_status
                self.persist_progress_snapshot(save_state=True)

            if flow_final_status == "STOPPED":
                self.log_analysis_finish(flow_final_status)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().engine_task_stop,
                    },
                )
                return

            has_error_file = any(
                status == Base.ProjectStatus.ERROR
                for status in self.analysis_state.values()
            )
            remaining_chunk_count = self.get_remaining_chunk_count(
                file_plans, self.analysis_state
            )
            if remaining_chunk_count == 0 and not has_error_file:
                flow_final_status = "SUCCESS"
                self.log_analysis_finish(flow_final_status)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().engine_task_done,
                    },
                )
            else:
                flow_final_status = "FAILED"
                self.log_analysis_finish(flow_final_status)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().engine_task_fail,
                    },
                )
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
    def build_analysis_file_plans(self, config: Config) -> list[AnalysisFilePlan]:
        return self.pipeline.build_analysis_file_plans(config)

    def should_include_item(self, item: Item) -> bool:
        return self.pipeline.should_include_item(item)

    def build_analysis_source_text(self, item: Item) -> str:
        return self.pipeline.build_analysis_source_text(item)

    def get_input_token_threshold(self) -> int:
        return self.pipeline.get_input_token_threshold()

    def build_extras_from_state(
        self,
        *,
        file_plans: list[AnalysisFilePlan],
        state: dict[str, Base.ProjectStatus],
        previous_extras: dict[str, Any],
        continue_mode: bool,
    ) -> dict[str, Any]:
        return self.pipeline.build_extras_from_state(
            file_plans=file_plans,
            state=state,
            previous_extras=previous_extras,
            continue_mode=continue_mode,
        )

    def run_file_plan(
        self, plan: AnalysisFilePlan, *, max_workers: int
    ) -> Base.ProjectStatus | None:
        return self.pipeline.run_file_plan(plan, max_workers=max_workers)

    def run_chunk(self, items: list[Item]) -> AnalysisChunkResult:
        return self.pipeline.run_chunk(items)

    def execute_chunk_request(self, items: list[Item]) -> AnalysisChunkResult:
        return self.pipeline.execute_chunk_request(items)

    def normalize_glossary_entries(
        self, glossary_entries: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        return self.pipeline.normalize_glossary_entries(glossary_entries)

    def merge_glossary_entries(self, glossary_entries: list[dict[str, Any]]) -> int:
        return self.pipeline.merge_glossary_entries(glossary_entries)

    def get_remaining_chunk_count(
        self,
        file_plans: list[AnalysisFilePlan],
        state: dict[str, Base.ProjectStatus],
    ) -> int:
        return self.pipeline.get_remaining_chunk_count(file_plans, state)

    def persist_progress_snapshot(self, *, save_state: bool) -> dict[str, Any]:
        return self.pipeline.persist_progress_snapshot(save_state=save_state)

    def log_analysis_start(self) -> None:
        self.pipeline.log_analysis_start()

    def log_analysis_finish(self, final_status: str) -> None:
        self.pipeline.log_analysis_finish(final_status)

    def print_chunk_log(
        self,
        *,
        start: float,
        pt: int,
        ct: int,
        srcs: list[str],
        glossary_entries: list[dict[str, Any]],
        response_think: str,
        response_result: str,
        status_text: str,
        log_func: Any,
        style: str,
    ) -> None:
        self.pipeline.print_chunk_log(
            start=start,
            pt=pt,
            ct=ct,
            srcs=srcs,
            glossary_entries=glossary_entries,
            response_think=response_think,
            response_result=response_result,
            status_text=status_text,
            log_func=log_func,
            style=style,
        )

    def generate_log_rows(
        self,
        srcs: list[str],
        glossary_entries: list[dict[str, Any]],
        extra: list[str],
        *,
        console: bool,
    ) -> list[str]:
        return self.pipeline.generate_log_rows(
            srcs,
            glossary_entries,
            extra,
            console=console,
        )

    def build_glossary_log_lines(
        self,
        glossary_entries: list[dict[str, Any]],
        *,
        console: bool,
    ) -> list[str]:
        return self.pipeline.build_glossary_log_lines(
            glossary_entries,
            console=console,
        )

    def generate_log_table(self, rows: list[str], style: str) -> Table:
        return self.pipeline.generate_log_table(rows, style)
