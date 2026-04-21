from api.v2.Server.CoreApiServer import CoreApiServer
from api.v2.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_v2_model_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        model_app_service=object(),
    )

    assert core_api_server.route_map[("POST", "/api/v2/models/snapshot")].mode == "json"
    assert core_api_server.route_map[("POST", "/api/v2/models/update")].mode == "json"
    assert (
        core_api_server.route_map[("POST", "/api/v2/models/list-available")].mode
        == "json"
    )
