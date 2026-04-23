from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class TaskRoutes:
    """集中注册任务相关 HTTP 路由。"""

    START_TRANSLATION_PATH: str = "/api/tasks/start-translation"
    STOP_TRANSLATION_PATH: str = "/api/tasks/stop-translation"
    RESET_TRANSLATION_ALL_PATH: str = "/api/tasks/reset-translation-all"
    RESET_TRANSLATION_FAILED_PATH: str = "/api/tasks/reset-translation-failed"
    START_ANALYSIS_PATH: str = "/api/tasks/start-analysis"
    STOP_ANALYSIS_PATH: str = "/api/tasks/stop-analysis"
    RESET_ANALYSIS_ALL_PATH: str = "/api/tasks/reset-analysis-all"
    RESET_ANALYSIS_FAILED_PATH: str = "/api/tasks/reset-analysis-failed"
    SNAPSHOT_PATH: str = "/api/tasks/snapshot"
    EXPORT_TRANSLATION_PATH: str = "/api/tasks/export-translation"

    @classmethod
    def register(cls, core_api_server: CoreApiServer, task_app_service) -> None:
        core_api_server.add_json_route(
            "POST",
            cls.START_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.start_translation(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.STOP_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.stop_translation(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_TRANSLATION_ALL_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.reset_translation_all(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_TRANSLATION_FAILED_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.reset_translation_failed(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.START_ANALYSIS_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.start_analysis(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.STOP_ANALYSIS_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.stop_analysis(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_ANALYSIS_ALL_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.reset_analysis_all(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_ANALYSIS_FAILED_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.reset_analysis_failed(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.get_task_snapshot(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.EXPORT_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True, data=task_app_service.export_translation(request)
            ),
        )
