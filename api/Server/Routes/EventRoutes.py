from api.Application.EventStreamService import EventStreamService
from api.Server.CoreApiServer import CoreApiServer


class EventRoutes:
    """集中注册运行态 patch 事件流。"""

    STREAM_PATH: str = "/api/events/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        event_stream_service: EventStreamService,
    ) -> None:
        """事件流沿用 SSE 传输层，并独立暴露稳定 URL。"""

        core_api_server.add_stream_route(
            cls.STREAM_PATH,
            event_stream_service.stream_to_handler,
        )
