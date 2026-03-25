from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleEntry
from model.Api.QualityRuleModels import QualityRuleSnapshot
from model.Api.QualityRuleModels import QualityRuleStatisticsResult
from model.Api.QualityRuleModels import QualityRuleStatisticsSnapshot


def test_quality_rule_entry_from_dict_uses_safe_defaults() -> None:
    entry = QualityRuleEntry.from_dict(None)

    assert entry.entry_id == ""
    assert entry.src == ""
    assert entry.dst == ""
    assert entry.info == ""
    assert entry.regex is False
    assert entry.case_sensitive is False


def test_quality_rule_snapshot_from_dict_keeps_revision_and_nested_statistics() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "revision": 3,
            "meta": {"enabled": True},
            "statistics": {
                "available": True,
                "results": {
                    "glossary": {
                        "matched_item_count": 2,
                        "subset_parents": ["root"],
                    }
                },
            },
            "entries": [{"entry_id": "1", "src": "a", "dst": "b"}],
        }
    )

    assert snapshot.rule_type == "glossary"
    assert snapshot.revision == 3
    assert snapshot.meta["enabled"] is True
    assert snapshot.statistics.available is True
    assert snapshot.statistics.results["glossary"].matched_item_count == 2
    assert snapshot.statistics.results["glossary"].subset_parents == ("root",)
    assert len(snapshot.entries) == 1
    assert snapshot.entries[0].entry_id == "1"
    assert snapshot.entries[0].src == "a"
    assert snapshot.entries[0].dst == "b"


def test_quality_rule_snapshot_round_trip_keeps_contract_fields() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "text-replacement",
            "revision": 8,
            "meta": {"enabled": False, "name": "示例"},
            "statistics": {
                "available": True,
                "results": {
                    "rule-a": {
                        "matched_item_count": 5,
                        "subset_parents": ["parent-a", "parent-b"],
                    }
                },
            },
            "entries": [
                {
                    "entry_id": "entry-9",
                    "src": "甲",
                    "dst": "乙",
                    "info": "说明",
                    "regex": True,
                    "case_sensitive": True,
                }
            ],
        }
    )

    payload = snapshot.to_dict()

    assert payload["rule_type"] == "text-replacement"
    assert payload["revision"] == 8
    assert payload["meta"] == {"enabled": False, "name": "示例"}
    assert payload["statistics"]["available"] is True
    assert payload["statistics"]["results"]["rule-a"]["matched_item_count"] == 5
    assert payload["statistics"]["results"]["rule-a"]["subset_parents"] == [
        "parent-a",
        "parent-b",
    ]
    assert payload["entries"][0]["entry_id"] == "entry-9"
    assert payload["entries"][0]["src"] == "甲"
    assert payload["entries"][0]["dst"] == "乙"


def test_quality_rule_statistics_snapshot_from_dict_normalizes_nested_data() -> None:
    snapshot = QualityRuleStatisticsSnapshot.from_dict(
        {
            "available": True,
            "results": {
                "glossary": {
                    "matched_item_count": 2,
                    "subset_parents": ["root", "child"],
                }
            },
        }
    )

    assert snapshot.available is True
    assert snapshot.results["glossary"].matched_item_count == 2
    assert snapshot.results["glossary"].subset_parents == ("root", "child")


def test_quality_rule_statistics_result_round_trip_keeps_subset_parents() -> None:
    result = QualityRuleStatisticsResult.from_dict(
        {
            "matched_item_count": 4,
            "subset_parents": ["root", "child"],
        }
    )

    payload = result.to_dict()

    assert result.matched_item_count == 4
    assert result.subset_parents == ("root", "child")
    assert payload["matched_item_count"] == 4
    assert payload["subset_parents"] == ["root", "child"]


def test_proofreading_lookup_query_from_dict_keeps_keyword_and_regex_flag() -> None:
    query = ProofreadingLookupQuery.from_dict({"keyword": "HP", "is_regex": True})

    assert query.keyword == "HP"
    assert query.is_regex is True
