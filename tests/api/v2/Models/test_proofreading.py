from api.v2.Models.Proofreading import ProofreadingItemView
from api.v2.Models.Proofreading import ProofreadingMutationResult
from api.v2.Models.Proofreading import ProofreadingSummary
from api.v2.Models.Proofreading import ProofreadingWarningSummary


def test_proofreading_summary_from_dict_keeps_all_stable_totals() -> None:
    summary = ProofreadingSummary.from_dict(
        {
            "total_items": 9,
            "filtered_items": 7,
            "warning_items": 3,
        }
    )

    assert summary.total_items == 9
    assert summary.filtered_items == 7
    assert summary.warning_items == 3


def test_proofreading_item_view_from_dict_keeps_item_id_and_row_number() -> None:
    item = ProofreadingItemView.from_dict(
        {
            "item_id": 123,
            "file_path": "chapter-1.txt",
            "row_number": 12,
            "src": "原文",
            "dst": "译文",
            "status": "PROCESSED",
            "warnings": ["GLOSSARY"],
            "failed_glossary_terms": [["HP", "生命值"]],
        }
    )

    assert item.item_id == 123
    assert item.file_path == "chapter-1.txt"
    assert item.row_number == 12
    assert item.failed_glossary_terms == (("HP", "生命值"),)


def test_proofreading_item_view_supports_alias_fields_and_term_dicts() -> None:
    item = ProofreadingItemView.from_dict(
        {
            "id": "item-1",
            "row": 7,
            "warning_types": ["GLOSSARY"],
            "applied_glossary_terms": [{"src": "勇者", "dst": "Hero"}],
            "failed_glossary_terms": [{"src": "HP", "dst": "生命值"}],
        }
    )

    assert item.item_id == "item-1"
    assert item.row_number == 7
    assert item.warnings == ("GLOSSARY",)
    assert item.applied_glossary_terms == (("勇者", "Hero"),)


def test_proofreading_mutation_result_round_trip_keeps_items_and_summary() -> None:
    result = ProofreadingMutationResult.from_dict(
        {
            "revision": 21,
            "changed_item_ids": ["item-1", "item-2"],
            "items": [
                {
                    "item_id": "item-1",
                    "file_path": "chapter-1.txt",
                    "row_number": 12,
                    "src": "原文",
                    "dst": "译文",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                }
            ],
            "summary": {
                "total_items": 12,
                "filtered_items": 10,
                "warning_items": 1,
            },
        }
    )

    payload = result.to_dict()

    assert payload["revision"] == 21
    assert payload["changed_item_ids"] == ["item-1", "item-2"]
    assert payload["items"][0]["item_id"] == "item-1"
    assert payload["summary"]["warning_items"] == 1


def test_proofreading_warning_summary_round_trip_keeps_stable_fields() -> None:
    summary = ProofreadingWarningSummary.from_dict(
        {
            "warning_type": "GLOSSARY",
            "count": 4,
        }
    )

    assert summary.warning_type == "GLOSSARY"
    assert summary.count == 4
    assert summary.to_dict() == {
        "warning_type": "GLOSSARY",
        "count": 4,
    }


def test_proofreading_models_use_safe_defaults_for_invalid_payloads() -> None:
    warning_summary = ProofreadingWarningSummary.from_dict(None)
    summary = ProofreadingSummary.from_dict(None)
    item = ProofreadingItemView.from_dict(None)
    mutation_result = ProofreadingMutationResult.from_dict(None)

    assert warning_summary.to_dict() == {
        "warning_type": "",
        "count": 0,
    }
    assert summary.to_dict() == {
        "total_items": 0,
        "filtered_items": 0,
        "warning_items": 0,
    }
    assert item.to_dict()["item_id"] == 0
    assert mutation_result.to_dict() == {
        "revision": 0,
        "changed_item_ids": [],
        "items": [],
        "summary": {
            "total_items": 0,
            "filtered_items": 0,
            "warning_items": 0,
        },
    }
