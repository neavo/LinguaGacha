from collections.abc import Callable

from api.Server.Routes.ModelRoutes import ModelRoutes


class RouteRecorder:
    """记录模型路由注册结果，避免把内部闭包细节当成断言目标。"""

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


def test_model_routes_paths_match_expected_contract() -> None:
    expected_paths = (
        "/api/models/snapshot",
        "/api/models/update",
        "/api/models/activate",
        "/api/models/add",
        "/api/models/delete",
        "/api/models/reset-preset",
        "/api/models/reorder",
        "/api/models/list-available",
        "/api/models/test",
    )
    actual_paths = (
        ModelRoutes.SNAPSHOT_PATH,
        ModelRoutes.UPDATE_PATH,
        ModelRoutes.ACTIVATE_PATH,
        ModelRoutes.ADD_PATH,
        ModelRoutes.DELETE_PATH,
        ModelRoutes.RESET_PRESET_PATH,
        ModelRoutes.REORDER_PATH,
        ModelRoutes.LIST_AVAILABLE_PATH,
        ModelRoutes.TEST_PATH,
    )

    assert actual_paths == expected_paths


def test_model_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    ModelRoutes.register(recorder, object())

    assert recorder.routes == [
        ("POST", ModelRoutes.SNAPSHOT_PATH),
        ("POST", ModelRoutes.UPDATE_PATH),
        ("POST", ModelRoutes.ACTIVATE_PATH),
        ("POST", ModelRoutes.ADD_PATH),
        ("POST", ModelRoutes.DELETE_PATH),
        ("POST", ModelRoutes.RESET_PRESET_PATH),
        ("POST", ModelRoutes.REORDER_PATH),
        ("POST", ModelRoutes.LIST_AVAILABLE_PATH),
        ("POST", ModelRoutes.TEST_PATH),
    ]
