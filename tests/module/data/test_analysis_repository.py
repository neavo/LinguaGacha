from __future__ import annotations

import pytest

from base.Base import Base
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Analysis.AnalysisRepository import AnalysisRepository
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Storage.LGDatabase import LGDatabase


@pytest.fixture
def repository_env(
    project_session: ProjectSession,
) -> tuple[AnalysisRepository, ProjectSession, LGDatabase]:
    db = LGDatabase(":memory:")
    db.open()
    project_session.db = db
    project_session.lg_path = "demo/project.lg"

    repository = AnalysisRepository(
        project_session,
        AnalysisCandidateService(),
        AnalysisProgressService(),
    )
    try:
        yield repository, project_session, db
    finally:
        db.close()


def test_persist_progress_snapshot_with_db_syncs_session_cache_and_meta(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, session, db = repository_env
    snapshot = {"processed_line": 2, "line": 3}

    with db.connection() as conn:
        persisted = repository.persist_progress_snapshot_with_db(
            db,
            conn,
            snapshot,
        )
        conn.commit()

    assert persisted == snapshot
    assert session.meta_cache["analysis_extras"] == snapshot
    assert db.get_meta("analysis_extras") == snapshot


def test_upsert_item_checkpoints_roundtrip_filters_invalid_rows(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, _session, _db = repository_env

    latest = repository.upsert_item_checkpoints(
        [
            {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": "2026-03-10T10:01:00",
                "error_count": 2,
            },
            {
                "item_id": 3,
                "status": Base.ProjectStatus.PROCESSING.value,
                "updated_at": "2026-03-10T10:02:00",
                "error_count": 9,
            },
        ]
    )

    assert latest == {
        1: {
            "item_id": 1,
            "status": Base.ProjectStatus.PROCESSED,
            "updated_at": "2026-03-10T10:00:00",
            "error_count": 0,
        },
        2: {
            "item_id": 2,
            "status": Base.ProjectStatus.ERROR,
            "updated_at": "2026-03-10T10:01:00",
            "error_count": 2,
        },
    }
    assert repository.get_item_checkpoints() == latest


def test_upsert_candidate_aggregate_roundtrip_normalizes_invalid_entries(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, _session, _db = repository_env

    latest = repository.upsert_candidate_aggregate(
        {
            " Alice ": {
                "dst_votes": {"爱丽丝": 2, "坏票": 0},
                "info_votes": {"女性人名": 1},
                "observation_count": 2,
                "first_seen_at": "2026-03-09T10:00:00",
                "last_seen_at": "2026-03-10T10:00:00",
                "case_sensitive": False,
            },
            "Bad": {"dst_votes": {}},
        }
    )

    assert latest == {
        "Alice": {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 2},
            "info_votes": {"女性人名": 1},
            "observation_count": 2,
            "first_seen_at": "2026-03-09T10:00:00",
            "last_seen_at": "2026-03-10T10:00:00",
            "case_sensitive": False,
            "first_seen_index": 0,
        }
    }


def test_commit_task_batch_persists_candidates_checkpoints_and_snapshot(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, session, db = repository_env

    inserted = repository.commit_task_batch(
        success_checkpoints=[
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
            },
            {
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "女性人名",
                "case_sensitive": False,
            },
            {
                "src": " ",
                "dst": "坏数据",
            },
        ],
        error_checkpoints=[],
        progress_snapshot={"processed_line": 1, "line": 1},
    )
    aggregate = repository.get_candidate_aggregate()

    assert inserted == 1
    assert (
        repository.get_item_checkpoints()[1]["status"] == Base.ProjectStatus.PROCESSED
    )
    assert aggregate == {
        "Alice": {
            "src": "Alice",
            "dst_votes": {"爱丽丝": 1},
            "info_votes": {"女性人名": 1},
            "observation_count": 1,
            "first_seen_at": aggregate["Alice"]["first_seen_at"],
            "last_seen_at": aggregate["Alice"]["last_seen_at"],
            "case_sensitive": False,
            "first_seen_index": 0,
        }
    }
    assert db.get_meta("analysis_extras") == {"processed_line": 1, "line": 1}
    assert session.meta_cache["analysis_extras"] == {"processed_line": 1, "line": 1}


def test_update_task_error_increments_existing_error_checkpoint_and_snapshot(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, _session, db = repository_env
    repository.upsert_item_checkpoints(
        [
            {
                "item_id": 3,
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": "2026-03-09T10:00:00",
                "error_count": 1,
            }
        ]
    )

    latest = repository.update_task_error(
        [{"item_id": 3}, {"item_id": "bad"}],
        progress_snapshot={"line": 1, "error_line": 1},
    )

    assert latest[3]["status"] == Base.ProjectStatus.ERROR
    assert latest[3]["error_count"] == 2
    assert db.get_meta("analysis_extras") == {"line": 1, "error_line": 1}


def test_clear_progress_clears_snapshot_checkpoints_and_candidate_pool(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, session, db = repository_env
    repository.commit_task_batch(
        success_checkpoints=[
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
        error_checkpoints=[],
        progress_snapshot={"processed_line": 1, "line": 1},
    )

    repository.clear_progress()

    assert repository.get_item_checkpoints() == {}
    assert repository.get_candidate_aggregate() == {}
    assert db.get_meta("analysis_extras") == {}
    assert session.meta_cache["analysis_extras"] == {}


def test_reset_failed_checkpoints_only_deletes_error_rows(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, _session, _db = repository_env
    repository.upsert_item_checkpoints(
        [
            {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": "2026-03-10T10:01:00",
                "error_count": 1,
            },
        ]
    )

    deleted = repository.reset_failed_checkpoints()

    assert deleted == 1
    assert repository.get_item_checkpoints() == {
        1: {
            "item_id": 1,
            "status": Base.ProjectStatus.PROCESSED,
            "updated_at": "2026-03-10T10:00:00",
            "error_count": 0,
        }
    }


def test_getters_return_empty_when_project_not_loaded() -> None:
    session = ProjectSession()
    repository = AnalysisRepository(
        session,
        AnalysisCandidateService(),
        AnalysisProgressService(),
    )

    assert repository.get_item_checkpoints() == {}
    assert repository.get_candidate_aggregate() == {}
    assert (
        repository.upsert_item_checkpoints(
            [
                {
                    "item_id": 1,
                    "status": Base.ProjectStatus.ERROR.value,
                    "updated_at": "2026-03-10T10:00:00",
                    "error_count": 1,
                }
            ]
        )
        == {}
    )
    assert (
        repository.upsert_candidate_aggregate(
            {
                "Alice": {
                    "dst_votes": {"爱丽丝": 1},
                    "info_votes": {"女性人名": 1},
                    "observation_count": 1,
                    "first_seen_at": "2026-03-09T10:00:00",
                    "last_seen_at": "2026-03-10T10:00:00",
                    "case_sensitive": False,
                }
            }
        )
        == {}
    )
    assert (
        repository.commit_task_batch(
            success_checkpoints=[],
            error_checkpoints=[],
            glossary_entries=[],
            progress_snapshot=None,
        )
        == 0
    )
    assert repository.reset_failed_checkpoints() == 0
    assert repository.update_task_error([]) == {}


def test_update_task_error_persists_snapshot_even_when_no_valid_checkpoint_rows(
    repository_env: tuple[AnalysisRepository, ProjectSession, LGDatabase],
) -> None:
    repository, _session, db = repository_env

    latest = repository.update_task_error(
        [{"item_id": "bad"}],
        progress_snapshot={"line": 1},
    )

    assert latest == {}
    assert db.get_meta("analysis_extras") == {"line": 1}
