from __future__ import annotations

import time

import pytest

from base.Base import Base
from module.Data.Core.Item import Item
from module.Engine.Analysis.Analysis import Analysis
from module.Engine.Analysis.AnalysisModels import AnalysisItemContext

from tests.module.engine.analysis.support import analysis_scheduler_module


def build_item(item_id: int, src: str, file_path: str = "story.txt") -> Item:
    return Item(id=item_id, src=src, file_path=file_path)


def test_analysis_scheduler_build_initial_contexts_uses_shared_file_boundaries() -> (
    None
):
    items = [
        AnalysisItemContext(item_id=1, file_path="a.txt", src_text="a1"),
        AnalysisItemContext(item_id=2, file_path="a.txt", src_text="a2"),
        AnalysisItemContext(
            item_id=3,
            file_path="b.txt",
            src_text="b1",
            previous_status=Base.ProjectStatus.ERROR,
        ),
    ]
    analysis = Analysis()

    contexts = analysis.scheduler.build_initial_analysis_contexts(
        items,
        input_token_threshold=1000,
    )

    assert [context.file_path for context in contexts] == ["a.txt", "b.txt"]
    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1, 2],
        [3],
    ]
    assert contexts[1].items[0].previous_status == Base.ProjectStatus.ERROR


def test_analysis_scheduler_build_initial_contexts_returns_empty_for_empty_input() -> (
    None
):
    analysis = Analysis()
    assert (
        analysis.scheduler.build_initial_analysis_contexts(
            [],
            input_token_threshold=1000,
        )
        == []
    )


def test_analysis_scheduler_build_initial_contexts_skips_invalid_and_orphan_seed_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items = [
        AnalysisItemContext(item_id=1, file_path="a.txt", src_text="a1"),
    ]
    invalid_id_item = Item(id="bad-id", src="bad", file_path="a.txt")
    orphan_item = Item(id=999, src="orphan", file_path="a.txt")
    valid_item = Item(id=1, src="a1", file_path="a.txt")
    analysis = Analysis()

    monkeypatch.setattr(
        analysis_scheduler_module.TaskScheduler,
        "generate_item_chunks_iter",
        classmethod(
            lambda cls, **kwargs: iter(
                [
                    ([invalid_id_item, orphan_item], []),
                    ([valid_item, orphan_item], []),
                ]
            )
        ),
    )

    contexts = analysis.scheduler.build_initial_analysis_contexts(
        items,
        input_token_threshold=1000,
    )

    assert len(contexts) == 1
    assert contexts[0].file_path == "a.txt"
    assert [item.item_id for item in contexts[0].items] == [1]


def test_analysis_scheduler_build_progress_snapshot_counts_current_status_and_reuses_progress(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    fake_data_manager.items = [
        build_item(1, "A"),
        build_item(2, "B"),
        build_item(3, "C"),
    ]
    fake_data_manager.analysis_item_checkpoints = {
        1: {"status": Base.ProjectStatus.PROCESSED},
        2: {"status": Base.ProjectStatus.ERROR},
    }

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    snapshot = analysis.scheduler.build_progress_snapshot(
        previous_extras={
            "time": 12.0,
            "total_tokens": 13,
            "total_input_tokens": 5,
            "total_output_tokens": 8,
        },
        continue_mode=True,
    )

    assert snapshot.total_line == 3
    assert snapshot.line == 2
    assert snapshot.processed_line == 1
    assert snapshot.error_line == 1
    assert snapshot.time == 12.0
    assert snapshot.total_tokens == 13
    assert snapshot.total_input_tokens == 5
    assert snapshot.total_output_tokens == 8
    assert float(snapshot.start_time) <= time.time()


def test_analysis_scheduler_build_task_contexts_continue_only_schedules_none_items(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    done_item = build_item(1, "done")
    error_item = build_item(3, "error", file_path="scene.txt")
    pending_item = build_item(4, "pending", file_path="scene.txt")
    fake_data_manager.items = [done_item, error_item, pending_item]
    fake_data_manager.analysis_item_checkpoints = {
        1: {"status": Base.ProjectStatus.PROCESSED},
        3: {"status": Base.ProjectStatus.ERROR},
    }

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [context.file_path for context in contexts] == ["scene.txt"]
    assert [item.item_id for item in contexts[0].items] == [4]


def test_analysis_scheduler_build_task_contexts_splits_when_file_changes(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    fake_data_manager.items = [
        build_item(1, "a1", file_path="a.txt"),
        build_item(2, "a2", file_path="a.txt"),
        build_item(3, "b1", file_path="b.txt"),
    ]

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [context.file_path for context in contexts] == ["a.txt", "b.txt"]
    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1, 2],
        [3],
    ]


def test_analysis_scheduler_build_task_contexts_uses_shared_line_limit(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analysis = Analysis()
    analysis.model = {"threshold": {"input_token_limit": 16}}
    fake_data_manager.items = [
        build_item(1, "\n".join([f"line-{i}" for i in range(8)])),
        build_item(2, "line-9"),
    ]

    monkeypatch.setattr(
        analysis_scheduler_module.DataManager,
        "get",
        lambda: fake_data_manager,
    )

    contexts = analysis.scheduler.build_analysis_task_contexts(analysis.config)

    assert [[item.item_id for item in context.items] for context in contexts] == [
        [1],
        [2],
    ]
