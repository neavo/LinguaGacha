from api.v2.Server.CoreApiServer import CoreApiServer
from api.v2.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_v2_quality_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        quality_rule_app_service=object(),
    )

    assert (
        core_api_server.route_map[("POST", "/api/v2/quality/rules/snapshot")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/quality/rules/statistics")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/quality/prompts/save")].mode
        == "json"
    )
