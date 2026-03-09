from importlib import import_module
from types import SimpleNamespace

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.Analyzer import Analyzer
from module.Engine.Engine import Engine

analyzer_module = import_module("module.Engine.Analyzer.Analyzer")


def build_context(task_fingerprint: str) -> AnalysisTaskContext:
    return AnalysisTaskContext(
        task_fingerprint=task_fingerprint,
        file_path="story.txt",
        items=tuple(),
    )


def test_analysis_require_stop_marks_engine_as_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analyzer = Analyzer()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

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

    class ImmediateThread:
        def __init__(self, target, args=(), daemon=None) -> None:
            self.target = target
            self.args = args
            self.daemon = daemon

        def start(self) -> None:
            self.target(*self.args)

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
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    class ImmediateThread:
        def __init__(self, target, args=(), daemon=None) -> None:
            self.target = target
            self.args = args
            self.daemon = daemon

        def start(self) -> None:
            self.target(*self.args)

    monkeypatch.setattr(analyzer_module.threading, "Thread", ImmediateThread)

    analyzer = Analyzer()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    analyzer.analysis_import_glossary()

    assert emitted[0] == (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.RUN},
    )
    assert (
        Base.Event.TOAST,
        {
            "type": Base.ToastType.SUCCESS,
            "message": "已导入候选术语 1 条",
        },
    ) in emitted
    assert (
        Base.Event.PROJECT_CHECK,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted
    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.DONE, "imported_count": 1},
    ) in emitted
    assert fake_data_manager.import_expected_paths == [fake_data_manager.lg_path]


def test_analysis_import_glossary_skips_stale_project_after_switch(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    fake_data_manager.analysis_candidate_count = 1
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
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

    analyzer = Analyzer()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    analyzer.analysis_import_glossary()

    assert emitted == [
        (
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            {"sub_event": Base.SubEvent.RUN},
        )
    ]
    assert fake_data_manager.import_count == 0
    assert fake_data_manager.import_expected_paths == ["/workspace/demo/project.lg"]


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
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    analyzer.start({"mode": Base.AnalysisMode.NEW, "config": config})

    assert (
        Base.Event.ANALYSIS_IMPORT_GLOSSARY,
        {"sub_event": Base.SubEvent.REQUEST},
    ) in emitted
