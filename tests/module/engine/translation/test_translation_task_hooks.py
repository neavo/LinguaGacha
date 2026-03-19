from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from base.Base import Base
from model.Item import Item
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
