from __future__ import annotations

from collections.abc import Iterator

from module.Engine.TaskPipeline import TaskPipeline
from module.Engine.TaskPipeline import TaskPipelineCommitResult


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
