from api.v2.Contract.ApiResponse import ApiResponse
from api.v2.Server.CoreApiServer import CoreApiServer


class QualityRoutes:
    """集中注册质量规则相关 HTTP 路由。"""

    UPDATE_META_PATH: str = "/api/v2/quality/rules/update-meta"
    SAVE_ENTRIES_PATH: str = "/api/v2/quality/rules/save-entries"
    IMPORT_RULES_PATH: str = "/api/v2/quality/rules/import"
    EXPORT_RULES_PATH: str = "/api/v2/quality/rules/export"
    RULE_PRESETS_PATH: str = "/api/v2/quality/rules/presets"
    RULE_PRESET_READ_PATH: str = "/api/v2/quality/rules/presets/read"
    RULE_PRESET_SAVE_PATH: str = "/api/v2/quality/rules/presets/save"
    RULE_PRESET_RENAME_PATH: str = "/api/v2/quality/rules/presets/rename"
    RULE_PRESET_DELETE_PATH: str = "/api/v2/quality/rules/presets/delete"
    STATISTICS_PATH: str = "/api/v2/quality/rules/statistics"
    PROMPT_TEMPLATE_PATH: str = "/api/v2/quality/prompts/template"
    PROMPT_SAVE_PATH: str = "/api/v2/quality/prompts/save"
    PROMPT_IMPORT_PATH: str = "/api/v2/quality/prompts/import"
    PROMPT_EXPORT_PATH: str = "/api/v2/quality/prompts/export"
    PROMPT_PRESETS_PATH: str = "/api/v2/quality/prompts/presets"
    PROMPT_PRESET_READ_PATH: str = "/api/v2/quality/prompts/presets/read"
    PROMPT_PRESET_SAVE_PATH: str = "/api/v2/quality/prompts/presets/save"
    PROMPT_PRESET_RENAME_PATH: str = "/api/v2/quality/prompts/presets/rename"
    PROMPT_PRESET_DELETE_PATH: str = "/api/v2/quality/prompts/presets/delete"

    @classmethod
    def register(cls, core_api_server: CoreApiServer, quality_rule_app_service) -> None:
        core_api_server.add_json_route(
            "POST",
            cls.UPDATE_META_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.update_rule_meta(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.SAVE_ENTRIES_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.save_rule_entries(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.IMPORT_RULES_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.import_rules(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.EXPORT_RULES_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.export_rules(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RULE_PRESETS_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.list_rule_presets(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RULE_PRESET_READ_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.read_rule_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RULE_PRESET_SAVE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.save_rule_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RULE_PRESET_RENAME_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.rename_rule_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.RULE_PRESET_DELETE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.delete_rule_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.STATISTICS_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.build_rule_statistics(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_TEMPLATE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.get_prompt_template(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_SAVE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.save_prompt(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_IMPORT_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.import_prompt(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_EXPORT_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.export_prompt(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_PRESETS_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.list_prompt_presets(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_PRESET_READ_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.read_prompt_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_PRESET_SAVE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.save_prompt_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_PRESET_RENAME_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.rename_prompt_preset(request)
            ),
        )
        core_api_server.add_json_route(
            "POST",
            cls.PROMPT_PRESET_DELETE_PATH,
            lambda request: ApiResponse(
                ok=True, data=quality_rule_app_service.delete_prompt_preset(request)
            ),
        )
