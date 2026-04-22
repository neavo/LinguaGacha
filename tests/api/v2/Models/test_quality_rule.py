from api.v2.Models.QualityRule import QualityRuleEntry
from api.v2.Models.QualityRule import QualityRuleSnapshot


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


def test_quality_rule_snapshot_from_dict_keeps_revision_and_entries() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "revision": 3,
            "meta": {"enabled": True},
            "entries": [{"entry_id": "1", "src": "a", "dst": "b"}],
        }
    )

    assert snapshot.rule_type == "glossary"
    assert snapshot.revision == 3
    assert snapshot.meta["enabled"] is True
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
    assert payload["entries"][0]["entry_id"] == "entry-9"
    assert payload["entries"][0]["src"] == "甲"
    assert payload["entries"][0]["dst"] == "乙"


def test_quality_rule_snapshot_accepts_prebuilt_entries() -> None:
    entry = QualityRuleEntry(entry_id="1", src="a", dst="b")
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "revision": 4,
            "entries": [entry],
        }
    )

    assert snapshot.entries == (entry,)


def test_quality_rule_snapshot_ignores_invalid_nested_payloads() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {
            "rule_type": "glossary",
            "meta": "invalid",
            "entries": "invalid",
        }
    )

    assert snapshot.meta == {}
    assert snapshot.entries == ()
