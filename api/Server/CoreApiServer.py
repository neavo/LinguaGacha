import json
from collections.abc import Callable
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

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self.host = host
        self.port = port
        self.route_map: dict[tuple[str, str], Callable[[], ApiResponse]] = {}

    def register_routes(self) -> None:
        """统一注册公开路由，避免路由散落在处理器内部。"""

        self.route_map[("GET", self.HEALTH_PATH)] = self.handle_health

    def create_http_server(self) -> ThreadingHTTPServer:
        """创建 HTTP 服务实例，并把请求分发回当前服务对象。"""

        core_api_server = self

        class RequestHandler(BaseHTTPRequestHandler):
            """闭包处理器，保证请求仍由 CoreApiServer 统一分发。"""

            def do_GET(self) -> None:  # noqa: N802
                core_api_server.handle_http_request(self, "GET")

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

        route_handler = self.route_map.get((method, handler.path))
        if route_handler is None:
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

        self.write_json(
            handler,
            status_code=200,
            response=route_handler(),
        )

    def handle_health(self) -> ApiResponse:
        """最小健康检查接口，用于验证服务已启动并可响应 JSON。"""

        return ApiResponse(ok=True, data={"status": "ok"})

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
