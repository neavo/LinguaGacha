from __future__ import annotations

import contextlib
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Analysis.AnalysisService import AnalysisService
from module.Data.Core.BatchService import BatchService
from module.Data.Core.ProjectSession import ProjectSession


ANALYSIS_TIME = "2026-03-10T10:00:00"


def build_analysis_service() -> tuple[AnalysisService, ProjectSession]:
    session = ProjectSession()
    conn = SimpleNamespace(commit=MagicMock())
    session.db = SimpleNamespace(
        connection=MagicMock(return_value=contextlib.nullcontext(conn)),
        get_analysis_item_checkpoints=MagicMock(return_value=[]),
        upsert_analysis_item_checkpoints=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(return_value=0),
        get_analysis_candidate_aggregates=MagicMock(return_value=[]),
        get_analysis_candidate_aggregates_by_srcs=MagicMock(return_value=[]),
        upsert_analysis_candidate_aggregates=MagicMock(),
        upsert_meta_entries=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
    )
    session.lg_path = "demo/project.lg"

    meta: dict[str, Any] = {}
    meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta.get(key, default)
        ),
        set_meta=MagicMock(side_effect=lambda key, value: meta.__setitem__(key, value)),
    )
    item_service = SimpleNamespace(
        get_all_items=MagicMock(return_value=[]),
        get_all_item_dicts=MagicMock(return_value=[]),
    )
    batch_service = BatchService(session)
    batch_service.update_batch = MagicMock()
    service = AnalysisService(
        session,
        batch_service,
        meta_service,
        item_service,
    )
    return service, session


def build_candidate_entry(
    *,
    src: str,
    dst_votes: dict[str, int],
    info_votes: dict[str, int],
    observation_count: int,
) -> dict[str, Any]:
    return {
        "src": src,
        "dst_votes": dst_votes,
        "info_votes": info_votes,
        "observation_count": observation_count,
        "first_seen_at": ANALYSIS_TIME,
        "last_seen_at": ANALYSIS_TIME,
        "case_sensitive": False,
    }


def test_get_analysis_candidate_aggregate_normalizes_invalid_entries() -> None:
    service, session = build_analysis_service()
    session.db.get_analysis_candidate_aggregates.return_value = [
        {
            "src": "HP",
            "dst_votes": {"生命值": 2, "": 0},
            "info_votes": {"属性": 1},
            "observation_count": 2,
            "first_seen_at": ANALYSIS_TIME,
            "last_seen_at": ANALYSIS_TIME,
            "case_sensitive": False,
        },
        {"src": "", "dst_votes": {"无效": 1}, "info_votes": {}},
    ]

    result = service.get_analysis_candidate_aggregate()

    assert result["HP"]["dst_votes"] == {"生命值": 2}


def test_commit_analysis_task_result_writes_checkpoints_and_aggregate() -> None:
    service, session = build_analysis_service()

    inserted = service.commit_analysis_task_result(
        checkpoints=[
            {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED,
                "updated_at": ANALYSIS_TIME,
                "error_count": 0,
            }
        ],
        glossary_entries=[
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": False,
            }
        ],
        progress_snapshot={"processed_line": 1, "line": 1},
    )

    assert inserted == 1
    session.db.upsert_analysis_item_checkpoints.assert_called_once()
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
    assert session.db.upsert_meta_entries.call_count == 2
    assert session.meta_cache["analysis_candidate_count"] == 1


def test_commit_analysis_task_batch_writes_success_error_and_candidate_count() -> None:
    service, session = build_analysis_service()
    session.meta_cache["analysis_candidate_count"] = 1
    session.db.get_analysis_candidate_aggregates_by_srcs.return_value = [
        build_candidate_entry(
            src="Alice",
            dst_votes={"爱丽丝": 1},
            info_votes={"女性人名": 1},
            observation_count=1,
        )
    ]

    inserted = service.commit_analysis_task_batch(
        success_checkpoints=[
            {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED,
                "updated_at": ANALYSIS_TIME,
                "error_count": 0,
            }
        ],
        error_checkpoints=[
            {
                "item_id": 2,
                "status": Base.ProjectStatus.ERROR,
                "error_count": 0,
            }
        ],
        glossary_entries=[
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": False,
            },
            {
                "src": "Bob",
                "dst": "鲍勃",
                "info": "男性人名",
                "case_sensitive": False,
            },
        ],
    )

    assert inserted == 2
    session.db.upsert_analysis_item_checkpoints.assert_called()
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
    assert session.meta_cache["analysis_candidate_count"] == 2


