from __future__ import annotations

import pytest

from base.Base import Base
from module.Data.Analysis.AnalysisCandidateService import AnalysisCandidateService
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService
from module.Data.Analysis.AnalysisRepository import AnalysisRepository
from module.Data.Core.ProjectSession import ProjectSession


class FakeDatabaseTransaction:
    def commit(self) -> None:
        return


class FakeAnalysisDatabaseGateway:
    # AnalysisRepository 单测只关心 gateway 契约，不启动真实 TS 服务。

    def __init__(self) -> None:
        self.meta: dict[str, object] = {}
        self.checkpoints: dict[int, dict[str, object]] = {}
        self.aggregates: dict[str, dict[str, object]] = {}

    def open(self) -> None:
        return

    def close(self) -> None:
        return

    def connection(self):
        class TransactionContext:
            def __enter__(self) -> FakeDatabaseTransaction:
                return FakeDatabaseTransaction()

            def __exit__(self, exc_type, exc, tb) -> None:
                del exc_type, exc, tb

        return TransactionContext()

    def get_meta(self, key: str, default: object = None) -> object:
        return self.meta.get(key, default)

    def upsert_meta_entries(
        self,
        meta: dict[str, object],
        conn: FakeDatabaseTransaction | None = None,
    ) -> None:
        del conn
        self.meta.update(meta)

    def get_analysis_item_checkpoints(
        self,
        conn: FakeDatabaseTransaction | None = None,
    ) -> list[dict[str, object]]:
        del conn
        return [
            dict(row)
            for _item_id, row in sorted(
                self.checkpoints.items(), key=lambda item: item[0]
            )
        ]

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, object]],
        conn: FakeDatabaseTransaction | None = None,
    ) -> None:
        del conn
        for checkpoint in checkpoints:
            item_id = int(checkpoint["item_id"])
            self.checkpoints[item_id] = dict(checkpoint)

    def delete_analysis_item_checkpoints(
        self,
        *,
        status: str | None = None,
        conn: FakeDatabaseTransaction | None = None,
    ) -> int:
        del conn
        target_ids = [
            item_id
            for item_id, checkpoint in self.checkpoints.items()
            if status is None or checkpoint.get("status") == status
        ]
        for item_id in target_ids:
            self.checkpoints.pop(item_id, None)
        return len(target_ids)

    def get_analysis_candidate_aggregates(
        self,
        conn: FakeDatabaseTransaction | None = None,
    ) -> list[dict[str, object]]:
        del conn
        return [dict(row) for _src, row in sorted(self.aggregates.items())]

    def get_analysis_candidate_aggregates_by_srcs(
        self,
        srcs: list[str],
        conn: FakeDatabaseTransaction | None = None,
    ) -> list[dict[str, object]]:
        del conn
        return [
            dict(self.aggregates[src]) for src in sorted(srcs) if src in self.aggregates
        ]

    def upsert_analysis_candidate_aggregates(
        self,
        aggregates: list[dict[str, object]],
        conn: FakeDatabaseTransaction | None = None,
    ) -> None:
        del conn
        for aggregate in aggregates:
            src = str(aggregate["src"])
            self.aggregates[src] = dict(aggregate)

    def clear_analysis_candidate_aggregates(
        self,
        conn: FakeDatabaseTransaction | None = None,
    ) -> None:
        del conn
        self.aggregates.clear()


@pytest.fixture
def repository_env(
    project_session: ProjectSession,
) -> tuple[AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway]:
    db = FakeAnalysisDatabaseGateway()
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
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
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
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, _session, _db = repository_env

    latest = repository.upsert_item_checkpoints(
        [
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ItemStatus.ERROR.value,
                "updated_at": "2026-03-10T10:01:00",
                "error_count": 2,
            },
            {
                "item_id": 3,
                "status": "PROCESSING",
                "updated_at": "2026-03-10T10:02:00",
                "error_count": 9,
            },
        ]
    )

    assert latest == {
        1: {
            "item_id": 1,
            "status": Base.ItemStatus.PROCESSED,
            "updated_at": "2026-03-10T10:00:00",
            "error_count": 0,
        },
        2: {
            "item_id": 2,
            "status": Base.ItemStatus.ERROR,
            "updated_at": "2026-03-10T10:01:00",
            "error_count": 2,
        },
    }
    assert repository.get_item_checkpoints() == latest


