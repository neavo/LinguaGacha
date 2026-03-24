from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ProjectRoutes:
    """集中注册工程相关 HTTP 路由。"""

    LOAD_PATH: str = "/api/project/load"
    CREATE_PATH: str = "/api/project/create"
    SNAPSHOT_PATH: str = "/api/project/snapshot"

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
