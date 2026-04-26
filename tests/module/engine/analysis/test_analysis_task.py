from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from module.Localizer.Localizer import Localizer
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisTask import AnalysisTask

from tests.module.engine.analysis.support import analysis_task_module
from tests.module.engine.analysis.support import build_request_task
from tests.module.engine.analysis.support import capture_chunk_log
from tests.module.engine.analysis.support import stub_glossary_request


class FakePipelineLogger:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.print_messages: list[str] = []

    def info(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.info_messages.append(msg)

    def warning(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.warning_messages.append(msg)

    def print(self, msg: str, *args, **kwargs) -> None:
        del args, kwargs
        self.print_messages.append(msg)


def build_analysis_task(
    context: AnalysisTaskContext | None = None,
) -> AnalysisTask:
    analysis = Analysis()
    analysis.model = {"name": "demo-model"}
    analysis.quality_snapshot = SimpleNamespace()
    return AnalysisTask(analysis, context or build_request_context())


def build_request_context() -> AnalysisTaskContext:
    return AnalysisTaskContext(
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                src_text="demo",
            ),
        ),
    )


def install_print_chunk_log_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    running_task_count: int = 0,
) -> tuple[FakePipelineLogger, list[str]]:
    del running_task_count
    logger = FakePipelineLogger()
    monkeypatch.setattr(
        analysis_task_module.LogManager,
        "get",
        lambda: logger,
    )
    return logger, logger.print_messages


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
    assert "TERM: 圣女艾琳 -> Saint Eileen #女性人名" in combined
    assert console_objects == []


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

    combined = "\n".join(logger.info_messages)
    assert Localizer.get().analysis_task_extracted_terms in combined
    assert "TERM: 圣女艾琳 -> Saint Eileen #女性人名" in combined
    assert console_outputs == []


def test_analysis_task_print_chunk_log_always_includes_result_log_in_console_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = build_request_task()
    captured: dict[str, list[str]] = {}

    def capture_rows(
        srcs: list[str],
        glossary_entries: list[dict[str, object]],
        extra: list[str],
        *,
        console: bool,
    ) -> list[str]:
        del srcs, glossary_entries
        captured["console" if console else "file"] = list(extra)
        return ["ROW"]

    monkeypatch.setattr(
        analysis_task_module.LogManager,
        "get",
        lambda: FakePipelineLogger(),
    )
    monkeypatch.setattr(
        task,
        "generate_log_rows",
        capture_rows,
    )

    task.print_chunk_log(
        start=time.time() - 1.0,
        pt=12,
        ct=34,
        srcs=["圣女艾琳在教堂祈祷。"],
        glossary_entries=[],
        response_think="",
        response_result='{"terms":[]}',
        status_text="",
        log_func=lambda *args, **kwargs: None,
        style="green",
    )

    assert any(
        Localizer.get().engine_task_response_result in row for row in captured["file"]
    )
    assert "console" not in captured


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
