from api.Application.EventStreamService import EventStreamService
from api.Server.CoreApiServer import CoreApiServer


class EventRoutes:
    """集中注册事件流相关路由。"""

    STREAM_PATH: str = "/api/events/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        event_stream_service: EventStreamService,
    ) -> None:
        """事件流是长连接，单独注册为 stream 路由。"""

        core_api_server.add_stream_route(
            cls.STREAM_PATH,
            event_stream_service.stream_to_handler,
        )
