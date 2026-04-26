from api.Server.Routes.LogRoutes import LogRoutes
from tests.api.Server.Routes.route_contracts import RouteRecorder


class StubLogStreamService:
    def __init__(self) -> None:
        self.streamed_handlers: list[object] = []

    def stream_to_handler(self, handler) -> None:
        self.streamed_handlers.append(handler)


def test_log_routes_register_expected_stream_contract() -> None:
    recorder = RouteRecorder()
    log_stream_service = StubLogStreamService()

    LogRoutes.register(recorder, log_stream_service)
    recorder.stream_handlers["/api/logs/stream"]("handler")

    assert recorder.stream_routes == ["/api/logs/stream"]
    assert recorder.json_routes == []
    assert log_stream_service.streamed_handlers == ["handler"]
