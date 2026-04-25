from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class LifecycleRoutes:
    """注册仅供 Electron main 使用的 Core 生命周期路由。"""

    SHUTDOWN_PATH: str = "/api/lifecycle/shutdown"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        core_lifecycle_app_service,
    ) -> None:
        """生命周期接口需要读取 token 请求头，因此使用上下文 JSON 路由。"""

        core_api_server.add_context_json_route(
            "POST",
            cls.SHUTDOWN_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=core_lifecycle_app_service.shutdown(request, handler),
            ),
        )
