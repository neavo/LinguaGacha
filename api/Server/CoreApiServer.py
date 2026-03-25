import json
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer
from typing import Any

from api.Contract.ApiError import ApiError
from api.Contract.ApiResponse import ApiResponse


class CoreApiServer:
    """本地 Core API 最小服务。

    第一阶段先把 HTTP 边界稳定下来，后续业务接口都挂在这里注册。
    """

    HEALTH_PATH: str = "/api/health"
    CONTENT_TYPE_JSON: str = "application/json; charset=utf-8"

    @dataclass(frozen=True)
    class RouteDefinition:
        """路由定义同时描述 JSON 与流式两类处理模式。"""

        mode: str
        handler: Callable[..., Any]

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self.host = host
        self.port = port
        self.route_map: dict[tuple[str, str], CoreApiServer.RouteDefinition] = {}

    def register_routes(self) -> None:
        """统一注册公开路由，避免路由散落在处理器内部。"""

        self.add_json_route(
            "GET",
            self.HEALTH_PATH,
            lambda request: self.handle_health(),
        )

    def create_http_server(self) -> ThreadingHTTPServer:
        """创建 HTTP 服务实例，并把请求分发回当前服务对象。"""

        core_api_server = self

        class RequestHandler(BaseHTTPRequestHandler):
            """闭包处理器，保证请求仍由 CoreApiServer 统一分发。"""

            def do_GET(self) -> None:  # noqa: N802
                core_api_server.handle_http_request(self, "GET")

            def do_POST(self) -> None:  # noqa: N802
                core_api_server.handle_http_request(self, "POST")

            def log_message(self, format: str, *args: Any) -> None:
                # 测试服务默认静默，避免控制台被标准库 HTTP 噪音刷屏。
                del format
                del args

        return ThreadingHTTPServer((self.host, self.port), RequestHandler)

    def handle_http_request(
        self,
        handler: BaseHTTPRequestHandler,
        method: str,
    ) -> None:
        """把标准库 HTTP 请求转换为统一 API 响应。"""

        route_definition = self.route_map.get((method, handler.path))
        if route_definition is None:
            self.write_json(
                handler,
                status_code=404,
                response=ApiResponse(
                    ok=False,
                    error=ApiError(
                        code="not_found",
                        message=f"Route not found: {method} {handler.path}",
                    ).__dict__,
                ),
            )
            return

        if route_definition.mode == "stream":
            route_definition.handler(handler)
        else:
            request_body = self.read_json_request(handler)
            response = route_definition.handler(request_body)
            if isinstance(response, dict):
                response = ApiResponse(ok=True, data=response)
            self.write_json(
                handler,
                status_code=200,
                response=response,
            )

    def handle_health(self) -> ApiResponse:
        """最小健康检查接口，用于验证服务已启动并可响应 JSON。"""

        return ApiResponse(ok=True, data={"status": "ok"})

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[[dict[str, Any]], ApiResponse],
    ) -> None:
        """JSON 路由统一走响应包装，避免后续手写重复模板。"""

        self.route_map[(method, path)] = self.RouteDefinition("json", handler)

    def add_stream_route(
        self,
        path: str,
        handler: Callable[[BaseHTTPRequestHandler], None],
    ) -> None:
        """SSE 长连接需要直接接触原始 handler，因此单独登记。"""

        self.route_map[("GET", path)] = self.RouteDefinition("stream", handler)

    def write_json(
        self,
        handler: BaseHTTPRequestHandler,
        *,
        status_code: int,
        response: ApiResponse,
    ) -> None:
        """统一输出 JSON，避免各路由重复处理响应头和编码。"""

        payload_bytes = json.dumps(response.to_dict()).encode("utf-8")
        handler.send_response(status_code)
        handler.send_header("Content-Type", self.CONTENT_TYPE_JSON)
        handler.send_header("Content-Length", str(len(payload_bytes)))
        handler.end_headers()
        handler.wfile.write(payload_bytes)

    def read_json_request(self, handler: BaseHTTPRequestHandler) -> dict[str, Any]:
        """统一读取 JSON 请求体，缺省场景返回空字典。"""

        if handler.command != "POST":
            return {}

        raw_length = handler.headers.get("Content-Length", "0")
        content_length = int(raw_length or 0)
        if content_length <= 0:
            return {}

        payload_bytes = handler.rfile.read(content_length)
        if payload_bytes == b"":
            return {}
        return dict(json.loads(payload_bytes.decode("utf-8")))
