from __future__ import annotations

import threading
from types import SimpleNamespace
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
