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
