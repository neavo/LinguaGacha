from api.Application.ProjectBootstrapAppService import ProjectBootstrapAppService
from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_items_block(self):
        return {"fields": ["item_id"], "rows": [[1]]}


def test_project_routes_register_bootstrap_stream():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        project_bootstrap_app_service=ProjectBootstrapAppService(StubRuntimeService()),
    )

    route_definition = core_api_server.route_map[
        ("GET", "/api/project/bootstrap/stream")
    ]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_project_command_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        project_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/project/load")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/project/snapshot")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/project/preview")].mode == "json"
    assert (
        core_api_server.route_map[
            ("POST", "/api/project/translation/reset-preview")
        ].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/project/translation/reset")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/project/analysis/reset-preview")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/project/analysis/reset")].mode
        == "json"
    )


def test_server_bootstrap_registers_project_runtime_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        workbench_app_service=object(),
        proofreading_app_service=object(),
    )

    assert (
        "POST",
        "/api/project/workbench/file-patch",
    ) not in core_api_server.route_map
    assert (
        core_api_server.route_map[("POST", "/api/project/proofreading/save-item")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/project/workbench/parse-file")].mode
        == "json"
    )
    assert (
        "POST",
        "/api/project/workbench/snapshot",
    ) not in core_api_server.route_map
    assert (
        "POST",
        "/api/project/proofreading/snapshot",
    ) not in core_api_server.route_map
