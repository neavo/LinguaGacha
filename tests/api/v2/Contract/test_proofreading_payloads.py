from api.v2.Contract.ProofreadingPayloads import ProofreadingMutationResultPayload
from api.v2.Contract.ProofreadingPayloads import build_mutation_result_payload


def test_proofreading_mutation_payload_builds_minimal_ack() -> None:
    payload = build_mutation_result_payload(
        revision=9,
        changed_item_ids=[1, 2],
    )

    assert payload == {
        "result": {
            "revision": 9,
            "changed_item_ids": [1, 2],
        }
    }


def test_proofreading_mutation_payload_roundtrip_defaults_missing_fields() -> None:
    payload = ProofreadingMutationResultPayload.from_dict(
        {
            "revision": 5,
            "changed_item_ids": [3],
        }
    ).to_dict()

    assert payload["result"]["revision"] == 5
    assert payload["result"]["changed_item_ids"] == [3]
