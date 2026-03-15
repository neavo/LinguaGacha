from __future__ import annotations

import contextlib
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.AnalysisService import AnalysisService
from module.Data.BatchService import BatchService
from module.Data.ProjectSession import ProjectSession
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


ANALYSIS_TIME = "2026-03-10T10:00:00"


def build_analysis_service() -> tuple[AnalysisService, ProjectSession]:
    session = ProjectSession()
    conn = SimpleNamespace(commit=MagicMock())
    session.db = SimpleNamespace(
        connection=MagicMock(return_value=contextlib.nullcontext(conn)),
        get_analysis_item_checkpoints=MagicMock(return_value=[]),
        upsert_analysis_item_checkpoints=MagicMock(),
        delete_analysis_item_checkpoints=MagicMock(return_value=0),
        get_analysis_task_observations=MagicMock(return_value=[]),
        insert_analysis_task_observations=MagicMock(return_value=0),
        clear_analysis_task_observations=MagicMock(),
        get_analysis_candidate_aggregates=MagicMock(return_value=[]),
        get_analysis_candidate_aggregates_by_srcs=MagicMock(return_value=[]),
        upsert_analysis_candidate_aggregates=MagicMock(),
        upsert_meta_entries=MagicMock(),
        clear_analysis_candidate_aggregates=MagicMock(),
    )
    session.lg_path = "demo/project.lg"

    meta: dict[str, Any] = {}
    batch_service = BatchService(session)
    batch_service.update_batch = MagicMock()
    service = AnalysisService(
        session,
        batch_service,
        lambda key, default=None: meta.get(key, default),
        lambda key, value: meta.__setitem__(key, value),
        lambda: [],
        lambda: [],
        lambda: [],
        lambda incoming, **kwargs: (
            incoming,
            QualityRuleMerger.Report(1, 0, 0, 0, 0, ()),
        ),
        lambda: ((), ()),
        lambda: {},
        lambda **kwargs: None,
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
    session.db.insert_analysis_task_observations = MagicMock(return_value=1)

    inserted = service.commit_analysis_task_result(
        task_fingerprint="task-1",
        checkpoints=[
            {
                "item_id": 1,
                "source_hash": "hash-1",
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
        progress_snapshot={"processed_line": 1, "line": 1, "added_glossary": 2},
    )

    assert inserted == 1
    session.db.upsert_analysis_item_checkpoints.assert_called_once()
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
    session.db.upsert_meta_entries.assert_called_once()


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


def test_merge_analysis_term_votes_merges_counts() -> None:
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

    merged = service.merge_analysis_term_votes(
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


def test_clear_analysis_progress_clears_tables_and_meta() -> None:
    service, session = build_analysis_service()

    service.clear_analysis_progress()

    session.db.delete_analysis_item_checkpoints.assert_called_once()
    session.db.clear_analysis_task_observations.assert_called_once()
    session.db.clear_analysis_candidate_aggregates.assert_called_once()


def test_import_analysis_candidates_returns_zero_when_no_candidate() -> None:
    service, _session = build_analysis_service()
    service.build_analysis_glossary_from_candidates = MagicMock(return_value=[])

    assert service.import_analysis_candidates() == 0
