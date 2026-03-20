from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Analysis.AnalysisTaskHooks import AnalysisCommitPayload
from module.Engine.Analysis.AnalysisTaskHooks import AnalysisTaskHooks


class FakeLimiter:
    def __init__(self, *, acquire_ok: bool = True, wait_ok: bool = True) -> None:
        self.acquire_ok = acquire_ok
        self.wait_ok = wait_ok
        self.acquire_calls = 0
        self.wait_calls = 0
        self.release_calls = 0

    def acquire(self, stop_checker) -> bool:
        del stop_checker
        self.acquire_calls += 1
        return self.acquire_ok

    def wait(self, stop_checker) -> bool:
        del stop_checker
        self.wait_calls += 1
        return self.wait_ok

    def release(self) -> None:
        self.release_calls += 1


class FakeErrorLogger:
    def __init__(self) -> None:
        self.errors: list[tuple[str, Exception | None]] = []

    def error(self, msg: str, e: Exception | None = None) -> None:
        self.errors.append((msg, e))


class FakeEngine:
    def __init__(self) -> None:
        self.statuses: list[Base.TaskStatus] = []

    def set_status(self, status: Base.TaskStatus) -> None:
        self.statuses.append(status)


def build_context(
    *,
    item_ids: tuple[int, ...] = (1,),
    retry_count: int = 0,
) -> AnalysisTaskContext:
    items = tuple(
        AnalysisItemContext(
            item_id=item_id,
            file_path="story.txt",
            src_text=f"src-{item_id}",
        )
        for item_id in item_ids
    )
    return AnalysisTaskContext(
        file_path="story.txt",
        items=items,
        retry_count=retry_count,
    )


def build_hooks(
    *,
    limiter: FakeLimiter | None = None,
    initial_contexts: list[AnalysisTaskContext] | None = None,
) -> tuple[AnalysisTaskHooks, Analysis]:
    analysis = Analysis()
    analysis.task_limiter = limiter
    analysis.progress_tracker = SimpleNamespace(
        update_extras_after_batch=MagicMock(),
        mark_progress_dirty=MagicMock(),
        update_runtime_counts_after_success=MagicMock(),
        update_runtime_counts_after_error=MagicMock(),
        sync_progress_snapshot_after_commit=MagicMock(return_value={}),
    )
    analysis.scheduler = SimpleNamespace(
        create_task=lambda context: SimpleNamespace(
            start=lambda: AnalysisTaskResult(
                context=context,
                success=True,
                stopped=False,
            )
        ),
        build_processed_checkpoints=lambda context: [
            {"item_id": item.item_id, "status": "processed"} for item in context.items
        ],
        build_error_checkpoints=lambda context: [
            {"item_id": item.item_id, "status": "error"} for item in context.items
        ],
        create_retry_task_context=lambda context: None,
    )
    hooks = AnalysisTaskHooks(
        analysis=analysis,
        initial_contexts=initial_contexts or [build_context()],
        max_workers=2,
    )
    return hooks, analysis


def test_analysis_task_hooks_iter_initial_contexts_returns_copy() -> None:
    context = build_context(item_ids=(1, 2))
    hooks, _analysis = build_hooks(initial_contexts=[context])

    contexts = hooks.iter_initial_contexts()
    contexts.append(build_context(item_ids=(9,)))

    assert hooks.initial_contexts == [context]
    assert hooks.build_pipeline_sizes() == (64, 512, 64)


def test_analysis_task_hooks_run_context_uses_limiter_and_wraps_result() -> None:
    limiter = FakeLimiter()
    context = build_context(item_ids=(1, 2))
    hooks, _analysis = build_hooks(limiter=limiter, initial_contexts=[context])

    payload = hooks.run_context(context)

    assert isinstance(payload, AnalysisCommitPayload)
    assert payload.result.context == context
    assert limiter.acquire_calls == 1
    assert limiter.wait_calls == 1
    assert limiter.release_calls == 1


def test_analysis_task_hooks_handle_commit_payloads_commits_success_result(
    fake_data_manager,
    monkeypatch,
) -> None:
    context = build_context(item_ids=(1, 2))
    hooks, analysis = build_hooks(initial_contexts=[context])
    commit_result_spy = MagicMock(return_value=1)
    fake_data_manager.commit_analysis_task_batch = commit_result_spy

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.DataManager.get",
        lambda: fake_data_manager,
    )

    result = hooks.handle_commit_payloads(
        (
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=context,
                    success=True,
                    stopped=False,
                    glossary_entries=({"src": "A", "dst": "B"},),
                )
            ),
        )
    )

    analysis.progress_tracker.update_extras_after_batch.assert_called_once_with(
        input_tokens=0,
        output_tokens=0,
    )
    analysis.progress_tracker.mark_progress_dirty.assert_called_once_with(
        commit_count=1
    )
    analysis.progress_tracker.update_runtime_counts_after_success.assert_called_once()
    analysis.progress_tracker.update_runtime_counts_after_error.assert_not_called()
    commit_result_spy.assert_called_once()
    assert result.failed is False
    assert result.stopped is False
    assert result.retry_contexts == ()


