from api.Contract.V2.BootstrapPayloads import BootstrapStagePayload


def test_bootstrap_stage_payload_to_dict_keeps_stage_and_payload():
    payload = BootstrapStagePayload(
        stage="items", payload={"schema": "project-items.v1"}
    )

    assert payload.to_dict() == {
        "type": "stage_payload",
        "stage": "items",
        "payload": {"schema": "project-items.v1"},
    }