def test_upsert_candidate_aggregate_roundtrip_normalizes_invalid_entries(
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
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
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, session, db = repository_env

    inserted = repository.commit_task_batch(
        success_checkpoints=[
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
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
    assert repository.get_item_checkpoints()[1]["status"] == Base.ItemStatus.PROCESSED
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
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, _session, db = repository_env
    repository.upsert_item_checkpoints(
        [
            {
                "item_id": 3,
                "status": Base.ItemStatus.ERROR.value,
                "updated_at": "2026-03-09T10:00:00",
                "error_count": 1,
            }
        ]
    )

    latest = repository.update_task_error(
        [{"item_id": 3}, {"item_id": "bad"}],
        progress_snapshot={"line": 1, "error_line": 1},
    )

    assert latest[3]["status"] == Base.ItemStatus.ERROR
    assert latest[3]["error_count"] == 2
    assert db.get_meta("analysis_extras") == {"line": 1, "error_line": 1}


def test_clear_progress_clears_snapshot_checkpoints_and_candidate_pool(
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, session, db = repository_env
    repository.commit_task_batch(
        success_checkpoints=[
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
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


def test_clear_progress_with_snapshot_persists_given_snapshot_and_resets_candidate_count(
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, session, db = repository_env
    repository.commit_task_batch(
        success_checkpoints=[
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
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

    snapshot = repository.clear_progress_with_snapshot(
        {
            "start_time": 0.0,
            "time": 0.0,
            "total_line": 5,
            "line": 0,
            "processed_line": 0,
            "error_line": 0,
        }
    )

    assert repository.get_item_checkpoints() == {}
    assert repository.get_candidate_aggregate() == {}
    assert snapshot == {
        "start_time": 0.0,
        "time": 0.0,
        "total_line": 5,
        "line": 0,
        "processed_line": 0,
        "error_line": 0,
    }
    assert db.get_meta("analysis_candidate_count") == 0
    assert session.meta_cache["analysis_candidate_count"] == 0


def test_reset_failed_checkpoints_only_deletes_error_rows(
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, _session, _db = repository_env
    repository.upsert_item_checkpoints(
        [
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ItemStatus.ERROR.value,
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
            "status": Base.ItemStatus.PROCESSED,
            "updated_at": "2026-03-10T10:00:00",
            "error_count": 0,
        }
    }


def test_reset_failed_checkpoints_with_snapshot_keeps_success_rows_and_updates_snapshot(
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, session, db = repository_env
    repository.upsert_item_checkpoints(
        [
            {
                "item_id": 1,
                "status": Base.ItemStatus.PROCESSED.value,
                "updated_at": "2026-03-10T10:00:00",
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ItemStatus.ERROR.value,
                "updated_at": "2026-03-10T10:01:00",
                "error_count": 1,
            },
        ]
    )

    deleted, snapshot = repository.reset_failed_checkpoints_with_snapshot(
        {
            "start_time": 4.0,
            "time": 6.0,
            "total_line": 5,
            "line": 3,
            "processed_line": 3,
            "error_line": 0,
        }
    )

    assert deleted == 1
    assert repository.get_item_checkpoints() == {
        1: {
            "item_id": 1,
            "status": Base.ItemStatus.PROCESSED,
            "updated_at": "2026-03-10T10:00:00",
            "error_count": 0,
        }
    }
    assert snapshot == {
        "start_time": 4.0,
        "time": 6.0,
        "total_line": 5,
        "line": 3,
        "processed_line": 3,
        "error_line": 0,
    }
    assert db.get_meta("analysis_extras") == snapshot
    assert session.meta_cache["analysis_extras"] == snapshot


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
                    "status": Base.ItemStatus.ERROR.value,
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
    repository_env: tuple[
        AnalysisRepository, ProjectSession, FakeAnalysisDatabaseGateway
    ],
) -> None:
    repository, _session, db = repository_env

    latest = repository.update_task_error(
        [{"item_id": "bad"}],
        progress_snapshot={"line": 1},
    )

    assert latest == {}
    assert db.get_meta("analysis_extras") == {"line": 1}
