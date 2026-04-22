from api.v2.Application.ProjectBootstrapAppService import ProjectBootstrapAppService
from api.v2.Server.CoreApiServer import CoreApiServer
from api.v2.Server.ServerBootstrap import ServerBootstrap


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_items_block(self):
        return {"schema": "project-items.v1", "fields": ["item_id"], "rows": [[1]]}


def test_v2_project_routes_register_bootstrap_stream():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        project_bootstrap_app_service=ProjectBootstrapAppService(StubRuntimeService()),
    )

    route_definition = core_api_server.route_map[
        ("GET", "/api/v2/project/bootstrap/stream")
    ]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_v2_project_command_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        project_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/v2/project/load")].mode == "json"
    assert (
        core_api_server.route_map[("POST", "/api/v2/project/snapshot")].mode == "json"
    )
    assert core_api_server.route_map[("POST", "/api/v2/project/preview")].mode == "json"


def test_server_bootstrap_registers_v2_project_runtime_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        workbench_app_service=object(),
        proofreading_app_service=object(),
    )

    assert (
        "POST",
        "/api/v2/project/workbench/file-patch",
    ) not in core_api_server.route_map
    assert (
        core_api_server.route_map[
            ("POST", "/api/v2/project/proofreading/save-item")
        ].mode
        == "json"
    )
    assert (
        "POST",
        "/api/v2/project/workbench/snapshot",
    ) not in core_api_server.route_map
    assert (
        "POST",
        "/api/v2/project/proofreading/snapshot",
    ) not in core_api_server.route_map
