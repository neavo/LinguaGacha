from api.Server.Routes.QualityRoutes import QualityRoutes
from tests.api.server.route_contracts import PHASE_TWO_QUALITY_ROUTE_PATHS
from tests.api.server.route_contracts import RouteRecorder


def test_quality_routes_paths_match_boundary_contract() -> None:
    actual_paths = (
        QualityRoutes.SNAPSHOT_PATH,
        QualityRoutes.UPDATE_META_PATH,
        QualityRoutes.SAVE_ENTRIES_PATH,
        QualityRoutes.IMPORT_RULES_PATH,
        QualityRoutes.EXPORT_RULES_PATH,
        QualityRoutes.RULE_PRESETS_PATH,
        QualityRoutes.RULE_PRESET_READ_PATH,
        QualityRoutes.RULE_PRESET_SAVE_PATH,
        QualityRoutes.RULE_PRESET_RENAME_PATH,
        QualityRoutes.RULE_PRESET_DELETE_PATH,
        QualityRoutes.QUERY_PROOFREADING_PATH,
        QualityRoutes.STATISTICS_PATH,
        QualityRoutes.PROMPT_SNAPSHOT_PATH,
        QualityRoutes.PROMPT_TEMPLATE_PATH,
        QualityRoutes.PROMPT_SAVE_PATH,
        QualityRoutes.PROMPT_IMPORT_PATH,
        QualityRoutes.PROMPT_EXPORT_PATH,
        QualityRoutes.PROMPT_PRESETS_PATH,
        QualityRoutes.PROMPT_PRESET_READ_PATH,
        QualityRoutes.PROMPT_PRESET_SAVE_PATH,
        QualityRoutes.PROMPT_PRESET_RENAME_PATH,
        QualityRoutes.PROMPT_PRESET_DELETE_PATH,
    )

    assert actual_paths == PHASE_TWO_QUALITY_ROUTE_PATHS


def test_quality_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    QualityRoutes.register(recorder, object())

    assert recorder.json_routes == [
        ("POST", path) for path in PHASE_TWO_QUALITY_ROUTE_PATHS
    ]
