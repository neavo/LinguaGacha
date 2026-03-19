from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Analysis.AnalysisScheduler import AnalysisScheduler
from module.Engine.Analysis.AnalysisTask import AnalysisTask

from tests.module.engine.analysis.support import analysis_progress_module
from tests.module.engine.analysis.support import analysis_scheduler_module
from tests.module.engine.analysis.support import analysis_task_module
from tests.module.engine.analysis.support import build_request_task
from tests.module.engine.analysis.support import capture_chunk_log
from tests.module.engine.analysis.support import stub_glossary_request


def build_analysis_runtime_extras(**overrides: object) -> dict[str, object]:
    extras: dict[str, object] = {
        "start_time": 100.0,
        "total_line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }
    extras.update(overrides)
    return extras


def build_item(item_id: int, src: str, file_path: str = "story.txt") -> Item:
    return Item(id=item_id, src=src, file_path=file_path)


def build_context(
    *,
    item_ids: tuple[int, ...] = (1,),
    file_path: str = "story.txt",
    retry_count: int = 0,
) -> AnalysisTaskContext:
    items = tuple(
        AnalysisItemContext(
            item_id=item_id,
            file_path=file_path,
            src_text=f"src-{item_id}",
        )
        for item_id in item_ids
    )
    return AnalysisTaskContext(
        file_path=file_path,
        items=items,
        retry_count=retry_count,
    )


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


class FakeConsoleProgress:
    def __init__(self) -> None:
        self.updates: list[dict[str, int]] = []

    def update(self, task_id: int, **kwargs: int) -> None:
        self.updates.append({"task_id": task_id, **kwargs})


def build_analysis_task(
    context: AnalysisTaskContext | None = None,
) -> AnalysisTask:
    analysis = Analysis()
    analysis.model = {"name": "demo-model"}
    analysis.quality_snapshot = SimpleNamespace()
    return AnalysisTask(analysis, context or build_context())


def install_print_chunk_log_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    running_task_count: int = 0,
) -> tuple[FakePipelineLogger, list[object]]:
    logger = FakePipelineLogger()
    console_outputs: list[object] = []
    monkeypatch.setattr(
        analysis_task_module.LogManager,
        "get",
        lambda: logger,
    )
    monkeypatch.setattr(
        analysis_task_module.rich,
        "get_console",
        lambda: SimpleNamespace(print=lambda obj: console_outputs.append(obj)),
    )
    monkeypatch.setattr(
        analysis_task_module.Engine,
        "get",
        lambda: SimpleNamespace(get_running_task_count=lambda: running_task_count),
    )
    return logger, console_outputs


