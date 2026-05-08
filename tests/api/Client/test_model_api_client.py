from copy import deepcopy

from api.Application.ModelProbeAppService import ModelProbeAppService
from api.Client.ApiClient import ApiClient
from api.Client.ModelApiClient import ModelApiClient
from api.Contract.ApiPaths import ModelApiPaths
from api.Models.Model import ModelPageSnapshot
from tests.api.support.application_fakes import FakeModelConfig


def build_model_snapshot_payload() -> dict[str, object]:
    return {
        "snapshot": {
            "active_model_id": "preset-1",
            "models": deepcopy(list(FakeModelConfig.DEFAULT_MODELS)),
        }
    }


def test_model_api_client_crud_methods_use_public_contract_paths(
    recording_api_client,
) -> None:
    client = ModelApiClient(recording_api_client)
    for path in (
        ModelApiPaths.SNAPSHOT_PATH,
        ModelApiPaths.UPDATE_PATH,
        ModelApiPaths.ACTIVATE_PATH,
        ModelApiPaths.ADD_PATH,
        ModelApiPaths.DELETE_PATH,
        ModelApiPaths.RESET_PRESET_PATH,
        ModelApiPaths.REORDER_PATH,
    ):
        recording_api_client.queue_post_response(path, build_model_snapshot_payload())

    snapshot = client.get_snapshot()
    updated = client.update_model("preset-1", {"name": "GPT-4.1 Updated"})
    activated = client.activate_model("preset-2")
    added = client.add_model("CUSTOM_ANTHROPIC")
    deleted = client.delete_model("custom-openai-1")
    reset = client.reset_preset_model("preset-1")
    reordered = client.reorder_models(["preset-2", "preset-1"])

    assert isinstance(snapshot, ModelPageSnapshot)
    assert isinstance(updated, ModelPageSnapshot)
    assert isinstance(activated, ModelPageSnapshot)
    assert isinstance(added, ModelPageSnapshot)
    assert isinstance(deleted, ModelPageSnapshot)
    assert isinstance(reset, ModelPageSnapshot)
    assert isinstance(reordered, ModelPageSnapshot)
    assert recording_api_client.post_requests == [
        (ModelApiPaths.SNAPSHOT_PATH, {}),
        (
            ModelApiPaths.UPDATE_PATH,
            {"model_id": "preset-1", "patch": {"name": "GPT-4.1 Updated"}},
        ),
        (ModelApiPaths.ACTIVATE_PATH, {"model_id": "preset-2"}),
        (ModelApiPaths.ADD_PATH, {"model_type": "CUSTOM_ANTHROPIC"}),
        (ModelApiPaths.DELETE_PATH, {"model_id": "custom-openai-1"}),
        (ModelApiPaths.RESET_PRESET_PATH, {"model_id": "preset-1"}),
        (ModelApiPaths.REORDER_PATH, {"ordered_model_ids": ["preset-2", "preset-1"]}),
    ]


def test_model_api_client_list_available_models_returns_models(
    start_api_server,
) -> None:
    model_probe_app_service = ModelProbeAppService(
        config_loader=lambda: FakeModelConfig(),
        available_models_loader=lambda model: ["gpt-5.4", str(model["model_id"])],
    )
    base_url = start_api_server(model_probe_app_service=model_probe_app_service)
    client = ModelApiClient(ApiClient(base_url))

    models = client.list_available_models("preset-1")

    assert models == ["gpt-5.4", "gpt-4.1"]


def test_model_api_client_test_model_returns_runner_result(
    start_api_server,
) -> None:
    model_probe_app_service = ModelProbeAppService(
        config_loader=lambda: FakeModelConfig(),
        api_test_runner=lambda model: {
            "success": True,
            "result_msg": f"test ok: {model['id']}",
        },
    )
    base_url = start_api_server(model_probe_app_service=model_probe_app_service)
    client = ModelApiClient(ApiClient(base_url))

    payload = client.test_model("preset-1")

    assert payload == {
        "success": True,
        "result_msg": "test ok: preset-1",
    }


def test_model_api_client_list_available_models_returns_empty_list_for_invalid_payload(
    recording_api_client,
) -> None:
    client = ModelApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ModelApiPaths.LIST_AVAILABLE_PATH,
        {"models": "invalid"},
    )

    models = client.list_available_models("preset-1")

    assert models == []
