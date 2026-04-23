from types import SimpleNamespace

from api.Application.EventStreamService import EventStreamService
from api.Bridge.ProjectPatchEventBridge import ProjectPatchEventBridge
from api.Server.CoreApiServer import CoreApiServer
from api.Server.Routes.EventRoutes import EventRoutes
from api.Server.ServerBootstrap import ServerBootstrap


def test_event_routes_register_expected_stream_contract():
    core_api_server = CoreApiServer()

    EventRoutes.register(
        core_api_server,
        SimpleNamespace(stream_to_handler=object()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/events/stream")]
    assert route_definition.mode == "stream"


def test_server_bootstrap_registers_event_stream_route():
    core_api_server = CoreApiServer()

    ServerBootstrap.register_api_routes(
        core_api_server,
        event_stream_service=EventStreamService(event_bridge=ProjectPatchEventBridge()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/events/stream")]
    assert route_definition.mode == "stream"
