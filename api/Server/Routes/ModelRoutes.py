from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ModelRoutes:
    """集中注册模型管理相关 HTTP 路由。"""

    SNAPSHOT_PATH: str = "/api/models/snapshot"
    UPDATE_PATH: str = "/api/models/update"
    ACTIVATE_PATH: str = "/api/models/activate"
    ADD_PATH: str = "/api/models/add"
    DELETE_PATH: str = "/api/models/delete"
    RESET_PRESET_PATH: str = "/api/models/reset-preset"
    REORDER_PATH: str = "/api/models/reorder"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        model_app_service,
    ) -> None:
        """模型接口统一走 POST + JSON，避免页面继续绕过边界。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.get_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.UPDATE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.update_model(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.ACTIVATE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.activate_model(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.ADD_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.add_model(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.DELETE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.delete_model(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_PRESET_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.reset_preset_model(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REORDER_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=model_app_service.reorder_model(request),
            ),
        )
