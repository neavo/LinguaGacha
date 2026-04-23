from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any
from typing import Callable

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder


@dataclass(frozen=True)
class TaskRunnerExecutionPlan:
    """共享骨架只关心的执行计划视图。"""

    total_line: int
    line: int
    has_pending_work: bool
    idle_final_status: str
    payload: object | None = None


@dataclass(frozen=True)
class TaskRunnerHooks:
    """把领域差异收成显式插槽，避免公共层堆业务分支。"""

    prepare: Callable[[], bool]
    build_plan: Callable[[], TaskRunnerExecutionPlan]
    persist_progress: Callable[[bool], dict[str, Any]]
    get_model: Callable[[], dict[str, Any] | None]
    bind_task_limiter: Callable[[int, int, int], None]
    clear_task_limiter: Callable[[], None]
    on_before_execute: Callable[[], None]
    execute: Callable[[TaskRunnerExecutionPlan, int], str]
    on_after_execute: Callable[[str], None]
    finalize: Callable[[str], None]
    cleanup: Callable[[], None]
    after_done: Callable[[str], None]


class TaskRunnerLifecycle:
    """抽取分析与翻译共享的任务生命周期骨架。"""

    @staticmethod
    def emit_task_error(
        owner: Base,
        *,
        task_event: Base.Event,
        message: str,
    ) -> None:
        """共享错误出口统一走任务事件，避免后端夹带 UI 语义。"""

        owner.emit(
            task_event,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": message,
            },
        )

    @staticmethod
    def reset_request_runtime(*, reset_text_processor: bool) -> None:
        """统一清理请求期缓存，避免两条任务线初始化顺序漂移。"""
        TaskRequester.reset()
        PromptBuilder.reset()
        if not reset_text_processor:
            return

        from module.TextProcessor import TextProcessor

        TextProcessor.reset()

    @staticmethod
    def start_background_run(
        owner: Base,
        *,
        busy_status: Base.TaskStatus,
        task_event: Base.Event,
        mode: Base.AnalysisMode | Base.TranslationMode,
        worker: Callable[[], None],
        thread_factory: Callable[..., Any] = threading.Thread,
    ) -> None:
        """统一处理忙碌态校验、占用引擎状态、发 RUN 事件和启动后台线程。"""

        engine = Engine.get()
        with engine.lock:
            if engine.status != Base.TaskStatus.IDLE:
                TaskRunnerLifecycle.emit_task_error(
                    owner,
                    task_event=task_event,
                    message=Localizer.get().task_running,
                )
                return

            engine.status = busy_status

        owner.emit(
            task_event,
            {
                "sub_event": Base.SubEvent.RUN,
                "mode": mode,
            },
        )

        try:
            thread_factory(target=worker, daemon=True).start()
        except Exception as e:
            engine.set_status(Base.TaskStatus.IDLE)
            LogManager.get().error(Localizer.get().task_failed, e)
            TaskRunnerLifecycle.emit_task_error(
                owner,
                task_event=task_event,
                message=Localizer.get().task_failed,
            )

    @staticmethod
    def request_stop(
        owner: Base,
        *,
        stop_event: Base.Event,
        mark_stop_requested: Callable[[], None],
    ) -> None:
        """统一处理停止请求链路，避免两条任务线各自维护一套收尾入口。"""

        mark_stop_requested()
        Engine.get().set_status(Base.TaskStatus.STOPPING)
        owner.emit(
            stop_event,
            {
                "sub_event": Base.SubEvent.RUN,
            },
        )

    @staticmethod
    def ensure_project_loaded(
        owner: Base,
        *,
        dm: Any,
        task_event: Base.Event,
    ) -> bool:
        """共享的工程加载校验。"""

        if dm.is_loaded():
            return True

        TaskRunnerLifecycle.emit_task_error(
            owner,
            task_event=task_event,
            message=Localizer.get().alert_project_not_loaded,
        )
        return False

    @staticmethod
    def resolve_active_model(
        owner: Base,
        *,
        config: Config,
        task_event: Base.Event,
    ) -> dict[str, Any] | None:
        """共享的激活模型校验。"""

        model = config.get_active_model()
        if model is not None:
            return model

        TaskRunnerLifecycle.emit_task_error(
            owner,
            task_event=task_event,
            message=Localizer.get().alert_no_active_model,
        )
        return None

    @staticmethod
    def build_task_limits(model: dict[str, Any] | None) -> tuple[int, int, int]:
        """统一并发和速率限制推导口径。"""

        if model is None:
            return 8, 8, 0

        threshold = model.get("threshold", {})
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

    @staticmethod
    def emit_task_done(
        owner: Base,
        *,
        task_event: Base.Event,
        final_status: str,
        message: str | None = None,
    ) -> None:
        """统一 DONE 事件载荷，避免不同任务线漂移。"""

        payload: dict[str, Any] = {
            "sub_event": Base.SubEvent.DONE,
            "final_status": final_status,
        }
        if isinstance(message, str) and message != "":
            payload["message"] = message
        owner.emit(task_event, payload)

    @classmethod
    def run_task_flow(
        cls,
        owner: Base,
        *,
        task_event: Base.Event,
        hooks: TaskRunnerHooks,
    ) -> None:
        """共享前置校验、计划初始化、调度驱动和终态收尾流程。"""

        flow_final_status = "FAILED"
        has_active_snapshot = False
        should_finalize = True
        should_emit_done = True
        should_run_after_done = True
        terminal_message: str | None = None
        immediate_error_message: str | None = None

        try:
            if not hooks.prepare():
                return

            plan = hooks.build_plan()
            if plan.total_line == 0:
                # “没有可处理条目”要显式落成错误终态，避免前端把它误认成成功完成。
                should_finalize = False
                should_emit_done = False
                should_run_after_done = False
                immediate_error_message = Localizer.get().engine_no_items
                return

            has_active_snapshot = True
            hooks.persist_progress(save_state=True)

            if not plan.has_pending_work:
                flow_final_status = plan.idle_final_status
                hooks.on_after_execute(flow_final_status)
                return

            max_workers, rps_limit, rpm_threshold = cls.build_task_limits(
                hooks.get_model()
            )
            hooks.bind_task_limiter(max_workers, rps_limit, rpm_threshold)
            hooks.on_before_execute()
            flow_final_status = hooks.execute(plan, max_workers)
            hooks.on_after_execute(flow_final_status)
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            terminal_message = Localizer.get().task_failed
        finally:
            if has_active_snapshot:
                hooks.persist_progress(save_state=True)
            hooks.clear_task_limiter()
            if should_finalize:
                hooks.finalize(flow_final_status)
            hooks.cleanup()
            Engine.get().set_status(Base.TaskStatus.IDLE)
            if (
                isinstance(immediate_error_message, str)
                and immediate_error_message != ""
            ):
                cls.emit_task_error(
                    owner,
                    task_event=task_event,
                    message=immediate_error_message,
                )
            if should_emit_done:
                cls.emit_task_done(
                    owner,
                    task_event=task_event,
                    final_status=flow_final_status,
                    message=terminal_message,
                )
            if should_run_after_done:
                hooks.after_done(flow_final_status)
