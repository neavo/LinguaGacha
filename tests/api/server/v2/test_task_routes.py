from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_v2_task_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_v2_routes(
        core_api_server,
        v2_task_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/v2/tasks/snapshot")].mode == "json"
    assert (
        core_api_server.route_map[("POST", "/api/v2/tasks/start-translation")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/tasks/import-analysis-glossary")].mode
        == "json"
    )
