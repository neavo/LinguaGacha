from api.Server.Routes.SettingsRoutes import SettingsRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


SETTINGS_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/settings/app", "get_app_settings"),
    JsonRouteCase("/api/settings/update", "update_app_settings"),
    JsonRouteCase("/api/settings/recent-projects/add", "add_recent_project"),
    JsonRouteCase("/api/settings/recent-projects/remove", "remove_recent_project"),
)


def test_settings_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    SettingsRoutes.register(recorder, service)

    assert_registered_json_routes_delegate_to_service(
        recorder,
        SETTINGS_ROUTE_CASES,
        service,
    )
