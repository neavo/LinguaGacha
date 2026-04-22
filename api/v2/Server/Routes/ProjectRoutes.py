from api.v2.Contract.ApiResponse import ApiResponse
from api.v2.Server.CoreApiServer import CoreApiServer


class ProjectRoutes:
    """集中注册项目运行态相关路由。"""

    LOAD_PATH: str = "/api/v2/project/load"
    CREATE_PATH: str = "/api/v2/project/create"
    SNAPSHOT_PATH: str = "/api/v2/project/snapshot"
    UNLOAD_PATH: str = "/api/v2/project/unload"
    SOURCE_FILES_PATH: str = "/api/v2/project/source-files"
    PREVIEW_PATH: str = "/api/v2/project/preview"
    WORKBENCH_ADD_FILE_PATH: str = "/api/v2/project/workbench/add-file"
    WORKBENCH_REPLACE_FILE_PATH: str = "/api/v2/project/workbench/replace-file"
    WORKBENCH_RESET_FILE_PATH: str = "/api/v2/project/workbench/reset-file"
    WORKBENCH_DELETE_FILE_PATH: str = "/api/v2/project/workbench/delete-file"
    WORKBENCH_DELETE_FILE_BATCH_PATH: str = (
        "/api/v2/project/workbench/delete-file-batch"
    )
    WORKBENCH_REORDER_FILES_PATH: str = "/api/v2/project/workbench/reorder-files"
    WORKBENCH_FILE_PATCH_PATH: str = "/api/v2/project/workbench/file-patch"
    PROOFREADING_SAVE_ITEM_PATH: str = "/api/v2/project/proofreading/save-item"
    PROOFREADING_SAVE_ALL_PATH: str = "/api/v2/project/proofreading/save-all"
    PROOFREADING_REPLACE_ALL_PATH: str = "/api/v2/project/proofreading/replace-all"
    PROOFREADING_RETRANSLATE_ITEMS_PATH: str = (
        "/api/v2/project/proofreading/retranslate-items"
    )
    BOOTSTRAP_STREAM_PATH: str = "/api/v2/project/bootstrap/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        project_app_service=None,
        workbench_app_service=None,
        proofreading_app_service=None,
        project_bootstrap_app_service=None,
    ) -> None:
        """V2 bootstrap 采用 GET stream，避免把加载命令和首包读取揉成一体。"""

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
                cls.CREATE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.create_project(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.SNAPSHOT_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.get_project_snapshot(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.UNLOAD_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.unload_project(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.SOURCE_FILES_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.collect_source_files(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.get_project_preview(request)
                ),
            )
        if workbench_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_ADD_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.add_file(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_REPLACE_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.replace_file(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_RESET_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.reset_file(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_DELETE_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.delete_file(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_DELETE_FILE_BATCH_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.delete_file_batch(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_REORDER_FILES_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.reorder_files(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_FILE_PATCH_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.get_file_patch(request)
                ),
            )
        if proofreading_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.PROOFREADING_SAVE_ITEM_PATH,
                lambda request: ApiResponse(
                    ok=True, data=proofreading_app_service.save_item(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.PROOFREADING_SAVE_ALL_PATH,
                lambda request: ApiResponse(
                    ok=True, data=proofreading_app_service.save_all(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.PROOFREADING_REPLACE_ALL_PATH,
                lambda request: ApiResponse(
                    ok=True, data=proofreading_app_service.replace_all(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.PROOFREADING_RETRANSLATE_ITEMS_PATH,
                lambda request: ApiResponse(
                    ok=True, data=proofreading_app_service.retranslate_items(request)
                ),
            )
        if project_bootstrap_app_service is not None:
            core_api_server.add_stream_route(
                cls.BOOTSTRAP_STREAM_PATH,
                project_bootstrap_app_service.stream_to_handler,
            )
