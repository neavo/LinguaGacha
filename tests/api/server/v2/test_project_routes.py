from api.Application.V2.ProjectBootstrapAppService import V2ProjectBootstrapAppService
from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_items_block(self):
        return {"schema": "project-items.v1", "fields": ["item_id"], "rows": [[1]]}


def test_v2_project_routes_register_bootstrap_stream():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_v2_routes(
        core_api_server,
        project_bootstrap_app_service=V2ProjectBootstrapAppService(
            StubRuntimeService()
        ),
    )

    route_definition = core_api_server.route_map[
        ("GET", "/api/v2/project/bootstrap/stream")
    ]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_v2_project_command_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_v2_routes(
        core_api_server,
        v2_project_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/v2/project/load")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/v2/project/snapshot")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/v2/project/preview")].mode == "json"


def test_server_bootstrap_registers_v2_project_runtime_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_v2_routes(
        core_api_server,
        workbench_app_service=object(),
        proofreading_app_service=object(),
    )

    assert (
        core_api_server.route_map[("POST", "/api/v2/project/workbench/snapshot")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/project/proofreading/snapshot")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/project/proofreading/save-item")].mode
        == "json"
    )
