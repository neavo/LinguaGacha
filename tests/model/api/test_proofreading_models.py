from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingItemView
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Api.ProofreadingModels import ProofreadingSummary
import pytest


def test_proofreading_filter_options_snapshot_from_dict_normalizes_collections() -> (
    None
):
    options = ProofreadingFilterOptionsSnapshot.from_dict(
        {
            "warning_types": ["GLOSSARY"],
            "statuses": ["NONE", "PROCESSED"],
            "file_paths": ["chapter-1.txt"],
            "glossary_terms": [["HP", "生命值"]],
        }
    )

    assert options.warning_types == ("GLOSSARY",)
    assert options.statuses == ("NONE", "PROCESSED")
    assert options.file_paths == ("chapter-1.txt",)
    assert options.glossary_terms == (("HP", "生命值"),)


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
    assert item.src == "原文"
    assert item.dst == "译文"
    assert item.status == "PROCESSED"
    assert item.warnings == ("GLOSSARY",)
    assert item.failed_glossary_terms == (("HP", "生命值"),)


def test_proofreading_snapshot_from_dict_keeps_filters_and_items_contract() -> None:
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "revision": 18,
            "project_id": "current",
            "readonly": False,
            "summary": {
                "total_items": 320,
                "filtered_items": 320,
                "warning_items": 54,
            },
            "filters": {
                "warning_types": ["GLOSSARY", "NO_WARNING"],
                "statuses": ["NONE", "PROCESSED", "ERROR"],
                "file_paths": ["script/a.txt"],
                "glossary_terms": [["勇者", "Hero"]],
            },
            "items": [
                {
                    "item_id": 123,
                    "file_path": "script/a.txt",
                    "row_number": 45,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                    "failed_glossary_terms": [["勇者", "Hero"]],
                }
            ],
        }
    )

    assert snapshot.revision == 18
    assert snapshot.project_id == "current"
    assert snapshot.readonly is False
    assert snapshot.summary.total_items == 320
    assert snapshot.summary.filtered_items == 320
    assert snapshot.summary.warning_items == 54
    assert snapshot.filters.warning_types == ("GLOSSARY", "NO_WARNING")
    assert snapshot.filters.statuses == ("NONE", "PROCESSED", "ERROR")
    assert snapshot.filters.file_paths == ("script/a.txt",)
    assert snapshot.filters.glossary_terms == (("勇者", "Hero"),)
    assert snapshot.items[0].item_id == 123
    assert snapshot.items[0].row_number == 45
    assert snapshot.items[0].failed_glossary_terms == (("勇者", "Hero"),)


def test_proofreading_snapshot_uses_filters_contract_and_ignores_legacy_alias() -> None:
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "revision": 11,
            "project_id": "project-1",
            "readonly": False,
            "summary": {
                "total_items": 3,
                "filtered_items": 2,
                "warning_items": 1,
            },
            "filter_options": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["chapter-1.txt"],
                "glossary_terms": [["HP", "生命值"]],
            },
            "items": [],
        }
    )

    assert snapshot.filters.warning_types == ()
    assert snapshot.filters.statuses == ()
    assert snapshot.filters.file_paths == ()
    assert snapshot.filters.glossary_terms == ()

    with pytest.raises(AttributeError):
        _ = snapshot.filter_options


def test_proofreading_snapshot_round_trip_keeps_stable_contract_keys() -> None:
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "revision": 19,
            "project_id": "project-7",
            "readonly": True,
            "summary": {
                "total_items": 12,
                "filtered_items": 6,
                "warning_items": 2,
            },
            "filters": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["chapter-1.txt"],
                "glossary_terms": [["HP", "生命值"]],
            },
            "items": [
                {
                    "item_id": "item-12",
                    "file_path": "chapter-1.txt",
                    "row_number": 12,
                    "src": "原文",
                    "dst": "译文",
                    "status": "PROCESSED",
                    "warnings": ["GLOSSARY"],
                    "failed_glossary_terms": [["HP", "生命值"]],
                }
            ],
        }
    )

    payload = snapshot.to_dict()

    assert payload["revision"] == 19
    assert payload["project_id"] == "project-7"
    assert payload["readonly"] is True
    assert payload["summary"] == {
        "total_items": 12,
        "filtered_items": 6,
        "warning_items": 2,
    }
    assert payload["filters"] == {
        "warning_types": ["GLOSSARY"],
        "statuses": ["PROCESSED"],
        "file_paths": ["chapter-1.txt"],
        "glossary_terms": [["HP", "生命值"]],
    }
    assert payload["items"][0]["item_id"] == "item-12"
    assert payload["items"][0]["row_number"] == 12
    assert payload["items"][0]["failed_glossary_terms"] == [["HP", "生命值"]]
    assert "filter_options" not in payload
    assert "lookup_query" not in payload
    assert "search_result" not in payload
    assert "mutation_result" not in payload


def test_proofreading_mutation_result_from_dict_keeps_incremental_contract() -> None:
    result = ProofreadingMutationResult.from_dict(
        {
            "revision": 20,
            "changed_item_ids": [123, 124],
            "items": [
                {
                    "item_id": 123,
                    "dst": "The Hero arrived",
                    "status": "PROCESSED",
                    "warnings": [],
                }
            ],
            "summary": {
                "filtered_items": 319,
                "warning_items": 53,
            },
        }
    )

    assert result.revision == 20
    assert result.changed_item_ids == (123, 124)
    assert result.items[0].item_id == 123
    assert result.items[0].dst == "The Hero arrived"
    assert result.items[0].status == "PROCESSED"
    assert result.items[0].warnings == ()
    assert result.summary.filtered_items == 319
    assert result.summary.warning_items == 53


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
    assert payload["items"][0]["row_number"] == 12
    assert payload["summary"] == {
        "total_items": 12,
        "filtered_items": 10,
        "warning_items": 1,
    }


def test_proofreading_model_package_exports_match_module_contract() -> None:
    from model.Api import ProofreadingSearchResult
    from model.Api import ProofreadingWarningSummary

    warning_summary = ProofreadingWarningSummary.from_dict(
        {"warning_type": "GLOSSARY", "count": 4}
    )
    search_result = ProofreadingSearchResult.from_dict(
        {
            "keyword": "HP",
            "is_regex": True,
            "matched_item_ids": [1, 2],
        }
    )

    assert warning_summary.warning_type == "GLOSSARY"
    assert warning_summary.count == 4
    assert search_result.keyword == "HP"
    assert search_result.is_regex is True
    assert search_result.matched_item_ids == (1, 2)
