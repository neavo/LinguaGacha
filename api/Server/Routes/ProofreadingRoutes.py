from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class ProofreadingRoutes:
    """集中注册校对相关 HTTP 路由。"""

    SNAPSHOT_PATH: str = "/api/proofreading/snapshot"
    FILE_PATCH_PATH: str = "/api/proofreading/file-patch"
    FILTER_PATH: str = "/api/proofreading/filter"
    SEARCH_PATH: str = "/api/proofreading/search"
    SAVE_ITEM_PATH: str = "/api/proofreading/save-item"
    SAVE_ALL_PATH: str = "/api/proofreading/save-all"
    REPLACE_ALL_PATH: str = "/api/proofreading/replace-all"
    RECHECK_ITEM_PATH: str = "/api/proofreading/recheck-item"
    RETRANSLATE_ITEMS_PATH: str = "/api/proofreading/retranslate-items"

    @classmethod
    def register(
        cls,
        core_api_server: CoreApiServer,
        proofreading_app_service,
    ) -> None:
        """校对接口统一走 POST + JSON，避免页面继续绕过应用层。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.get_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.FILE_PATCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.get_file_patch(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.FILTER_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.filter_items(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SEARCH_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.search(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SAVE_ITEM_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.save_item(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SAVE_ALL_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.save_all(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.REPLACE_ALL_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.replace_all(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RECHECK_ITEM_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.recheck_item(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RETRANSLATE_ITEMS_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=proofreading_app_service.retranslate_items(request),
            ),
        )
