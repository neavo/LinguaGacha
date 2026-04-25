from collections.abc import Callable

import pytest

from api.Application.ModelAppService import ModelAppService
from module.Engine.ModelApiTestRunner import ModelApiKeyTestResult
from module.Engine.ModelApiTestRunner import ModelApiTestSummary
from tests.api.support.application_fakes import FakeModelConfig
from tests.api.support.application_fakes import FakeModelManager


def build_model_app_service(
    *,
    fake_config: FakeModelConfig | None = None,
    fake_model_manager: FakeModelManager | None = None,
    available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
    api_test_runner: Callable[[dict[str, object]], object] | None = None,
) -> ModelAppService:
    """统一构造模型应用服务测试桩，避免每个用例重复拼装依赖。"""

    config = fake_config if fake_config is not None else FakeModelConfig()
    model_manager = (
        fake_model_manager if fake_model_manager is not None else FakeModelManager()
    )
    return ModelAppService(
        config_loader=lambda: config,
        model_manager=model_manager,
        available_models_loader=available_models_loader,
        api_test_runner=api_test_runner,
    )


def test_model_app_service_update_model_rejects_forbidden_patch_key() -> None:
    service = build_model_app_service()
    request = {
        "model_id": "preset-1",
        "patch": {
            "type": "CUSTOM_OPENAI",
        },
    }

    with pytest.raises(ValueError, match="forbidden model patch key"):
        service.update_model(request)


def test_model_app_service_snapshot_returns_active_model_and_models() -> None:
    service = build_model_app_service()

    data = service.get_snapshot({})

    assert "snapshot" in data
    snapshot = data["snapshot"]
    assert snapshot["active_model_id"] == "preset-1"
    assert isinstance(snapshot["models"], list)
    assert len(snapshot["models"]) == 3


def test_model_app_service_activate_model_updates_active_model_snapshot() -> None:
    fake_config = FakeModelConfig()
    service = build_model_app_service(fake_config=fake_config)

    data = service.activate_model({"model_id": "preset-2"})

    assert data["snapshot"]["active_model_id"] == "preset-2"
    assert fake_config.activate_model_id == "preset-2"
    assert fake_config.save_calls == 1


def test_model_app_service_update_model_merges_nested_patch() -> None:
    service = build_model_app_service()

    data = service.update_model(
        {
            "model_id": "preset-1",
            "patch": {
                "generation": {
                    "temperature": 0.9,
                }
            },
        }
    )

    snapshot = data["snapshot"]
    updated_model = next(
        model for model in snapshot["models"] if model["id"] == "preset-1"
    )
    assert updated_model["generation"]["temperature"] == 0.9
    assert updated_model["generation"]["top_p"] == 0.8


def test_model_app_service_delete_preset_model_is_rejected() -> None:
    service = build_model_app_service()

    with pytest.raises(ValueError, match="preset model cannot be deleted"):
        service.delete_model({"model_id": "preset-1"})


def test_model_app_service_add_model_returns_snapshot_with_new_custom_model() -> None:
    fake_config = FakeModelConfig()
    fake_model_manager = FakeModelManager()
    service = build_model_app_service(
        fake_config=fake_config,
        fake_model_manager=fake_model_manager,
    )

    data = service.add_model({"model_type": "CUSTOM_GOOGLE"})

    models = data["snapshot"]["models"]
    added_model = next(model for model in models if model["id"] == "custom_google-1")
    assert len(models) == 4
    assert added_model["type"] == "CUSTOM_GOOGLE"
    assert fake_config.save_calls == 1


def test_model_app_service_delete_model_reassigns_active_model_after_removing_custom_model() -> (
    None
):
    fake_config = FakeModelConfig()
    fake_config.activate_model_id = "custom-openai-1"
    service = build_model_app_service(
        fake_config=fake_config,
        fake_model_manager=FakeModelManager(),
    )

    data = service.delete_model({"model_id": "custom-openai-1"})

    remaining_ids = [model["id"] for model in data["snapshot"]["models"]]
    assert "custom-openai-1" not in remaining_ids
    assert data["snapshot"]["active_model_id"] == "preset-1"
    assert fake_config.activate_model_id == "preset-1"


def test_model_app_service_reset_preset_model_restores_original_fields() -> None:
    fake_config = FakeModelConfig()
    service = build_model_app_service(
        fake_config=fake_config,
        fake_model_manager=FakeModelManager(),
    )
    service.update_model(
        {
            "model_id": "preset-1",
            "patch": {"name": "已改坏的模型名"},
        }
    )

    data = service.reset_preset_model({"model_id": "preset-1"})

    restored_model = next(
        model for model in data["snapshot"]["models"] if model["id"] == "preset-1"
    )
    assert restored_model["name"] == "GPT-4.1"
    assert restored_model["api_url"] == "https://api.example.com/v1"


def test_model_app_service_reorder_model_accepts_ordered_model_ids() -> None:
    service = build_model_app_service()

    data = service.reorder_model(
        {
            "ordered_model_ids": ["preset-2", "preset-1"],
        }
    )

    snapshot = data["snapshot"]
    preset_ids = [
        model["id"] for model in snapshot["models"] if model["type"] == "PRESET"
    ]

    assert preset_ids == ["preset-2", "preset-1"]


def test_model_app_service_reorder_model_rejects_cross_group_ids() -> None:
    service = build_model_app_service()

    with pytest.raises(
        ValueError,
        match="ordered_model_ids must match one model group exactly",
    ):
        service.reorder_model(
            {
                "ordered_model_ids": ["preset-1", "custom-openai-1"],
            }
        )


def test_model_app_service_list_available_models_returns_loader_result() -> None:
    service = build_model_app_service(
        available_models_loader=lambda model: ["gpt-5.4", str(model["model_id"])],
    )

    data = service.list_available_models({"model_id": "preset-1"})

    assert data == {"models": ["gpt-5.4", "gpt-4.1"]}


def test_model_app_service_test_model_returns_runner_result() -> None:
    service = build_model_app_service(
        api_test_runner=lambda model: {
            "success": True,
            "result_msg": f"测试通过：{model['name']}",
        },
    )

    data = service.test_model({"model_id": "preset-1"})

    assert data["success"] is True
    assert data["result_msg"] == "测试通过：GPT-4.1"


def test_model_app_service_test_model_maps_engine_runner_summary() -> None:
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

    service = build_model_app_service(api_test_runner=api_test_runner)

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
