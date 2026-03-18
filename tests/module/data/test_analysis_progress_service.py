from __future__ import annotations

from base.Base import Base
from model.Item import Item
from module.Data.Analysis.AnalysisProgressService import AnalysisProgressService


ANALYSIS_TIME = "2026-03-10T10:00:00"


def test_collect_pending_items_skips_done_failed_and_empty_source() -> None:
    service = AnalysisProgressService()
    done_item = Item(id=1, src="done")
    failed_item = Item(id=2, src="failed")
    pending_item = Item(id=3, src="pending")
    name_only_item = Item(id=4, src="", name_src="Alice")

    pending_items = service.collect_pending_items(
        [done_item, failed_item, pending_item, name_only_item],
        {
            1: {"status": Base.ProjectStatus.PROCESSED},
            2: {"status": Base.ProjectStatus.ERROR},
        },
    )

    assert [item.get_id() for item in pending_items] == [3]


def test_normalize_item_checkpoint_accepts_minimal_valid_payload() -> None:
    service = AnalysisProgressService()

    checkpoint = service.normalize_item_checkpoint(
        {
            "item_id": 9,
            "status": Base.ProjectStatus.PROCESSED.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 1,
        }
    )

    assert checkpoint == {
        "item_id": 9,
        "status": Base.ProjectStatus.PROCESSED,
        "updated_at": ANALYSIS_TIME,
        "error_count": 1,
    }


def test_build_error_checkpoint_rows_increments_existing_error_count() -> None:
    service = AnalysisProgressService()

    error_rows, latest = service.build_error_checkpoint_rows(
        [{"item_id": 7, "error_count": 0}],
        {
            7: {
                "item_id": 7,
                "status": Base.ProjectStatus.ERROR,
                "updated_at": "2026-03-09T10:00:00",
                "error_count": 2,
            }
        },
        updated_at=ANALYSIS_TIME,
    )

    assert error_rows == [
        {
            "item_id": 7,
            "status": Base.ProjectStatus.ERROR.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 3,
        }
    ]
    assert latest[7]["status"] == Base.ProjectStatus.ERROR
    assert latest[7]["error_count"] == 3


def test_build_status_summary_counts_only_valid_items() -> None:
    service = AnalysisProgressService()
    processed_item = Item(id=1, src="alpha")
    skipped_item = Item(id=2, src="beta", status=Base.ProjectStatus.EXCLUDED)
    empty_src_item = Item(id=3, src="   ")
    no_id_item = Item(src="gamma")
    pending_item = Item(id=4, src="delta")

    summary = service.build_status_summary(
        [processed_item, skipped_item, empty_src_item, no_id_item, pending_item],
        {
            1: {
                "item_id": 1,
                "status": Base.ProjectStatus.PROCESSED,
            },
            4: {
                "item_id": 4,
                "status": Base.ProjectStatus.ERROR,
            },
        },
        skipped_statuses=(Base.ProjectStatus.EXCLUDED,),
    )

    assert summary == {
        "total_line": 2,
        "processed_line": 1,
        "error_line": 1,
        "line": 2,
    }


def test_build_progress_snapshot_keeps_existing_time_and_token_fields() -> None:
    service = AnalysisProgressService()

    snapshot = service.build_progress_snapshot(
        {
            "start_time": 1.5,
            "time": 3.0,
            "processed_line": 99,
            "error_line": 88,
            "line": 77,
            "total_line": 66,
            "total_tokens": 12,
            "total_input_tokens": 7,
            "total_output_tokens": 5,
        },
        {
            "total_line": 4,
            "processed_line": 2,
            "error_line": 1,
            "line": 3,
        },
    )

    assert snapshot == {
        "start_time": 1.5,
        "time": 3.0,
        "total_line": 4,
        "line": 3,
        "processed_line": 2,
        "error_line": 1,
        "total_tokens": 12,
        "total_input_tokens": 7,
        "total_output_tokens": 5,
    }


def test_normalize_item_checkpoint_rejects_invalid_status_and_clamps_error_count() -> (
    None
):
    service = AnalysisProgressService()

    invalid_status = service.normalize_item_checkpoint(
        {
            "item_id": 1,
            "status": Base.ProjectStatus.PROCESSING.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 2,
        }
    )
    normalized = service.normalize_item_checkpoint(
        {
            "item_id": 2,
            "status": Base.ProjectStatus.ERROR,
            "updated_at": " ",
            "error_count": -5,
        }
    )

    assert invalid_status is None
    assert normalized is not None
    assert normalized["item_id"] == 2
    assert normalized["status"] == Base.ProjectStatus.ERROR
    assert normalized["error_count"] == 0
    assert isinstance(normalized["updated_at"], str)
    assert normalized["updated_at"] != ""


def test_normalize_item_checkpoint_upsert_rows_keeps_only_valid_trackable_rows() -> (
    None
):
    service = AnalysisProgressService()

    rows = service.normalize_item_checkpoint_upsert_rows(
        [
            {
                "item_id": 1,
                "status": Base.ProjectStatus.NONE.value,
                "updated_at": ANALYSIS_TIME,
                "error_count": 0,
            },
            {
                "item_id": 2,
                "status": Base.ProjectStatus.PROCESSED.value,
                "updated_at": ANALYSIS_TIME,
                "error_count": 1,
            },
            {
                "item_id": 3,
                "status": Base.ProjectStatus.PROCESSING.value,
                "updated_at": ANALYSIS_TIME,
                "error_count": 9,
            },
            {
                "item_id": 0,
                "status": Base.ProjectStatus.ERROR.value,
                "updated_at": ANALYSIS_TIME,
                "error_count": 1,
            },
        ]
    )

    assert rows == [
        {
            "item_id": 1,
            "status": Base.ProjectStatus.NONE.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 0,
        },
        {
            "item_id": 2,
            "status": Base.ProjectStatus.PROCESSED.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 1,
        },
    ]


def test_build_error_checkpoint_rows_starts_new_error_and_ignores_invalid_rows() -> (
    None
):
    service = AnalysisProgressService()

    error_rows, latest = service.build_error_checkpoint_rows(
        [{"item_id": 8}, {"item_id": "bad"}],
        existing={},
        updated_at=ANALYSIS_TIME,
    )

    assert error_rows == [
        {
            "item_id": 8,
            "status": Base.ProjectStatus.ERROR.value,
            "updated_at": ANALYSIS_TIME,
            "error_count": 1,
        }
    ]
    assert latest == {
        8: {
            "item_id": 8,
            "status": Base.ProjectStatus.ERROR,
            "updated_at": ANALYSIS_TIME,
            "error_count": 1,
        }
    }