def test_commit_analysis_task_batch_rebuilds_missing_candidate_count_cache() -> None:
    service, session = build_analysis_service()
    session.meta_cache.pop("analysis_candidate_count", None)
    session.db.get_analysis_candidate_aggregates.return_value = [
        build_candidate_entry(
            src="Alice",
            dst_votes={"爱丽丝": 1},
            info_votes={"女性人名": 1},
            observation_count=1,
        ),
        build_candidate_entry(
            src="Carol",
            dst_votes={"卡萝尔": 1},
            info_votes={"女性人名": 1},
            observation_count=1,
        ),
    ]
    session.db.get_analysis_candidate_aggregates_by_srcs.return_value = [
        build_candidate_entry(
            src="Alice",
            dst_votes={"爱丽丝": 1},
            info_votes={"女性人名": 1},
            observation_count=1,
        )
    ]

    inserted = service.commit_analysis_task_batch(
        success_checkpoints=[],
        error_checkpoints=[],
        glossary_entries=[
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": False,
            },
            {
                "src": "Bob",
                "dst": "鲍勃",
                "info": "男性人名",
                "case_sensitive": False,
            },
        ],
    )

    assert inserted == 2
    session.db.get_analysis_candidate_aggregates.assert_called_once()
    assert session.meta_cache["analysis_candidate_count"] == 3


def test_build_analysis_glossary_from_candidates_votes_and_filters() -> None:
    service, _session = build_analysis_service()
    service.get_analysis_candidate_aggregate = MagicMock(
        return_value={
            "Alice": build_candidate_entry(
                src="Alice",
                dst_votes={"爱丽丝": 2, "艾丽斯": 1},
                info_votes={"女性人名": 2},
                observation_count=2,
            ),
            "same": build_candidate_entry(
                src="same",
                dst_votes={"same": 1},
                info_votes={"属性": 1},
                observation_count=1,
            ),
        }
    )

    result = service.build_analysis_glossary_from_candidates()

    assert result == [
        {
            "src": "Alice",
            "dst": "爱丽丝",
            "info": "女性人名",
            "case_sensitive": False,
        }
    ]


def test_merge_analysis_candidate_aggregate_merges_counts() -> None:
    service, _session = build_analysis_service()
    service.get_analysis_candidate_aggregate = MagicMock(
        return_value={
            "HP": build_candidate_entry(
                src="HP",
                dst_votes={"生命值": 2},
                info_votes={"属性": 1},
                observation_count=2,
            )
        }
    )
    service.upsert_analysis_candidate_aggregate = MagicMock(
        side_effect=lambda pool: pool
    )

    merged = service.merge_analysis_candidate_aggregate(
        {
            "HP": build_candidate_entry(
                src="HP",
                dst_votes={"生命值": 1, "血量": 1},
                info_votes={"属性": 2},
                observation_count=2,
            )
        }
    )

    assert merged["HP"]["dst_votes"] == {"生命值": 3, "血量": 1}


def test_get_analysis_candidate_count_prefers_cached_meta() -> None:
    service, _session = build_analysis_service()
    service.meta_service.get_meta = MagicMock(return_value=5)
    service.build_analysis_glossary_from_candidates = MagicMock(
        side_effect=AssertionError("不该走全量重建")
    )

    assert service.get_analysis_candidate_count() == 5


def test_get_analysis_progress_snapshot_reads_cached_extras_only() -> None:
    service, _session = build_analysis_service()
    service.set_analysis_extras({"line": 5, "time": 2})
    service.get_analysis_status_summary = MagicMock(
        side_effect=AssertionError("读取缓存快照时不该全量重算")
    )

    assert service.get_analysis_progress_snapshot() == {
        "start_time": 0.0,
        "time": 2.0,
        "total_line": 0,
        "line": 5,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }


