from __future__ import annotations

import queue
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
import module.Engine.Translation.TranslationTaskPipeline as pipeline_module
from module.Engine.TaskScheduler import TaskContext
from module.Engine.Translation.TranslationTaskPipeline import TranslationTaskPipeline


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


class FakeTask:
    def __init__(self, items: list[Item], result: dict[str, Any]) -> None:
        self.items = items
        self.result = result

    def start(self) -> dict[str, Any]:
        return self.result


class FakeProgress:
    def __init__(self) -> None:
        self.updates: list[dict[str, int]] = []

    def update(self, pid: int, *, completed: int, total: int) -> None:
        self.updates.append(
            {
                "pid": pid,
                "completed": completed,
                "total": total,
            }
        )


class FakeLogger:
    def __init__(self) -> None:
        self.errors: list[tuple[str, Exception | None]] = []

    def error(self, msg: str, e: Exception | BaseException | None = None) -> None:
        self.errors.append((msg, e if isinstance(e, Exception) else None))


def create_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    *,
    engine_status: Base.TaskStatus = Base.TaskStatus.IDLE,
    limiter: FakeLimiter | None = None,
) -> tuple[TranslationTaskPipeline, Any, FakeProgress, Any]:
    progress = FakeProgress()
    limiter_obj = limiter or FakeLimiter()
    engine = SimpleNamespace(status=engine_status)
    engine.get_status = lambda: engine.status
    engine.set_status = lambda status: setattr(engine, "status", status)

    translation = SimpleNamespace(
        get_task_buffer_size=lambda workers: 4,
        scheduler=SimpleNamespace(
            create_task=lambda context: FakeTask(context.items, {}),
            handle_failed_context=lambda context, result: [],
        ),
        update_extras_snapshot=MagicMock(return_value={"line": 1, "total_line": 1}),
        apply_batch_update_sync=MagicMock(),
        emit=MagicMock(),
    )

    logger = FakeLogger()
    monkeypatch.setattr(pipeline_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        pipeline_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_failed="task failed")),
    )
    monkeypatch.setattr(
        pipeline_module.LogManager,
        "get",
        staticmethod(lambda: logger),
    )

    pipeline = TranslationTaskPipeline(
        translation=translation,
        progress=progress,
        pid=7,
        task_limiter=limiter_obj,  # type: ignore[arg-type]
        max_workers=1,
    )
    return pipeline, translation, progress, engine


def test_should_stop_reads_engine_status(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, _, _, engine = create_pipeline(
        monkeypatch,
        engine_status=Base.TaskStatus.STOPPING,
    )

    assert pipeline.should_stop() is True
    engine.status = Base.TaskStatus.IDLE
    assert pipeline.should_stop() is False


def test_get_next_context_prioritizes_high_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    high_context = TaskContext(items=[], precedings=[], token_threshold=8)
    normal_context = TaskContext(items=[], precedings=[], token_threshold=16)
    pipeline.high_queue.put(high_context)
    pipeline.normal_queue.put(normal_context)

    got = pipeline.get_next_context()

    assert got is high_context
    assert pipeline.normal_queue.qsize() == 1


def test_get_next_context_returns_none_after_all_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    pipeline.producer_done.set()

    assert pipeline.get_next_context() is None


def test_run_one_context_returns_when_acquire_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limiter = FakeLimiter(acquire_ok=False)
    pipeline, translation, _, _ = create_pipeline(monkeypatch, limiter=limiter)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    create_task = MagicMock()
    translation.scheduler.create_task = create_task

    pipeline.run_one_context(context)

    assert limiter.acquire_calls == 1
    assert limiter.wait_calls == 0
    create_task.assert_not_called()


def test_run_one_context_puts_payload_when_task_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    item = Item(src="s")
    context = TaskContext(items=[item], precedings=[], token_threshold=8)
    expected_result = {"input_tokens": 1, "output_tokens": 2}
    translation.scheduler.create_task = lambda ctx: FakeTask(ctx.items, expected_result)

    pipeline.run_one_context(context)

    payload = pipeline.commit_queue.get_nowait()
    assert payload[0] is context
    assert payload[2] == expected_result
    assert pipeline.get_pending_commit_count() == 1


def test_run_one_context_sets_engine_stopping_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, engine = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)

    def boom(ctx: TaskContext) -> Any:
        del ctx
        raise RuntimeError("boom")

    translation.scheduler.create_task = boom

    pipeline.run_one_context(context)

    assert engine.status == Base.TaskStatus.STOPPING


