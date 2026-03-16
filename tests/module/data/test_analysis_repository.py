from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Analysis.AnalysisRepository import AnalysisRepository
from module.Data.Core.ProjectSession import ProjectSession


def build_repository() -> tuple[AnalysisRepository, ProjectSession]:
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
    return (
        AnalysisRepository(
            session,
            AnalysisCandidateService(),
            AnalysisProgressService(),
        ),
        session,
    )


def test_persist_progress_snapshot_with_db_syncs_session_cache() -> None:
    repository, session = build_repository()

    persisted = repository.persist_progress_snapshot_with_db(
        session.db,
        SimpleNamespace(),
        {"processed_line": 2, "line": 3},
    )

    assert persisted == {"processed_line": 2, "line": 3}
    assert session.meta_cache["analysis_extras"] == {"processed_line": 2, "line": 3}
    session.db.upsert_meta_entries.assert_called_once()


def test_commit_task_result_merges_touched_candidates_and_checkpoints() -> None:
    repository, session = build_repository()
    session.db.get_analysis_candidate_aggregates_by_srcs.return_value = [
        {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 1},
            "info_votes": {"女性人名": 1},
            "observation_count": 1,
            "first_seen_at": "2026-03-09T10:00:00",
            "last_seen_at": "2026-03-09T10:00:00",
            "case_sensitive": False,
        }
    ]

    inserted = repository.commit_task_result(
        checkpoints=[
            {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
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
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
    session.db.upsert_analysis_item_checkpoints.assert_called_once()
    session.db.upsert_meta_entries.assert_called_once()


def test_update_task_error_retries_existing_failed_item() -> None:
    repository, session = build_repository()
    session.db.get_analysis_item_checkpoints.return_value = [
        {
            "item_id": 3,
            "status": Base.ProjectStatus.ERROR.value,
            "updated_at": "2026-03-09T10:00:00",
            "error_count": 1,
        }
    ]

    latest = repository.update_task_error(
        [{"item_id": 3}],
        progress_snapshot={"line": 1},
    )

    assert latest[3]["status"] == Base.ProjectStatus.ERROR
    assert latest[3]["error_count"] == 2
    session.db.upsert_analysis_item_checkpoints.assert_called_once()
    session.db.upsert_meta_entries.assert_called_once()


def test_get_item_checkpoints_returns_empty_when_project_not_loaded() -> None:
    repository, session = build_repository()
    session.db = None

    assert repository.get_item_checkpoints() == {}


def test_upsert_candidate_aggregate_normalizes_entries_and_returns_latest_snapshot() -> (
    None
):
    repository, session = build_repository()
    session.db.get_analysis_candidate_aggregates.return_value = [
        {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 2},
            "info_votes": {"女性人名": 1},
            "observation_count": 2,
            "first_seen_at": "2026-03-09T10:00:00",
            "last_seen_at": "2026-03-10T10:00:00",
            "case_sensitive": False,
        }
    ]

    latest = repository.upsert_candidate_aggregate(
        {
            " Alice ": {
                "dst_votes": {"爱丽丝": 2},
                "info_votes": {"女性人名": 1},
                "observation_count": 2,
                "first_seen_at": "2026-03-09T10:00:00",
                "last_seen_at": "2026-03-10T10:00:00",
                "case_sensitive": False,
            },
            " ": {"dst_votes": {"坏数据": 1}},
        }
    )

    assert latest["Alice"]["dst_votes"] == {"爱丽丝": 2}
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
