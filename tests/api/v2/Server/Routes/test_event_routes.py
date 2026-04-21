from types import SimpleNamespace

from api.v2.Application.EventStreamService import EventStreamService
from api.v2.Bridge.EventBridge import ProjectPatchEventBridge
from api.v2.Server.CoreApiServer import CoreApiServer
from api.v2.Server.Routes.EventRoutes import EventRoutes
from api.v2.Server.ServerBootstrap import ServerBootstrap


def test_v2_event_routes_register_expected_stream_contract():
    core_api_server = CoreApiServer()

    EventRoutes.register(
        core_api_server,
        SimpleNamespace(stream_to_handler=object()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/v2/events/stream")]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_v2_event_stream_route():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        event_stream_service=EventStreamService(event_bridge=ProjectPatchEventBridge()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/v2/events/stream")]
    assert route_definition.mode == "stream"
