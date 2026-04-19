from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from tests.api.server.route_contracts import PHASE_TWO_PROOFREADING_ROUTE_PATHS
from tests.api.server.route_contracts import RouteRecorder


def test_proofreading_routes_paths_match_boundary_contract() -> None:
    actual_paths = (
        ProofreadingRoutes.SNAPSHOT_PATH,
        ProofreadingRoutes.FILE_PATCH_PATH,
        ProofreadingRoutes.ENTRY_PATCH_PATH,
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

    assert recorder.json_routes == [
        ("POST", path) for path in PHASE_TWO_PROOFREADING_ROUTE_PATHS
    ]
