from api.v2.Server.CoreApiServer import CoreApiServer
from api.v2.Server.ServerBootstrap import ServerBootstrap


def test_server_bootstrap_registers_only_active_v2_quality_routes():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        quality_rule_app_service=object(),
    )

    assert ("POST", "/api/v2/quality/rules/snapshot") not in core_api_server.route_map
    assert (
        "POST",
        "/api/v2/quality/rules/query-proofreading",
    ) not in core_api_server.route_map
    assert ("POST", "/api/v2/quality/prompts/snapshot") not in core_api_server.route_map
    assert ("POST", "/api/v2/quality/rules/statistics") not in core_api_server.route_map
    assert (
        core_api_server.route_map[("POST", "/api/v2/quality/rules/save-entries")].mode
        == "json"
    )
    assert (
        core_api_server.route_map[("POST", "/api/v2/quality/prompts/save")].mode
        == "json"
    )
