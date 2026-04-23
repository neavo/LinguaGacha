from api.Server.CoreApiServer import CoreApiServer
from api.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_model_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        model_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/models/snapshot")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/models/update")].mode == "json"
    assert (
        core_api_server.route_map[("POST", "/api/models/list-available")].mode == "json"
    )
