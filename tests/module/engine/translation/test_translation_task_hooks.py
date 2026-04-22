from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
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


def test_translation_task_hooks_handle_commit_payloads_updates_batch_and_progress() -> (
    None
):
    hooks, translation = build_translation_hooks()
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.PROCESSED)
    context = SimpleNamespace(items=[item], precedings=[], token_threshold=8)
    task = SimpleNamespace(items=[item])
    payload = (
        TranslationCommitPayload(
            context=context,
            task=task,
            result={"input_tokens": 3, "output_tokens": 4},
        ),
    )

    result = hooks.handle_commit_payloads(payload)

    translation.update_extras_snapshot.assert_called_once_with(
        processed_count=1,
        error_count=0,
        input_tokens=3,
        output_tokens=4,
    )
    translation.apply_batch_update_sync.assert_called_once_with(
        [item.to_dict()],
        {"line": 1, "total_line": 2},
    )
    translation.update_pipeline_progress.assert_called_once_with(
        {"line": 1, "total_line": 2}
    )
    assert result.retry_contexts == ()


def test_translation_task_hooks_handle_commit_payloads_returns_retry_contexts() -> None:
    hooks, translation = build_translation_hooks()
    item = Item(src="a")
    item.set_status(Base.ProjectStatus.NONE)
    retry_context = SimpleNamespace(items=[], precedings=[], token_threshold=4)
    translation.scheduler.handle_failed_context = lambda context, result: [
        retry_context
    ]
    payload = (
        TranslationCommitPayload(
            context=SimpleNamespace(items=[item], precedings=[], token_threshold=8),
            task=SimpleNamespace(items=[item]),
            result={"input_tokens": 0, "output_tokens": 0},
        ),
    )

    result = hooks.handle_commit_payloads(payload)

    assert result.retry_contexts == (retry_context,)


def test_translation_task_hooks_handle_commit_payloads_merges_batch_statistics() -> (
    None
):
    hooks, translation = build_translation_hooks()
    processed_item = Item(src="a")
    processed_item.set_status(Base.ProjectStatus.PROCESSED)
    failed_item = Item(src="b")
    failed_item.set_status(Base.ProjectStatus.ERROR)

    result = hooks.handle_commit_payloads(
        (
            TranslationCommitPayload(
                context=SimpleNamespace(
                    items=[processed_item],
                    precedings=[],
                    token_threshold=8,
                ),
                task=SimpleNamespace(items=[processed_item]),
                result={"input_tokens": 3, "output_tokens": 4},
            ),
            TranslationCommitPayload(
                context=SimpleNamespace(
                    items=[failed_item],
                    precedings=[],
                    token_threshold=8,
                ),
                task=SimpleNamespace(items=[failed_item]),
                result={"input_tokens": 5, "output_tokens": 6},
            ),
        )
    )

    translation.update_extras_snapshot.assert_called_once_with(
        processed_count=1,
        error_count=1,
        input_tokens=8,
        output_tokens=10,
    )
    translation.apply_batch_update_sync.assert_called_once()
    assert result.retry_contexts == ()


def test_translation_task_hooks_exposes_fixed_thread_names_and_pipeline_sizes() -> None:
    hooks, _translation = build_translation_hooks()

    assert hooks.get_producer_thread_name().endswith("TRANSLATION_PRODUCER")
    assert hooks.get_worker_thread_name_prefix().endswith("TRANSLATION_WORKER")
    assert hooks.build_pipeline_sizes() == (4, 32, 4)
    assert list(hooks.iter_initial_contexts()) == []


def test_translation_task_hooks_start_task_returns_none_without_scheduler() -> None:
    hooks, translation = build_translation_hooks()
    translation.scheduler = None
    context = SimpleNamespace(items=[], precedings=[], token_threshold=1)

    payload = hooks.start_task(context)

    assert payload is None


def test_translation_task_hooks_run_context_returns_none_when_stopping() -> None:
    limiter = FakeLimiter()
    hooks, translation = build_translation_hooks(limiter=limiter)
    translation.should_stop = lambda: True
    context = SimpleNamespace(items=[], precedings=[], token_threshold=1)

    payload = hooks.run_context(context)

    assert payload is None
    assert limiter.acquire_calls == 0
    assert limiter.wait_calls == 0
    assert limiter.release_calls == 0


def test_translation_task_hooks_run_context_returns_none_without_limiter() -> None:
    hooks, translation = build_translation_hooks()
    translation.task_limiter = None
    context = SimpleNamespace(items=[], precedings=[], token_threshold=1)

    payload = hooks.run_context(context)

    assert payload is None


@pytest.mark.parametrize(
    ("acquire_ok", "wait_ok"),
    [
        (False, True),
        (True, False),
    ],
)
def test_translation_task_hooks_run_context_returns_none_when_limiter_fails(
    acquire_ok: bool,
    wait_ok: bool,
) -> None:
    limiter = FakeLimiter(acquire_ok=acquire_ok, wait_ok=wait_ok)
    hooks, _translation = build_translation_hooks(limiter=limiter)
    context = SimpleNamespace(items=[], precedings=[], token_threshold=1)

    payload = hooks.run_context(context)

    assert payload is None
    assert limiter.acquire_calls == 1
    expected_wait_calls = 1 if acquire_ok else 0
    expected_release_calls = 1 if acquire_ok else 0
    assert limiter.wait_calls == expected_wait_calls
    assert limiter.release_calls == expected_release_calls


def test_translation_task_hooks_build_retry_contexts_applies_guard_conditions() -> None:
    hooks, translation = build_translation_hooks()
    item = Item(src="a")
    context = SimpleNamespace(items=[item], precedings=[], token_threshold=1)
    task = SimpleNamespace(items=[item])

    translation.should_stop = lambda: True
    assert hooks.build_retry_contexts(context, task, {}) == ()

    translation.should_stop = lambda: False
    item.set_status(Base.ProjectStatus.PROCESSED)
    assert hooks.build_retry_contexts(context, task, {}) == ()

    item.set_status(Base.ProjectStatus.NONE)
    translation.scheduler = None
    assert hooks.build_retry_contexts(context, task, {}) == ()


def test_translation_task_hooks_stop_engine_after_error_sets_stopping_status(
    monkeypatch,
) -> None:
    hooks, _translation = build_translation_hooks()
    fake_log = FakeErrorLogger()
    fake_engine = FakeEngine()
    error = RuntimeError("boom")

    monkeypatch.setattr(
        "module.Engine.Translation.TranslationTaskHooks.LogManager.get",
        lambda: fake_log,
    )
    monkeypatch.setattr(
        "module.Engine.Translation.TranslationTaskHooks.Localizer.get",
        lambda: SimpleNamespace(task_failed="task_failed"),
    )
    monkeypatch.setattr(
        "module.Engine.Translation.TranslationTaskHooks.Engine.get",
        lambda: fake_engine,
    )

    hooks.stop_engine_after_error(error)

    assert fake_log.errors == [("task_failed", error)]
    assert fake_engine.statuses == [Base.TaskStatus.STOPPING]


def test_translation_task_hooks_error_callbacks_delegate_to_stop() -> None:
    hooks, _translation = build_translation_hooks()
    stop_spy = MagicMock()
    hooks.stop_engine_after_error = stop_spy
    error = RuntimeError("boom")

    hooks.on_producer_error(error)
    hooks.on_worker_error(SimpleNamespace(), error)
    hooks.on_commit_error(tuple(), error)
    hooks.on_worker_loop_error(error)

    assert stop_spy.call_count == 4
