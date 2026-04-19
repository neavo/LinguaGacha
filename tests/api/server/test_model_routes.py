from api.Server.Routes.ModelRoutes import ModelRoutes
from tests.api.server.route_contracts import MODEL_ROUTE_PATHS
from tests.api.server.route_contracts import RouteRecorder


def test_model_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        ModelRoutes.SNAPSHOT_PATH,
        ModelRoutes.UPDATE_PATH,
        ModelRoutes.ACTIVATE_PATH,
        ModelRoutes.ADD_PATH,
        ModelRoutes.DELETE_PATH,
        ModelRoutes.RESET_PRESET_PATH,
        ModelRoutes.REORDER_PATH,
        ModelRoutes.LIST_AVAILABLE_PATH,
        ModelRoutes.TEST_PATH,
    )

    assert actual_paths == MODEL_ROUTE_PATHS


def test_model_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    ModelRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in MODEL_ROUTE_PATHS]
