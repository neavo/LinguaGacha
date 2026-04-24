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
    assert from_dict_payload == {
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
                "request": {
                    "extra_headers": {},
                    "extra_headers_custom_enable": False,
                    "extra_body": {},
                    "extra_body_custom_enable": False,
                },
                "threshold": {
                    "input_token_limit": 512,
                    "output_token_limit": 4096,
                    "rpm_limit": 0,
                    "concurrency_limit": 0,
                },
                "thinking": {"level": "OFF"},
                "generation": {
                    "temperature": 0.95,
                    "temperature_custom_enable": False,
                    "top_p": 0.95,
                    "top_p_custom_enable": False,
                    "presence_penalty": 0.0,
                    "presence_penalty_custom_enable": False,
                    "frequency_penalty": 0.0,
                    "frequency_penalty_custom_enable": False,
                },
            }
        ],
    }


def test_model_page_snapshot_payload_defaults_missing_snapshot_to_empty_page() -> None:
    payload = ModelPageSnapshotPayload.from_dict(None).to_dict()

    assert payload == {
        "active_model_id": "",
        "models": [],
    }
