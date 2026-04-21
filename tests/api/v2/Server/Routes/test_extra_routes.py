from api.v2.Server.Routes.ExtraRoutes import ExtraRoutes
from tests.api.v2.Server.Routes.route_contracts import EXTRA_ROUTE_PATHS
from tests.api.v2.Server.Routes.route_contracts import RouteRecorder


def test_extra_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        ExtraRoutes.TS_CONVERSION_OPTIONS_PATH,
        ExtraRoutes.TS_CONVERSION_START_PATH,
        ExtraRoutes.NAME_FIELD_SNAPSHOT_PATH,
        ExtraRoutes.NAME_FIELD_EXTRACT_PATH,
        ExtraRoutes.NAME_FIELD_TRANSLATE_PATH,
        ExtraRoutes.NAME_FIELD_SAVE_GLOSSARY_PATH,
    )

    assert actual_paths == EXTRA_ROUTE_PATHS


def test_extra_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    ExtraRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in EXTRA_ROUTE_PATHS]
