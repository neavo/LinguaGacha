from api.Application.ExtraAppService import ExtraAppService
from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ExtraRoutes:
    """集中注册 Extra 页面的最小实验室路由，先打通首条 API 化闭环。"""

    SNAPSHOT_PATH: str = "/api/extra/laboratory/snapshot"
    UPDATE_PATH: str = "/api/extra/laboratory/update"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        extra_app_service: ExtraAppService,
    ) -> None:
        """Extra 页面统一走路由层，避免 UI 继续直连 Core 单例。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=extra_app_service.get_laboratory_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.UPDATE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=extra_app_service.update_laboratory_settings(request),
            ),
        )
