from importlib import import_module
from types import SimpleNamespace
import time

import pytest

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.Engine.Analyzer.AnalysisModels import AnalysisChunkResult
from module.Engine.Analyzer.AnalysisModels import AnalysisFilePlan
from module.Engine.Analyzer.AnalysisPipeline import AnalysisPipeline
from module.Engine.Analyzer.Analyzer import Analyzer

analysis_pipeline_module = import_module("module.Engine.Analyzer.AnalysisPipeline")


def make_line_plan(file_path: str, chunk_sizes: list[int]) -> AnalysisFilePlan:
    chunks: list[tuple[Item, ...]] = []
    for chunk_index, chunk_size in enumerate(chunk_sizes):
        chunk = tuple(
            Item(src=f"{file_path}-{chunk_index}-{item_index}")
            for item_index in range(chunk_size)
        )
        chunks.append(chunk)
    return AnalysisFilePlan(file_path=file_path, chunks=tuple(chunks))


def test_build_extras_from_state_counts_chunk_statistics_and_reuses_progress() -> None:
    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)

    extras = pipeline.build_extras_from_state(
        file_plans=[
            make_line_plan("done.txt", [2, 1]),
            make_line_plan("failed.txt", [3]),
            make_line_plan("todo.txt", [1, 2]),
        ],
        state={
            "done.txt": Base.ProjectStatus.PROCESSED,
            "failed.txt": Base.ProjectStatus.ERROR,
        },
        previous_extras={
            "time": 12.0,
            "total_tokens": 13,
            "total_input_tokens": 5,
            "total_output_tokens": 8,
            "added_glossary": 2,
        },
        continue_mode=True,
    )

    assert extras["total_line"] == 9
    assert extras["line"] == 6
    assert extras["processed_line"] == 3
    assert extras["error_line"] == 3
    assert extras["time"] == 12.0
    assert extras["total_tokens"] == 13
    assert extras["total_input_tokens"] == 5
    assert extras["total_output_tokens"] == 8
    assert extras["added_glossary"] == 2
    assert float(extras["start_time"]) <= time.time()


def test_merge_glossary_entries_updates_snapshot_and_db(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.quality_snapshot = SimpleNamespace(
        merge_glossary_entries=lambda incoming: incoming
    )

    count = pipeline.merge_glossary_entries(
        [{"src": "HP", "dst": "生命值", "info": "stat", "case_sensitive": False}]
    )

    assert count == 1
    assert len(fake_data_manager.updated_rules) == 1
    stored_rules = next(iter(fake_data_manager.updated_rules[0].values()))
    assert stored_rules == [
        {
            "src": "HP",
            "dst": "生命值",
            "info": "stat",
            "case_sensitive": False,
        }
    ]


def test_run_file_plan_marks_full_file_as_error_when_any_chunk_fails(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.extras = {
        "start_time": time.time(),
        "processed_line": 0,
        "error_line": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_tokens": 0,
        "added_glossary": 0,
    }
    analyzer.task_limiter = None

    results = iter(
        [
            AnalysisChunkResult(
                success=True,
                stopped=False,
                input_tokens=3,
                output_tokens=7,
                glossary_entries=(
                    {
                        "src": "魔导具",
                        "dst": "魔导器",
                        "info": "特殊物品",
                        "case_sensitive": False,
                    },
                ),
            ),
            AnalysisChunkResult(
                success=False, stopped=False, input_tokens=1, output_tokens=0
            ),
        ]
    )
    monkeypatch.setattr(analyzer, "run_chunk", lambda items: next(results))
    monkeypatch.setattr(
        analyzer, "merge_glossary_entries", lambda entries: len(entries)
    )

    status = pipeline.run_file_plan(make_line_plan("story.txt", [2, 3]), max_workers=1)

    assert status == Base.ProjectStatus.ERROR
    assert analyzer.extras["processed_line"] == 0
    assert analyzer.extras["error_line"] == 5
    assert analyzer.extras["added_glossary"] == 1
    assert analyzer.extras["total_input_tokens"] == 4
    assert analyzer.extras["total_output_tokens"] == 7


def test_run_file_plan_rolls_back_partial_progress_when_stopped(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.extras = {
        "start_time": time.time(),
        "processed_line": 0,
        "error_line": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_tokens": 0,
        "added_glossary": 0,
    }
    analyzer.task_limiter = None

    def fake_run_chunk(items) -> AnalysisChunkResult:
        del items
        if analyzer.extras["processed_line"] == 0:
            return AnalysisChunkResult(
                success=True, stopped=False, input_tokens=2, output_tokens=3
            )
        analyzer.stop_requested = True
        return AnalysisChunkResult(
            success=False, stopped=True, input_tokens=0, output_tokens=0
        )

    monkeypatch.setattr(analyzer, "run_chunk", fake_run_chunk)
    monkeypatch.setattr(analyzer, "merge_glossary_entries", lambda entries: 0)

    status = pipeline.run_file_plan(make_line_plan("scene.txt", [2, 3]), max_workers=1)

    assert status is None
    assert analyzer.extras["processed_line"] == 0
    assert analyzer.extras["error_line"] == 0
    assert analyzer.extras["total_input_tokens"] == 2
    assert analyzer.extras["total_output_tokens"] == 3


def test_log_analysis_start_outputs_model_and_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages: list[str] = []

    class FakeLogger:
        def print(self, msg: str, *args, **kwargs) -> None:
            del args, kwargs
            messages.append(msg)

        def info(self, msg: str, *args, **kwargs) -> None:
            del args, kwargs
            messages.append(msg)

    monkeypatch.setattr(
        analysis_pipeline_module.LogManager,
        "get",
        lambda: FakeLogger(),
    )
    monkeypatch.setattr(
        analysis_pipeline_module.PromptBuilder,
        "build_glossary_analysis_main",
        lambda self: "ANALYSIS_PROMPT",
    )

    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.model = {
        "name": "demo-model",
        "api_url": "https://example.test/v1",
        "model_id": "demo-id",
        "api_format": Base.APIFormat.OPENAI,
    }
    analyzer.quality_snapshot = SimpleNamespace()

    pipeline.log_analysis_start()

    assert any("demo-model" in message for message in messages)
    assert any("https://example.test/v1" in message for message in messages)
    assert any("demo-id" in message for message in messages)
    assert "ANALYSIS_PROMPT" in messages


def test_print_chunk_log_writes_source_and_extracted_terms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_logs: list[str] = []
    console_objects: list[object] = []

    class FakeLogger:
        def __init__(self) -> None:
            self.expert_mode = False

        def info(self, msg: str, *args, **kwargs) -> None:
            del args, kwargs
            file_logs.append(msg)

        def is_expert_mode(self) -> bool:
            return self.expert_mode

    logger = FakeLogger()
    monkeypatch.setattr(
        analysis_pipeline_module.LogManager,
        "get",
        lambda: logger,
    )
    monkeypatch.setattr(
        analysis_pipeline_module.rich,
        "get_console",
        lambda: SimpleNamespace(print=lambda obj: console_objects.append(obj)),
    )

    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    pipeline.print_chunk_log(
        start=time.time() - 1.0,
        pt=12,
        ct=34,
        srcs=["圣女艾琳在教堂祈祷。"],
        glossary_entries=[
            {"src": "圣女艾琳", "dst": "Saint Eileen", "info": "女性人名"}
        ],
        response_think="",
        response_result='{"src":"圣女艾琳","dst":"Saint Eileen","type":"女性人名"}',
        status_text="",
        log_func=logger.info,
        style="green",
    )

    combined = "\n".join(file_logs)
    assert Localizer.get().analysis_task_source_texts in combined
    assert Localizer.get().analysis_task_extracted_terms in combined
    assert "圣女艾琳 -> Saint Eileen #女性人名" in combined
    assert console_objects != []
