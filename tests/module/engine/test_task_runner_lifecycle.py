from __future__ import annotations

import sys
import threading
from types import ModuleType
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from base.Base import Base
import module.Engine.TaskRunnerLifecycle as lifecycle_module
from module.Engine.TaskRunnerLifecycle import TaskRunnerExecutionPlan
from module.Engine.TaskRunnerLifecycle import TaskRunnerHooks
from module.Engine.TaskRunnerLifecycle import TaskRunnerLifecycle


class EventRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[Base.Event, dict]] = []

    def emit(self, event: Base.Event, payload: dict) -> bool:
        self.events.append((event, payload))
        return True


def create_owner() -> SimpleNamespace:
    recorder = EventRecorder()
    owner = SimpleNamespace()
    owner.emit = recorder.emit
    owner.events = recorder.events
    return owner


def create_engine(status: Base.TaskStatus) -> SimpleNamespace:
    engine = SimpleNamespace(status=status, lock=threading.Lock())
    engine.set_status = lambda new_status: setattr(engine, "status", new_status)
    engine.get_status = lambda: engine.status
    return engine


def test_reset_request_runtime_resets_optional_text_processor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    monkeypatch.setattr(
        lifecycle_module.TaskRequester,
        "reset",
        staticmethod(lambda: calls.append("requester")),
    )
    monkeypatch.setattr(
        lifecycle_module.PromptBuilder,
        "reset",
        staticmethod(lambda: calls.append("prompt")),
    )

    fake_module = ModuleType("module.TextProcessor")

    class FakeTextProcessor:
        @staticmethod
        def reset() -> None:
            calls.append("text")

    fake_module.TextProcessor = FakeTextProcessor
    monkeypatch.setitem(sys.modules, "module.TextProcessor", fake_module)

    TaskRunnerLifecycle.reset_request_runtime(reset_text_processor=False)
    TaskRunnerLifecycle.reset_request_runtime(reset_text_processor=True)

    assert calls == ["requester", "prompt", "requester", "prompt", "text"]


def test_start_background_run_emits_busy_warning_when_engine_not_idle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = create_owner()
    engine = create_engine(Base.TaskStatus.TRANSLATING)
    worker = MagicMock()

    monkeypatch.setattr(
        lifecycle_module.Engine,
        "get",
        staticmethod(lambda: engine),
    )
    monkeypatch.setattr(
        lifecycle_module.Localizer,
        "get",
        staticmethod(
            lambda: SimpleNamespace(task_running="task_running", task_failed="failed")
        ),
    )

    TaskRunnerLifecycle.start_background_run(
        owner,
        busy_status=Base.TaskStatus.ANALYZING,
        task_event=Base.Event.ANALYSIS_TASK,
        mode=Base.AnalysisMode.NEW,
        worker=worker,
    )

    assert owner.events == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "task_running",
            },
        ),
        (
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": "task_running",
            },
        ),
    ]
    worker.assert_not_called()
    assert engine.status == Base.TaskStatus.TRANSLATING


def test_start_background_run_emits_run_and_executes_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = create_owner()
    engine = create_engine(Base.TaskStatus.IDLE)
    thread_state: dict[str, bool] = {"started": False}
    worker_calls: list[str] = []

    class InlineThread:
        def __init__(self, *, target: Any, daemon: bool) -> None:
            self.target = target
            thread_state["daemon"] = daemon

        def start(self) -> None:
            thread_state["started"] = True
            self.target()

    monkeypatch.setattr(
        lifecycle_module.Engine,
        "get",
        staticmethod(lambda: engine),
    )

    TaskRunnerLifecycle.start_background_run(
        owner,
        busy_status=Base.TaskStatus.TRANSLATING,
        task_event=Base.Event.TRANSLATION_TASK,
        mode=Base.TranslationMode.NEW,
        worker=lambda: worker_calls.append("ran"),
        thread_factory=InlineThread,
    )

    assert owner.events == [
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.RUN,
                "mode": Base.TranslationMode.NEW,
            },
        )
    ]
    assert worker_calls == ["ran"]
    assert thread_state == {"started": True, "daemon": True}
    assert engine.status == Base.TaskStatus.TRANSLATING


def test_start_background_run_restores_idle_when_thread_factory_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = create_owner()
    engine = create_engine(Base.TaskStatus.IDLE)
    fake_log = MagicMock()

    monkeypatch.setattr(
        lifecycle_module.Engine,
        "get",
        staticmethod(lambda: engine),
    )
    monkeypatch.setattr(
        lifecycle_module.Localizer,
        "get",
        staticmethod(
            lambda: SimpleNamespace(task_running="task_running", task_failed="failed")
        ),
    )
    monkeypatch.setattr(
        lifecycle_module.LogManager,
        "get",
        staticmethod(lambda: fake_log),
    )

    def failing_thread_factory(**kwargs: Any) -> Any:
        del kwargs
        raise RuntimeError("boom")

    TaskRunnerLifecycle.start_background_run(
        owner,
        busy_status=Base.TaskStatus.TRANSLATING,
        task_event=Base.Event.TRANSLATION_TASK,
        mode=Base.TranslationMode.NEW,
        worker=lambda: None,
        thread_factory=failing_thread_factory,
    )

    assert owner.events == [
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.RUN,
                "mode": Base.TranslationMode.NEW,
            },
        ),
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "failed",
            },
        ),
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": "failed",
            },
        ),
    ]
    fake_log.error.assert_called_once()
    assert engine.status == Base.TaskStatus.IDLE


def test_run_task_flow_skips_finalize_and_done_when_plan_has_no_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = create_owner()
    engine = create_engine(Base.TaskStatus.TRANSLATING)
    finalize = MagicMock()
    cleanup = MagicMock()
    after_done = MagicMock()

    monkeypatch.setattr(
        lifecycle_module.Engine,
        "get",
        staticmethod(lambda: engine),
    )
    monkeypatch.setattr(
        lifecycle_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(engine_no_items="no_items")),
    )

    TaskRunnerLifecycle.run_task_flow(
        owner,
        task_event=Base.Event.TRANSLATION_TASK,
        hooks=TaskRunnerHooks(
            prepare=MagicMock(return_value=True),
            build_plan=MagicMock(
                return_value=TaskRunnerExecutionPlan(
                    total_line=0,
                    line=0,
                    has_pending_work=False,
                    idle_final_status="SUCCESS",
                )
            ),
            persist_progress=MagicMock(return_value={}),
            get_model=MagicMock(return_value=None),
            bind_task_limiter=MagicMock(),
            clear_task_limiter=MagicMock(),
            on_before_execute=MagicMock(),
            execute=MagicMock(return_value="SUCCESS"),
            on_after_execute=MagicMock(),
            terminal_toast=MagicMock(),
            finalize=finalize,
            cleanup=cleanup,
            after_done=after_done,
        ),
    )

    assert owner.events == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "no_items",
            },
        )
    ]
    finalize.assert_not_called()
    cleanup.assert_called_once_with()
    after_done.assert_not_called()
    assert engine.status == Base.TaskStatus.IDLE
