from importlib import import_module
from types import SimpleNamespace
from typing import Any

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Engine import Engine
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot
from module.Localizer.Localizer import Localizer

analysis_module = import_module("module.Engine.Analysis.Analysis")
EmittedEvent = tuple[Base.Event, dict[str, object]]


def build_context(file_path: str) -> AnalysisTaskContext:
    return AnalysisTaskContext(
        file_path=file_path,
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path=file_path,
                src_text="src-1",
            ),
        ),
    )


def build_analysis_progress_snapshot(
    *,
    total_line: int,
    line: int,
    processed_line: int,
    error_line: int,
    time_value: float = 0.0,
    total_tokens: int = 0,
    total_input_tokens: int = 0,
    total_output_tokens: int = 0,
    start_time: float = 1.0,
) -> TaskProgressSnapshot:
    return TaskProgressSnapshot(
        start_time=start_time,
        time=time_value,
        total_line=total_line,
        line=line,
        processed_line=processed_line,
        error_line=error_line,
        total_tokens=total_tokens,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
    )


class FakeLogManager:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.error_messages: list[str] = []
        self.error_exceptions: list[BaseException | None] = []
        self.print_messages: list[str] = []

    def info(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def print(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.print_messages.append(msg)

    def error(self, msg: str, e: BaseException | None = None) -> None:
        self.error_messages.append(msg)
        self.error_exceptions.append(e)


class ImmediateThread:
    def __init__(self, target, args=(), daemon=None) -> None:
        self.target = target
        self.args = args
        self.daemon = daemon

    def start(self) -> None:
        self.target(*self.args)


class FakeProgressBar:
    instances: list["FakeProgressBar"] = []

    def __init__(self, transient: bool) -> None:
        self.transient = transient
        self.new_calls: list[dict[str, int]] = []
        FakeProgressBar.instances.append(self)

    def __enter__(self) -> "FakeProgressBar":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        del exc_type, exc, tb
        return False

    def new(self, total: int = 0, completed: int = 0) -> int:
        self.new_calls.append({"total": total, "completed": completed})
        return 11

    def update(self, task_id: int, **kwargs: int) -> None:
        del task_id, kwargs


def install_analysis_import_glossary_runtime(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    logger: FakeLogManager,
    thread_type: type[Any],
) -> None:
    # 导入测试只关心事件流，不关心真实线程与日志实现，这里统一装最小运行环境。
    monkeypatch.setattr(
        analysis_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_module.threading, "Thread", thread_type)
    monkeypatch.setattr(analysis_module.LogManager, "get", lambda: logger)


def capture_emitted_events(
    monkeypatch: pytest.MonkeyPatch,
    analysis: Analysis,
) -> list[EmittedEvent]:
    # 统一把事件收进列表，避免每个测试都手写一遍同样的 lambda。
    emitted: list[EmittedEvent] = []
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )
    return emitted


def assert_analysis_import_started(emitted: list[EmittedEvent]) -> None:
    # 导入入口必须先通知页面“开始了”，后面的成功/失败断言才有意义。
    assert emitted[:2] == [
        (
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {"sub_event": Base.SubEvent.RUN},
        ),
        (
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": "处理中 …",
                "indeterminate": True,
            },
        ),
    ]


def assert_analysis_import_finished(
    emitted: list[EmittedEvent],
    *,
    sub_event: Base.SubEvent,
) -> None:
    # 统一校验进度提示的收尾方式，避免每个测试都重复找同一条事件。
    assert (
        Base.Event.PROGRESS_TOAST,
        {"sub_event": sub_event},
    ) in emitted


# 导入术语相关测试都要同步线程并截获日志，这里集中搭建，避免样板代码盖住断言重点。
def build_import_glossary_test_context(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: object,
) -> tuple[Analysis, list[EmittedEvent], FakeLogManager]:
    logger = FakeLogManager()
    install_analysis_import_glossary_runtime(
        monkeypatch,
        fake_data_manager,
        logger,
        ImmediateThread,
    )
    analysis = Analysis()
    emitted = capture_emitted_events(monkeypatch, analysis)
    return analysis, emitted, logger


