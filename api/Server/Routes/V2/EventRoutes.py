from api.Application.EventStreamService import EventStreamService
from api.Server.CoreApiServer import CoreApiServer


class V2EventRoutes:
    """集中注册 V2 运行态 patch 事件流。"""

    STREAM_PATH: str = "/api/v2/events/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        event_stream_service: EventStreamService,
    ) -> None:
        """V2 事件流沿用 SSE 传输层，但独立暴露版本化 URL。"""

        core_api_server.add_stream_route(
            cls.STREAM_PATH,
            event_stream_service.stream_to_handler,
        )
