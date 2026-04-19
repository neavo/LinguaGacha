from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class WorkbenchRoutes:
    """集中注册工作台相关 API 路由。"""

    SNAPSHOT_PATH: str = "/api/workbench/snapshot"
    ADD_FILE_PATH: str = "/api/workbench/add-file"
    REPLACE_FILE_PATH: str = "/api/workbench/replace-file"
    REPLACE_FILE_BATCH_PATH: str = "/api/workbench/replace-file-batch"
    RESET_FILE_PATH: str = "/api/workbench/reset-file"
    RESET_FILE_BATCH_PATH: str = "/api/workbench/reset-file-batch"
    DELETE_FILE_PATH: str = "/api/workbench/delete-file"
    DELETE_FILE_BATCH_PATH: str = "/api/workbench/delete-file-batch"
    REORDER_FILES_PATH: str = "/api/workbench/reorder-files"
    FILE_PATCH_PATH: str = "/api/workbench/file-patch"
    EXTENSIONS_PATH: str = "/api/workbench/extensions"

    @classmethod
    def register(cls, core_api_server: CoreApiServer, workbench_app_service) -> None:
        """工作台接口统一使用 POST + JSON，避免页面继续绕过边界。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.get_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.ADD_FILE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.add_file(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REPLACE_FILE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.replace_file(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REPLACE_FILE_BATCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.replace_file_batch(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_FILE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.reset_file(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RESET_FILE_BATCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.reset_file_batch(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.DELETE_FILE_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.delete_file(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.DELETE_FILE_BATCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.delete_file_batch(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REORDER_FILES_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.reorder_files(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.FILE_PATCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.get_file_patch(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.EXTENSIONS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=workbench_app_service.get_supported_extensions(request),
            ),
        )