def install_analysis_start_runtime(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: object,
    quality_snapshot: object,
) -> None:
    # 启动类测试都依赖同一套 DataManager 和质量快照补丁，这里集中收口。
    monkeypatch.setattr(
        analysis_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        analysis_module.QualityRuleSnapshot,
        "capture",
        lambda: quality_snapshot,
    )


def build_start_config() -> Config:
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}
    return config


def patch_start_runtime(
    monkeypatch: pytest.MonkeyPatch,
    analysis: Analysis,
    *,
    task_contexts: list[AnalysisTaskContext],
    progress_snapshot: SimpleNamespace,
) -> None:
    # 启动路径只关心任务列表和进度快照，统一在这里替身，减少测试样板。
    monkeypatch.setattr(
        analysis,
        "build_analysis_task_contexts",
        lambda config: task_contexts,
    )
    monkeypatch.setattr(
        analysis,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: progress_snapshot,
    )


def test_analysis_require_stop_marks_engine_as_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis = Analysis()
    emitted = capture_emitted_events(monkeypatch, analysis)

    Engine.get().set_status(Base.TaskStatus.ANALYZING)

    analysis.analysis_require_stop()

    assert analysis.stop_requested is True
    assert Engine.get().get_status() == Base.TaskStatus.STOPPING
    assert emitted == [
        (
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.RUN},
        )
    ]


@pytest.mark.parametrize(
    ("final_status", "toast_type", "message_attr"),
    [
        ("SUCCESS", Base.ToastType.SUCCESS, "engine_task_done"),
        ("STOPPED", Base.ToastType.SUCCESS, "engine_task_stop"),
        ("FAILED", Base.ToastType.WARNING, "engine_task_fail"),
    ],
)
def test_emit_analysis_terminal_toast_matches_final_status(
    monkeypatch: pytest.MonkeyPatch,
    final_status: str,
    toast_type: Base.ToastType,
    message_attr: str,
) -> None:
    analysis = Analysis()
    emitted = capture_emitted_events(monkeypatch, analysis)

    analysis.emit_analysis_terminal_toast(final_status)

    assert emitted == [
        (
            Base.Event.TOAST,
            {
                "type": toast_type,
                "message": getattr(Localizer.get(), message_attr),
            },
        )
    ]


def test_start_continue_only_executes_pending_tasks(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    fake_data_manager.analysis_extras = {
        "time": 12.0,
        "total_input_tokens": 5,
        "total_output_tokens": 8,
        "total_tokens": 13,
    }
    fake_data_manager.items = [
        Item(id=1, src="A", file_path="story.txt"),
        Item(id=2, src="B", file_path="story.txt"),
        Item(id=3, src="C", file_path="story.txt"),
    ]
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    config = build_start_config()

    contexts = [build_context("todo")]
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=contexts,
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=3,
            line=2,
            processed_line=1,
            error_line=1,
            time_value=12.0,
            total_tokens=13,
            total_input_tokens=5,
            total_output_tokens=8,
        ),
    )

    called: list[str] = []
    monkeypatch.setattr(
        analysis,
        "execute_task_contexts",
        lambda task_contexts, max_workers: (
            called.extend(context.file_path for context in task_contexts) or "SUCCESS"
        ),
    )

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert called == ["todo"]
    assert fake_data_manager.import_count == 0
    assert fake_data_manager.analysis_extras["total_line"] == 3


def test_start_continue_without_pending_tasks_emits_auto_import_when_candidates_exist(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    fake_data_manager.analysis_candidate_count = 2
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    emitted = capture_emitted_events(monkeypatch, analysis)
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=3,
            line=3,
            processed_line=3,
            error_line=0,
            time_value=12.0,
            total_tokens=13,
            total_input_tokens=5,
            total_output_tokens=8,
        ),
    )

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted


def test_start_continue_without_pending_tasks_skips_auto_import_when_no_candidates(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    emitted = capture_emitted_events(monkeypatch, analysis)
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=3,
            line=3,
            processed_line=3,
            error_line=0,
            time_value=12.0,
            total_tokens=13,
            total_input_tokens=5,
            total_output_tokens=8,
        ),
    )

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    ) not in emitted


