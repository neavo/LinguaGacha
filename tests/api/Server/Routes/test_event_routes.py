from api.Server.Routes.EventRoutes import EventRoutes
from tests.api.Server.Routes.route_contracts import RouteRecorder


class StubEventStreamService:
    def __init__(self) -> None:
        self.streamed_handlers: list[object] = []

    def stream_to_handler(self, handler) -> None:
        self.streamed_handlers.append(handler)


def test_event_routes_register_expected_stream_contract() -> None:
    recorder = RouteRecorder()
    event_stream_service = StubEventStreamService()

    EventRoutes.register(recorder, event_stream_service)
    recorder.stream_handlers["/api/events/stream"]("handler")

    assert recorder.stream_routes == ["/api/events/stream"]
    assert recorder.json_routes == []
    assert event_stream_service.streamed_handlers == ["handler"]
