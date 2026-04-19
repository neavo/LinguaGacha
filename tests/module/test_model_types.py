from module.Model.Types import GenerationConfig
from module.Model.Types import Model
from module.Model.Types import ModelType
from module.Model.Types import RequestConfig
from module.Model.Types import ThinkingConfig
from module.Model.Types import ThinkingLevel
from module.Model.Types import ThresholdConfig


def test_request_threshold_and_generation_config_roundtrip_public_state() -> None:
    request = RequestConfig.from_dict(
        {
            "extra_headers": {"X-Test": "1"},
            "extra_headers_custom_enable": True,
            "extra_body": {"temperature": 0.2},
            "extra_body_custom_enable": True,
        }
    )
    threshold = ThresholdConfig.from_dict(
        {
            "input_token_limit": 2048,
            "output_token_limit": 8192,
            "rpm_limit": 60,
            "concurrency_limit": 4,
        }
    )
    generation = GenerationConfig.from_dict(
        {
            "temperature": 0.2,
            "temperature_custom_enable": True,
            "top_p": 0.8,
            "top_p_custom_enable": True,
            "presence_penalty": 0.3,
            "presence_penalty_custom_enable": True,
            "frequency_penalty": 0.4,
            "frequency_penalty_custom_enable": True,
        }
    )

    assert request.to_dict() == {
        "extra_headers": {"X-Test": "1"},
        "extra_headers_custom_enable": True,
        "extra_body": {"temperature": 0.2},
        "extra_body_custom_enable": True,
    }
    assert threshold.to_dict() == {
        "input_token_limit": 2048,
        "output_token_limit": 8192,
        "rpm_limit": 60,
        "concurrency_limit": 4,
    }
    assert generation.to_dict() == {
        "temperature": 0.2,
        "temperature_custom_enable": True,
        "top_p": 0.8,
        "top_p_custom_enable": True,
        "presence_penalty": 0.3,
        "presence_penalty_custom_enable": True,
        "frequency_penalty": 0.4,
        "frequency_penalty_custom_enable": True,
    }


def test_thinking_config_falls_back_to_off_for_invalid_level() -> None:
    thinking = ThinkingConfig.from_dict({"level": "not-supported"})

    assert thinking.level == ThinkingLevel.OFF
    assert thinking.to_dict() == {"level": ThinkingLevel.OFF.value}


def test_model_from_dict_builds_nested_configs_and_repairs_invalid_type() -> None:
    model = Model.from_dict(
        {
            "name": "demo-model",
            "type": "bad-type",
            "api_format": "OpenAI",
            "api_url": "https://example.com",
            "api_key": "secret",
            "model_id": "gpt-demo",
            "request": {
                "extra_headers": {"X-Trace": "1"},
                "extra_headers_custom_enable": True,
            },
            "threshold": {
                "input_token_limit": 1024,
                "concurrency_limit": 2,
            },
            "thinking": {"level": ThinkingLevel.HIGH.value},
            "generation": {
                "temperature": 0.1,
                "top_p_custom_enable": True,
            },
        }
    )

    assert model.id != ""
    assert model.type == ModelType.PRESET
    assert model.request.extra_headers == {"X-Trace": "1"}
    assert model.request.extra_headers_custom_enable is True
    assert model.threshold.input_token_limit == 1024
    assert model.threshold.concurrency_limit == 2
    assert model.thinking.level == ThinkingLevel.HIGH
    assert model.generation.temperature == 0.1
    assert model.generation.top_p_custom_enable is True


def test_model_to_dict_and_helper_flags_expose_public_snapshot() -> None:
    model = Model(
        id="custom-openai",
        type=ModelType.CUSTOM_OPENAI,
        name="Custom OpenAI",
        api_format="OpenAI",
        api_url="https://example.com",
        api_key="secret",
        model_id="gpt-demo",
        request=RequestConfig(
            extra_body={"stream": True},
            extra_body_custom_enable=True,
        ),
        threshold=ThresholdConfig(rpm_limit=120),
        thinking=ThinkingConfig(level=ThinkingLevel.MEDIUM),
        generation=GenerationConfig(temperature=0.25),
    )

    assert model.to_dict() == {
        "id": "custom-openai",
        "type": ModelType.CUSTOM_OPENAI.value,
        "name": "Custom OpenAI",
        "api_format": "OpenAI",
        "api_url": "https://example.com",
        "api_key": "secret",
        "model_id": "gpt-demo",
        "request": {
            "extra_headers": {},
            "extra_headers_custom_enable": False,
            "extra_body": {"stream": True},
            "extra_body_custom_enable": True,
        },
        "threshold": {
            "input_token_limit": 512,
            "output_token_limit": 4096,
            "rpm_limit": 120,
            "concurrency_limit": 0,
        },
        "thinking": {"level": ThinkingLevel.MEDIUM.value},
        "generation": {
            "temperature": 0.25,
            "temperature_custom_enable": False,
            "top_p": 0.95,
            "top_p_custom_enable": False,
            "presence_penalty": 0.0,
            "presence_penalty_custom_enable": False,
            "frequency_penalty": 0.0,
            "frequency_penalty_custom_enable": False,
        },
    }
    assert model.is_custom() is True
    assert model.is_preset() is False
