from __future__ import annotations

import math
from typing import Any

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
import module.Engine.TaskScheduler as task_scheduler_module
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
from module.Engine.TaskScheduler import TaskContext
from module.Engine.TaskScheduler import TaskScheduler


def create_item(
    src: str,
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
    *,
    file_path: str = "story.txt",
) -> Item:
    item = Item(src=src, file_path=file_path)
    item.set_status(status)
    return item


def test_generate_initial_contexts_iter_builds_task_contexts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = create_item("first")
    second = create_item("second")
    chunks = [([first], [second])]
    scheduler = TaskScheduler(
        config=Config(preceding_lines_threshold=2),
        model={"threshold": {"input_token_limit": 64}},
        items=[first, second],
    )

    monkeypatch.setattr(
        task_scheduler_module.TaskScheduler,
        "generate_item_chunks_iter",
        classmethod(lambda cls, **kwargs: iter(chunks)),
    )

    contexts = list(scheduler.generate_initial_contexts_iter())

    assert len(contexts) == 1
    assert contexts[0].items == [first]
    assert contexts[0].precedings == [second]
    assert contexts[0].token_threshold == 64
    assert contexts[0].is_initial is True


def test_handle_failed_context_returns_empty_when_no_pending_items() -> None:
    processed = create_item("done", Base.ProjectStatus.PROCESSED)
    context = TaskContext(
        items=[processed],
        precedings=[],
        token_threshold=32,
    )
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [processed]
    )

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []


def test_handle_failed_context_skips_error_items_during_continue_semantics() -> None:
    failed = create_item("failed", Base.ProjectStatus.ERROR)
    context = TaskContext(
        items=[failed],
        precedings=[],
        token_threshold=32,
    )
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [failed]
    )

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []


def test_handle_failed_context_splits_items_when_threshold_above_one(
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
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [first, second]
    )

    monkeypatch.setattr(
        task_scheduler_module.TaskScheduler,
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


def test_handle_failed_context_splits_to_single_items_when_threshold_is_one() -> None:
    first = create_item("a")
    second = create_item("b")
    context = TaskContext(
        items=[first, second],
        precedings=[],
        token_threshold=1,
        split_count=2,
    )
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [first, second]
    )

    new_contexts = scheduler.handle_failed_context(context, {})

    assert [ctx.items for ctx in new_contexts] == [[first], [second]]
    assert all(ctx.token_threshold == 1 for ctx in new_contexts)
    assert all(ctx.split_count == 3 for ctx in new_contexts)


def test_handle_failed_context_retries_single_item_until_limit() -> None:
    item = create_item("single")
    context = TaskContext(
        items=[item],
        precedings=[],
        token_threshold=16,
        retry_count=2,
    )
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )

    new_contexts = scheduler.handle_failed_context(context, {})

    assert len(new_contexts) == 1
    assert new_contexts[0].items == [item]
    assert new_contexts[0].retry_count == 3
    assert new_contexts[0].split_count == context.split_count


def test_handle_failed_context_force_accepts_after_retry_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = create_item("single")
    context = TaskContext(
        items=[item],
        precedings=[],
        token_threshold=16,
        retry_count=3,
    )
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )
    calls: list[Item] = []
    monkeypatch.setattr(scheduler, "force_accept", lambda obj: calls.append(obj))

    new_contexts = scheduler.handle_failed_context(context, {})

    assert new_contexts == []
    assert calls == [item]


def test_create_task_injects_split_retry_and_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeTranslationTask:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)
            self.split_count = -1
            self.token_threshold = -1
            self.retry_count = -1

    monkeypatch.setattr(task_scheduler_module, "TranslationTask", FakeTranslationTask)

    item = create_item("line")
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )
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


def test_force_accept_sets_src_to_dst_and_error_status() -> None:
    item = create_item("origin")
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )

    scheduler.force_accept(item)

    assert item.get_dst() == "origin"
    assert item.get_status() == Base.ProjectStatus.ERROR


def test_force_accept_keeps_existing_dst_when_status_is_none() -> None:
    item = create_item("origin", Base.ProjectStatus.NONE)
    item.set_dst("translated")
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )

    scheduler.force_accept(item)

    assert item.get_dst() == "translated"
    assert item.get_status() == Base.ProjectStatus.ERROR


def test_force_accept_does_not_override_processed_item() -> None:
    item = create_item("origin", Base.ProjectStatus.PROCESSED)
    item.set_dst("translated")
    scheduler = TaskScheduler(
        Config(), {"threshold": {"input_token_limit": 64}}, [item]
    )

    scheduler.force_accept(item)

    assert item.get_dst() == "translated"
    assert item.get_status() == Base.ProjectStatus.PROCESSED


def test_generate_item_chunks_splits_when_file_changes() -> None:
    items = [
        create_item("a1", file_path="a.txt"),
        create_item("a2", file_path="a.txt"),
        create_item("b1", file_path="b.txt"),
    ]

    chunks, preceding_chunks = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=1000,
        preceding_lines_threshold=3,
    )

    assert [len(chunk) for chunk in chunks] == [2, 1]
    assert preceding_chunks[1] == []


def test_generate_item_chunks_iter_uses_gap_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items = [create_item("a1"), create_item("a2")]
    observed: list[list[tuple[int, Item]]] = []

    def fake_gap_iter(
        iterable: list[tuple[int, Item]] | Any,
        *,
        sleep_seconds: float | None = None,
    ) -> Any:
        del sleep_seconds
        captured = list(iterable)
        observed.append(captured)
        return iter(captured)

    monkeypatch.setattr(
        task_scheduler_module.GapTool,
        "iter",
        staticmethod(fake_gap_iter),
    )

    chunks = list(
        TaskScheduler.generate_item_chunks_iter(
            items=items,
            input_token_threshold=1000,
            preceding_lines_threshold=0,
        )
    )

    assert observed == [[(0, items[0]), (1, items[1])]]
    assert [chunk for chunk, _preceding in chunks] == [items]


def test_generate_item_chunks_splits_when_line_limit_exceeded() -> None:
    items = [
        create_item("\n".join([f"line-{i}" for i in range(8)])),
        create_item("line-9"),
    ]

    chunks, _ = TaskScheduler.generate_item_chunks(
        items=items,
        input_token_threshold=16,
        preceding_lines_threshold=0,
    )

    assert [len(chunk) for chunk in chunks] == [1, 1]


def test_build_initial_analysis_contexts_uses_shared_file_boundaries() -> None:
    items = [
        AnalysisItemContext(item_id=1, file_path="a.txt", source_text="a1"),
        AnalysisItemContext(item_id=2, file_path="a.txt", source_text="a2"),
        AnalysisItemContext(
            item_id=3,
            file_path="b.txt",
            source_text="b1",
            previous_status=Base.ProjectStatus.ERROR,
        ),
    ]

    contexts = TaskScheduler.build_initial_analysis_contexts(
        items=items,
        input_token_threshold=1000,
    )

    assert [context.file_path for context in contexts] == ["a.txt", "b.txt"]
    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1, 2],
        [3],
    ]
    assert contexts[1].items[0].previous_status == Base.ProjectStatus.ERROR