def test_analysis_reset_failed_rebuilds_progress_without_clearing_candidates(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_extras = {
        "time": 9.0,
        "total_input_tokens": 4,
        "total_output_tokens": 6,
        "total_tokens": 10,
    }
    fake_data_manager.analysis_candidate_count = 5
    fake_data_manager.analysis_item_checkpoints = {
        1: {"status": Base.ProjectStatus.PROCESSED},
        2: {"status": Base.ProjectStatus.ERROR},
    }
    monkeypatch.setattr(
        analysis_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analysis = Analysis()

    monkeypatch.setattr(analysis_module.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(
        analysis,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: build_analysis_progress_snapshot(
            total_line=2,
            line=1,
            processed_line=1,
            error_line=0,
            time_value=9.0,
            total_tokens=10,
            total_input_tokens=4,
            total_output_tokens=6,
        ),
    )

    analysis.analysis_reset(
        Base.Event.ANALYSIS_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert 2 not in fake_data_manager.analysis_item_checkpoints
    assert fake_data_manager.analysis_candidate_count == 5
    assert fake_data_manager.analysis_extras["processed_line"] == 1
    assert fake_data_manager.analysis_extras["error_line"] == 0


def test_start_stopped_does_not_import_candidates(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[build_context("todo")],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=2,
            line=0,
            processed_line=0,
            error_line=0,
        ),
    )
    monkeypatch.setattr(
        analysis,
        "execute_task_contexts",
        lambda task_contexts, max_workers: "STOPPED",
    )

    analysis.start({"mode": Base.AnalysisMode.NEW, "config": config})

    assert fake_data_manager.import_count == 0


def test_start_creates_progress_bar_for_pending_tasks(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    config = build_start_config()
    FakeProgressBar.instances = []
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[build_context("todo")],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=5,
            line=2,
            processed_line=1,
            error_line=1,
            time_value=12.0,
        ),
    )
    monkeypatch.setattr(analysis_module, "ProgressBar", FakeProgressBar)
    monkeypatch.setattr(
        analysis_module,
        "TaskLimiter",
        lambda rps, rpm, max_concurrency: SimpleNamespace(
            rps=rps,
            rpm=rpm,
            max_concurrency=max_concurrency,
        ),
    )
    monkeypatch.setattr(analysis, "log_analysis_start", lambda: None)
    monkeypatch.setattr(analysis, "log_analysis_finish", lambda final_status: None)
    monkeypatch.setattr(
        analysis,
        "emit_analysis_terminal_toast",
        lambda final_status: None,
    )
    monkeypatch.setattr(
        analysis,
        "persist_progress_snapshot",
        lambda save_state: dict(analysis.extras),
    )

    def fake_execute(task_contexts, max_workers: int) -> str:
        del task_contexts, max_workers
        assert len(FakeProgressBar.instances) == 1
        assert analysis.pipeline.console_progress is FakeProgressBar.instances[0]
        assert analysis.pipeline.console_progress_task_id == 11
        return "SUCCESS"

    monkeypatch.setattr(analysis, "execute_task_contexts", fake_execute)

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert len(FakeProgressBar.instances) == 1
    assert FakeProgressBar.instances[0].transient is True
    assert FakeProgressBar.instances[0].new_calls == [{"total": 5, "completed": 2}]
    assert analysis.pipeline.console_progress is None
    assert analysis.pipeline.console_progress_task_id is None


def test_start_without_pending_tasks_skips_progress_bar(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=3,
            line=3,
            processed_line=3,
            error_line=0,
            time_value=12.0,
        ),
    )

    def fail_progress_bar(*args, **kwargs) -> FakeProgressBar:
        del args, kwargs
        raise AssertionError("没有待执行任务时不该创建进度条")

    monkeypatch.setattr(analysis_module, "ProgressBar", fail_progress_bar)
    monkeypatch.setattr(analysis, "log_analysis_finish", lambda final_status: None)
    monkeypatch.setattr(
        analysis,
        "emit_analysis_terminal_toast",
        lambda final_status: None,
    )
    monkeypatch.setattr(
        analysis,
        "persist_progress_snapshot",
        lambda save_state: dict(analysis.extras),
    )

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})


