from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock


from base.Base import Base
from model.Item import Item
from module.Engine.TaskPipeline import TaskPipeline
from module.Engine.TaskPipeline import TaskPipelineCommitResult
from module.Engine.Translation.TranslationTaskHooks import TranslationCommitPayload
from module.Engine.Translation.TranslationTaskHooks import TranslationTaskHooks


class FakeLimiter:
    def __init__(self, *, acquire_ok: bool = True, wait_ok: bool = True) -> None:
        self.acquire_ok = acquire_ok
        self.wait_ok = wait_ok
        self.acquire_calls = 0
        self.wait_calls = 0
        self.release_calls = 0

    def acquire(self, stop_checker: Any = None) -> bool:
        del stop_checker
        self.acquire_calls += 1
        return self.acquire_ok

    def wait(self, stop_checker: Any = None) -> bool:
        del stop_checker
        self.wait_calls += 1
        return self.wait_ok

    def release(self) -> None:
        self.release_calls += 1


class FakeHooks:
    def __init__(self) -> None:
        self.stop_requested = False
        self.initial_contexts: list[int] = []
        self.committed_payloads: list[int] = []
        self.retry_once_payloads: set[int] = set()
        self.worker_errors: list[tuple[int, Exception]] = []

    def should_stop(self) -> bool:
        return self.stop_requested

    def get_producer_thread_name(self) -> str:
        return "TEST_PRODUCER"

    def get_worker_thread_name_prefix(self) -> str:
        return "TEST_WORKER"

    def iter_initial_contexts(self) -> Iterator[int]:
        return iter(self.initial_contexts)

    def run_context(self, context: int) -> int | None:
        return context

    def handle_commit_payload(
        self,
        payload: int,
    ) -> TaskPipelineCommitResult[int]:
        self.committed_payloads.append(payload)
        if payload in self.retry_once_payloads:
            self.retry_once_payloads.remove(payload)
            return TaskPipelineCommitResult(retry_contexts=(payload + 100,))
        return TaskPipelineCommitResult()

    def on_producer_error(self, e: Exception) -> None:
        raise e

    def on_worker_error(self, context: int, e: Exception) -> None:
        self.worker_errors.append((context, e))

    def on_commit_error(self, payload: int, e: Exception) -> None:
        raise e

    def on_worker_loop_error(self, e: Exception) -> None:
        raise e


def build_task_pipeline(hooks: FakeHooks) -> TaskPipeline[int, int]:
    return TaskPipeline(
        hooks=hooks,
        max_workers=1,
        normal_queue_size=4,
        high_queue_size=8,
        commit_queue_size=4,
    )


def test_task_pipeline_get_next_context_prioritizes_high_queue() -> None:
    hooks = FakeHooks()
    pipeline = build_task_pipeline(hooks)
    pipeline.high_queue.put(2)
    pipeline.normal_queue.put(1)

    assert pipeline.get_next_context() == 2
    assert pipeline.normal_queue.qsize() == 1


def test_task_pipeline_run_one_context_enqueues_commit_payload() -> None:
    hooks = FakeHooks()
    pipeline = build_task_pipeline(hooks)

    pipeline.run_one_context(7)

    assert pipeline.commit_queue.get_nowait() == 7
    assert pipeline.get_pending_commit_count() == 1
    assert pipeline.commit_queue_peak_length == 1


def test_task_pipeline_run_end_to_end_requeues_high_priority_retry() -> None:
    hooks = FakeHooks()
    hooks.initial_contexts = [1]
    hooks.retry_once_payloads = {1}
    pipeline = build_task_pipeline(hooks)

    result = pipeline.run()

    assert hooks.committed_payloads == [1, 101]
    assert result.failed is False
    assert result.stopped is False
    assert result.committed_payload_count == 2
    assert result.commit_queue_peak_length >= 1


def test_task_pipeline_commit_loop_drains_contexts_when_stopping() -> None:
    hooks = FakeHooks()
    pipeline = build_task_pipeline(hooks)
    pipeline.high_queue.put(9)
    pipeline.normal_queue.put(3)
    pipeline.producer_done.set()
    hooks.stop_requested = True

    result = pipeline.commit_loop()

    assert result.stopped is True
    assert pipeline.high_queue.empty() is True
    assert pipeline.normal_queue.empty() is True


def build_translation_hooks(
    *,
    limiter: FakeLimiter | None = None,
) -> tuple[TranslationTaskHooks, Any]:
    translation = SimpleNamespace()
    translation.task_limiter = limiter or FakeLimiter()
    translation.scheduler = SimpleNamespace(
        generate_initial_contexts_iter=lambda: iter(()),
        create_task=lambda context: SimpleNamespace(
            items=context.items,
            start=lambda: {"input_tokens": 1, "output_tokens": 2},
        ),
        handle_failed_context=lambda context, result: [],
    )
    translation.get_task_buffer_size = lambda workers: 4
    translation.should_stop = lambda: False
    translation.update_extras_snapshot = MagicMock(
        return_value={"line": 1, "total_line": 2}
    )
    translation.apply_batch_update_sync = MagicMock()
    translation.update_pipeline_progress = MagicMock()
    translation.task_hooks = None
    hooks = TranslationTaskHooks(
        translation=translation,
        progress=SimpleNamespace(update=lambda *args, **kwargs: None),
        pid=3,
        max_workers=2,
    )
    return hooks, translation


def test_translation_task_hooks_run_context_uses_limiter_and_builds_payload() -> None:
    limiter = FakeLimiter()
    hooks, _translation = build_translation_hooks(limiter=limiter)
    item = Item(src="a")
    context = SimpleNamespace(items=[item], precedings=[], token_threshold=8)

    payload = hooks.run_context(context)

    assert isinstance(payload, TranslationCommitPayload)
    assert limiter.acquire_calls == 1
    assert limiter.wait_calls == 1
    assert limiter.release_calls == 1
    assert payload.result == {"input_tokens": 1, "output_tokens": 2}


def test_translation_task_hooks_handle_commit_payload_updates_batch_and_progress() -> (
    None
):
    hooks, translation = build_translation_hooks()
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.PROCESSED)
    context = SimpleNamespace(items=[item], precedings=[], token_threshold=8)
    task = SimpleNamespace(items=[item])
    payload = TranslationCommitPayload(
        context=context,
        task=task,
        result={"input_tokens": 3, "output_tokens": 4},
    )

    hooks.handle_commit_payload(payload)

    translation.update_extras_snapshot.assert_called_once_with(
        processed_count=1,
        error_count=0,
        input_tokens=3,
        output_tokens=4,
    )
    translation.apply_batch_update_sync.assert_called_once()
    translation.update_pipeline_progress.assert_called_once_with(
        {"line": 1, "total_line": 2}
    )


def test_translation_task_hooks_handle_commit_payload_returns_retry_contexts() -> None:
    hooks, translation = build_translation_hooks()
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.NONE)
    retry_context = SimpleNamespace(items=[], precedings=[], token_threshold=4)
    translation.scheduler.handle_failed_context = lambda context, result: [
        retry_context
    ]
    payload = TranslationCommitPayload(
        context=SimpleNamespace(items=[item], precedings=[], token_threshold=8),
        task=SimpleNamespace(items=[item]),
        result={"input_tokens": 0, "output_tokens": 0},
    )

    result = hooks.handle_commit_payload(payload)

    assert result.retry_contexts == (retry_context,)
