from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer


class QualityRoutes:
    """集中注册质量规则相关 HTTP 路由。"""

    SNAPSHOT_PATH: str = "/api/quality/rules/snapshot"
    UPDATE_META_PATH: str = "/api/quality/rules/update-meta"
    SAVE_ENTRIES_PATH: str = "/api/quality/rules/save-entries"
    QUERY_PROOFREADING_PATH: str = "/api/quality/rules/query-proofreading"

    @classmethod
    def register(cls, core_api_server: CoreApiServer, quality_rule_app_service) -> None:
        """质量规则命令与查询统一走 JSON 路由。"""

        core_api_server.add_json_route(
            "POST",
            cls.SNAPSHOT_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=quality_rule_app_service.get_rule_snapshot(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.UPDATE_META_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=quality_rule_app_service.update_rule_meta(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SAVE_ENTRIES_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=quality_rule_app_service.save_rule_entries(request),
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.QUERY_PROOFREADING_PATH,
            lambda request: ApiResponse(
                ok=True,
                data=quality_rule_app_service.query_proofreading(request),
            ),
        )
