from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelGenerationSnapshot
from model.Api.ModelModels import ModelPageSnapshot
from model.Api.ModelModels import ModelRequestSnapshot
from model.Api.ModelModels import ModelThinkingSnapshot
from model.Api.ModelModels import ModelThresholdSnapshot


def test_model_page_snapshot_from_dict_builds_nested_objects() -> None:
    snapshot = ModelPageSnapshot.from_dict(
        {
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
                        "extra_headers": {"X-Test": "1"},
                        "extra_headers_custom_enable": True,
                        "extra_body": {"reasoning": "high"},
                        "extra_body_custom_enable": False,
                    },
                    "threshold": {
                        "input_token_limit": 1024,
                        "output_token_limit": 2048,
                        "rpm_limit": 60,
                        "concurrency_limit": 2,
                    },
                    "thinking": {"level": "HIGH"},
                    "generation": {
                        "temperature": 0.3,
                        "temperature_custom_enable": True,
                        "top_p": 0.8,
                        "top_p_custom_enable": True,
                        "presence_penalty": 0.1,
                        "presence_penalty_custom_enable": False,
                        "frequency_penalty": 0.2,
                        "frequency_penalty_custom_enable": True,
                    },
                }
            ],
        }
    )

    assert snapshot.active_model_id == "model-1"
    assert len(snapshot.models) == 1
    assert isinstance(snapshot.models[0], ModelEntrySnapshot)
    assert isinstance(snapshot.models[0].request, ModelRequestSnapshot)
    assert isinstance(snapshot.models[0].threshold, ModelThresholdSnapshot)
    assert isinstance(snapshot.models[0].thinking, ModelThinkingSnapshot)
    assert isinstance(snapshot.models[0].generation, ModelGenerationSnapshot)
    assert snapshot.models[0].generation.temperature == 0.3
