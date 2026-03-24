from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class SettingsRoutes:
    """集中注册应用设置相关 HTTP 路由。"""

    SNAPSHOT_PATH: str = "/api/settings/app"
    UPDATE_PATH: str = "/api/settings/update"
    ADD_RECENT_PROJECT_PATH: str = "/api/settings/recent-projects/add"
    REMOVE_RECENT_PROJECT_PATH: str = "/api/settings/recent-projects/remove"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        settings_app_service,
    ) -> None:
        """设置接口统一走 POST + JSON，避免 UI 继续直连 Config。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=settings_app_service.get_app_settings(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.UPDATE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=settings_app_service.update_app_settings(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.ADD_RECENT_PROJECT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=settings_app_service.add_recent_project(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REMOVE_RECENT_PROJECT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=settings_app_service.remove_recent_project(request),
            ),
        )
