from api.Server.Routes.ProjectRoutes import ProjectRoutes
from tests.api.server.route_contracts import PROJECT_ROUTE_PATHS
from tests.api.server.route_contracts import RouteRecorder


def test_project_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        ProjectRoutes.LOAD_PATH,
        ProjectRoutes.CREATE_PATH,
        ProjectRoutes.SNAPSHOT_PATH,
        ProjectRoutes.UNLOAD_PATH,
        ProjectRoutes.EXTENSIONS_PATH,
        ProjectRoutes.SOURCE_FILES_PATH,
        ProjectRoutes.PREVIEW_PATH,
    )

    assert actual_paths == PROJECT_ROUTE_PATHS


def test_project_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    ProjectRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in PROJECT_ROUTE_PATHS]
