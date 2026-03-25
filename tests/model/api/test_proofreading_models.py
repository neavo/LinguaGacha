from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingLookupQuery
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSnapshot


def test_proofreading_lookup_query_from_dict_keeps_keyword_and_regex_flag() -> None:
    query = ProofreadingLookupQuery.from_dict({"keyword": "HP", "is_regex": True})

    assert query.keyword == "HP"
    assert query.is_regex is True


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


def test_proofreading_snapshot_from_dict_keeps_view_and_summary_models() -> None:
    snapshot = ProofreadingSnapshot.from_dict(
        {
            "revision": 7,
            "items": [
                {
                    "item_id": 12,
                    "src": "原文",
                    "dst": "译文",
                    "status": "PROCESSED",
                    "file_path": "chapter-1.txt",
                    "warnings": ["GLOSSARY"],
                }
            ],
            "filter_options": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["chapter-1.txt"],
                "glossary_terms": [["HP", "生命值"]],
            },
            "warning_summaries": [{"warning_type": "GLOSSARY", "count": 1}],
            "search_result": {
                "keyword": "HP",
                "is_regex": False,
                "matched_item_ids": [12],
            },
            "mutation_result": {"success": True, "changed_count": 1},
        }
    )

    assert snapshot.revision == 7
    assert snapshot.items[0].src == "原文"
    assert snapshot.items[0].warnings == ("GLOSSARY",)
    assert snapshot.filter_options.file_paths == ("chapter-1.txt",)
    assert snapshot.warning_summaries[0].count == 1
    assert snapshot.search_result.matched_item_ids == (12,)
    assert snapshot.mutation_result.success is True


def test_proofreading_mutation_result_from_dict_uses_safe_defaults() -> None:
    result = ProofreadingMutationResult.from_dict(None)

    assert result.success is False
    assert result.changed_count == 0
