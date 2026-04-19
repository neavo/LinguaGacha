from __future__ import annotations

from api.Contract.ProofreadingPayloads import ProofreadingEntryPatchPayload
from api.Contract.ProofreadingPayloads import ProofreadingSnapshotPayload
from api.Contract.ProofreadingPayloads import build_mutation_result_payload
from api.Contract.ProofreadingPayloads import build_search_result_payload
from api.Models.Proofreading import ProofreadingFilterOptionsSnapshot
from api.Models.Proofreading import ProofreadingItemView
from api.Models.Proofreading import ProofreadingSummary


def test_proofreading_snapshot_payload_wraps_snapshot_fields() -> None:
    # Arrange
    snapshot_dict = {
        "revision": 7,
        "project_id": "demo/project.lg",
        "readonly": False,
        "summary": {
            "total_items": 2,
            "filtered_items": 1,
            "warning_items": 1,
        },
        "filters": {
            "warning_types": ["GLOSSARY"],
            "statuses": ["PROCESSED"],
            "file_paths": ["script/a.txt"],
            "glossary_terms": [["勇者", "Hero"]],
        },
        "items": [
            {
                "item_id": 1,
                "file_path": "script/a.txt",
                "row_number": 12,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "warnings": ["GLOSSARY"],
            }
        ],
    }

    # Act
    result = ProofreadingSnapshotPayload.from_dict(snapshot_dict).to_dict()

    # Assert
    assert result == {
        "snapshot": {
            "revision": 7,
            "project_id": "demo/project.lg",
            "readonly": False,
            "summary": {
                "total_items": 2,
                "filtered_items": 1,
                "warning_items": 1,
            },
            "filters": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["script/a.txt"],
                "glossary_terms": [["勇者", "Hero"]],
            },
            "items": [
                {
                    "item_id": 1,
                    "file_path": "script/a.txt",
                    "row_number": 12,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                    "applied_glossary_terms": [],
                    "failed_glossary_terms": [],
                }
            ],
        }
    }


def test_build_mutation_result_payload_wraps_summary_and_items() -> None:
    # Arrange
    item_dict = {
        "item_id": 1,
        "file_path": "script/a.txt",
        "row_number": 12,
        "src": "勇者が来た",
        "dst": "Hero arrived",
        "status": "PROCESSED",
        "warnings": ["GLOSSARY"],
        "failed_glossary_terms": [["勇者", "Hero"]],
    }

    # Act
    result = build_mutation_result_payload(
        revision=9,
        changed_item_ids=[1],
        items=[item_dict],
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )

    # Assert
    assert result == {
        "result": {
            "revision": 9,
            "changed_item_ids": [1],
            "items": [
                {
                    "item_id": 1,
                    "file_path": "script/a.txt",
                    "row_number": 12,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                    "applied_glossary_terms": [],
                    "failed_glossary_terms": [["勇者", "Hero"]],
                }
            ],
            "summary": {
                "total_items": 2,
                "filtered_items": 2,
                "warning_items": 1,
            },
        }
    }


def test_proofreading_entry_patch_payload_to_dict_keeps_dual_views() -> None:
    # Arrange
    payload = ProofreadingEntryPatchPayload(
        revision=11,
        project_id="demo/project.lg",
        readonly=False,
        target_item_ids=(1, 2),
        default_filters=ProofreadingFilterOptionsSnapshot.from_dict(
            {"file_paths": ["script/a.txt"]}
        ),
        applied_filters=ProofreadingFilterOptionsSnapshot.from_dict(
            {"warning_types": ["GLOSSARY"]}
        ),
        full_summary=ProofreadingSummary(
            total_items=2,
            filtered_items=2,
            warning_items=1,
        ),
        filtered_summary=ProofreadingSummary(
            total_items=2,
            filtered_items=1,
            warning_items=1,
        ),
        full_items=(
            ProofreadingItemView.from_dict(
                {
                    "item_id": 1,
                    "file_path": "script/a.txt",
                    "row_number": 12,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                }
            ),
        ),
        filtered_items=(
            ProofreadingItemView.from_dict(
                {
                    "item_id": 1,
                    "file_path": "script/a.txt",
                    "row_number": 12,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                }
            ),
        ),
    )

    # Act
    result = payload.to_dict()

    # Assert
    assert result == {
        "revision": 11,
        "project_id": "demo/project.lg",
        "readonly": False,
        "target_item_ids": [1, 2],
        "default_filters": {
            "warning_types": [],
            "statuses": [],
            "file_paths": ["script/a.txt"],
            "glossary_terms": [],
        },
        "applied_filters": {
            "warning_types": ["GLOSSARY"],
            "statuses": [],
            "file_paths": [],
            "glossary_terms": [],
        },
        "full_summary": {
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
        "filtered_summary": {
            "total_items": 2,
            "filtered_items": 1,
            "warning_items": 1,
        },
        "full_items": [
            {
                "item_id": 1,
                "file_path": "script/a.txt",
                "row_number": 12,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "warnings": [],
                "applied_glossary_terms": [],
                "failed_glossary_terms": [],
            }
        ],
        "filtered_items": [
            {
                "item_id": 1,
                "file_path": "script/a.txt",
                "row_number": 12,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "warnings": ["GLOSSARY"],
                "applied_glossary_terms": [],
                "failed_glossary_terms": [],
            }
        ],
    }


def test_build_search_result_payload_wraps_keyword_and_matches() -> None:
    # Act
    result = build_search_result_payload(
        keyword="勇者",
        is_regex=False,
        matched_item_ids=[1, 3],
    )

    # Assert
    assert result == {
        "search_result": {
            "keyword": "勇者",
            "is_regex": False,
            "matched_item_ids": [1, 3],
        }
    }
