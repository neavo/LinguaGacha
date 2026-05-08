from collections.abc import Callable

import pytest

from api.Application.ModelProbeAppService import ModelProbeAppService
from module.Engine.ModelApiTestRunner import ModelApiKeyTestResult
from module.Engine.ModelApiTestRunner import ModelApiTestSummary
from tests.api.support.application_fakes import FakeModelConfig


def build_model_probe_app_service(
    *,
    fake_config: FakeModelConfig | None = None,
    available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
    api_test_runner: Callable[[dict[str, object]], object] | None = None,
) -> ModelProbeAppService:
    """统一构造模型探测服务测试桩，避免每个用例重复拼装依赖。"""

    config = fake_config if fake_config is not None else FakeModelConfig()
    return ModelProbeAppService(
        config_loader=lambda: config,
        available_models_loader=available_models_loader,
        api_test_runner=api_test_runner,
    )


def test_model_probe_app_service_list_available_models_returns_loader_result() -> None:
    service = build_model_probe_app_service(
        available_models_loader=lambda model: ["gpt-5.4", str(model["model_id"])],
    )

    data = service.list_available_models({"model_id": "preset-1"})

    assert data == {"models": ["gpt-5.4", "gpt-4.1"]}


def test_model_probe_app_service_rejects_unknown_model() -> None:
    service = build_model_probe_app_service()

    with pytest.raises(ValueError, match="model not found"):
        service.list_available_models({"model_id": "missing"})


def test_model_probe_app_service_test_model_returns_runner_result() -> None:
    service = build_model_probe_app_service(
        api_test_runner=lambda model: {
            "success": True,
            "result_msg": f"测试通过：{model['name']}",
        },
    )

    data = service.test_model({"model_id": "preset-1"})

    assert data["success"] is True
    assert data["result_msg"] == "测试通过：GPT-4.1"


def test_model_probe_app_service_test_model_maps_engine_runner_summary() -> None:
    seen_models: list[dict[str, object]] = []

    def api_test_runner(model: dict[str, object]) -> ModelApiTestSummary:
        seen_models.append(model)
        return ModelApiTestSummary(
            success=False,
            result_msg="总数 1 成功 0 失败 1",
            total_count=1,
            success_count=0,
            failure_count=1,
            total_response_time_ms=123,
            key_results=(
                ModelApiKeyTestResult(
                    masked_key="preset-key",
                    success=False,
                    input_tokens=0,
                    output_tokens=0,
                    response_time_ms=123,
                    error_reason="ValueError: bad",
                ),
            ),
        )

    service = build_model_probe_app_service(api_test_runner=api_test_runner)

    data = service.test_model({"model_id": "preset-1"})

    assert seen_models[0]["name"] == "GPT-4.1"
    assert data == {
        "success": False,
        "result_msg": "总数 1 成功 0 失败 1",
        "total_count": 1,
        "success_count": 0,
        "failure_count": 1,
        "total_response_time_ms": 123,
        "key_results": [
            {
                "masked_key": "preset-key",
                "success": False,
                "input_tokens": 0,
                "output_tokens": 0,
                "response_time_ms": 123,
                "error_reason": "ValueError: bad",
            }
        ],
    }
