from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleEntry
from model.Api.QualityRuleModels import QualityRuleSnapshot
from model.Api.QualityRuleModels import QualityRuleStatisticsSnapshot


def test_quality_rule_entry_from_dict_uses_safe_defaults() -> None:
    entry = QualityRuleEntry.from_dict(None)

    assert entry.entry_id == ""
    assert entry.src == ""
    assert entry.dst == ""
    assert entry.info == ""
    assert entry.regex is False
    assert entry.case_sensitive is False


def test_quality_rule_snapshot_from_dict_keeps_revision_and_entries() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "revision": 3,
            "meta": {"enabled": True},
            "statistics": {
                "available": True,
                "results": {"glossary": {"matched_item_count": 2}},
                "subset_parents": {"glossary": ["root"]},
            },
            "entries": [{"entry_id": "1", "src": "a", "dst": "b"}],
        }
    )

    assert snapshot.rule_type == "glossary"
    assert snapshot.revision == 3
    assert snapshot.meta["enabled"] is True
    assert snapshot.statistics.available is True
    assert snapshot.statistics.results["glossary"].matched_item_count == 2
    assert snapshot.statistics.subset_parents["glossary"] == ("root",)
    assert len(snapshot.entries) == 1
    assert snapshot.entries[0].entry_id == "1"
    assert snapshot.entries[0].src == "a"
    assert snapshot.entries[0].dst == "b"


def test_quality_rule_statistics_snapshot_from_dict_normalizes_nested_data() -> None:
    snapshot = QualityRuleStatisticsSnapshot.from_dict(
        {
            "available": True,
            "results": {"glossary": 2},
            "subset_parents": {"glossary": ["root", "child"]},
        }
    )

    assert snapshot.available is True
    assert snapshot.results["glossary"].matched_item_count == 2
    assert snapshot.subset_parents["glossary"] == ("root", "child")


def test_proofreading_lookup_query_from_dict_keeps_keyword_and_regex_flag() -> None:
    query = ProofreadingLookupQuery.from_dict({"keyword": "HP", "is_regex": True})

    assert query.keyword == "HP"
    assert query.is_regex is True
