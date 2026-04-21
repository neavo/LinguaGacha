from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class V2ProjectRoutes:
    """集中注册 V2 项目运行态相关路由。"""

    BOOTSTRAP_STREAM_PATH: str = "/api/v2/project/bootstrap/stream"
    MUTATION_APPLY_PATH: str = "/api/v2/project/mutations/apply"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        project_bootstrap_app_service=None,
        project_mutation_app_service=None,
    ) -> None:
        """V2 bootstrap 采用 GET stream，避免把加载命令和首包读取揉成一体。"""

        if project_bootstrap_app_service is not None:
            core_api_server.add_stream_route(
                cls.BOOTSTRAP_STREAM_PATH,
                project_bootstrap_app_service.stream_to_handler,
            )
        if project_mutation_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.MUTATION_APPLY_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_mutation_app_service.apply_mutations(request),
                ),
            )
