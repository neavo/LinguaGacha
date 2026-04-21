from types import SimpleNamespace

from api.Server.CoreApiServer import CoreApiServer
from api.Server.Routes.V2.EventRoutes import V2EventRoutes


def test_v2_event_routes_register_expected_stream_contract():
    core_api_server = CoreApiServer()

    V2EventRoutes.register(
        core_api_server,
        SimpleNamespace(stream_to_handler=object()),
    )

    route_definition = core_api_server.route_map[("GET", "/api/v2/events/stream")]
    assert route_definition.mode == "stream"
