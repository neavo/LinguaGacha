from importlib import import_module
from types import SimpleNamespace

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Engine import Engine
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot

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
        self.rich_messages: list[object] = []

    def info(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def print(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.print_messages.append(msg)

    def error(self, msg: str, e: BaseException | None = None) -> None:
        self.error_messages.append(msg)
        self.error_exceptions.append(e)

    def print_rich(self, renderable: object) -> None:
        self.rich_messages.append(renderable)


def install_analysis_logger(
    monkeypatch: pytest.MonkeyPatch,
    logger: FakeLogManager | None = None,
) -> FakeLogManager:
    # 分析控制器已不再依赖 LogManager；保留这个辅助函数，兼容旧测试装配入口。
    fake_logger = logger or FakeLogManager()
    if hasattr(analysis_module, "LogManager"):
        monkeypatch.setattr(analysis_module.LogManager, "get", lambda: fake_logger)
    return fake_logger


class ImmediateThread:
    def __init__(self, target, args=(), daemon=None) -> None:
        self.target = target
        self.args = args
        self.daemon = daemon

    def start(self) -> None:
        self.target(*self.args)


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


def install_analysis_start_runtime(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager: object,
    quality_snapshot: object,
) -> None:
    # 启动类测试只验证生命周期行为，不该依赖真实提示词文件路径。
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
    monkeypatch.setattr(
        analysis_module.AnalysisTask,
        "log_run_start",
        lambda owner: None,
    )
    monkeypatch.setattr(
        analysis_module.AnalysisTask,
        "log_run_finish",
        lambda final_status: None,
    )
    install_analysis_logger(monkeypatch)


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
        analysis.scheduler,
        "build_analysis_task_contexts",
        lambda config: task_contexts,
    )
    monkeypatch.setattr(
        analysis.scheduler,
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
    assert fake_data_manager.analysis_extras["total_line"] == 3


def test_start_continue_without_pending_tasks_does_not_emit_followup_event(
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

    assert emitted != []
    assert all(
        event in (Base.Event.ANALYSIS_PROGRESS, Base.Event.ANALYSIS_TASK)
        for event, _data in emitted
    )


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


def test_start_with_pending_tasks_runs_without_console_progress(
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
    install_analysis_logger(monkeypatch)
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
    monkeypatch.setattr(
        analysis_module,
        "TaskLimiter",
        lambda rps, rpm, max_concurrency: SimpleNamespace(
            rps=rps,
            rpm=rpm,
            max_concurrency=max_concurrency,
        ),
    )
    monkeypatch.setattr(
        analysis_module.AnalysisTask, "log_run_start", lambda owner: None
    )
    monkeypatch.setattr(
        analysis_module.AnalysisTask,
        "log_run_finish",
        lambda final_status: None,
    )
    monkeypatch.setattr(
        analysis.progress_tracker,
        "persist_progress_snapshot",
        lambda save_state: dict(analysis.extras),
    )
    executed = {"called": False}

    def fake_execute(task_contexts, max_workers: int) -> str:
        del task_contexts, max_workers
        executed["called"] = True
        return "SUCCESS"

    monkeypatch.setattr(analysis, "execute_task_contexts", fake_execute)

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert executed["called"] is True


def test_start_without_pending_tasks_skips_console_progress(
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

    monkeypatch.setattr(
        analysis_module.AnalysisTask,
        "log_run_finish",
        lambda final_status: None,
    )
    monkeypatch.setattr(
        analysis.progress_tracker,
        "persist_progress_snapshot",
        lambda save_state: dict(analysis.extras),
    )

    analysis.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})


def test_start_success_does_not_emit_followup_request(
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

    assert emitted != []
    assert all(
        event in (Base.Event.ANALYSIS_PROGRESS, Base.Event.ANALYSIS_TASK)
        for event, _data in emitted
    )


def test_start_uses_quality_snapshot_override(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    install_analysis_start_runtime(
        monkeypatch,
        fake_data_manager,
        SimpleNamespace(should_not_be_used=True),
    )

    analysis = Analysis()
    config = build_start_config()
    patch_start_runtime(
        monkeypatch,
        analysis,
        task_contexts=[],
        progress_snapshot=build_analysis_progress_snapshot(
            total_line=1,
            line=1,
            processed_line=1,
            error_line=0,
        ),
    )

    analysis.start(
        {
            "mode": Base.AnalysisMode.NEW,
            "config": config,
            "quality_snapshot": quality_snapshot,
        }
    )

    assert analysis.quality_snapshot is quality_snapshot
