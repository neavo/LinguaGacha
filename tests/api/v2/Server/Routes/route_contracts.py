from collections.abc import Callable


class RouteRecorder:
    """记录路由注册结果，避免把闭包实现细节误当成公开契约。"""

    def __init__(self) -> None:
        self.json_routes: list[tuple[str, str]] = []
        self.stream_routes: list[str] = []

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.json_routes.append((method, path))

    def add_stream_route(
        self,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.stream_routes.append(path)


SETTINGS_ROUTE_PATHS: tuple[str, ...] = (
    "/api/settings/app",
    "/api/settings/update",
    "/api/settings/recent-projects/add",
    "/api/settings/recent-projects/remove",
)

EXTRA_ROUTE_PATHS: tuple[str, ...] = (
    "/api/extra/ts-conversion/options",
    "/api/extra/ts-conversion/start",
    "/api/extra/name-fields/snapshot",
    "/api/extra/name-fields/extract",
    "/api/extra/name-fields/translate",
    "/api/extra/name-fields/save-to-glossary",
)
