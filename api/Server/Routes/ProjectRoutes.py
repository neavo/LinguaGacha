from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ProjectRoutes:
    """集中注册项目运行态相关路由。"""

    LOAD_PATH: str = "/api/project/load"
    CREATE_PREVIEW_PATH: str = "/api/project/create-preview"
    CREATE_COMMIT_PATH: str = "/api/project/create-commit"
    SNAPSHOT_PATH: str = "/api/project/snapshot"
    UNLOAD_PATH: str = "/api/project/unload"
    OPEN_PREVIEW_PATH: str = "/api/project/open-preview"
    TRANSLATION_RESET_PREVIEW_PATH: str = "/api/project/translation/reset-preview"
    ANALYSIS_RESET_PREVIEW_PATH: str = "/api/project/analysis/reset-preview"
    SOURCE_FILES_PATH: str = "/api/project/source-files"
    PREVIEW_PATH: str = "/api/project/preview"
    TEXT_PRESERVE_PRESET_RULES_PATH: str = "/api/project/text-preserve/preset-rules"
    EXPORT_CONVERTED_TRANSLATION_PATH: str = "/api/project/export-converted-translation"
    WORKBENCH_PARSE_FILE_PATH: str = "/api/project/workbench/parse-file"
    PROOFREADING_SAVE_ITEM_PATH: str = "/api/project/proofreading/save-item"
    PROOFREADING_SAVE_ALL_PATH: str = "/api/project/proofreading/save-all"
    PROOFREADING_REPLACE_ALL_PATH: str = "/api/project/proofreading/replace-all"
    BOOTSTRAP_STREAM_PATH: str = "/api/project/bootstrap/stream"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        project_app_service=None,
        workbench_app_service=None,
        proofreading_app_service=None,
        project_bootstrap_app_service=None,
    ) -> None:
        """bootstrap 采用 GET stream，避免把加载命令和首包读取揉成一体。"""

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
                cls.CREATE_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.create_project_preview(request)
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.CREATE_COMMIT_PATH,
                lambda request: ApiResponse(
                    ok=True, data=project_app_service.create_project_commit(request)
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
                cls.OPEN_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.get_open_project_alignment_preview(
                        request
                    ),
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.TRANSLATION_RESET_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.preview_translation_reset(request),
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.ANALYSIS_RESET_PREVIEW_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.preview_analysis_reset(request),
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
            core_api_server.add_json_route(
                "POST",
                cls.TEXT_PRESERVE_PRESET_RULES_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.get_text_preserve_preset_rules(request),
                ),
            )
            core_api_server.add_json_route(
                "POST",
                cls.EXPORT_CONVERTED_TRANSLATION_PATH,
                lambda request: ApiResponse(
                    ok=True,
                    data=project_app_service.export_converted_translation(request),
                ),
            )
        if workbench_app_service is not None:
            core_api_server.add_json_route(
                "POST",
                cls.WORKBENCH_PARSE_FILE_PATH,
                lambda request: ApiResponse(
                    ok=True, data=workbench_app_service.parse_file(request)
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
        if project_bootstrap_app_service is not None:
            core_api_server.add_stream_route(
                cls.BOOTSTRAP_STREAM_PATH,
                project_bootstrap_app_service.stream_to_handler,
            )
