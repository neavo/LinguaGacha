from api.Application.LogStreamService import LogStreamService
from api.Server.CoreApiServer import CoreApiServer


class LogRoutes:
    """集中注册诊断日志事件流。"""

    STREAM_PATH: str = "/api/logs/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        log_stream_service: LogStreamService,
    ) -> None:
        """日志流独立于项目运行态事件流，避免诊断信息污染 ProjectStore。"""

        core_api_server.add_stream_route(
            cls.STREAM_PATH,
            log_stream_service.stream_to_handler,
        )
