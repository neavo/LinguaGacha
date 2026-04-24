from api.Server.Routes.TaskRoutes import TaskRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


TASK_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/tasks/start-translation", "start_translation"),
    JsonRouteCase("/api/tasks/stop-translation", "stop_translation"),
    JsonRouteCase("/api/tasks/start-analysis", "start_analysis"),
    JsonRouteCase("/api/tasks/stop-analysis", "stop_analysis"),
    JsonRouteCase("/api/tasks/snapshot", "get_task_snapshot"),
    JsonRouteCase("/api/tasks/export-translation", "export_translation"),
    JsonRouteCase("/api/tasks/translate-single", "translate_single"),
)


def test_task_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    TaskRoutes.register(recorder, service)

    assert_registered_json_routes_delegate_to_service(
        recorder,
        TASK_ROUTE_CASES,
        service,
    )
