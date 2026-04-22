from __future__ import annotations

from types import SimpleNamespace

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
import module.Engine.Translation.TranslationProgressTracker as translation_progress_module
from module.Engine.Translation.TranslationProgressTracker import (
    TranslationProgressTracker,
)


def create_translation_stub() -> SimpleNamespace:
    translation = SimpleNamespace()
    translation.extras = {}
    translation.items_cache = None
    translation.task_hooks = None
    translation.dm = SimpleNamespace(get_translation_extras=lambda: {})
    translation.saved_statuses: list[Base.ProjectStatus] = []
    translation.emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    translation.save_translation_state = lambda status: (
        translation.saved_statuses.append(status)
    )
    translation.emit = lambda event, data: translation.emitted_events.append(
        (event, data)
    )
    translation.get_item_count_by_status = lambda status: {
        Base.ProjectStatus.PROCESSED: 0,
        Base.ProjectStatus.ERROR: 0,
    }.get(status, 0)
    return translation


def test_update_extras_snapshot_accumulates_runtime_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.extras = {
        "processed_line": 2,
        "error_line": 1,
        "total_tokens": 10,
        "total_input_tokens": 6,
        "total_output_tokens": 4,
        "start_time": 100.0,
    }
    tracker = TranslationProgressTracker(translation)
    monkeypatch.setattr(translation_progress_module.time, "time", lambda: 112.5)

    snapshot = tracker.update_extras_snapshot(
        processed_count=3,
        error_count=2,
        input_tokens=7,
        output_tokens=11,
    )

    assert snapshot["processed_line"] == 5
    assert snapshot["error_line"] == 3
    assert snapshot["line"] == 8
    assert snapshot["total_tokens"] == 28
    assert snapshot["total_input_tokens"] == 13
    assert snapshot["total_output_tokens"] == 15
    assert snapshot["time"] == pytest.approx(12.5)


def test_sync_extras_line_stats_uses_items_cache_as_source_of_truth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    processed = Item(src="a")
    processed.set_status(Base.ProjectStatus.PROCESSED)
    failed = Item(src="b")
    failed.set_status(Base.ProjectStatus.ERROR)
    pending = Item(src="c")
    pending.set_status(Base.ProjectStatus.NONE)
    translation.items_cache = [processed, failed, pending]
    translation.extras = {"start_time": 10.0}
    tracker = TranslationProgressTracker(translation)
    monkeypatch.setattr(translation_progress_module.time, "time", lambda: 16.0)

    tracker.sync_extras_line_stats()

    assert translation.extras["processed_line"] == 1
    assert translation.extras["error_line"] == 1
    assert translation.extras["line"] == 2
    assert translation.extras["total_line"] == 3
    assert translation.extras["time"] == pytest.approx(6.0)


def test_sync_extras_line_stats_returns_when_items_cache_is_none() -> None:
    translation = create_translation_stub()
    translation.items_cache = None
    translation.extras = {"start_time": 10.0}
    tracker = TranslationProgressTracker(translation)

    tracker.sync_extras_line_stats()

    assert translation.extras == {"start_time": 10.0}


def test_sync_extras_line_stats_ignores_untracked_item_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    item = Item(src="x")
    item.set_status(Base.ProjectStatus.EXCLUDED)
    translation.items_cache = [item]
    translation.extras = {"start_time": 0.0}
    tracker = TranslationProgressTracker(translation)
    monkeypatch.setattr(translation_progress_module.time, "time", lambda: 1.0)

    tracker.sync_extras_line_stats()

    assert translation.extras["processed_line"] == 0
    assert translation.extras["error_line"] == 0
    assert translation.extras["total_line"] == 0


def test_build_plan_snapshot_continue_mode_reuses_saved_tokens_and_live_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    translation = create_translation_stub()
    translation.dm = SimpleNamespace(
        get_translation_extras=lambda: {
            "time": 12.0,
            "total_line": 10,
            "line": 7,
            "total_tokens": 90,
            "total_input_tokens": 40,
            "total_output_tokens": 50,
        }
    )
    translation.get_item_count_by_status = lambda status: {
        Base.ProjectStatus.PROCESSED: 4,
        Base.ProjectStatus.ERROR: 2,
    }.get(status, 0)
    tracker = TranslationProgressTracker(translation)
    monkeypatch.setattr(translation_progress_module.time, "time", lambda: 200.0)

    snapshot = tracker.build_plan_snapshot(continue_mode=True)

    assert snapshot.time == 12.0
    assert snapshot.start_time == pytest.approx(188.0)
    assert snapshot.total_line == 10
    assert snapshot.line == 6
    assert snapshot.processed_line == 4
    assert snapshot.error_line == 2
    assert snapshot.total_tokens == 90
    assert snapshot.total_input_tokens == 40
    assert snapshot.total_output_tokens == 50


def test_update_pipeline_progress_emits_event() -> None:
    translation = create_translation_stub()
    tracker = TranslationProgressTracker(translation)
    snapshot = {"line": 3, "total_line": 8}

    tracker.update_pipeline_progress(snapshot)

    assert translation.emitted_events == [(Base.Event.TRANSLATION_PROGRESS, snapshot)]


def test_persist_progress_snapshot_saves_state_only_when_requested() -> None:
    translation = create_translation_stub()
    translation.items_cache = [Item(src="a")]
    translation.extras = {"line": 1}
    tracker = TranslationProgressTracker(translation)

    snapshot = tracker.persist_progress_snapshot(save_state=True)

    assert translation.saved_statuses == [Base.ProjectStatus.PROCESSING]
    assert snapshot == {"line": 1}
