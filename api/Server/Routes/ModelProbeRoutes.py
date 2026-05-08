from api.Contract.ApiPaths import ModelApiPaths
from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ModelProbeRoutes:
    """只注册仍由 Python Core 承担的模型探测接口。"""

    @classmethod
    def register(cls, core_api_server: CoreApiServer, model_probe_app_service) -> None:
        """注册内部路由，保持 HTTP 路径和服务方法映射集中。"""

        del cls
        core_api_server.add_json_route(
            "POST",
            ModelApiPaths.LIST_AVAILABLE_PATH,
            lambda request: ApiResponse(
                ok=True, data=model_probe_app_service.list_available_models(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            ModelApiPaths.TEST_PATH,
            lambda request: ApiResponse(
                ok=True, data=model_probe_app_service.test_model(request)
            ),
        )
