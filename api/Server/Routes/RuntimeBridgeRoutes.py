from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class RuntimeBridgeRoutes:
    """注册 Electron main TS Gateway 专用的内部运行时桥路由。"""

    # 任务路径只给 TS Gateway 调用，不属于公开 `/api/tasks/*` 协议。
    START_TRANSLATION_PATH: str = "/internal/runtime/tasks/start-translation"
    STOP_TRANSLATION_PATH: str = "/internal/runtime/tasks/stop-translation"
    START_ANALYSIS_PATH: str = "/internal/runtime/tasks/start-analysis"
    STOP_ANALYSIS_PATH: str = "/internal/runtime/tasks/stop-analysis"
    START_RETRANSLATE_PATH: str = "/internal/runtime/tasks/start-retranslate"
    TRANSLATE_SINGLE_PATH: str = "/internal/runtime/tasks/translate-single"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        runtime_bridge_app_service,
    ) -> None:
        """注册内部路由，保持 HTTP 路径和服务方法映射集中。"""

        core_api_server.add_context_json_route(
            "POST",
            cls.START_TRANSLATION_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.start_translation(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.STOP_TRANSLATION_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.stop_translation(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.START_ANALYSIS_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.start_analysis(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.STOP_ANALYSIS_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.stop_analysis(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.START_RETRANSLATE_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.start_retranslate(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.TRANSLATE_SINGLE_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=runtime_bridge_app_service.translate_single(request, handler),
            ),
        )
