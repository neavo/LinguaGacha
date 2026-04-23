from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_task_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        task_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/tasks/snapshot")].mode == "json"
    assert (
        core_api_server.route_map[("POST", "/api/tasks/start-translation")].mode
        == "json"
    )
    assert ("POST", "/api/tasks/reset-analysis-failed") not in core_api_server.route_map
    assert ("POST", "/api/tasks/reset-translation-all") not in core_api_server.route_map
