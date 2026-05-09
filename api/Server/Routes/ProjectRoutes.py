from api.Contract.ApiResponse import ApiResponse
from api.Contract.ApiPaths import ProjectApiPaths
from api.Server.CoreApiServer import CoreApiServer


class ProjectRoutes:
    """集中注册项目运行态相关路由。"""

    LOAD_PATH: str = ProjectApiPaths.LOAD_PATH
    CREATE_PREVIEW_PATH: str = ProjectApiPaths.CREATE_PREVIEW_PATH
    CREATE_COMMIT_PATH: str = ProjectApiPaths.CREATE_COMMIT_PATH
    OPEN_PREVIEW_PATH: str = ProjectApiPaths.OPEN_PREVIEW_PATH
    EXPORT_CONVERTED_TRANSLATION_PATH: str = (
        ProjectApiPaths.EXPORT_CONVERTED_TRANSLATION_PATH
    )
    WORKBENCH_PARSE_FILE_PATH: str = ProjectApiPaths.WORKBENCH_PARSE_FILE_PATH
    BOOTSTRAP_STREAM_PATH: str = ProjectApiPaths.BOOTSTRAP_STREAM_PATH

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        project_app_service=None,
        workbench_app_service=None,
        project_bootstrap_app_service=None,
    ) -> None:
        """bootstrap 采用 GET stream，避免把加载命令和首包读取揉成一体。"""

        if project_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.LOAD_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.load_project(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.CREATE_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.create_project_preview(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.CREATE_COMMIT_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.create_project_commit(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.OPEN_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.get_open_project_alignment_preview(
                        request
                    ),
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.EXPORT_CONVERTED_TRANSLATION_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.export_converted_translation(request),
                ),
            )
        if workbench_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_PARSE_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.parse_file(request)
                ),
            )
        if project_bootstrap_app_service is not None:
            core_api_server.add_stream_route(
                cls.BOOTSTRAP_STREAM_PATH,
                project_bootstrap_app_service.stream_to_handler,
            )
