from types import SimpleNamespace

from api.Server.Routes.EventRoutes import EventRoutes
from tests.api.server.route_contracts import EVENT_STREAM_PATH
from tests.api.server.route_contracts import RouteRecorder


def test_event_routes_path_matches_expected_contract() -> None:
    assert EventRoutes.STREAM_PATH == EVENT_STREAM_PATH


def test_event_routes_register_expected_stream_contract() -> None:
    recorder = RouteRecorder()
    event_stream_service = SimpleNamespace(stream_to_handler=object())

    EventRoutes.register(recorder, event_stream_service)

    assert recorder.stream_routes == [EVENT_STREAM_PATH]