def test_analysis_scheduler_build_progress_snapshot_counts_current_status_and_reuses_progress(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    fake_data_manager.items = [
        build_item(1, "A"),
        build_item(2, "B"),
        build_item(3, "C"),
    ]
    fake_data_manager.analysis_item_checkpoints = {
        1: {"status": Base.ProjectStatus.PROCESSED},
        2: {"status": Base.ProjectStatus.ERROR},
    }

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    snapshot = analysis.scheduler.build_progress_snapshot(
        previous_extras={
            "time": 12.0,
            "total_tokens": 13,
            "total_input_tokens": 5,
            "total_output_tokens": 8,
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
    assert float(snapshot.start_time) <= time.time()


def test_analysis_scheduler_build_task_contexts_continue_only_schedules_none_items(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    done_item = build_item(1, "done")
    error_item = build_item(3, "error", file_path="scene.txt")
    pending_item = build_item(4, "pending", file_path="scene.txt")
    fake_data_manager.items = [done_item, error_item, pending_item]
    fake_data_manager.analysis_item_checkpoints = {
        1: {"status": Base.ProjectStatus.PROCESSED},
        3: {"status": Base.ProjectStatus.ERROR},
    }

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [context.file_path for context in contexts] == ["scene.txt"]
    assert [item.item_id for item in contexts[0].items] == [4]


def test_analysis_scheduler_build_task_contexts_splits_when_file_changes(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    fake_data_manager.items = [
        build_item(1, "a1", file_path="a.txt"),
        build_item(2, "a2", file_path="a.txt"),
        build_item(3, "b1", file_path="b.txt"),
    ]

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [context.file_path for context in contexts] == ["a.txt", "b.txt"]
    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1, 2],
        [3],
    ]


def test_analysis_scheduler_build_task_contexts_uses_shared_line_limit(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.model = {"threshold": {"input_token_limit": 16}}
    fake_data_manager.items = [
        build_item(1, "\n".join([f"line-{i}" for i in range(8)])),
        build_item(2, "line-9"),
    ]

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1],
        [2],
    ]


def test_execute_task_contexts_commits_success_immediately_and_marks_failures(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(start_time=time.time())
    analysis.task_limiter = None
    success_context = build_context(item_ids=(1, 2))
    fail_context = build_context(item_ids=(3,))
    results = {
        (1, 2, 0): AnalysisTaskResult(
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
        (3, 0): AnalysisTaskResult(
            context=fail_context,
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        ),
        (3, 1): AnalysisTaskResult(
            context=AnalysisTaskContext(
                file_path="story.txt",
                items=fail_context.items,
                retry_count=1,
            ),
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        ),
        (3, 2): AnalysisTaskResult(
            context=AnalysisTaskContext(
                file_path="story.txt",
                items=fail_context.items,
                retry_count=2,
            ),
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        ),
    }

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    analysis.scheduler.create_task = lambda context: SimpleNamespace(
        start=lambda: results[
            tuple([item.item_id for item in context.items] + [context.retry_count])
        ]
    )

    status = analysis.execute_task_contexts(
        [success_context, fail_context], max_workers=1
    )

    assert status == "FAILED"
    assert fake_data_manager.analysis_candidate_count == 1
    assert analysis.extras["processed_line"] == 2
    assert analysis.extras["error_line"] == 1
    assert (
        fake_data_manager.analysis_item_checkpoints[1]["status"]
        == Base.ProjectStatus.PROCESSED
    )
    assert (
        fake_data_manager.analysis_item_checkpoints[3]["status"]
        == Base.ProjectStatus.ERROR
    )


def test_execute_task_contexts_retries_same_context_until_limit_then_marks_error(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(start_time=time.time())
    analysis.task_limiter = None
    context = build_context(item_ids=(1, 2))
    seen_retry_counts: list[int] = []

    def build_result(task_context: AnalysisTaskContext) -> AnalysisTaskResult:
        seen_retry_counts.append(task_context.retry_count)
        return AnalysisTaskResult(
            context=task_context,
            success=False,
            stopped=False,
            input_tokens=1,
            output_tokens=0,
        )

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    analysis.scheduler.create_task = lambda context: SimpleNamespace(
        start=lambda: build_result(context)
    )

    status = analysis.execute_task_contexts([context], max_workers=1)

    assert status == "FAILED"
    assert seen_retry_counts == [0, 1, 2]
    assert analysis.extras["error_line"] == 2
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
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(start_time=time.time())
    analysis.task_limiter = None
    context = build_context(item_ids=(5,))
    seen_retry_counts: list[int] = []

    def build_result(task_context: AnalysisTaskContext) -> AnalysisTaskResult:
        seen_retry_counts.append(task_context.retry_count)
        if task_context.retry_count < AnalysisScheduler.RETRY_LIMIT:
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

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    analysis.scheduler.create_task = lambda context: SimpleNamespace(
        start=lambda: build_result(context)
    )

    status = analysis.execute_task_contexts([context], max_workers=1)

    assert status == "SUCCESS"
    assert seen_retry_counts == [0, 1, 2]
    assert analysis.extras["processed_line"] == 1
    assert analysis.extras["error_line"] == 0
    assert (
        fake_data_manager.analysis_item_checkpoints[5]["status"]
        == Base.ProjectStatus.PROCESSED
    )


def test_analysis_task_execute_request_uses_shared_response_decoder_glossary_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = AnalysisTaskContext(
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                src_text="Alice, Bob",
            ),
        ),
    )
    task = build_analysis_task(context)
    stub_glossary_request(
        monkeypatch,
        response_result='{"src":"Alice, Bob","dst":"爱丽丝, 鲍勃","type":"女性人名"}',
        input_tokens=3,
        output_tokens=4,
    )

    result = task.start()

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


def test_analysis_task_returns_failure_when_response_shape_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = build_request_task()
    stub_glossary_request(monkeypatch, response_result='{"bad":[]}')

    result = task.start()

    assert result.success is False
    assert result.stopped is False


def test_analysis_task_returns_failure_when_glossary_is_filtered_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = build_request_task()
    captured = capture_chunk_log(monkeypatch, task)
    stub_glossary_request(
        monkeypatch,
        response_result='{"src":"Alice","dst":1,"type":"女性人名"}',
    )

    result = task.start()

    assert result.success is False
    assert result.stopped is False
    assert captured["status_text"] == Localizer.get().response_checker_fail_data
    assert captured["glossary_entries"] == []


def test_analysis_task_treats_empty_jsonline_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = build_request_task()
    captured = capture_chunk_log(monkeypatch, task)
    stub_glossary_request(
        monkeypatch,
        response_result="<why>当前文本没有稳定术语</why>\n```jsonline\n\n```",
        output_tokens=2,
    )

    result = task.start()

    assert result.success is True
    assert result.stopped is False
    assert result.glossary_entries == tuple()
    assert captured["status_text"] == ""
    assert captured["glossary_entries"] == []


def test_analysis_task_returns_failure_when_empty_result_has_no_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = build_request_task()
    captured = capture_chunk_log(monkeypatch, task)
    stub_glossary_request(
        monkeypatch,
        response_result="```jsonline\n```",
        output_tokens=2,
    )

    result = task.start()

    assert result.success is False
    assert result.stopped is False
    assert captured["status_text"] == Localizer.get().response_checker_fail_data
    assert captured["glossary_entries"] == []


def test_analysis_task_print_chunk_log_writes_source_and_extracted_terms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger, console_objects = install_print_chunk_log_runtime(monkeypatch)
    task = build_request_task()
    task.print_chunk_log(
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
    assert console_objects != []


def test_analysis_task_print_chunk_log_summary_mode_omits_candidate_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger, console_outputs = install_print_chunk_log_runtime(
        monkeypatch,
        running_task_count=33,
    )
    task = build_request_task()
    task.print_chunk_log(
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
    assert Localizer.get().engine_task_simple_log_prefix in combined
    assert "候选术语" not in combined


@pytest.mark.parametrize(
    ("final_status", "expected_info", "expected_warning"),
    [
        ("SUCCESS", "engine_task_done", None),
        ("STOPPED", "engine_task_stop", None),
        ("FAILED", None, "engine_task_fail"),
    ],
)
def test_analysis_task_log_run_finish_keeps_existing_terminal_message(
    monkeypatch: pytest.MonkeyPatch,
    final_status: str,
    expected_info: str | None,
    expected_warning: str | None,
) -> None:
    logger = FakePipelineLogger()
    monkeypatch.setattr(
        analysis_task_module.LogManager,
        "get",
        lambda: logger,
    )

    AnalysisTask.log_run_finish(final_status)

    if expected_info is None:
        assert logger.info_messages == []
    else:
        assert logger.info_messages == [getattr(Localizer.get(), expected_info)]

    if expected_warning is None:
        assert logger.warning_messages == []
    else:
        assert logger.warning_messages == [getattr(Localizer.get(), expected_warning)]

    assert logger.print_messages == ["", ""]


def test_analysis_progress_tracker_runtime_uses_memory_snapshot_only(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=3,
        error_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    fake_data_manager.get_analysis_status_summary = lambda: (_ for _ in ()).throw(
        AssertionError("运行态不该全量重算")
    )
    fake_data_manager.update_analysis_progress_snapshot = lambda snapshot: (
        _ for _ in ()
    ).throw(AssertionError("运行态不该单独写库"))

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=False)

    assert snapshot["time"] == pytest.approx(12.0)
    assert snapshot["line"] == 4
    assert snapshot["processed_line"] == 3
    assert snapshot["error_line"] == 1
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_updates_bound_console_progress(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=3,
        error_line=1,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    progress = FakeConsoleProgress()

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    analysis.progress_tracker.bind_console_progress(progress, 7)
    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=False)

    assert progress.updates == [{"task_id": 7, "completed": 4, "total": 9}]
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_save_state_reconciles_before_persist(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
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
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=True)

    assert status_calls == [True]
    assert persisted_snapshots[0]["processed_line"] == 2
    assert persisted_snapshots[0]["error_line"] == 1
    assert persisted_snapshots[0]["line"] == 3
    assert snapshot["total_line"] == 6
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_task_injects_fake_name_only_for_model_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = AnalysisTaskContext(
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                src_text=r"村长\n[7]来了",
            ),
        ),
    )
    task = build_analysis_task(context)
    captured_request_srcs: dict[str, list[str]] = {}
    captured_chunk_log = capture_chunk_log(monkeypatch, task)

    stub_glossary_request(
        monkeypatch,
        response_result="<why>当前文本没有稳定术语</why>\n```jsonline\n\n```",
        on_generate=lambda srcs: captured_request_srcs.update({"srcs": srcs}),
    )

    result = task.start()

    assert result.success is True
    assert captured_request_srcs["srcs"] == ["村长蓝霁云来了"]
    assert captured_chunk_log["srcs"] == [r"村长\n[7]来了"]
    assert captured_chunk_log["glossary_entries"] == []


def test_analysis_task_build_prompt_source_texts_uses_translation_name_prefix() -> None:
    task = build_request_task()
    items = (
        AnalysisItemContext(
            item_id=1,
            file_path="story.txt",
            src_text=r"正文\n[7]",
            first_name_src="角色名",
        ),
    )

    assert task.build_prompt_source_texts(items) == [r"【角色名】正文\n[7]"]


def test_analysis_task_build_prompt_source_texts_skips_empty_source_even_when_name_exists() -> (
    None
):
    task = build_request_task()
    items = (
        AnalysisItemContext(
            item_id=1,
            file_path="story.txt",
            src_text="",
            first_name_src="角色名",
        ),
    )

    assert task.build_prompt_source_texts(items) == []
