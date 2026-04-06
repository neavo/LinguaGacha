from collections.abc import Callable

from api.Application.ModelAppService import ModelAppService
from api.Client.ApiClient import ApiClient
from api.Client.ModelApiClient import ModelApiClient
from model.Api.ModelModels import ModelPageSnapshot
from tests.api.support.application_fakes import FakeModelConfig
from tests.api.support.application_fakes import FakeModelManager


def build_model_api_client(
    start_api_server: Callable[..., str],
) -> ModelApiClient:
    """统一启动模型测试服务，避免每个用例重复拼装同一套依赖。"""

    fake_config = FakeModelConfig()
    model_app_service = ModelAppService(
        config_loader=lambda: fake_config,
        model_manager=FakeModelManager(),
    )
    base_url = start_api_server(model_app_service=model_app_service)
    return ModelApiClient(ApiClient(base_url))


def test_model_api_client_get_snapshot_returns_model_page_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.get_snapshot()

    assert isinstance(snapshot, ModelPageSnapshot)
    assert snapshot.active_model_id == "preset-1"
    assert len(snapshot.models) == 3


def test_model_api_client_update_model_returns_updated_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.update_model(
        "preset-1",
        {
            "name": "GPT-4.1 Updated",
        },
    )

    updated_model = next(model for model in snapshot.models if model.id == "preset-1")
    assert updated_model.name == "GPT-4.1 Updated"


def test_model_api_client_add_model_returns_snapshot_with_new_model(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.add_model("CUSTOM_ANTHROPIC")

    assert any(model.type == "CUSTOM_ANTHROPIC" for model in snapshot.models)


def test_model_routes_reorder_accepts_ordered_model_ids(
    start_api_server: Callable[..., str],
) -> None:
    fake_config = FakeModelConfig()
    model_app_service = ModelAppService(
        config_loader=lambda: fake_config,
        model_manager=FakeModelManager(),
    )
    api_client = ApiClient(start_api_server(model_app_service=model_app_service))

    payload = api_client.post(
        "/api/models/reorder",
        {
            "ordered_model_ids": ["preset-2", "preset-1"],
        },
    )

    preset_ids = [
        model["id"]
        for model in payload["snapshot"]["models"]
        if model["type"] == "PRESET"
    ]

    assert preset_ids == ["preset-2", "preset-1"]


def test_model_routes_list_available_models_returns_models(
    start_api_server: Callable[..., str],
) -> None:
    model_app_service = ModelAppService(
        config_loader=lambda: FakeModelConfig(),
        model_manager=FakeModelManager(),
        available_models_loader=lambda model: ["gpt-5.4", str(model["model_id"])],
    )
    api_client = ApiClient(start_api_server(model_app_service=model_app_service))

    payload = api_client.post("/api/models/list-available", {"model_id": "preset-1"})

    assert payload["models"] == ["gpt-5.4", "gpt-4.1"]


def test_model_routes_test_model_returns_runner_result(
    start_api_server: Callable[..., str],
) -> None:
    model_app_service = ModelAppService(
        config_loader=lambda: FakeModelConfig(),
        model_manager=FakeModelManager(),
        api_test_runner=lambda model: {
            "success": True,
            "result_msg": f"test ok: {model['id']}",
        },
    )
    api_client = ApiClient(start_api_server(model_app_service=model_app_service))

    payload = api_client.post("/api/models/test", {"model_id": "preset-1"})

    assert payload == {
        "success": True,
        "result_msg": "test ok: preset-1",
    }
