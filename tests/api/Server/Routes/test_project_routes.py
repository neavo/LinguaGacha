from api.Server.Routes.ProjectRoutes import ProjectRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


PROJECT_COMMAND_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/project/load", "load_project"),
    JsonRouteCase("/api/project/create", "create_project"),
    JsonRouteCase("/api/project/snapshot", "get_project_snapshot"),
    JsonRouteCase("/api/project/unload", "unload_project"),
    JsonRouteCase("/api/project/apply-prefilter", "apply_prefilter"),
    JsonRouteCase("/api/project/settings/sync-meta", "sync_project_settings_meta"),
    JsonRouteCase("/api/project/analysis/import-glossary", "import_analysis_glossary"),
    JsonRouteCase(
        "/api/project/translation/reset-preview", "preview_translation_reset"
    ),
    JsonRouteCase("/api/project/translation/reset", "apply_translation_reset"),
    JsonRouteCase("/api/project/analysis/reset-preview", "preview_analysis_reset"),
    JsonRouteCase("/api/project/analysis/reset", "apply_analysis_reset"),
    JsonRouteCase("/api/project/source-files", "collect_source_files"),
    JsonRouteCase("/api/project/preview", "get_project_preview"),
    JsonRouteCase(
        "/api/project/text-preserve/preset-rules",
        "get_text_preserve_preset_rules",
    ),
    JsonRouteCase(
        "/api/project/export-converted-translation",
        "export_converted_translation",
    ),
)

WORKBENCH_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/project/workbench/parse-file", "parse_file"),
    JsonRouteCase("/api/project/workbench/add-file", "add_file"),
    JsonRouteCase("/api/project/workbench/replace-file", "replace_file"),
    JsonRouteCase("/api/project/workbench/reset-file", "reset_file"),
    JsonRouteCase("/api/project/workbench/delete-file", "delete_file"),
    JsonRouteCase("/api/project/workbench/delete-file-batch", "delete_file_batch"),
    JsonRouteCase("/api/project/workbench/reorder-files", "reorder_files"),
)

PROOFREADING_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/project/proofreading/save-item", "save_item"),
    JsonRouteCase("/api/project/proofreading/save-all", "save_all"),
    JsonRouteCase("/api/project/proofreading/replace-all", "replace_all"),
    JsonRouteCase("/api/project/proofreading/retranslate-items", "retranslate_items"),
)


class StubBootstrapAppService:
    def __init__(self) -> None:
        self.streamed_handlers: list[object] = []

    def stream_to_handler(self, handler: object) -> None:
        self.streamed_handlers.append(handler)


def test_project_routes_register_bootstrap_stream() -> None:
    recorder = RouteRecorder()
    bootstrap_app_service = StubBootstrapAppService()

    ProjectRoutes.register(
        recorder,
        project_bootstrap_app_service=bootstrap_app_service,
    )
    recorder.stream_handlers["/api/project/bootstrap/stream"]("handler")

    assert recorder.stream_routes == ["/api/project/bootstrap/stream"]
    assert recorder.json_routes == []
    assert bootstrap_app_service.streamed_handlers == ["handler"]


def test_project_routes_register_project_command_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    ProjectRoutes.register(
        recorder,
        project_app_service=service,
    )

    assert_registered_json_routes_delegate_to_service(
        recorder,
        PROJECT_COMMAND_ROUTE_CASES,
        service,
    )


def test_project_routes_register_runtime_mutation_http_contract() -> None:
    recorder = RouteRecorder()
    workbench_service = RecordingRouteService()
    proofreading_service = RecordingRouteService()

    ProjectRoutes.register(
        recorder,
        workbench_app_service=workbench_service,
        proofreading_app_service=proofreading_service,
    )

    route_cases = WORKBENCH_ROUTE_CASES + PROOFREADING_ROUTE_CASES
    assert recorder.json_routes == [
        ("POST", route_case.path) for route_case in route_cases
    ]
    assert recorder.stream_routes == []

    for route_case in WORKBENCH_ROUTE_CASES:
        request = {"route": route_case.path}
        response = recorder.json_handlers[("POST", route_case.path)](request)

        assert response.to_dict() == {
            "ok": True,
            "data": {"handled_by": route_case.service_method, "request": request},
        }

    for route_case in PROOFREADING_ROUTE_CASES:
        request = {"route": route_case.path}
        response = recorder.json_handlers[("POST", route_case.path)](request)

        assert response.to_dict() == {
            "ok": True,
            "data": {"handled_by": route_case.service_method, "request": request},
        }

    assert workbench_service.calls == [
        (route_case.service_method, {"route": route_case.path})
        for route_case in WORKBENCH_ROUTE_CASES
    ]
    assert proofreading_service.calls == [
        (route_case.service_method, {"route": route_case.path})
        for route_case in PROOFREADING_ROUTE_CASES
    ]
