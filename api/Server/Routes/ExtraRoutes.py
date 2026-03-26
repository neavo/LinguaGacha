from api.Application.ExtraAppService import ExtraAppService
from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ExtraRoutes:
    """集中注册 Extra 页面的最小路由，逐步把工具页迁到 API 边界。"""

    SNAPSHOT_PATH: str = "/api/extra/laboratory/snapshot"
    UPDATE_PATH: str = "/api/extra/laboratory/update"
    TS_CONVERSION_OPTIONS_PATH: str = "/api/extra/ts-conversion/options"
    TS_CONVERSION_START_PATH: str = "/api/extra/ts-conversion/start"

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
        core_api_server.add_json_route(
            "POST",
            cls.TS_CONVERSION_OPTIONS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=extra_app_service.get_ts_conversion_options(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.TS_CONVERSION_START_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=extra_app_service.start_ts_conversion(request),
            ),
        )
