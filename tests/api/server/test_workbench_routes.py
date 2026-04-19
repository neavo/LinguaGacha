from api.Server.Routes.WorkbenchRoutes import WorkbenchRoutes
from tests.api.server.route_contracts import RouteRecorder
from tests.api.server.route_contracts import WORKBENCH_ROUTE_PATHS


def test_workbench_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        WorkbenchRoutes.SNAPSHOT_PATH,
        WorkbenchRoutes.ADD_FILE_PATH,
        WorkbenchRoutes.REPLACE_FILE_PATH,
        WorkbenchRoutes.REPLACE_FILE_BATCH_PATH,
        WorkbenchRoutes.RESET_FILE_PATH,
        WorkbenchRoutes.RESET_FILE_BATCH_PATH,
        WorkbenchRoutes.DELETE_FILE_PATH,
        WorkbenchRoutes.DELETE_FILE_BATCH_PATH,
        WorkbenchRoutes.REORDER_FILES_PATH,
        WorkbenchRoutes.FILE_PATCH_PATH,
        WorkbenchRoutes.EXTENSIONS_PATH,
    )

    assert actual_paths == WORKBENCH_ROUTE_PATHS


def test_workbench_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    WorkbenchRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in WORKBENCH_ROUTE_PATHS]
