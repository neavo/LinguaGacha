from api.Contract.ProofreadingPayloads import ProofreadingMutationResultPayload
from api.Contract.ProofreadingPayloads import build_mutation_result_payload


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


def test_proofreading_mutation_payload_defaults_missing_fields() -> None:
    payload = ProofreadingMutationResultPayload.from_dict(None).to_dict()

    assert payload == {
        "result": {
            "revision": 0,
            "changed_item_ids": [],
        }
    }
