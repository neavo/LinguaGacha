from collections.abc import Callable

import pytest

from api.Application.ModelAppService import ModelAppService
from tests.api.support.application_fakes import FakeModelConfig
from tests.api.support.application_fakes import FakeModelManager


def build_model_app_service(
    *,
    available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
    api_test_runner: Callable[[dict[str, object]], dict[str, object]] | None = None,
) -> ModelAppService:
    """统一构造模型应用服务测试桩，避免每个用例重复拼装依赖。"""

    fake_config = FakeModelConfig()
    return ModelAppService(
        config_loader=lambda: fake_config,
        model_manager=FakeModelManager(),
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


def test_model_app_service_reorder_model_keeps_operation_payload_for_legacy_client() -> (
    None
):
    service = build_model_app_service()

    data = service.reorder_model(
        {
            "model_id": "preset-2",
            "operation": "MOVE_UP",
        }
    )

    snapshot = data["snapshot"]
    preset_ids = [
        model["id"] for model in snapshot["models"] if model["type"] == "PRESET"
    ]

    assert preset_ids == ["preset-2", "preset-1"]


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
