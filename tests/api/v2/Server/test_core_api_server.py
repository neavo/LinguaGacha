import socket
from io import BytesIO

import pytest

from api.v2.Contract.ApiResponse import ApiResponse
from api.v2.Server.CoreApiServer import CoreApiServer


class DisconnectingWriteStream:
    """最小写入桩：模拟浏览器重载时响应写回阶段被本机断开。"""

    def __init__(self) -> None:
        self.write_calls: int = 0

    def write(self, payload: bytes) -> None:
        del payload
        self.write_calls += 1
        raise ConnectionAbortedError(10053, "connection aborted")


class FakeRequestHandler:
    """最小 HTTP handler 桩：只保留 CoreApiServer 当前会用到的接口。"""

    def __init__(self, *, path: str, command: str = "POST") -> None:
        self.path = path
        self.command = command
        self.headers = {"Content-Length": "0"}
        self.rfile = BytesIO()
        self.wfile = DisconnectingWriteStream()

    def send_response(self, status_code: int) -> None:
        del status_code

    def send_header(self, key: str, value: str) -> None:
        del key
        del value

    def end_headers(self) -> None:
        return None


def test_core_api_server_swallows_disconnect_when_success_response_is_aborted() -> None:
    server = CoreApiServer()
    handler = FakeRequestHandler(path="/api/demo")

    server.add_json_route(
        "POST",
        "/api/demo",
        lambda request: ApiResponse(ok=True, data={"accepted": True}),
    )

    server.handle_http_request(handler, "POST")

    assert handler.wfile.write_calls == 1


def test_core_api_server_swallows_disconnect_when_error_response_is_aborted() -> None:
    server = CoreApiServer()
    handler = FakeRequestHandler(path="/api/demo")

    def raise_invalid_request(request: dict[str, object]) -> ApiResponse:
        del request
        raise ValueError("bad request")

    server.add_json_route(
        "POST",
        "/api/demo",
        raise_invalid_request,
    )

    server.handle_http_request(handler, "POST")

    assert handler.wfile.write_calls == 1


def test_core_api_server_request_handler_swallows_disconnect_during_read_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """前端刷新导致的 handler 读取中断不应被 socketserver 当成服务端异常。"""

    server = CoreApiServer()
    http_server = server.create_http_server()
    request_handler_class = http_server.RequestHandlerClass
    handle_call_count: int = 0

    def raise_connection_aborted(self) -> None:
        """模拟 BaseHTTPRequestHandler 在读取下一条请求时被客户端中止。"""

        nonlocal handle_call_count
        del self
        handle_call_count += 1
        raise ConnectionAbortedError(10053, "connection aborted")

    monkeypatch.setattr(
        request_handler_class,
        "handle_one_request",
        raise_connection_aborted,
    )

    server_socket, client_socket = socket.socketpair()
    try:
        request_handler_class(server_socket, ("127.0.0.1", 0), http_server)
    finally:
        client_socket.close()
        server_socket.close()
        http_server.server_close()

    assert handle_call_count == 1
