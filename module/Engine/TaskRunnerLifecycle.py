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
    terminal_toast: Callable[[str], None]
    finalize: Callable[[str], None]
    after_done: Callable[[str], None]


class TaskRunnerLifecycle:
    """抽取分析与翻译共享的任务生命周期骨架。"""

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
                owner.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().task_running,
                    },
                )
                owner.emit(
                    task_event,
                    {
                        "sub_event": Base.SubEvent.ERROR,
                        "message": Localizer.get().task_running,
                    },
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
            owner.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            owner.emit(
                task_event,
                {
                    "sub_event": Base.SubEvent.ERROR,
                    "message": Localizer.get().task_failed,
                },
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
    def ensure_project_loaded(owner: Base, *, dm: Any) -> bool:
        """共享的工程加载校验。"""

        if dm.is_loaded():
            return True

        owner.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().alert_project_not_loaded,
            },
        )
        return False

    @staticmethod
    def resolve_active_model(
        owner: Base,
        *,
        config: Config,
    ) -> dict[str, Any] | None:
        """共享的激活模型校验。"""

        model = config.get_active_model()
        if model is not None:
            return model

        owner.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().alert_no_active_model,
            },
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
    def emit_terminal_toast(owner: Base, *, final_status: str) -> None:
        """统一成功、停止、失败三种终态提示。"""

        if final_status == "SUCCESS":
            toast_type = Base.ToastType.SUCCESS
            message = Localizer.get().engine_task_done
        elif final_status == "STOPPED":
            toast_type = Base.ToastType.SUCCESS
            message = Localizer.get().engine_task_stop
        else:
            toast_type = Base.ToastType.WARNING
            message = Localizer.get().engine_task_fail

        owner.emit(
            Base.Event.TOAST,
            {
                "type": toast_type,
                "message": message,
            },
        )

    @staticmethod
    def emit_task_done(
        owner: Base,
        *,
        task_event: Base.Event,
        final_status: str,
    ) -> None:
        """统一 DONE 事件载荷，避免不同任务线漂移。"""

        owner.emit(
            task_event,
            {
                "sub_event": Base.SubEvent.DONE,
                "final_status": final_status,
            },
        )

    @staticmethod
    def emit_no_items_warning(owner: Base) -> None:
        """两条任务线的“没有可处理条目”提示统一收口。"""

        owner.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().engine_no_items,
            },
        )

    @staticmethod
    def run_reset_flow(
        owner: Base,
        *,
        reset_event: Base.Event,
        progress_message: str | None,
        worker: Callable[[], None],
        thread_factory: Callable[..., Any] = threading.Thread,
        ensure_loaded: Callable[[], bool],
    ) -> None:
        """统一重置任务的边界事件、线程启动和异常提示。"""
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            owner.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            owner.emit(reset_event, {"sub_event": Base.SubEvent.ERROR})
            return

        if not ensure_loaded():
            return

        owner.emit(reset_event, {"sub_event": Base.SubEvent.RUN})
        progress_toast_active = False
        if progress_message:
            owner.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "message": progress_message,
                    "indeterminate": True,
                },
            )
            progress_toast_active = True

        def task() -> None:
            try:
                worker()
                owner.emit(reset_event, {"sub_event": Base.SubEvent.DONE})
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                owner.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
                owner.emit(reset_event, {"sub_event": Base.SubEvent.ERROR})
            finally:
                if progress_toast_active:
                    owner.emit(
                        Base.Event.PROGRESS_TOAST,
                        {"sub_event": Base.SubEvent.DONE},
                    )

        thread_factory(target=task, daemon=True).start()

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

        try:
            if not hooks.prepare():
                return

            plan = hooks.build_plan()
            if plan.total_line == 0:
                cls.emit_no_items_warning(owner)
                return

            has_active_snapshot = True
            hooks.persist_progress(save_state=True)

            if not plan.has_pending_work:
                flow_final_status = plan.idle_final_status
                hooks.on_after_execute(flow_final_status)
                hooks.terminal_toast(flow_final_status)
                return

            max_workers, rps_limit, rpm_threshold = cls.build_task_limits(
                hooks.get_model()
            )
            hooks.bind_task_limiter(max_workers, rps_limit, rpm_threshold)
            hooks.on_before_execute()
            flow_final_status = hooks.execute(plan, max_workers)
            hooks.on_after_execute(flow_final_status)
            hooks.terminal_toast(flow_final_status)
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            owner.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
        finally:
            if has_active_snapshot:
                hooks.persist_progress(save_state=True)
            hooks.clear_task_limiter()
            hooks.finalize(flow_final_status)
            Engine.get().set_status(Base.TaskStatus.IDLE)
            cls.emit_task_done(
                owner,
                task_event=task_event,
                final_status=flow_final_status,
            )
            hooks.after_done(flow_final_status)