def test_commit_loop_applies_batch_and_updates_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, progress, _ = create_pipeline(monkeypatch)
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.PROCESSED)
    context = TaskContext(items=[item], precedings=[], token_threshold=8)
    task = FakeTask(
        items=[item],
        result={
            "input_tokens": 3,
            "output_tokens": 4,
        },
    )

    pipeline.inc_pending_commit()
    pipeline.commit_queue.put((context, task, task.result))
    pipeline.producer_done.set()

    pipeline.commit_loop()

    translation.update_extras_snapshot.assert_called_once_with(
        processed_count=1,
        error_count=0,
        input_tokens=3,
        output_tokens=4,
    )
    translation.apply_batch_update_sync.assert_called_once()
    assert progress.updates == [{"pid": 7, "completed": 1, "total": 1}]
    translation.emit.assert_called_once_with(
        Base.Event.TRANSLATION_PROGRESS, {"line": 1, "total_line": 1}
    )
    assert pipeline.get_pending_commit_count() == 0


def test_drain_context_queues_on_stop_clears_both_queues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    pipeline.high_queue.put(TaskContext(items=[], precedings=[], token_threshold=8))
    pipeline.normal_queue.put(TaskContext(items=[], precedings=[], token_threshold=8))

    pipeline.drain_context_queues_on_stop()

    assert pipeline.high_queue.empty() is True
    assert pipeline.normal_queue.empty() is True


def test_start_producer_thread_runs_producer_until_generator_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    thread_state = {"started": False}

    translation.scheduler.generate_initial_contexts_iter = lambda: iter(())

    class FakeThread:
        def __init__(self, **kwargs: Any) -> None:
            self.target = kwargs["target"]

        def start(self) -> None:
            thread_state["started"] = True
            self.target()

    monkeypatch.setattr(pipeline_module.threading, "Thread", FakeThread)

    pipeline.start_producer_thread()

    assert thread_state["started"] is True
    assert pipeline.producer_done.is_set() is True
    assert pipeline.normal_queue.empty() is True


def test_producer_retries_when_queue_is_full(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    translation.scheduler.generate_initial_contexts_iter = lambda: iter([context])

    calls = {"count": 0}

    def fake_put(payload: TaskContext, timeout: float) -> None:
        del payload, timeout
        calls["count"] += 1
        if calls["count"] == 1:
            raise queue.Full()

    monkeypatch.setattr(pipeline.normal_queue, "put", fake_put)

    pipeline.producer()

    assert calls["count"] == 2
    assert pipeline.producer_done.is_set() is True


def test_producer_breaks_when_stop_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    translation.scheduler.generate_initial_contexts_iter = lambda: iter([context])

    checks = iter([False, True])
    pipeline.should_stop = lambda: next(checks, True)

    pipeline.producer()

    assert pipeline.producer_done.is_set() is True
    assert pipeline.normal_queue.empty() is True


def test_producer_breaks_before_queueing_when_stop_is_true_on_outer_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    translation.scheduler.generate_initial_contexts_iter = lambda: iter([context])
    pipeline.should_stop = lambda: True

    pipeline.producer()

    assert pipeline.normal_queue.empty() is True
    assert pipeline.producer_done.is_set() is True


def test_producer_sets_stopping_when_generator_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, engine = create_pipeline(monkeypatch)

    class BadIterable:
        def __iter__(self) -> Any:
            raise RuntimeError("bad generator")

    translation.scheduler.generate_initial_contexts_iter = lambda: BadIterable()

    pipeline.producer()

    assert engine.status == Base.TaskStatus.STOPPING
    assert pipeline.producer_done.is_set() is True


def test_get_next_context_retries_normal_queue_after_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)

    attempts = iter([queue.Empty(), context])

    def fake_get(timeout: float) -> TaskContext:
        del timeout
        value = next(attempts)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(pipeline.normal_queue, "get", fake_get)

    got = pipeline.get_next_context()

    assert got is context


