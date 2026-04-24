from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from api.Contract.ApiResponse import ApiResponse


@dataclass(frozen=True)
class JsonRouteCase:
    path: str
    service_method: str


class RouteRecorder:
    """记录路由注册结果，避免把闭包实现细节误当成公开契约。"""

    def __init__(self) -> None:
        self.json_routes: list[tuple[str, str]] = []
        self.json_handlers: dict[tuple[str, str], Callable[..., object]] = {}
        self.stream_routes: list[str] = []
        self.stream_handlers: dict[str, Callable[..., object]] = {}

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        self.json_routes.append((method, path))
        self.json_handlers[(method, path)] = handler

    def add_stream_route(
        self,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        self.stream_routes.append(path)
        self.stream_handlers[path] = handler


class RecordingRouteService:
    """按公开请求载荷记录路由委派结果，不关心内部闭包怎样拼接。"""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __getattr__(
        self, method_name: str
    ) -> Callable[[dict[str, Any]], dict[str, Any]]:
        def record(request: dict[str, Any]) -> dict[str, Any]:
            self.calls.append((method_name, request))
            return {"handled_by": method_name, "request": request}

        return record


def assert_registered_json_routes_delegate_to_service(
    recorder: RouteRecorder,
    route_cases: tuple[JsonRouteCase, ...],
    service: RecordingRouteService,
) -> None:
    assert recorder.json_routes == [
        ("POST", route_case.path) for route_case in route_cases
    ]
    assert recorder.stream_routes == []

    for route_case in route_cases:
        request = {"route": route_case.path}
        response = recorder.json_handlers[("POST", route_case.path)](request)

        assert isinstance(response, ApiResponse)
        assert response.to_dict() == {
            "ok": True,
            "data": {"handled_by": route_case.service_method, "request": request},
        }

    assert service.calls == [
        (route_case.service_method, {"route": route_case.path})
        for route_case in route_cases
    ]