def test_analysis_task_hooks_handle_commit_payloads_requeues_retry_context(
    fake_data_manager,
    monkeypatch,
) -> None:
    context = build_context(item_ids=(3,))
    retry_context = build_context(item_ids=(3,), retry_count=1)
    hooks, analysis = build_hooks(initial_contexts=[context])
    analysis.scheduler.create_retry_task_context = lambda task_context: retry_context
    update_error_spy = MagicMock()
    fake_data_manager.update_analysis_task_error = update_error_spy

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.DataManager.get",
        lambda: fake_data_manager,
    )

    result = hooks.handle_commit_payloads(
        (
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=context,
                    success=False,
                    stopped=False,
                    input_tokens=1,
                    output_tokens=2,
                )
            ),
        )
    )

    analysis.progress_tracker.update_runtime_counts_after_error.assert_not_called()
    update_error_spy.assert_not_called()
    analysis.progress_tracker.update_extras_after_batch.assert_called_once_with(
        input_tokens=1,
        output_tokens=2,
    )
    assert result.retry_contexts == (retry_context,)
    assert result.failed is False


def test_analysis_task_hooks_handle_commit_payloads_marks_error_after_retry_limit(
    fake_data_manager,
    monkeypatch,
) -> None:
    context = build_context(item_ids=(4, 5), retry_count=2)
    hooks, analysis = build_hooks(initial_contexts=[context])
    commit_result_spy = MagicMock(return_value=0)
    fake_data_manager.commit_analysis_task_batch = commit_result_spy

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.DataManager.get",
        lambda: fake_data_manager,
    )

    result = hooks.handle_commit_payloads(
        (
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=context,
                    success=False,
                    stopped=False,
                )
            ),
        )
    )

    analysis.progress_tracker.update_runtime_counts_after_error.assert_called_once_with(
        context
    )
    commit_result_spy.assert_called_once()
    assert result.failed is True
    assert result.retry_contexts == ()


def test_analysis_task_hooks_handle_commit_payloads_merges_success_and_error_batch(
    fake_data_manager,
    monkeypatch,
) -> None:
    success_context = build_context(item_ids=(1,))
    error_context = build_context(item_ids=(2,), retry_count=2)
    hooks, analysis = build_hooks(initial_contexts=[success_context, error_context])
    commit_result_spy = MagicMock(return_value=1)
    fake_data_manager.commit_analysis_task_batch = commit_result_spy

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.DataManager.get",
        lambda: fake_data_manager,
    )

    result = hooks.handle_commit_payloads(
        (
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=success_context,
                    success=True,
                    stopped=False,
                    input_tokens=3,
                    output_tokens=4,
                    glossary_entries=({"src": "Alice", "dst": "爱丽丝"},),
                )
            ),
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=error_context,
                    success=False,
                    stopped=False,
                    input_tokens=5,
                    output_tokens=6,
                )
            ),
        )
    )

    analysis.progress_tracker.update_extras_after_batch.assert_called_once_with(
        input_tokens=8,
        output_tokens=10,
    )
    analysis.progress_tracker.mark_progress_dirty.assert_called_once_with(
        commit_count=2
    )
    analysis.progress_tracker.update_runtime_counts_after_success.assert_called_once()
    analysis.progress_tracker.update_runtime_counts_after_error.assert_called_once_with(
        error_context
    )
    commit_result_spy.assert_called_once_with(
        success_checkpoints=[{"item_id": 1, "status": "processed"}],
        error_checkpoints=[{"item_id": 2, "status": "error"}],
        glossary_entries=[{"src": "Alice", "dst": "爱丽丝"}],
        progress_snapshot=None,
    )
    assert result.failed is True


def test_analysis_task_hooks_exposes_fixed_thread_names() -> None:
    hooks, _analysis = build_hooks()

    assert hooks.get_producer_thread_name().endswith("ANALYSIS_PRODUCER")
    assert hooks.get_worker_thread_name_prefix().endswith("ANALYSIS_WORKER")


