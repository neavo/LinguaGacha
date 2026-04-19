from api.Contract.QualityPayloads import ProofreadingLookupPayload
from api.Contract.QualityPayloads import QualityRuleSnapshotPayload


def test_quality_rule_snapshot_payload_wraps_snapshot() -> None:
    payload = QualityRuleSnapshotPayload.from_dict(
        {
            "rule_type": "glossary",
            "revision": 2,
            "meta": {"enabled": True},
            "statistics": {"available": False, "results": {}},
            "entries": [
                {
                    "entry_id": "glossary:0",
                    "src": "勇者",
                    "dst": "Hero",
                    "info": "",
                    "regex": False,
                    "case_sensitive": False,
                }
            ],
        }
    ).to_dict()

    assert payload["snapshot"]["rule_type"] == "glossary"
    assert payload["snapshot"]["entries"][0]["dst"] == "Hero"


def test_proofreading_lookup_payload_wraps_lookup_query() -> None:
    payload = ProofreadingLookupPayload.from_dict(
        {"keyword": "^勇者$", "is_regex": True}
    ).to_dict()

    assert payload == {
        "query": {
            "keyword": "^勇者$",
            "is_regex": True,
        }
    }
