from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class TaskExecutorRoutes:
    """注册 TS Task Engine 专用的内部 work-unit executor 路由。"""

    TRANSLATION_CHUNK_PATH: str = "/internal/task-executor/translation-chunk"
    ANALYSIS_CHUNK_PATH: str = "/internal/task-executor/analysis-chunk"
    RETRANSLATE_ITEM_PATH: str = "/internal/task-executor/retranslate-item"
    TRANSLATE_SINGLE_PATH: str = "/internal/task-executor/translate-single"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        task_executor_app_service,
    ) -> None:
        """集中维护路径和服务方法映射，避免 executor 路由散落。"""

        core_api_server.add_context_json_route(
            "POST",
            cls.TRANSLATION_CHUNK_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=task_executor_app_service.execute_translation_chunk(
                    request,
                    handler,
                ),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.ANALYSIS_CHUNK_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=task_executor_app_service.execute_analysis_chunk(request, handler),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.RETRANSLATE_ITEM_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=task_executor_app_service.execute_retranslate_item(
                    request,
                    handler,
                ),
            ),
        )
        core_api_server.add_context_json_route(
            "POST",
            cls.TRANSLATE_SINGLE_PATH,
            lambda request, handler: ApiResponse(
                ok=True,
                data=task_executor_app_service.execute_translate_single(
                    request,
                    handler,
                ),
            ),
        )
