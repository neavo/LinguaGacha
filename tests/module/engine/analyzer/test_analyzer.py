from importlib import import_module
from types import SimpleNamespace

import pytest

from base.Base import Base
from module.Config import Config
from module.Engine.Analyzer.Analyzer import Analyzer
from module.Engine.Engine import Engine

analyzer_module = import_module("module.Engine.Analyzer.Analyzer")


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


def test_start_continue_skips_processed_and_error_files(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    plan_factory,
) -> None:
    fake_data_manager.analysis_state = {
        "done.txt": Base.ProjectStatus.PROCESSED,
        "failed.txt": Base.ProjectStatus.ERROR,
    }
    fake_data_manager.analysis_extras = {
        "time": 12.0,
        "total_input_tokens": 5,
        "total_output_tokens": 8,
        "total_tokens": 13,
        "added_glossary": 2,
    }
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(
        analyzer_module.QualityRuleSnapshot,
        "capture",
        lambda: SimpleNamespace(
            translation_prompt_enable=False,
            translation_prompt="",
            analysis_prompt_enable=False,
            analysis_prompt="",
        ),
    )

    analyzer = Analyzer()
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}

    plans = [
        plan_factory("done.txt", 1),
        plan_factory("failed.txt", 2),
        plan_factory("todo.txt", 3),
    ]
    monkeypatch.setattr(analyzer, "build_analysis_file_plans", lambda config: plans)

    called: list[str] = []

    def fake_run_file_plan(plan, *, max_workers: int) -> Base.ProjectStatus:
        del max_workers
        called.append(plan.file_path)
        analyzer.extras["processed_line"] = (
            analyzer.extras.get("processed_line", 0) + plan.chunk_count
        )
        return Base.ProjectStatus.PROCESSED

    monkeypatch.setattr(analyzer, "run_file_plan", fake_run_file_plan)

    analyzer.start({"mode": Base.AnalysisMode.CONTINUE, "config": config})

    assert called == ["todo.txt"]
    assert fake_data_manager.analysis_state["done.txt"] == Base.ProjectStatus.PROCESSED
    assert fake_data_manager.analysis_state["failed.txt"] == Base.ProjectStatus.ERROR
    assert fake_data_manager.analysis_state["todo.txt"] == Base.ProjectStatus.PROCESSED
    assert fake_data_manager.analysis_extras["total_line"] == 6


def test_analysis_reset_failed_rebuilds_progress_without_error_files(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
    plan_factory,
) -> None:
    fake_data_manager.analysis_state = {
        "done.txt": Base.ProjectStatus.PROCESSED,
        "failed.txt": Base.ProjectStatus.ERROR,
    }
    fake_data_manager.analysis_extras = {
        "time": 9.0,
        "total_input_tokens": 4,
        "total_output_tokens": 6,
        "total_tokens": 10,
        "added_glossary": 3,
    }
    monkeypatch.setattr(
        analyzer_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analyzer = Analyzer()
    config = Config()
    config.get_active_model = lambda: {"threshold": {"input_token_limit": 64}}
    monkeypatch.setattr(
        analyzer_module.Config,
        "load",
        lambda self: config,
    )
    monkeypatch.setattr(
        analyzer,
        "build_analysis_file_plans",
        lambda config: [plan_factory("done.txt", 2), plan_factory("failed.txt", 1)],
    )

    class ImmediateThread:
        def __init__(self, target, args=(), daemon=None) -> None:
            self.target = target
            self.args = args
            self.daemon = daemon

        def start(self) -> None:
            self.target(*self.args)

    monkeypatch.setattr(
        analyzer_module.threading,
        "Thread",
        ImmediateThread,
    )

    analyzer.analysis_reset(
        Base.Event.ANALYSIS_RESET_FAILED,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert fake_data_manager.analysis_state == {
        "done.txt": Base.ProjectStatus.PROCESSED
    }
    assert fake_data_manager.analysis_extras["processed_line"] == 2
    assert fake_data_manager.analysis_extras["error_line"] == 0
    assert fake_data_manager.analysis_extras["total_line"] == 3
