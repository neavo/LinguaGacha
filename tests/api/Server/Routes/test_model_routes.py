from api.Server.Routes.ModelRoutes import ModelRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


MODEL_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/models/snapshot", "get_snapshot"),
    JsonRouteCase("/api/models/update", "update_model"),
    JsonRouteCase("/api/models/activate", "activate_model"),
    JsonRouteCase("/api/models/add", "add_model"),
    JsonRouteCase("/api/models/delete", "delete_model"),
    JsonRouteCase("/api/models/reset-preset", "reset_preset_model"),
    JsonRouteCase("/api/models/reorder", "reorder_model"),
    JsonRouteCase("/api/models/list-available", "list_available_models"),
    JsonRouteCase("/api/models/test", "test_model"),
)


def test_model_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    ModelRoutes.register(recorder, service)

    assert_registered_json_routes_delegate_to_service(
        recorder,
        MODEL_ROUTE_CASES,
        service,
    )
