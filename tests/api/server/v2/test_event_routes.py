from types import SimpleNamespace

from api.Application.EventStreamService import EventStreamService
from api.Bridge.V2.EventBridge import V2EventBridge
from api.Server.CoreApiServer import CoreApiServer
from api.Server.Routes.V2.EventRoutes import V2EventRoutes
from api.Server.ServerBootstrap import ServerBootstrap


def test_v2_event_routes_register_expected_stream_contract():
    core_api_server = CoreApiServer()

    V2EventRoutes.register(
        core_api_server,
        SimpleNamespace(stream_to_handler=object()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/v2/events/stream")]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_v2_event_stream_route():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_v2_routes(
        core_api_server,
        v2_event_stream_service=EventStreamService(event_bridge=V2EventBridge()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/v2/events/stream")]
    assert route_definition.mode == "stream"
