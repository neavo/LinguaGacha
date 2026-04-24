from api.Server.Routes.QualityRoutes import QualityRoutes
from tests.api.Server.Routes.route_contracts import JsonRouteCase
from tests.api.Server.Routes.route_contracts import RecordingRouteService
from tests.api.Server.Routes.route_contracts import RouteRecorder
from tests.api.Server.Routes.route_contracts import (
    assert_registered_json_routes_delegate_to_service,
)


QUALITY_ROUTE_CASES: tuple[JsonRouteCase, ...] = (
    JsonRouteCase("/api/quality/rules/update-meta", "update_rule_meta"),
    JsonRouteCase("/api/quality/rules/save-entries", "save_rule_entries"),
    JsonRouteCase("/api/quality/rules/import", "import_rules"),
    JsonRouteCase("/api/quality/rules/export", "export_rules"),
    JsonRouteCase("/api/quality/rules/presets", "list_rule_presets"),
    JsonRouteCase("/api/quality/rules/presets/read", "read_rule_preset"),
    JsonRouteCase("/api/quality/rules/presets/save", "save_rule_preset"),
    JsonRouteCase("/api/quality/rules/presets/rename", "rename_rule_preset"),
    JsonRouteCase("/api/quality/rules/presets/delete", "delete_rule_preset"),
    JsonRouteCase("/api/quality/prompts/template", "get_prompt_template"),
    JsonRouteCase("/api/quality/prompts/save", "save_prompt"),
    JsonRouteCase("/api/quality/prompts/import", "read_prompt_import_text"),
    JsonRouteCase("/api/quality/prompts/export", "export_prompt"),
    JsonRouteCase("/api/quality/prompts/presets", "list_prompt_presets"),
    JsonRouteCase("/api/quality/prompts/presets/read", "read_prompt_preset"),
    JsonRouteCase("/api/quality/prompts/presets/save", "save_prompt_preset"),
    JsonRouteCase("/api/quality/prompts/presets/rename", "rename_prompt_preset"),
    JsonRouteCase("/api/quality/prompts/presets/delete", "delete_prompt_preset"),
)


def test_quality_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()
    service = RecordingRouteService()

    QualityRoutes.register(recorder, service)

    assert_registered_json_routes_delegate_to_service(
        recorder,
        QUALITY_ROUTE_CASES,
        service,
    )
