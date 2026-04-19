from api.Server.Routes.TaskRoutes import TaskRoutes
from tests.api.server.route_contracts import RouteRecorder
from tests.api.server.route_contracts import TASK_ROUTE_PATHS


def test_task_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        TaskRoutes.START_TRANSLATION_PATH,
        TaskRoutes.STOP_TRANSLATION_PATH,
        TaskRoutes.RESET_TRANSLATION_ALL_PATH,
        TaskRoutes.RESET_TRANSLATION_FAILED_PATH,
        TaskRoutes.START_ANALYSIS_PATH,
        TaskRoutes.STOP_ANALYSIS_PATH,
        TaskRoutes.RESET_ANALYSIS_ALL_PATH,
        TaskRoutes.RESET_ANALYSIS_FAILED_PATH,
        TaskRoutes.IMPORT_ANALYSIS_GLOSSARY_PATH,
        TaskRoutes.SNAPSHOT_PATH,
        TaskRoutes.EXPORT_TRANSLATION_PATH,
    )

    assert actual_paths == TASK_ROUTE_PATHS


def test_task_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    TaskRoutes.register(recorder, object())

    assert recorder.json_routes == [("POST", path) for path in TASK_ROUTE_PATHS]
