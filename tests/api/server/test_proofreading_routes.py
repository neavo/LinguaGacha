from collections.abc import Callable

from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from tests.api.server.route_contracts import PHASE_TWO_PROOFREADING_ROUTE_PATHS


class RouteRecorder:
    """记录校对路由注册结果，避免把闭包实现细节当成断言目标。"""

    def __init__(self) -> None:
        self.routes: list[tuple[str, str]] = []

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.routes.append((method, path))


def test_proofreading_routes_paths_match_boundary_contract() -> None:
    actual_paths = (
        ProofreadingRoutes.SNAPSHOT_PATH,
        ProofreadingRoutes.FILE_PATCH_PATH,
        ProofreadingRoutes.FILTER_PATH,
        ProofreadingRoutes.SEARCH_PATH,
        ProofreadingRoutes.SAVE_ITEM_PATH,
        ProofreadingRoutes.SAVE_ALL_PATH,
        ProofreadingRoutes.REPLACE_ALL_PATH,
        ProofreadingRoutes.RECHECK_ITEM_PATH,
        ProofreadingRoutes.RETRANSLATE_ITEMS_PATH,
    )

    assert actual_paths == PHASE_TWO_PROOFREADING_ROUTE_PATHS


def test_proofreading_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    ProofreadingRoutes.register(recorder, object())

    assert recorder.routes == [
        ("POST", path) for path in PHASE_TWO_PROOFREADING_ROUTE_PATHS
    ]