def test_analysis_import_glossary_emits_done_and_refresh(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_candidate_count = 1
    analysis, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    analysis.analysis_import_glossary()

    assert_analysis_import_started(emitted)
    assert (
        Base.Event.TOAST,
        {
            "type": Base.ToastType.SUCCESS,
            "message": "导入成功，新增 1 条 …",
        },
    ) in emitted
    assert_analysis_import_finished(emitted, sub_event=Base.SubEvent.DONE)
    assert (
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted
    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.DONE, "imported_count": 1},
    ) in emitted
    assert fake_data_manager.import_expected_paths == [fake_data_manager.lg_path]
    assert logger.info_messages == ["处理中 …", "导入成功，新增 1 条 …"]
    assert logger.print_messages == [""]


def test_analysis_import_glossary_emits_success_toast_when_zero_imported(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    analysis.analysis_import_glossary()

    assert_analysis_import_started(emitted)
    assert (
        Base.Event.TOAST,
        {
            "type": Base.ToastType.SUCCESS,
            "message": "导入成功，新增 0 条 …",
        },
    ) in emitted
    assert_analysis_import_finished(emitted, sub_event=Base.SubEvent.DONE)
    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.DONE, "imported_count": 0},
    ) in emitted
    assert logger.info_messages == ["处理中 …", "导入成功，新增 0 条 …"]
    assert logger.print_messages == [""]


def test_analysis_import_glossary_skips_stale_project_after_switch(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_candidate_count = 1
    analysis, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    class SwitchingThread:
        def __init__(self, target, args=(), daemon=None) -> None:
            self.target = target
            self.args = args
            self.daemon = daemon

        def start(self) -> None:
            fake_data_manager.lg_path = "/workspace/demo/other-project.lg"
            self.target(*self.args)

    monkeypatch.setattr(analysis_module.threading, "Thread", SwitchingThread)

    analysis.analysis_import_glossary()

    assert_analysis_import_started(emitted)
    assert_analysis_import_finished(emitted, sub_event=Base.SubEvent.DONE)
    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.ERROR},
    ) in emitted
    assert not any(event == Base.Event.TOAST for event, _ in emitted)
    assert fake_data_manager.import_count == 0
    assert fake_data_manager.import_expected_paths == ["/workspace/demo/project.lg"]
    assert logger.info_messages == ["处理中 …"]
    assert logger.print_messages == [""]


def test_analysis_import_glossary_emits_error_toast_and_progress_terminal_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_candidate_count = 1
    analysis, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    def raise_import_error(
        dm,
        *,
        expected_lg_path: str,
    ) -> int | None:
        del dm, expected_lg_path
        raise RuntimeError("boom")

    monkeypatch.setattr(
        analysis,
        "import_analysis_candidates_sync",
        raise_import_error,
    )

    analysis.analysis_import_glossary()

    assert_analysis_import_started(emitted)
    assert (
        Base.Event.TOAST,
        {
            "type": Base.ToastType.ERROR,
            "message": "任务执行失败 …",
        },
    ) in emitted
    assert_analysis_import_finished(emitted, sub_event=Base.SubEvent.ERROR)
    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {
            "sub_event": Base.SubEvent.ERROR,
            "message": "任务执行失败 …",
        },
    ) in emitted
    assert logger.info_messages == ["处理中 …"]
    assert logger.error_messages == ["任务执行失败 …"]
    assert isinstance(logger.error_exceptions[0], RuntimeError)
    assert logger.print_messages == [""]


def test_import_analysis_candidates_sync_calls_new_entry(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    called: list[str | None] = []

    def fake_import(expected_lg_path: str | None = None) -> int | None:
        called.append(expected_lg_path)
        return 1

    fake_data_manager.import_analysis_candidates = fake_import
    monkeypatch.setattr(analysis, "emit", lambda event, data: None)

    assert (
        analysis.import_analysis_candidates_sync(
            fake_data_manager,
            expected_lg_path="demo.lg",
        )
        == 1
    )
    assert called == ["demo.lg"]


def test_start_success_emits_auto_import_glossary_request(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        quality_snapshot,
    )

    analysis = Analysis()
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[build_context("todo")],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=2,
            line=0,
            processed_line=0,
            error_line=0,
        ),
    )
    monkeypatch.setattr(
        analysis,
        "execute_task_contexts",
        lambda task_contexts, max_workers: (
            setattr(fake_data_manager, "analysis_candidate_count", 1) or "SUCCESS"
        ),
    )
    emitted = capture_emitted_events(monkeypatch, analysis)

    analysis.start({"mode": Base.AnalysisMode.NEW, "config": config})

    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted
