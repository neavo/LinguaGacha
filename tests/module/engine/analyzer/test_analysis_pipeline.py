from importlib import import_module
from types import SimpleNamespace
import time

import pytest

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.Engine.Analyzer.AnalysisModels import AnalysisItemContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskResult
from module.Engine.Analyzer.AnalysisPipeline import AnalysisPipeline
from module.Engine.Analyzer.Analyzer import Analyzer

analysis_pipeline_module = import_module("module.Engine.Analyzer.AnalysisPipeline")


def build_analysis_runtime_extras(**overrides: object) -> dict[str, object]:
    extras: dict[str, object] = {
        "start_time": 100.0,
        "total_line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "added_glossary": 0,
    }
    extras.update(overrides)
    return extras


def build_item(item_id: int, src: str, file_path: str = "story.txt") -> Item:
    return Item(id=item_id, src=src, file_path=file_path)


def build_context(
    fingerprint: str,
    *,
    item_ids: tuple[int, ...] = (1,),
    file_path: str = "story.txt",
    retry_count: int = 0,
) -> AnalysisTaskContext:
    items = tuple(
        AnalysisItemContext(
            item_id=item_id,
            file_path=file_path,
            source_text=f"src-{item_id}",
            source_hash=f"hash-{item_id}",
        )
        for item_id in item_ids
    )
    return AnalysisTaskContext(
        task_fingerprint=fingerprint,
        file_path=file_path,
        items=items,
        retry_count=retry_count,
    )


def build_request_pipeline() -> AnalysisPipeline:
    analyzer = Analyzer()
    analyzer.model = {"name": "demo-model"}
    analyzer.quality_snapshot = SimpleNamespace()
    return AnalysisPipeline(analyzer)


def stub_glossary_request(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response_result: str,
    response_think: str = "",
    input_tokens: int = 1,
    output_tokens: int = 1,
    exception: Exception | None = None,
) -> None:
    monkeypatch.setattr(
        analysis_pipeline_module.PromptBuilder,
        "generate_glossary_prompt",
        lambda self, srcs: ([{"role": "user", "content": "\n".join(srcs)}], []),
    )
    monkeypatch.setattr(
        analysis_pipeline_module.TaskRequester,
        "request",
        lambda self, messages, stop_checker: (
            exception,
            response_think,
            response_result,
            input_tokens,
            output_tokens,
        ),
    )


def capture_chunk_log(
    monkeypatch: pytest.MonkeyPatch, pipeline: AnalysisPipeline
) -> dict[str, object]:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        pipeline,
        "print_chunk_log",
        lambda **kwargs: captured.update(kwargs),
    )
    return captured


class FakePipelineLogger:
    def __init__(self, *, expert_mode: bool = False) -> None:
        self.expert_mode = expert_mode
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.print_messages: list[str] = []

    def is_expert_mode(self) -> bool:
        return self.expert_mode

    def info(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.info_messages.append(msg)

    def warning(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.warning_messages.append(msg)

    def print(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.print_messages.append(msg)


def build_analysis_pipeline() -> AnalysisPipeline:
    analyzer = Analyzer()
    return AnalysisPipeline(analyzer)


def install_print_chunk_log_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    running_task_count: int = 0,
) -> tuple[FakePipelineLogger, list[object]]:
    logger = FakePipelineLogger()
    console_outputs: list[object] = []
    monkeypatch.setattr(
        analysis_pipeline_module.LogManager,
        "get",
        lambda: logger,
    )
    monkeypatch.setattr(
        analysis_pipeline_module.rich,
        "get_console",
        lambda: SimpleNamespace(print=lambda obj: console_outputs.append(obj)),
    )
    monkeypatch.setattr(
        analysis_pipeline_module.Engine,
        "get",
        lambda: SimpleNamespace(get_running_task_count=lambda: running_task_count),
    )
    return logger, console_outputs


def test_build_progress_snapshot_counts_current_hash_status_and_reuses_progress(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    fake_data_manager.items = [
        build_item(1, "A"),
        build_item(2, "B"),
        build_item(3, "C"),
    ]
    checkpoint_map = {}
    for item in fake_data_manager.items[:2]:
        source_text = pipeline.build_analysis_source_text(item)
        checkpoint_map[item.get_id()] = {
            "source_hash": pipeline.build_source_hash(source_text),
            "status": Base.ProjectStatus.PROCESSED
            if item.get_id() == 1
            else Base.ProjectStatus.ERROR,
        }
    fake_data_manager.analysis_item_checkpoints = checkpoint_map

    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    snapshot = pipeline.build_progress_snapshot(
        previous_extras={
            "time": 12.0,
            "total_tokens": 13,
            "total_input_tokens": 5,
            "total_output_tokens": 8,
            "added_glossary": 2,
        },
        continue_mode=True,
    )

    assert snapshot.total_line == 3
    assert snapshot.line == 2
    assert snapshot.processed_line == 1
    assert snapshot.error_line == 1
    assert snapshot.time == 12.0
    assert snapshot.total_tokens == 13
    assert snapshot.total_input_tokens == 5
    assert snapshot.total_output_tokens == 8
    assert snapshot.added_glossary == 2
    assert float(snapshot.start_time) <= time.time()


def test_build_analysis_task_contexts_skips_processed_same_hash_and_keeps_changed_text(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    done_item = build_item(1, "done")
    changed_item = build_item(2, "changed")
    error_item = build_item(3, "error", file_path="scene.txt")
    fake_data_manager.items = [done_item, changed_item, error_item]

    done_hash = pipeline.build_source_hash(
        pipeline.build_analysis_source_text(done_item)
    )
    fake_data_manager.analysis_item_checkpoints = {
        1: {"source_hash": done_hash, "status": Base.ProjectStatus.PROCESSED},
        2: {"source_hash": "old-hash", "status": Base.ProjectStatus.PROCESSED},
        3: {
            "source_hash": pipeline.build_source_hash(
                pipeline.build_analysis_source_text(error_item)
            ),
            "status": Base.ProjectStatus.ERROR,
        },
    }

    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = pipeline.build_analysis_task_contexts(analyzer.config)

    assert [context.file_path for context in contexts] == ["story.txt", "scene.txt"]
    assert [item.item_id for item in contexts[0].items] == [2]
    assert [item.item_id for item in contexts[1].items] == [3]


def test_execute_task_contexts_commits_success_immediately_and_marks_failures(
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
    analyzer.extras = build_analysis_runtime_extras(start_time=time.time())
    analyzer.task_limiter = None

    success_context = build_context("success", item_ids=(1, 2))
    fail_context = build_context("failed", item_ids=(3,))
    results = {
        "success": AnalysisTaskResult(
            context=success_context,
            success=True,
            stopped=False,
            input_tokens=2,
            output_tokens=3,
            glossary_entries=(
                {
                    "src": "艾琳",
                    "dst": "Eileen",
                    "info": "女性人名",
                    "case_sensitive": False,
                },
            ),
        ),
        "failed": AnalysisTaskResult(
            context=fail_context,
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        ),
    }

    monkeypatch.setattr(
        analyzer,
        "run_task_context",
        lambda context: results[context.task_fingerprint],
    )

    status = pipeline.execute_task_contexts(
        [success_context, fail_context],
        max_workers=1,
    )

    assert status == "FAILED"
    assert fake_data_manager.analysis_candidate_count == 1
    assert analyzer.extras["processed_line"] == 2
    assert analyzer.extras["error_line"] == 1
    assert analyzer.extras["added_glossary"] == 1
    assert (
        fake_data_manager.analysis_item_checkpoints[1]["status"]
        == Base.ProjectStatus.PROCESSED
    )
    assert (
        fake_data_manager.analysis_item_checkpoints[3]["status"]
        == Base.ProjectStatus.ERROR
    )


def test_execute_task_request_uses_shared_response_decoder_glossary_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = build_request_pipeline()

    context = AnalysisTaskContext(
        task_fingerprint="fp",
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                source_text="Alice, Bob",
                source_hash="h1",
            ),
        ),
    )

    stub_glossary_request(
        monkeypatch,
        response_result='{"src":"Alice, Bob","dst":"爱丽丝, 鲍勃","type":"女性人名"}',
        input_tokens=3,
        output_tokens=4,
    )

    result = pipeline.execute_task_request(context)

    assert result.success is True
    assert result.stopped is False
    assert result.input_tokens == 3
    assert result.output_tokens == 4
    assert list(result.glossary_entries) == [
        {
            "src": "Alice",
            "dst": "爱丽丝",
            "info": "女性人名",
            "case_sensitive": False,
        },
        {
            "src": "Bob",
            "dst": "鲍勃",
            "info": "女性人名",
            "case_sensitive": False,
        },
    ]


def test_execute_task_request_returns_failure_when_response_shape_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = build_request_pipeline()
    context = build_context("fp")

    stub_glossary_request(monkeypatch, response_result='{"bad":[]}')

    result = pipeline.execute_task_request(context)

    assert result.success is False
    assert result.stopped is False


def test_execute_task_request_returns_failure_when_glossary_is_filtered_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = build_request_pipeline()
    context = build_context("fp")
    captured = capture_chunk_log(monkeypatch, pipeline)

    stub_glossary_request(
        monkeypatch,
        response_result='{"src":"Alice","dst":1,"type":"女性人名"}',
    )

    result = pipeline.execute_task_request(context)

    assert result.success is False
    assert result.stopped is False
    assert captured["status_text"] == Localizer.get().response_checker_fail_data
    assert captured["glossary_entries"] == []


def test_execute_task_request_treats_empty_jsonline_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = build_request_pipeline()
    context = build_context("fp")
    captured = capture_chunk_log(monkeypatch, pipeline)

    stub_glossary_request(
        monkeypatch,
        response_result="<why>当前文本没有稳定术语</why>\n```jsonline\n\n```",
        output_tokens=2,
    )

    result = pipeline.execute_task_request(context)

    assert result.success is True
    assert result.stopped is False
    assert result.glossary_entries == tuple()
    assert captured["status_text"] == ""
    assert captured["glossary_entries"] == []


def test_execute_task_request_returns_failure_when_empty_result_has_no_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = build_request_pipeline()
    context = build_context("fp")
    captured = capture_chunk_log(monkeypatch, pipeline)

    stub_glossary_request(
        monkeypatch,
        response_result="```jsonline\n```",
        output_tokens=2,
    )

    result = pipeline.execute_task_request(context)

    assert result.success is False
    assert result.stopped is False
    assert captured["status_text"] == Localizer.get().response_checker_fail_data
    assert captured["glossary_entries"] == []


def test_execute_task_contexts_retries_same_context_until_limit_then_marks_error(
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
    analyzer.extras = build_analysis_runtime_extras(start_time=time.time())
    analyzer.task_limiter = None

    context = build_context("failed", item_ids=(1, 2))
    seen_retry_counts: list[int] = []

    def fake_run(task_context: AnalysisTaskContext) -> AnalysisTaskResult:
        seen_retry_counts.append(task_context.retry_count)
        return AnalysisTaskResult(
            context=task_context,
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        )

    monkeypatch.setattr(analyzer, "run_task_context", fake_run)

    status = pipeline.execute_task_contexts([context], max_workers=1)

    assert status == "FAILED"
    assert seen_retry_counts == [0, 1, 2]
    assert analyzer.extras["error_line"] == 2
    assert (
        fake_data_manager.analysis_item_checkpoints[1]["status"]
        == Base.ProjectStatus.ERROR
    )
    assert (
        fake_data_manager.analysis_item_checkpoints[2]["status"]
        == Base.ProjectStatus.ERROR
    )


def test_execute_task_contexts_stops_retrying_after_successful_retry(
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
    analyzer.extras = build_analysis_runtime_extras(start_time=time.time())
    analyzer.task_limiter = None

    context = build_context("retry-success", item_ids=(5,))
    seen_retry_counts: list[int] = []

    def fake_run(task_context: AnalysisTaskContext) -> AnalysisTaskResult:
        seen_retry_counts.append(task_context.retry_count)
        if task_context.retry_count < AnalysisPipeline.RETRY_LIMIT:
            return AnalysisTaskResult(
                context=task_context,
                success=False,
                stopped=False,
                input_tokens=1,
                output_tokens=0,
            )
        return AnalysisTaskResult(
            context=task_context,
            success=True,
            stopped=False,
            input_tokens=1,
            output_tokens=1,
            glossary_entries=tuple(),
        )

    monkeypatch.setattr(analyzer, "run_task_context", fake_run)

    status = pipeline.execute_task_contexts([context], max_workers=1)

    assert status == "SUCCESS"
    assert seen_retry_counts == [0, 1, 2]
    assert analyzer.extras["processed_line"] == 1
    assert analyzer.extras["error_line"] == 0
    assert (
        fake_data_manager.analysis_item_checkpoints[5]["status"]
        == Base.ProjectStatus.PROCESSED
    )


def test_print_chunk_log_writes_source_and_extracted_terms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger, console_objects = install_print_chunk_log_runtime(monkeypatch)
    pipeline = build_analysis_pipeline()
    pipeline.print_chunk_log(
        start=time.time() - 1.0,
        pt=12,
        ct=34,
        srcs=["圣女艾琳在教堂祈祷。"],
        glossary_entries=[
            {"src": "圣女艾琳", "dst": "Saint Eileen", "info": "女性人名"}
        ],
        response_think="",
        response_result='{"terms":[{"src":"圣女艾琳","dst":"Saint Eileen","info":"女性人名"}]}',
        status_text="",
        log_func=logger.info,
        style="green",
    )

    combined = "\n".join(logger.info_messages)
    assert Localizer.get().analysis_task_source_texts in combined
    assert Localizer.get().analysis_task_extracted_terms in combined
    assert "圣女艾琳 -> Saint Eileen #女性人名" in combined
    assert "候选术语" not in combined
    assert console_objects != []


def test_print_chunk_log_summary_mode_omits_candidate_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger, console_outputs = install_print_chunk_log_runtime(
        monkeypatch,
        running_task_count=33,
    )
    pipeline = build_analysis_pipeline()
    pipeline.print_chunk_log(
        start=time.time() - 1.0,
        pt=12,
        ct=34,
        srcs=["圣女艾琳在教堂祈祷。"],
        glossary_entries=[
            {"src": "圣女艾琳", "dst": "Saint Eileen", "info": "女性人名"}
        ],
        response_think="",
        response_result='{"terms":[{"src":"圣女艾琳","dst":"Saint Eileen","info":"女性人名"}]}',
        status_text="",
        log_func=logger.info,
        style="green",
    )

    combined = "\n".join(str(output) for output in console_outputs)
    assert Localizer.get().translator_simple_log_prefix in combined
    assert "候选术语" not in combined


def test_log_analysis_finish_success_logs_completion_and_added_terms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = FakePipelineLogger()
    monkeypatch.setattr(
        analysis_pipeline_module.LogManager,
        "get",
        lambda: logger,
    )

    pipeline = build_analysis_pipeline()
    pipeline.analyzer.extras = build_analysis_runtime_extras(
        line=3,
        time=12.0,
        total_input_tokens=5,
        total_output_tokens=8,
        added_glossary=2,
    )

    pipeline.log_analysis_finish("SUCCESS")

    assert logger.info_messages == [
        Localizer.get().engine_task_completed,
        Localizer.get().engine_task_done_with_terms.replace("{COUNT}", "2"),
    ]
    assert logger.warning_messages == []
    assert logger.print_messages == ["", ""]


@pytest.mark.parametrize(
    ("final_status", "expected_info", "expected_warning"),
    [
        ("STOPPED", "engine_task_stop", None),
        ("FAILED", None, "engine_task_fail"),
    ],
)
def test_log_analysis_finish_non_success_keeps_existing_terminal_message(
    monkeypatch: pytest.MonkeyPatch,
    final_status: str,
    expected_info: str | None,
    expected_warning: str | None,
) -> None:
    logger = FakePipelineLogger()
    monkeypatch.setattr(
        analysis_pipeline_module.LogManager,
        "get",
        lambda: logger,
    )

    pipeline = build_analysis_pipeline()
    pipeline.analyzer.extras = build_analysis_runtime_extras(
        line=3,
        time=12.0,
        total_input_tokens=5,
        total_output_tokens=8,
        added_glossary=2,
    )

    pipeline.log_analysis_finish(final_status)

    if expected_info is None:
        assert logger.info_messages == []
    else:
        assert logger.info_messages == [getattr(Localizer.get(), expected_info)]

    if expected_warning is None:
        assert logger.warning_messages == []
    else:
        assert logger.warning_messages == [getattr(Localizer.get(), expected_warning)]

    assert logger.print_messages == ["", ""]


def test_persist_progress_snapshot_runtime_uses_memory_snapshot_only(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=3,
        error_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
        added_glossary=2,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    fake_data_manager.get_analysis_status_summary = lambda: (_ for _ in ()).throw(
        AssertionError("运行态不该全量重算")
    )
    fake_data_manager.update_analysis_progress_snapshot = lambda snapshot: (
        _ for _ in ()
    ).throw(AssertionError("运行态不该单独写库"))

    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_pipeline_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = pipeline.persist_progress_snapshot(save_state=False)

    assert snapshot["time"] == pytest.approx(12.0)
    assert snapshot["line"] == 4
    assert snapshot["processed_line"] == 3
    assert snapshot["error_line"] == 1
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_persist_progress_snapshot_save_state_reconciles_before_persist(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analyzer = Analyzer()
    pipeline = AnalysisPipeline(analyzer)
    analyzer.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
        added_glossary=2,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    status_calls: list[bool] = []
    persisted_snapshots: list[dict[str, object]] = []

    def fake_status_summary() -> dict[str, object]:
        status_calls.append(True)
        return {
            "total_line": 6,
            "processed_line": 2,
            "error_line": 1,
            "line": 3,
        }

    def fake_persist(snapshot: dict[str, object]) -> dict[str, object]:
        persisted_snapshots.append(dict(snapshot))
        fake_data_manager.analysis_extras = dict(snapshot)
        return dict(snapshot)

    fake_data_manager.get_analysis_status_summary = fake_status_summary
    fake_data_manager.update_analysis_progress_snapshot = fake_persist

    monkeypatch.setattr(
        analysis_pipeline_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_pipeline_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analyzer,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = pipeline.persist_progress_snapshot(save_state=True)

    assert status_calls == [True]
    assert persisted_snapshots[0]["processed_line"] == 2
    assert persisted_snapshots[0]["error_line"] == 1
    assert persisted_snapshots[0]["line"] == 3
    assert snapshot["total_line"] == 6
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]
