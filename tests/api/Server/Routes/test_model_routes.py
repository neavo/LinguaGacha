from api.Server.Routes.ModelProbeRoutes import ModelProbeRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


MODEL_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/models/list-available", "list_available_models"),
    JsonRouteCase("/api/models/test", "test_model"),
)


def test_model_probe_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    ModelProbeRoutes.register(recorder, service)

    assert_registered_json_routes_delegate_to_service(
        recorder,
        MODEL_ROUTE_CASES,
        service,
    )
