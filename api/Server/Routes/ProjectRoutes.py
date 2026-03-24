from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ProjectRoutes:
    """集中注册工程相关 HTTP 路由。"""

    LOAD_PATH: str = "/api/project/load"
    CREATE_PATH: str = "/api/project/create"
    SNAPSHOT_PATH: str = "/api/project/snapshot"
    UNLOAD_PATH: str = "/api/project/unload"
    EXTENSIONS_PATH: str = "/api/project/extensions"
    SOURCE_FILES_PATH: str = "/api/project/source-files"
    PREVIEW_PATH: str = "/api/project/preview"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        project_app_service,
    ) -> None:
        """工程接口统一使用 POST + JSON，避免 UI 继续绕过边界。"""

        core_api_server.add_json_route(
            "POST",
            cls.LOAD_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.load_project(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.CREATE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.create_project(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.get_project_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.UNLOAD_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.unload_project(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.EXTENSIONS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.get_supported_extensions(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SOURCE_FILES_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.collect_source_files(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PREVIEW_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=project_app_service.get_project_preview(request),
            ),
        )
