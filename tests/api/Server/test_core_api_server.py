import codecs
import socket
from io import BytesIO

import pytest

from api.Contract.ApiResponse import ApiResponse
from api.Server.CoreApiServer import CoreApiServer
from module.Utils.JSONTool import JSONTool


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


class RecordingRequestHandler(FakeRequestHandler):
    """记录响应头与 body，便于断言 JSONTool 输出确实落在 API 边界。"""

    def __init__(self, *, path: str, command: str = "POST") -> None:
        super().__init__(path=path, command=command)
        self.status_code: int | None = None
        self.sent_headers: list[tuple[str, str]] = []
        self.wfile = BytesIO()

    def send_response(self, status_code: int) -> None:
        self.status_code = status_code

    def send_header(self, key: str, value: str) -> None:
        self.sent_headers.append((key, value))


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


def test_core_api_server_write_json_uses_json_tool_bytes() -> None:
    server = CoreApiServer()
    handler = RecordingRequestHandler(path="/api/demo")
    response = ApiResponse(ok=True, data={"text": "\ud800", "message": "勇者"})

    server.add_json_route(
        "POST",
        "/api/demo",
        lambda request: response,
    )

    server.handle_http_request(handler, "POST")

    expected_payload = JSONTool.dumps_bytes(response.to_dict(), indent=0)

    assert handler.status_code == 200
    assert ("Content-Type", server.CONTENT_TYPE_JSON) in handler.sent_headers
    assert ("Content-Length", str(len(expected_payload))) in handler.sent_headers
    assert handler.wfile.getvalue() == expected_payload


def test_core_api_server_read_json_request_uses_json_tool() -> None:
    server = CoreApiServer()
    handler = RecordingRequestHandler(path="/api/demo")
    payload_bytes = codecs.BOM_UTF8 + b'{"text":"\xe5\x8b\x87\xe8\x80\x85"}'
    handler.headers["Content-Length"] = str(len(payload_bytes))
    handler.rfile = BytesIO(payload_bytes)

    assert server.read_json_request(handler) == {"text": "勇者"}
