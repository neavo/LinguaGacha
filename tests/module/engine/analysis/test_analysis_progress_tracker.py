from __future__ import annotations


import pytest

from base.Base import Base
from module.Engine.Analysis.Analysis import Analysis

from tests.module.engine.analysis.support import analysis_progress_module


def build_analysis_runtime_extras(**overrides: object) -> dict[str, object]:
    extras: dict[str, object] = {
        "start_time": 100.0,
        "total_line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }
    extras.update(overrides)
    return extras


class FakeConsoleProgress:
    def __init__(self) -> None:
        self.updates: list[dict[str, int]] = []

    def update_task(self, task_id: int, **kwargs: int) -> None:
        self.updates.append({"task_id": task_id, **kwargs})


def test_analysis_progress_tracker_runtime_uses_memory_snapshot_only(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=3,
        error_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    fake_data_manager.get_analysis_status_summary = lambda: (_ for _ in ()).throw(
        AssertionError("运行态不该全量重算")
    )
    fake_data_manager.update_analysis_progress_snapshot = lambda snapshot: (
        _ for _ in ()
    ).throw(AssertionError("运行态不该单独写库"))

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=False)

    assert snapshot["time"] == pytest.approx(12.0)
    assert snapshot["line"] == 4
    assert snapshot["processed_line"] == 3
    assert snapshot["error_line"] == 1
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_emits_candidate_count_from_cache(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=2,
        total_output_tokens=6,
        total_input_tokens=3,
        total_tokens=9,
    )
    fake_data_manager.analysis_candidate_count = 5
    emitted: list[tuple[Base.Event, dict[str, object]]] = []

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=False)

    assert snapshot["analysis_candidate_count"] == 5
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_updates_bound_console_progress(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=3,
        error_line=1,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    progress = FakeConsoleProgress()

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    analysis.progress_tracker.bind_console_progress(progress, 7)
    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=False)

    assert progress.updates == [{"task_id": 7, "completed": 4, "total": 9}]
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_save_state_only_persists_runtime_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    persisted_snapshots: list[dict[str, object]] = []

    def fake_persist(snapshot: dict[str, object]) -> dict[str, object]:
        persisted_snapshots.append(dict(snapshot))
        fake_data_manager.analysis_extras = dict(snapshot)
        return dict(snapshot)

    fake_data_manager.update_analysis_progress_snapshot = fake_persist
    fake_data_manager.refresh_analysis_progress_snapshot_cache = lambda: (
        _ for _ in ()
    ).throw(AssertionError("普通持久化不该全量校准"))

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.persist_progress_snapshot(save_state=True)

    assert persisted_snapshots[0]["processed_line"] == 1
    assert persisted_snapshots[0]["error_line"] == 0
    assert persisted_snapshots[0]["line"] == 1
    assert snapshot["total_line"] == 9
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_force_sync_refreshes_cache_after_persist(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.extras = build_analysis_runtime_extras(
        total_line=9,
        processed_line=1,
        total_tokens=7,
        total_input_tokens=3,
        total_output_tokens=4,
    )
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    persisted_snapshots: list[dict[str, object]] = []

    def fake_persist(snapshot: dict[str, object]) -> dict[str, object]:
        persisted_snapshots.append(dict(snapshot))
        fake_data_manager.analysis_extras = dict(snapshot)
        return dict(snapshot)

    def fake_refresh() -> dict[str, object]:
        fake_data_manager.analysis_extras = {
            **fake_data_manager.analysis_extras,
            "total_line": 6,
            "processed_line": 2,
            "error_line": 1,
            "line": 3,
        }
        return dict(fake_data_manager.analysis_extras)

    fake_data_manager.update_analysis_progress_snapshot = fake_persist
    fake_data_manager.refresh_analysis_progress_snapshot_cache = fake_refresh

    monkeypatch.setattr(
        analysis_progress_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 112.0)
    monkeypatch.setattr(
        analysis,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )

    snapshot = analysis.progress_tracker.sync_progress_snapshot_after_commit(force=True)

    assert persisted_snapshots[0]["processed_line"] == 1
    assert persisted_snapshots[0]["line"] == 1
    assert snapshot["processed_line"] == 2
    assert snapshot["error_line"] == 1
    assert snapshot["line"] == 3
    assert emitted == [(Base.Event.ANALYSIS_PROGRESS, snapshot)]


def test_analysis_progress_tracker_clear_progress_dirty_state_records_persist_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis = Analysis()
    tracker = analysis.progress_tracker
    tracker.progress_dirty = True
    tracker.pending_progress_commit_count = 3
    monkeypatch.setattr(analysis_progress_module.time, "time", lambda: 123.0)

    tracker.clear_progress_dirty_state()

    assert tracker.progress_dirty is False
    assert tracker.pending_progress_commit_count == 0
    assert tracker.last_progress_persist_at == 123.0
