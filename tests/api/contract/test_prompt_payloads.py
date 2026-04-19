from api.Contract.PromptPayloads import PromptSnapshotPayload


def test_prompt_snapshot_payload_copies_dict_and_rejects_invalid_payload() -> None:
    source = {"task_type": "translation", "text": "demo"}
    payload = PromptSnapshotPayload.from_dict(source)
    source["text"] = "mutated"

    assert payload.to_dict() == {"task_type": "translation", "text": "demo"}
    assert PromptSnapshotPayload.from_dict("invalid").to_dict() == {}
