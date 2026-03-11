from importlib import import_module
from types import SimpleNamespace
from typing import Any

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.Analyzer import Analyzer
from module.Engine.Engine import Engine

analyzer_module = import_module("module.Engine.Analyzer.Analyzer")
EmittedEvent = tuple[Base.Event, dict[str, object]]


def build_context(task_fingerprint: str) -> AnalysisTaskContext:
    return AnalysisTaskContext(
        task_fingerprint=task_fingerprint,
        file_path="story.txt",
        items=tuple(),
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


def install_analysis_import_glossary_runtime(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    logger: FakeLogManager,
    thread_type: type[Any],
) -> None:
    # 导入测试只关心事件流，不关心真实线程与日志实现，这里统一装最小运行环境。
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analyzer_module.threading, "Thread", thread_type)
    monkeypatch.setattr(analyzer_module.LogManager, "get", lambda: logger)


def capture_emitted_events(
    monkeypatch: pytest.MonkeyPatch,
    analyzer: Analyzer,
) -> list[EmittedEvent]:
    # 统一把事件收进列表，避免每个测试都手写一遍同样的 lambda。
    emitted: list[EmittedEvent] = []
    monkeypatch.setattr(
        analyzer,
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
) -> tuple[Analyzer, list[EmittedEvent], FakeLogManager]:
    logger = FakeLogManager()
    install_analysis_import_glossary_runtime(
        monkeypatch,
        fake_data_manager,
        logger,
        ImmediateThread,
    )
    analyzer = Analyzer()
    emitted = capture_emitted_events(monkeypatch, analyzer)
    return analyzer, emitted, logger


def test_analysis_require_stop_marks_engine_as_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analyzer = Analyzer()
    emitted = capture_emitted_events(monkeypatch, analyzer)

    Engine.get().set_status(Base.TaskStatus.ANALYZING)

    analyzer.analysis_require_stop()

    assert analyzer.stop_requested is True
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
        "added_glossary": 2,
    }
    fake_data_manager.items = [
        Item(id=1, src="A", file_path="story.txt"),
        Item(id=2, src="B", file_path="story.txt"),
        Item(id=3, src="C", file_path="story.txt"),
    ]
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        analyzer_module.QualityRuleSnapshot,
        "capture",
        lambda: quality_snapshot,
    )

    analyzer = Analyzer()
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}

    contexts = [build_context("todo")]
    monkeypatch.setattr(
        analyzer, "build_analysis_task_contexts", lambda config: contexts
    )
    monkeypatch.setattr(
        analyzer,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: SimpleNamespace(
            to_dict=lambda: {
                "start_time": 1.0,
                "time": 12.0,
                "total_line": 3,
                "line": 2,
                "processed_line": 1,
                "error_line": 1,
                "total_tokens": 13,
                "total_input_tokens": 5,
                "total_output_tokens": 8,
                "added_glossary": 2,
            },
            total_line=3,
        ),
    )

    called: list[str] = []
    monkeypatch.setattr(
        analyzer,
        "execute_task_contexts",
        lambda task_contexts, max_workers: (
            called.extend(context.task_fingerprint for context in task_contexts)
            or "SUCCESS"
        ),
    )

    analyzer.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert called == ["todo"]
    assert fake_data_manager.import_count == 0
    assert fake_data_manager.analysis_extras["total_line"] == 3


def test_analysis_reset_failed_rebuilds_progress_without_clearing_candidates(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_extras = {
        "time": 9.0,
        "total_input_tokens": 4,
        "total_output_tokens": 6,
        "total_tokens": 10,
        "added_glossary": 3,
    }
    fake_data_manager.analysis_candidate_count = 5
    fake_data_manager.analysis_item_checkpoints = {
        1: {"source_hash": "h1", "status": Base.ProjectStatus.PROCESSED},
        2: {"source_hash": "h2", "status": Base.ProjectStatus.ERROR},
    }
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analyzer = Analyzer()

    monkeypatch.setattr(analyzer_module.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(
        analyzer,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: SimpleNamespace(
            to_dict=lambda: {
                "start_time": 1.0,
                "time": 9.0,
                "total_line": 2,
                "line": 1,
                "processed_line": 1,
                "error_line": 0,
                "total_tokens": 10,
                "total_input_tokens": 4,
                "total_output_tokens": 6,
                "added_glossary": 3,
            }
        ),
    )

    analyzer.analysis_reset(
        Base.Event.ANALYSIS_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert 2 not in fake_data_manager.analysis_item_checkpoints
    assert fake_data_manager.analysis_candidate_count == 5
    assert fake_data_manager.analysis_extras["processed_line"] == 1
    assert fake_data_manager.analysis_extras["error_line"] == 0


def test_start_stopped_does_not_import_term_pool(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        analyzer_module.QualityRuleSnapshot,
        "capture",
        lambda: quality_snapshot,
    )

    analyzer = Analyzer()
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}
    monkeypatch.setattr(
        analyzer,
        "build_analysis_task_contexts",
        lambda config: [build_context("todo")],
    )
    monkeypatch.setattr(
        analyzer,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: SimpleNamespace(
            to_dict=lambda: {
                "start_time": 1.0,
                "time": 0.0,
                "total_line": 2,
                "line": 0,
                "processed_line": 0,
                "error_line": 0,
                "total_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "added_glossary": 0,
            },
            total_line=2,
        ),
    )
    monkeypatch.setattr(
        analyzer,
        "execute_task_contexts",
        lambda task_contexts, max_workers: "STOPPED",
    )

    analyzer.start({"mode": Base.AnalysisMode.NEW, "config": config})

    assert fake_data_manager.import_count == 0


def test_analysis_import_glossary_emits_done_and_refresh(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_candidate_count = 1
    analyzer, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    analyzer.analysis_import_glossary()

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
    analyzer, emitted, logger = build_import_glossary_test_context(
        monkeypatch,
        fake_data_manager,
    )

    analyzer.analysis_import_glossary()

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
    analyzer, emitted, logger = build_import_glossary_test_context(
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

    monkeypatch.setattr(analyzer_module.threading, "Thread", SwitchingThread)

    analyzer.analysis_import_glossary()

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
    analyzer, emitted, logger = build_import_glossary_test_context(
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
        analyzer,
        "import_analysis_term_pool_sync",
        raise_import_error,
    )

    analyzer.analysis_import_glossary()

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


def test_start_success_emits_auto_import_glossary_request(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    quality_snapshot,
) -> None:
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        analyzer_module.QualityRuleSnapshot,
        "capture",
        lambda: quality_snapshot,
    )

    analyzer = Analyzer()
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}
    monkeypatch.setattr(
        analyzer,
        "build_analysis_task_contexts",
        lambda config: [build_context("todo")],
    )
    monkeypatch.setattr(
        analyzer,
        "build_progress_snapshot",
        lambda previous_extras, continue_mode: SimpleNamespace(
            to_dict=lambda: {
                "start_time": 1.0,
                "time": 0.0,
                "total_line": 2,
                "line": 0,
                "processed_line": 0,
                "error_line": 0,
                "total_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "added_glossary": 0,
            },
            total_line=2,
        ),
    )
    monkeypatch.setattr(
        analyzer,
        "execute_task_contexts",
        lambda task_contexts, max_workers: (
            setattr(fake_data_manager, "analysis_candidate_count", 1) or "SUCCESS"
        ),
    )
    emitted = capture_emitted_events(monkeypatch, analyzer)

    analyzer.start({"mode": Base.AnalysisMode.NEW, "config": config})

    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted
