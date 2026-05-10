from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class LlmRequestRoutes:
    """注册 TS worker 专用的内部 LLM request adapter 路由。"""

    REQUEST_PATH: str = "/internal/llm/request"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        llm_request_app_service,
    ) -> None:
        """集中维护内部 LLM adapter 路径，避免旧 executor 路由继续扩散。"""

        core_api_server.add_context_json_route(
            "POST",
            cls.REQUEST_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=llm_request_app_service.request(request, handler),
            ),
        )