def test_get_next_context_returns_none_when_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(
        monkeypatch, engine_status=Base.TaskStatus.STOPPING
    )

    assert pipeline.get_next_context() is None


def test_run_one_context_returns_immediately_when_should_stop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(
        monkeypatch, engine_status=Base.TaskStatus.STOPPING
    )
    context = TaskContext(items=[], precedings=[], token_threshold=8)

    pipeline.run_one_context(context)

    assert pipeline.task_limiter.acquire_calls == 0


def test_run_one_context_returns_when_wait_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limiter = FakeLimiter(acquire_ok=True, wait_ok=False)
    pipeline, _, _, _ = create_pipeline(monkeypatch, limiter=limiter)
    context = TaskContext(items=[], precedings=[], token_threshold=8)

    pipeline.run_one_context(context)

    assert limiter.acquire_calls == 1
    assert limiter.wait_calls == 1
    assert limiter.release_calls == 1


def test_run_one_context_returns_when_stop_after_wait(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    checks = iter([False, True])
    pipeline.should_stop = lambda: next(checks, True)
    create_task = MagicMock()
    translation.scheduler.create_task = create_task

    pipeline.run_one_context(context)

    create_task.assert_not_called()


def test_run_one_context_rolls_back_pending_count_when_commit_put_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, engine = create_pipeline(monkeypatch)
    context = TaskContext(items=[Item(src="x")], precedings=[], token_threshold=8)
    translation.scheduler.create_task = lambda ctx: FakeTask(
        ctx.items, {"input_tokens": 0, "output_tokens": 0}
    )

    def fail_put(payload: Any) -> None:
        del payload
        raise RuntimeError("put failed")

    monkeypatch.setattr(pipeline.commit_queue, "put", fail_put)

    pipeline.run_one_context(context)

    assert pipeline.get_pending_commit_count() == 0
    assert engine.status == Base.TaskStatus.STOPPING


def test_worker_runs_until_context_queue_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    context = TaskContext(items=[], precedings=[], token_threshold=8)
    pipeline.get_next_context = MagicMock(side_effect=[context, None])
    pipeline.run_one_context = MagicMock()

    pipeline.worker()

    pipeline.run_one_context.assert_called_once_with(context)
    assert pipeline.get_active_context_count() == 0


def test_worker_returns_when_stopping_immediately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(
        monkeypatch, engine_status=Base.TaskStatus.STOPPING
    )
    pipeline.get_next_context = MagicMock()

    pipeline.worker()

    pipeline.get_next_context.assert_not_called()


def test_dec_pending_commit_is_noop_when_count_is_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    pipeline.pending_commit_count = 0

    pipeline.dec_pending_commit()

    assert pipeline.get_pending_commit_count() == 0


def test_dec_active_context_is_noop_when_count_is_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    pipeline.active_context_count = 0

    pipeline.dec_active_context()

    assert pipeline.get_active_context_count() == 0


def test_commit_loop_stopping_returns_when_no_pending_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(
        monkeypatch, engine_status=Base.TaskStatus.STOPPING
    )
    pipeline.drain_context_queues_on_stop = MagicMock()
    monkeypatch.setattr(
        pipeline.commit_queue,
        "get",
        lambda timeout: (_ for _ in ()).throw(queue.Empty()),
    )

    pipeline.commit_loop()

    pipeline.drain_context_queues_on_stop.assert_called()


def test_commit_loop_stopping_continues_then_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(
        monkeypatch, engine_status=Base.TaskStatus.STOPPING
    )
    pipeline.drain_context_queues_on_stop = MagicMock()
    monkeypatch.setattr(
        pipeline.commit_queue,
        "get",
        lambda timeout: (_ for _ in ()).throw(queue.Empty()),
    )
    pending_counts = iter([1, 0])
    pipeline.get_pending_commit_count = lambda: next(pending_counts, 0)
    pipeline.get_active_context_count = lambda: 0
    monkeypatch.setattr(pipeline.commit_queue, "empty", lambda: True)

    pipeline.commit_loop()

    assert pipeline.drain_context_queues_on_stop.call_count >= 1


def test_commit_loop_empty_queue_continues_when_not_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, _ = create_pipeline(monkeypatch)
    checks = iter([False, False, True])
    pipeline.should_stop = lambda: next(checks, True)
    monkeypatch.setattr(
        pipeline.commit_queue,
        "get",
        lambda timeout: (_ for _ in ()).throw(queue.Empty()),
    )
    pipeline.producer_done.set()
    monkeypatch.setattr(pipeline.normal_queue, "empty", lambda: False)
    monkeypatch.setattr(pipeline.high_queue, "empty", lambda: True)
    pipeline.get_pending_commit_count = lambda: 0
    pipeline.get_active_context_count = lambda: 0
    pipeline.drain_context_queues_on_stop = MagicMock()
    monkeypatch.setattr(pipeline.commit_queue, "empty", lambda: True)

    pipeline.commit_loop()

    pipeline.drain_context_queues_on_stop.assert_called_once()


def test_commit_loop_enqueues_failed_context_without_glossary_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.NONE)
    context = TaskContext(items=[item], precedings=[], token_threshold=8)
    retry_context = TaskContext(items=[], precedings=[], token_threshold=4)
    translation.scheduler.handle_failed_context = lambda ctx, result: [retry_context]
    task = FakeTask(
        items=[item],
        result={"input_tokens": 0, "output_tokens": 0},
    )
    pipeline.inc_pending_commit()
    pipeline.commit_queue.put((context, task, task.result))
    pipeline.producer_done.set()
    put_calls = {"count": 0}

    def high_put(payload: TaskContext, timeout: float) -> None:
        del timeout
        put_calls["count"] += 1
        if put_calls["count"] == 1:
            raise queue.Full()
        assert payload is retry_context

    monkeypatch.setattr(pipeline.high_queue, "put", high_put)

    pipeline.commit_loop()

    assert put_calls["count"] == 2
    translation.apply_batch_update_sync.assert_called_once()
    assert pipeline.get_pending_commit_count() == 0


