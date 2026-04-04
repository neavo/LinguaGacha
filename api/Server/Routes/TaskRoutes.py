from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class TaskRoutes:
    """集中注册任务相关 API 路由。"""

    START_TRANSLATION_PATH: str = "/api/tasks/start-translation"
    STOP_TRANSLATION_PATH: str = "/api/tasks/stop-translation"
    START_ANALYSIS_PATH: str = "/api/tasks/start-analysis"
    STOP_ANALYSIS_PATH: str = "/api/tasks/stop-analysis"
    SNAPSHOT_PATH: str = "/api/tasks/snapshot"
    EXPORT_TRANSLATION_PATH: str = "/api/tasks/export-translation"

    @classmethod
    def register(cls, core_api_server: CoreApiServer, task_app_service) -> None:
        """任务命令与查询统一收口到路由层。"""

        core_api_server.add_json_route(
            "POST",
            cls.START_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.start_translation(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.STOP_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.stop_translation(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.START_ANALYSIS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.start_analysis(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.STOP_ANALYSIS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.stop_analysis(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.get_task_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.EXPORT_TRANSLATION_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=task_app_service.export_translation(request),
            ),
        )