def test_analysis_task_hooks_start_task_returns_none_without_scheduler() -> None:
    context = build_context(item_ids=(1,))
    hooks, analysis = build_hooks(initial_contexts=[context])
    analysis.scheduler = None

    payload = hooks.start_task(context)

    assert payload is None


def test_analysis_task_hooks_run_context_returns_none_when_stopping() -> None:
    limiter = FakeLimiter()
    context = build_context(item_ids=(1,))
    hooks, analysis = build_hooks(limiter=limiter, initial_contexts=[context])
    analysis.should_stop = lambda: True

    payload = hooks.run_context(context)

    assert payload is None
    assert limiter.acquire_calls == 0
    assert limiter.wait_calls == 0
    assert limiter.release_calls == 0


@pytest.mark.parametrize(
    ("acquire_ok", "wait_ok"),
    [
        (False, True),
        (True, False),
    ],
)
def test_analysis_task_hooks_run_context_returns_none_when_limiter_refuses(
    acquire_ok: bool,
    wait_ok: bool,
) -> None:
    limiter = FakeLimiter(acquire_ok=acquire_ok, wait_ok=wait_ok)
    context = build_context(item_ids=(1,))
    hooks, _analysis = build_hooks(limiter=limiter, initial_contexts=[context])

    payload = hooks.run_context(context)

    assert payload is None
    assert limiter.acquire_calls == 1
    expected_wait_calls = 1 if acquire_ok else 0
    expected_release_calls = 1 if acquire_ok else 0
    assert limiter.wait_calls == expected_wait_calls
    assert limiter.release_calls == expected_release_calls


def test_analysis_task_hooks_run_context_starts_task_without_limiter() -> None:
    context = build_context(item_ids=(1,))
    hooks, _analysis = build_hooks(limiter=None, initial_contexts=[context])

    payload = hooks.run_context(context)

    assert isinstance(payload, AnalysisCommitPayload)
    assert payload.result.success is True


def test_analysis_task_hooks_handle_commit_payloads_returns_failed_without_scheduler() -> (
    None
):
    context = build_context(item_ids=(1,))
    hooks, analysis = build_hooks(initial_contexts=[context])
    analysis.scheduler = None

    result = hooks.handle_commit_payloads(tuple())

    assert result.failed is True
    assert result.retry_contexts == ()


def test_analysis_task_hooks_handle_commit_payloads_sets_stopped_flag(
    fake_data_manager,
    monkeypatch,
) -> None:
    context = build_context(item_ids=(8,))
    hooks, analysis = build_hooks(initial_contexts=[context])
    commit_batch_spy = MagicMock()
    fake_data_manager.commit_analysis_task_batch = commit_batch_spy

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.DataManager.get",
        lambda: fake_data_manager,
    )

    result = hooks.handle_commit_payloads(
        (
            AnalysisCommitPayload(
                result=AnalysisTaskResult(
                    context=context,
                    success=False,
                    stopped=True,
                )
            ),
        )
    )

    analysis.progress_tracker.update_runtime_counts_after_success.assert_not_called()
    analysis.progress_tracker.update_runtime_counts_after_error.assert_not_called()
    commit_batch_spy.assert_not_called()
    assert result.stopped is True
    assert result.failed is False
    assert result.retry_contexts == ()


def test_analysis_task_hooks_stop_engine_after_error_sets_stopping_status(
    monkeypatch,
) -> None:
    hooks, _analysis = build_hooks()
    fake_log = FakeErrorLogger()
    fake_engine = FakeEngine()
    error = RuntimeError("boom")

    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.LogManager.get",
        lambda: fake_log,
    )
    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.Localizer.get",
        lambda: SimpleNamespace(task_failed="task_failed"),
    )
    monkeypatch.setattr(
        "module.Engine.Analysis.AnalysisTaskHooks.Engine.get",
        lambda: fake_engine,
    )

    hooks.stop_engine_after_error(error)

    assert fake_log.errors == [("task_failed", error)]
    assert fake_engine.statuses == [Base.TaskStatus.STOPPING]


def test_analysis_task_hooks_error_callbacks_delegate_to_stop() -> None:
    hooks, _analysis = build_hooks()
    stop_spy = MagicMock()
    hooks.stop_engine_after_error = stop_spy
    error = RuntimeError("boom")

    hooks.on_producer_error(error)
    hooks.on_worker_error(build_context(), error)
    hooks.on_commit_error(tuple(), error)
    hooks.on_worker_loop_error(error)

    assert stop_spy.call_count == 4
