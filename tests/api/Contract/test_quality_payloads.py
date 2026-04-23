from api.Contract.QualityPayloads import QualityRuleSnapshotPayload


def test_quality_rule_snapshot_payload_wraps_snapshot() -> None:
    payload = QualityRuleSnapshotPayload.from_dict(
        {
            "rule_type": "glossary",
            "revision": 2,
            "meta": {"enabled": True},
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
