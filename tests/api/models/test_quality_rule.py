from types import SimpleNamespace

from api.Models.QualityRule import ProofreadingLookupQuery
from api.Models.QualityRule import QualityRuleEntry
from api.Models.QualityRule import QualityRuleSnapshot
from api.Models.QualityRule import QualityRuleStatisticsResult
from api.Models.QualityRule import QualityRuleStatisticsSnapshot


def test_quality_rule_entry_from_dict_uses_safe_defaults() -> None:
    entry = QualityRuleEntry.from_dict(None)

    assert entry.entry_id == ""
    assert entry.src == ""
    assert entry.dst == ""
    assert entry.info == ""
    assert entry.regex is False
    assert entry.case_sensitive is False
    assert entry.to_dict() == {
        "entry_id": "",
        "src": "",
        "dst": "",
        "info": "",
        "regex": False,
        "case_sensitive": False,
    }


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


def test_quality_rule_statistics_snapshot_normalizes_scalar_results() -> None:
    snapshot = QualityRuleStatisticsSnapshot.from_dict(
        {
            "available": True,
            "results": {"glossary": 2},
        }
    )

    assert snapshot.available is True
    assert snapshot.results["glossary"].matched_item_count == 2
    assert snapshot.results["glossary"].subset_parents == ()


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


def test_quality_rule_statistics_result_accepts_object_like_payload() -> None:
    result = QualityRuleStatisticsResult.from_dict(
        SimpleNamespace(
            matched_item_count=5,
            subset_parents=("root", "child"),
        )
    )

    assert result.matched_item_count == 5
    assert result.subset_parents == ("root", "child")


def test_quality_rule_statistics_result_handles_none_and_scalar_payloads() -> None:
    empty_result = QualityRuleStatisticsResult.from_dict(None)
    scalar_result = QualityRuleStatisticsResult.from_dict(3)

    assert empty_result.to_dict() == {
        "matched_item_count": 0,
        "subset_parents": [],
    }
    assert scalar_result.to_dict() == {
        "matched_item_count": 3,
        "subset_parents": [],
    }


def test_quality_rule_statistics_result_ignores_invalid_subset_parent_container() -> (
    None
):
    dict_result = QualityRuleStatisticsResult.from_dict(
        {
            "matched_item_count": 2,
            "subset_parents": "invalid",
        }
    )
    object_result = QualityRuleStatisticsResult.from_dict(
        SimpleNamespace(
            matched_item_count=2,
            subset_parents="invalid",
        )
    )

    assert dict_result.subset_parents == ()
    assert object_result.subset_parents == ()


def test_quality_rule_snapshot_accepts_prebuilt_statistics_and_entries() -> None:
    statistics = QualityRuleStatisticsSnapshot(
        available=True,
        results={"glossary": QualityRuleStatisticsResult(matched_item_count=2)},
    )
    entry = QualityRuleEntry(entry_id="1", src="a", dst="b")
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "revision": 4,
            "statistics": statistics,
            "entries": [entry],
        }
    )

    assert snapshot.statistics == statistics
    assert snapshot.entries == (entry,)
    assert snapshot.to_dict()["statistics"]["results"]["glossary"] == {
        "matched_item_count": 2,
        "subset_parents": [],
    }


def test_quality_rule_snapshot_ignores_invalid_nested_payloads() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "meta": "invalid",
            "statistics": None,
            "entries": "invalid",
        }
    )
    statistics = QualityRuleStatisticsSnapshot.from_dict(None)

    assert snapshot.meta == {}
    assert snapshot.entries == ()
    assert snapshot.statistics == statistics
    assert statistics.to_dict() == {"available": False, "results": {}}


def test_proofreading_lookup_query_from_dict_keeps_keyword_and_regex_flag() -> None:
    query = ProofreadingLookupQuery.from_dict({"keyword": "HP", "is_regex": True})

    assert query.keyword == "HP"
    assert query.is_regex is True
    assert query.to_dict() == {"keyword": "HP", "is_regex": True}


def test_proofreading_lookup_query_uses_safe_defaults_for_invalid_payload() -> None:
    query = ProofreadingLookupQuery.from_dict(None)

    assert query.keyword == ""
    assert query.is_regex is False
