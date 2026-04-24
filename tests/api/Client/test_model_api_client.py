from collections.abc import Callable
from copy import deepcopy

from api.Application.ModelAppService import ModelAppService
from api.Client.ApiClient import ApiClient
from api.Client.ModelApiClient import ModelApiClient
from api.Models.Model import ModelPageSnapshot
from api.Server.Routes.ModelRoutes import ModelRoutes
from tests.api.support.application_fakes import FakeModelConfig
from tests.api.support.application_fakes import FakeModelManager


def build_model_api_client(
    start_api_server: Callable[..., str],
    *,
    model_app_service: ModelAppService | None = None,
) -> ModelApiClient:
    """统一启动模型测试服务，避免每个用例重复拼装同一套依赖。"""

    if model_app_service is None:
        fake_config = FakeModelConfig()
        model_app_service = ModelAppService(
            config_loader=lambda: fake_config,
            model_manager=FakeModelManager(),
        )
    base_url = start_api_server(model_app_service=model_app_service)
    return ModelApiClient(ApiClient(base_url))


def build_model_snapshot_payload() -> dict[str, object]:
    return {
        "snapshot": {
            "active_model_id": "preset-1",
            "models": deepcopy(list(FakeModelConfig.DEFAULT_MODELS)),
        }
    }


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


def test_model_api_client_update_model_preserves_zero_output_token_limit(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.update_model(
        "preset-1",
        {
            "threshold": {
                "output_token_limit": 0,
            },
        },
    )

    updated_model = next(model for model in snapshot.models if model.id == "preset-1")
    assert updated_model.threshold.output_token_limit == 0


def test_model_api_client_add_model_returns_snapshot_with_new_model(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.add_model("CUSTOM_ANTHROPIC")

    assert any(model.type == "CUSTOM_ANTHROPIC" for model in snapshot.models)


def test_model_api_client_reorder_models_returns_reordered_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    client = build_model_api_client(start_api_server)

    snapshot = client.reorder_models(["preset-2", "preset-1"])

    preset_ids = [model.id for model in snapshot.models if model.type == "PRESET"]

    assert preset_ids == ["preset-2", "preset-1"]


def test_model_api_client_list_available_models_returns_models(
    start_api_server: Callable[..., str],
) -> None:
    model_app_service = ModelAppService(
        config_loader=lambda: FakeModelConfig(),
        model_manager=FakeModelManager(),
        available_models_loader=lambda model: ["gpt-5.4", str(model["model_id"])],
    )
    client = build_model_api_client(
        start_api_server,
        model_app_service=model_app_service,
    )

    models = client.list_available_models("preset-1")

    assert models == ["gpt-5.4", "gpt-4.1"]


def test_model_api_client_test_model_returns_runner_result(
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
    client = build_model_api_client(
        start_api_server,
        model_app_service=model_app_service,
    )

    payload = client.test_model("preset-1")

    assert payload == {
        "success": True,
        "result_msg": "test ok: preset-1",
    }


def test_model_api_client_supports_activate_delete_reset_commands(
    recording_api_client,
) -> None:
    client = ModelApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ModelRoutes.ACTIVATE_PATH,
        build_model_snapshot_payload(),
    )
    recording_api_client.queue_post_response(
        ModelRoutes.DELETE_PATH,
        build_model_snapshot_payload(),
    )
    recording_api_client.queue_post_response(
        ModelRoutes.RESET_PRESET_PATH,
        build_model_snapshot_payload(),
    )

    activated = client.activate_model("preset-2")
    deleted = client.delete_model("custom-openai-1")
    reset = client.reset_preset_model("preset-1")

    assert isinstance(activated, ModelPageSnapshot)
    assert activated.active_model_id == "preset-1"
    assert isinstance(deleted, ModelPageSnapshot)
    assert isinstance(reset, ModelPageSnapshot)
    assert recording_api_client.post_requests == [
        (ModelRoutes.ACTIVATE_PATH, {"model_id": "preset-2"}),
        (ModelRoutes.DELETE_PATH, {"model_id": "custom-openai-1"}),
        (ModelRoutes.RESET_PRESET_PATH, {"model_id": "preset-1"}),
    ]


def test_model_api_client_list_available_models_returns_empty_list_for_invalid_payload(
    recording_api_client,
) -> None:
    client = ModelApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ModelRoutes.LIST_AVAILABLE_PATH,
        {"models": "invalid"},
    )

    models = client.list_available_models("preset-1")

    assert models == []
