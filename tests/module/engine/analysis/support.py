from __future__ import annotations

from collections.abc import Callable
from importlib import import_module
from types import SimpleNamespace

import pytest

from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Analysis.AnalysisTask import AnalysisTask

analysis_task_module = import_module("module.Engine.Analysis.AnalysisTask")
analysis_progress_module = import_module(
    "module.Engine.Analysis.AnalysisProgressTracker"
)
analysis_scheduler_module = import_module("module.Engine.Analysis.AnalysisScheduler")


def build_request_task() -> AnalysisTask:
    """统一构造最小分析任务，避免每个测试自己重复搭环境。"""
    analysis = Analysis()
    analysis.model = {"name": "demo-model"}
    analysis.quality_snapshot = SimpleNamespace()
    from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
    from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext

    context_obj = AnalysisTaskContext(
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                src_text="demo",
            ),
        ),
    )
    return AnalysisTask(analysis, context_obj)


def stub_glossary_prompt(
    monkeypatch: pytest.MonkeyPatch,
    *,
    on_generate: Callable[[list[str]], None] | None = None,
) -> None:
    """统一替换提示词构造器，必要时把请求文本回传给测试断言。"""

    def fake_generate_glossary_prompt(
        self,
        srcs: list[str],
    ) -> tuple[list[dict[str, str]], list[str]]:
        del self
        if on_generate is not None:
            on_generate(list(srcs))
        return [{"role": "user", "content": "\n".join(srcs)}], []

    monkeypatch.setattr(
        analysis_task_module.PromptBuilder,
        "generate_glossary_prompt",
        fake_generate_glossary_prompt,
    )


def stub_glossary_request(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response_result: str,
    response_think: str = "",
    input_tokens: int = 1,
    output_tokens: int = 1,
    exception: Exception | None = None,
    on_generate: Callable[[list[str]], None] | None = None,
) -> None:
    """统一替换请求器，保证测试只关心响应内容而不是样板代码。"""
    stub_glossary_prompt(monkeypatch, on_generate=on_generate)
    monkeypatch.setattr(
        analysis_task_module.TaskRequester,
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
    monkeypatch: pytest.MonkeyPatch,
    task: AnalysisTask,
) -> dict[str, object]:
    """把 chunk 日志收进字典，方便断言而不污染测试主体。"""
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        task,
        "print_chunk_log",
        lambda **kwargs: captured.update(kwargs),
    )
    return captured
