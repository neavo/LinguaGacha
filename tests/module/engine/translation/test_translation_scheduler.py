from __future__ import annotations

import math
from typing import Any

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
import module.Engine.Translation.TranslationScheduler as translation_scheduler_module
from module.Engine.Translation.TranslationScheduler import TaskContext
from module.Engine.Translation.TranslationScheduler import TranslationScheduler


def create_item(
    src: str,
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
    *,
    file_path: str = "story.txt",
) -> Item:
    item = Item(src=src, file_path=file_path)
    item.set_status(status)
    return item


def create_translation_scheduler(items: list[Item]) -> TranslationScheduler:
    return TranslationScheduler(
        config=Config(preceding_lines_threshold=2),
        model={"threshold": {"input_token_limit": 64}},
        items=items,
    )


def test_translation_scheduler_generate_initial_contexts_iter_builds_task_contexts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = create_item("first")
    second = create_item("second")
    chunks = [([first], [second])]
    scheduler = create_translation_scheduler([first, second])

    monkeypatch.setattr(
        translation_scheduler_module.TaskScheduler,
        "generate_item_chunks_iter",
        classmethod(lambda cls, **kwargs: iter(chunks)),
    )

    contexts = list(scheduler.generate_initial_contexts_iter())

    assert len(contexts) == 1
    assert contexts[0].items == [first]
    assert contexts[0].precedings == [second]
    assert contexts[0].token_threshold == 64
    assert contexts[0].is_initial is True


def test_translation_scheduler_handle_failed_context_returns_empty_when_no_pending_items() -> (
    None
):
    processed = create_item("done", Base.ProjectStatus.PROCESSED)
    context = TaskContext(
        items=[processed],
        precedings=[],
        token_threshold=32,
    )
    scheduler = create_translation_scheduler([processed])

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []


def test_translation_scheduler_handle_failed_context_skips_error_items_during_continue_semantics() -> (
    None
):
    failed = create_item("failed", Base.ProjectStatus.ERROR)
    context = TaskContext(
        items=[failed],
        precedings=[],
        token_threshold=32,
    )
    scheduler = create_translation_scheduler([failed])

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []


def test_translation_scheduler_handle_failed_context_splits_items_when_threshold_above_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = create_item("a")
    second = create_item("b")
    context = TaskContext(
        items=[first, second],
        precedings=[],
        token_threshold=32,
        split_count=1,
        retry_count=0,
        is_initial=False,
    )
    scheduler = create_translation_scheduler([first, second])

    monkeypatch.setattr(
        translation_scheduler_module.TaskScheduler,
        "generate_item_chunks",
        classmethod(lambda cls, **kwargs: ([[first], [second]], [])),
    )

    new_contexts = scheduler.handle_failed_context(context, {})

    assert len(new_contexts) == 2
    assert all(ctx.split_count == 2 for ctx in new_contexts)
    assert all(ctx.retry_count == 0 for ctx in new_contexts)
    assert all(ctx.precedings == [] for ctx in new_contexts)
    assert all(ctx.is_initial is False for ctx in new_contexts)
    expected_threshold = max(1, math.floor(32 * scheduler.factor))
    assert all(ctx.token_threshold == expected_threshold for ctx in new_contexts)


def test_translation_scheduler_handle_failed_context_splits_to_single_items_when_threshold_is_one() -> (
    None
):
    first = create_item("a")
    second = create_item("b")
    context = TaskContext(
        items=[first, second],
        precedings=[],
        token_threshold=1,
        split_count=2,
    )
    scheduler = create_translation_scheduler([first, second])

    new_contexts = scheduler.handle_failed_context(context, {})

    assert [ctx.items for ctx in new_contexts] == [[first], [second]]
    assert all(ctx.token_threshold == 1 for ctx in new_contexts)
    assert all(ctx.split_count == 3 for ctx in new_contexts)


def test_translation_scheduler_handle_failed_context_retries_single_item_until_limit() -> (
    None
):
    item = create_item("single")
    context = TaskContext(
        items=[item],
        precedings=[],
        token_threshold=16,
        retry_count=2,
    )
    scheduler = create_translation_scheduler([item])

    new_contexts = scheduler.handle_failed_context(context, {})

    assert len(new_contexts) == 1
    assert new_contexts[0].items == [item]
    assert new_contexts[0].retry_count == 3
    assert new_contexts[0].split_count == context.split_count


def test_translation_scheduler_handle_failed_context_force_accepts_after_retry_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = create_item("single")
    context = TaskContext(
        items=[item],
        precedings=[],
        token_threshold=16,
        retry_count=3,
    )
    scheduler = create_translation_scheduler([item])
    calls: list[Item] = []
    monkeypatch.setattr(scheduler, "force_accept", lambda obj: calls.append(obj))

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []
    assert calls == [item]


def test_translation_scheduler_create_task_injects_split_retry_and_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeTranslationTask:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)
            self.split_count = -1
            self.token_threshold = -1
            self.retry_count = -1

    monkeypatch.setattr(
        translation_scheduler_module,
        "TranslationTask",
        FakeTranslationTask,
    )

    item = create_item("line")
    scheduler = create_translation_scheduler([item])
    context = TaskContext(
        items=[item],
        precedings=[],
        token_threshold=20,
        split_count=4,
        retry_count=2,
        is_initial=False,
    )

    task = scheduler.create_task(context)

    assert captured["items"] == [item]
    assert captured["precedings"] == []
    assert captured["is_sub_task"] is True
    assert task.split_count == 4
    assert task.token_threshold == 20
    assert task.retry_count == 2


def test_translation_scheduler_force_accept_sets_src_to_dst_and_error_status() -> None:
    item = create_item("origin")
    scheduler = create_translation_scheduler([item])

    scheduler.force_accept(item)

    assert item.get_dst() == "origin"
    assert item.get_status() == Base.ProjectStatus.ERROR


def test_translation_scheduler_force_accept_keeps_existing_dst_when_status_is_none() -> (
    None
):
    item = create_item("origin", Base.ProjectStatus.NONE)
    item.set_dst("translated")
    scheduler = create_translation_scheduler([item])

    scheduler.force_accept(item)

    assert item.get_dst() == "translated"
    assert item.get_status() == Base.ProjectStatus.ERROR


def test_translation_scheduler_force_accept_does_not_override_processed_item() -> None:
    item = create_item("origin", Base.ProjectStatus.PROCESSED)
    item.set_dst("translated")
    scheduler = create_translation_scheduler([item])

    scheduler.force_accept(item)

    assert item.get_dst() == "translated"
    assert item.get_status() == Base.ProjectStatus.PROCESSED
