from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class RuntimeBridgeRoutes:
    """注册 Electron main TS Gateway 专用的内部运行时桥路由。"""

    PROJECT_STATE_PATH: str = "/internal/runtime/project-state"
    SYNC_PATH: str = "/internal/runtime/sync"
    PARSE_PROJECT_ASSETS_PATH: str = "/internal/runtime/parse-project-assets"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        runtime_bridge_app_service,
    ) -> None:
        """注册内部路由，保持 HTTP 路径和服务方法映射集中。"""

        core_api_server.add_context_json_route(
            "POST",
            cls.PROJECT_STATE_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.get_project_state(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.SYNC_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.sync(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.PARSE_PROJECT_ASSETS_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.parse_project_assets(request, handler),
            ),
        )
