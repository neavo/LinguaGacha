from api.Server.Routes.SettingsRoutes import SettingsRoutes
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import SETTINGS_ROUTE_PATHS


def test_settings_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        SettingsRoutes.SNAPSHOT_PATH,
        SettingsRoutes.UPDATE_PATH,
        SettingsRoutes.ADD_RECENT_PROJECT_PATH,
        SettingsRoutes.REMOVE_RECENT_PROJECT_PATH,
    )

    assert actual_paths == SETTINGS_ROUTE_PATHS


def test_settings_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    SettingsRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in SETTINGS_ROUTE_PATHS]