def test_refresh_analysis_progress_snapshot_cache_rebuilds_and_persists_summary() -> (
    None
):
    service, _session = build_analysis_service()
    service.set_analysis_extras(
        {
            "start_time": 10.0,
            "time": 3.0,
            "total_tokens": 8,
            "total_input_tokens": 3,
            "total_output_tokens": 5,
        }
    )
    service.item_service.get_all_items.return_value = [
        Item.from_dict(
            {
                "id": 1,
                "src": "Alice",
                "file_path": "story.txt",
                "status": Base.ProjectStatus.NONE,
            }
        ),
        Item.from_dict(
            {
                "id": 2,
                "src": "Bob",
                "file_path": "story.txt",
                "status": Base.ProjectStatus.NONE,
            }
        ),
        Item.from_dict(
            {
                "id": 3,
                "src": "",
                "file_path": "story.txt",
                "status": Base.ProjectStatus.NONE,
            }
        ),
        Item.from_dict(
            {
                "id": 4,
                "src": "skip",
                "file_path": "story.txt",
                "status": Base.ProjectStatus.EXCLUDED,
            }
        ),
    ]
    service.repository.get_item_checkpoints = MagicMock(
        return_value={
            1: {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED,
                "error_count": 0,
                "updated_at": ANALYSIS_TIME,
            },
            2: {
                "item_id": 2,
                "status": Base.ProjectStatus.ERROR,
                "error_count": 1,
                "updated_at": ANALYSIS_TIME,
            },
        }
    )

    snapshot = service.refresh_analysis_progress_snapshot_cache()

    assert snapshot["total_line"] == 2
    assert snapshot["processed_line"] == 1
    assert snapshot["error_line"] == 1
    assert snapshot["line"] == 2
    assert snapshot["total_tokens"] == 8
    assert service.get_analysis_extras() == snapshot


def test_clear_analysis_progress_clears_tables_and_meta() -> None:
    service, session = build_analysis_service()
    service.set_analysis_extras({"line": 9, "processed_line": 5})
    service.set_analysis_candidate_count_cache(7)

    service.clear_analysis_progress()

    session.db.delete_analysis_item_checkpoints.assert_called_once()
    session.db.clear_analysis_candidate_aggregates.assert_called_once()
    assert service.get_analysis_progress_snapshot() == {
        "start_time": 0.0,
        "time": 0.0,
        "total_line": 0,
        "line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }
    assert service.get_analysis_candidate_count_cache() == 0


def test_analysis_helpers_normalize_control_code_and_skipped_statuses() -> None:
    service, _session = build_analysis_service()

    assert service.is_skipped_analysis_status(Base.ProjectStatus.EXCLUDED) is True
    assert service.is_skipped_analysis_status(Base.ProjectStatus.PROCESSED) is False
    assert service.is_analysis_control_code_text(r" \n[7] ") is True
    assert service.is_analysis_control_code_text("前缀\\n[7]") is False
    assert service.is_analysis_control_code_self_mapping(r" \n[7] ", r"\n[7]") is True
    assert service.is_analysis_control_code_self_mapping(r"\n[7]", "名字") is False


def test_get_analysis_candidate_count_cache_normalizes_invalid_values() -> None:
    service, _session = build_analysis_service()
    service.meta_service.get_meta = MagicMock(side_effect=["-3", "bad-value", None])

    assert service.get_analysis_candidate_count_cache() == 0
    assert service.get_analysis_candidate_count_cache() is None
    assert service.get_analysis_candidate_count_cache() is None


def test_update_analysis_progress_snapshot_normalizes_and_persists_snapshot() -> None:
    service, _session = build_analysis_service()

    snapshot = service.update_analysis_progress_snapshot(
        {
            "start_time": "1.5",
            "time": "2.0",
            "line": "4",
            "processed_line": "3",
            "error_line": "1",
        }
    )

    assert snapshot == {
        "start_time": 1.5,
        "time": 2.0,
        "total_line": 0,
        "line": 4,
        "processed_line": 3,
        "error_line": 1,
        "total_tokens": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }
    service.meta_service.set_meta.assert_called_with("analysis_extras", snapshot)


def test_get_pending_analysis_items_returns_only_schedulable_items() -> None:
    service, _session = build_analysis_service()
    pending_item = Item.from_dict(
        {
            "id": 1,
            "src": "Alice",
            "file_path": "story.txt",
            "status": Base.ProjectStatus.NONE,
        }
    )
    processed_item = Item.from_dict(
        {
            "id": 2,
            "src": "Bob",
            "file_path": "story.txt",
            "status": Base.ProjectStatus.NONE,
        }
    )
    excluded_item = Item.from_dict(
        {
            "id": 3,
            "src": "skip",
            "file_path": "story.txt",
            "status": Base.ProjectStatus.EXCLUDED,
        }
    )
    empty_item = Item.from_dict(
        {
            "id": 4,
            "src": "",
            "file_path": "story.txt",
            "status": Base.ProjectStatus.NONE,
        }
    )
    service.item_service.get_all_items.return_value = [
        pending_item,
        processed_item,
        excluded_item,
        empty_item,
    ]
    service.repository.get_item_checkpoints = MagicMock(
        return_value={
            2: {
                "item_id": 2,
                "status": Base.ProjectStatus.PROCESSED,
                "updated_at": ANALYSIS_TIME,
                "error_count": 0,
            }
        }
    )

    result = service.get_pending_analysis_items()

    assert result == [pending_item]
