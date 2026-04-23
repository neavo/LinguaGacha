from api.Contract.ModelPayloads import ModelPageSnapshotPayload
from api.Models.Model import ModelPageSnapshot


def test_model_page_snapshot_payload_supports_dict_and_snapshot_inputs() -> None:
    source = {
        "active_model_id": "model-1",
        "models": [
            {
                "id": "model-1",
                "type": "PRESET",
                "name": "GPT-4.1",
                "api_format": "OpenAI",
                "api_url": "https://api.example.com/v1",
                "api_key": "secret",
                "model_id": "gpt-4.1",
            }
        ],
    }

    from_dict_payload = ModelPageSnapshotPayload.from_dict(source).to_dict()
    from_snapshot_payload = ModelPageSnapshotPayload.from_snapshot(
        ModelPageSnapshot.from_dict(source)
    ).to_dict()

    assert from_dict_payload == from_snapshot_payload
    assert from_dict_payload["active_model_id"] == "model-1"
    assert from_dict_payload["models"][0]["id"] == "model-1"