def test_commit_loop_breaks_retry_enqueue_when_stop_requested_in_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, _ = create_pipeline(monkeypatch)
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.NONE)
    context = TaskContext(items=[item], precedings=[], token_threshold=8)
    retry_context = TaskContext(items=[], precedings=[], token_threshold=4)
    translation.scheduler.handle_failed_context = lambda ctx, result: [retry_context]
    task = FakeTask(items=[item], result={"input_tokens": 0, "output_tokens": 0})
    pipeline.inc_pending_commit()
    pipeline.commit_queue.put((context, task, task.result))
    pipeline.producer_done.set()
    checks = iter([False, False, True, True])
    pipeline.should_stop = lambda: next(checks, True)
    put_spy = MagicMock()
    monkeypatch.setattr(pipeline.high_queue, "put", put_spy)

    pipeline.commit_loop()

    put_spy.assert_not_called()


def test_commit_loop_sets_engine_stopping_when_commit_processing_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, translation, _, engine = create_pipeline(monkeypatch)
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.PROCESSED)
    context = TaskContext(items=[item], precedings=[], token_threshold=8)
    task = FakeTask(items=[item], result={"input_tokens": 0, "output_tokens": 0})
    translation.update_extras_snapshot = MagicMock(side_effect=RuntimeError("boom"))
    pipeline.inc_pending_commit()
    pipeline.commit_queue.put((context, task, task.result))
    pipeline.producer_done.set()

    pipeline.commit_loop()

    assert engine.status == Base.TaskStatus.STOPPING
    assert pipeline.get_pending_commit_count() == 0


def test_run_handles_future_exception_and_sets_engine_stopping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _, _, engine = create_pipeline(monkeypatch)
    pipeline.start_producer_thread = MagicMock()
    pipeline.commit_loop = MagicMock()

    class FakeFuture:
        def __init__(self, should_raise: bool) -> None:
            self.should_raise = should_raise

        def result(self) -> None:
            if self.should_raise:
                raise RuntimeError("worker failed")

    class FakeExecutor:
        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.calls = 0

        def __enter__(self) -> "FakeExecutor":
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
            del exc_type, exc, tb
            return False

        def submit(self, fn: Any) -> FakeFuture:
            del fn
            self.calls += 1
            return FakeFuture(self.calls == 1)

    monkeypatch.setattr(
        pipeline_module.concurrent.futures,
        "ThreadPoolExecutor",
        FakeExecutor,
    )

    pipeline.run()

    assert engine.status == Base.TaskStatus.STOPPING
