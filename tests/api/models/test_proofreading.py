from api.Models.Proofreading import ProofreadingFilterOptionsSnapshot
from api.Models.Proofreading import ProofreadingItemView
from api.Models.Proofreading import ProofreadingMutationResult
from api.Models.Proofreading import ProofreadingSearchResult
from api.Models.Proofreading import ProofreadingSnapshot
from api.Models.Proofreading import ProofreadingSummary
from api.Models.Proofreading import ProofreadingWarningSummary


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
    assert options.include_without_glossary_miss is True


def test_proofreading_filter_options_snapshot_accepts_dict_terms() -> None:
    options = ProofreadingFilterOptionsSnapshot.from_dict(
        {
            "glossary_terms": [
                {"src": "勇者", "dst": "Hero"},
                ["HP", "生命值"],
            ]
        }
    )

    assert options.glossary_terms == (("勇者", "Hero"), ("HP", "生命值"))
    assert options.include_without_glossary_miss is True
    assert options.to_dict()["glossary_terms"] == [["勇者", "Hero"], ["HP", "生命值"]]
    assert options.to_dict()["include_without_glossary_miss"] is True


def test_proofreading_filter_options_snapshot_ignores_invalid_collection_payloads() -> (
    None
):
    options = ProofreadingFilterOptionsSnapshot.from_dict(
        {
            "warning_types": "invalid",
            "statuses": "invalid",
            "file_paths": "invalid",
            "glossary_terms": "invalid",
        }
    )

    assert options.warning_types == ()
    assert options.statuses == ()
    assert options.file_paths == ()
    assert options.glossary_terms == ()
    assert options.include_without_glossary_miss is True


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


def test_proofreading_item_view_supports_alias_fields_and_term_dicts() -> None:
    item = ProofreadingItemView.from_dict(
        {
            "id": "item-1",
            "row": 7,
            "file_path": "chapter-2.txt",
            "src": "勇者が来た",
            "dst": "Hero arrived",
            "status": "PROCESSED",
            "warning_types": ["GLOSSARY"],
            "applied_glossary_terms": [{"src": "勇者", "dst": "Hero"}],
            "failed_glossary_terms": [{"src": "HP", "dst": "生命值"}],
        }
    )

    assert item.item_id == "item-1"
    assert item.row_number == 7
    assert item.warnings == ("GLOSSARY",)
    assert item.applied_glossary_terms == (("勇者", "Hero"),)
    assert item.failed_glossary_terms == (("HP", "生命值"),)
    assert item.to_dict()["applied_glossary_terms"] == [["勇者", "Hero"]]


def test_proofreading_item_view_ignores_invalid_warning_and_term_containers() -> None:
    item = ProofreadingItemView.from_dict(
        {
            "warnings": "invalid",
            "applied_glossary_terms": "invalid",
            "failed_glossary_terms": "invalid",
        }
    )

    assert item.warnings == ()
    assert item.applied_glossary_terms == ()
    assert item.failed_glossary_terms == ()


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
                "include_without_glossary_miss": False,
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
    assert snapshot.filters.include_without_glossary_miss is False
    assert snapshot.items[0].item_id == 123
    assert snapshot.items[0].row_number == 45
    assert snapshot.items[0].failed_glossary_terms == (("勇者", "Hero"),)


def test_proofreading_snapshot_accepts_prebuilt_objects() -> None:
    summary = ProofreadingSummary(total_items=3, filtered_items=2, warning_items=1)
    filters = ProofreadingFilterOptionsSnapshot(
        warning_types=("GLOSSARY",),
        statuses=("PROCESSED",),
        file_paths=("chapter-1.txt",),
        glossary_terms=(("HP", "生命值"),),
        include_without_glossary_miss=False,
    )
    item = ProofreadingItemView(
        item_id="item-1",
        row_number=12,
        warnings=("GLOSSARY",),
    )
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "revision": 11,
            "project_id": "project-1",
            "readonly": False,
            "summary": summary,
            "filters": filters,
            "items": [item],
        }
    )

    assert snapshot.summary == summary
    assert snapshot.filters == filters
    assert snapshot.items == (item,)


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
                "include_without_glossary_miss": False,
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
        "include_without_glossary_miss": False,
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


def test_proofreading_mutation_result_accepts_prebuilt_objects() -> None:
    item = ProofreadingItemView(item_id="item-1", dst="译文")
    summary = ProofreadingSummary(total_items=1, filtered_items=1, warning_items=0)
    result = ProofreadingMutationResult.from_dict(
        {
            "revision": 4,
            "changed_item_ids": "invalid",
            "items": [item],
            "summary": summary,
        }
    )

    assert result.changed_item_ids == ()
    assert result.items == (item,)
    assert result.summary == summary


def test_proofreading_search_result_round_trip_keeps_stable_fields() -> None:
    result = ProofreadingSearchResult.from_dict(
        {
            "keyword": "HP",
            "is_regex": True,
            "matched_item_ids": [1, 2],
        }
    )

    assert result.keyword == "HP"
    assert result.is_regex is True
    assert result.matched_item_ids == (1, 2)
    assert result.to_dict() == {
        "keyword": "HP",
        "is_regex": True,
        "matched_item_ids": [1, 2],
    }


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
    options = ProofreadingFilterOptionsSnapshot.from_dict(None)
    warning_summary = ProofreadingWarningSummary.from_dict(None)
    summary = ProofreadingSummary.from_dict(None)
    item = ProofreadingItemView.from_dict(None)
    search_result = ProofreadingSearchResult.from_dict(None)
    mutation_result = ProofreadingMutationResult.from_dict(None)
    snapshot = ProofreadingSnapshot.from_dict(None)

    assert options.to_dict() == {
        "warning_types": [],
        "statuses": [],
        "file_paths": [],
        "glossary_terms": [],
        "include_without_glossary_miss": True,
    }
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
    assert search_result.to_dict() == {
        "keyword": "",
        "is_regex": False,
        "matched_item_ids": [],
    }
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
    assert snapshot.to_dict() == {
        "revision": 0,
        "project_id": "",
        "readonly": False,
        "summary": {
            "total_items": 0,
            "filtered_items": 0,
            "warning_items": 0,
        },
        "filters": {
            "warning_types": [],
            "statuses": [],
            "file_paths": [],
            "glossary_terms": [],
            "include_without_glossary_miss": True,
        },
        "items": [],
    }
