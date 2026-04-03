from collections.abc import Callable

from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from api.Server.Routes.QualityRoutes import QualityRoutes
from tests.api.server.route_contracts import PHASE_TWO_PROOFREADING_ROUTE_PATHS
from tests.api.server.route_contracts import PHASE_TWO_QUALITY_ROUTE_PATHS


class RouteRecorder:
    """记录对外注册的路由契约，避免把 Mock 调用细节当主断言。"""

    def __init__(self) -> None:
        self.routes: list[tuple[str, str]] = []

    def add_json_route(
        self, method: str, path: str, handler: Callable[..., object]
    ) -> None:
        del handler
        self.routes.append((method, path))


def test_phase_two_route_paths_match_boundary_contract() -> None:
    # 准备
    quality_paths = (
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
    proofreading_paths = (
        ProofreadingRoutes.SNAPSHOT_PATH,
        ProofreadingRoutes.FILTER_PATH,
        ProofreadingRoutes.SEARCH_PATH,
        ProofreadingRoutes.SAVE_ITEM_PATH,
        ProofreadingRoutes.SAVE_ALL_PATH,
        ProofreadingRoutes.REPLACE_ALL_PATH,
        ProofreadingRoutes.RECHECK_ITEM_PATH,
        ProofreadingRoutes.RETRANSLATE_ITEMS_PATH,
    )

    # 执行
    quality_contract_paths = quality_paths
    proofreading_contract_paths = proofreading_paths

    # 断言
    assert quality_contract_paths == PHASE_TWO_QUALITY_ROUTE_PATHS
    assert proofreading_contract_paths == PHASE_TWO_PROOFREADING_ROUTE_PATHS


def test_quality_routes_register_expected_http_contract() -> None:
    # 准备
    recorder = RouteRecorder()

    # 执行
    QualityRoutes.register(recorder, object())

    # 断言
    assert recorder.routes == [("POST", path) for path in PHASE_TWO_QUALITY_ROUTE_PATHS]


def test_proofreading_routes_register_expected_http_contract() -> None:
    # 准备
    recorder = RouteRecorder()

    # 执行
    ProofreadingRoutes.register(recorder, object())

    # 断言
    assert recorder.routes == [
        ("POST", path) for path in PHASE_TWO_PROOFREADING_ROUTE_PATHS
    ]
