from api.Models.Proofreading import ProofreadingMutationResult


def test_proofreading_mutation_result_round_trip_keeps_minimal_ack() -> None:
    result = ProofreadingMutationResult.from_dict(
        {
            "revision": 21,
            "changed_item_ids": ["item-1", "item-2"],
        }
    )

    payload = result.to_dict()

    assert payload["revision"] == 21
    assert payload["changed_item_ids"] == ["item-1", "item-2"]


def test_proofreading_models_use_safe_defaults_for_invalid_payloads() -> None:
    mutation_result = ProofreadingMutationResult.from_dict(None)

    assert mutation_result.to_dict() == {
        "revision": 0,
        "changed_item_ids": [],
    }
