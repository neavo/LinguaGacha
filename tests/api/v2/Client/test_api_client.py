from typing import Any

from api.v2.Client.ApiClient import ApiClient
import api.v2.Client.ApiClient as api_client_module


class FakeHttpResponse:
    """最小 HTTP 响应桩，只暴露 ApiClient 当前会读取的 JSON 载荷。"""

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def json(self) -> dict[str, object]:
        return dict(self.payload)


class FakeHttpClient:
    """最小 HTTP 客户端桩，记录请求并返回预设结果。"""

    def __init__(self, *, base_url: str) -> None:
        self.base_url = base_url
        self.post_calls: list[tuple[str, dict[str, object]]] = []
        self.get_calls: list[str] = []
        self.post_payload = {"data": {"accepted": True}}
        self.get_payload = {"data": {"status": "ok"}}

    def post(self, path: str, json: dict[str, Any]) -> FakeHttpResponse:
        self.post_calls.append((path, dict(json)))
        return FakeHttpResponse(self.post_payload)

    def get(self, path: str) -> FakeHttpResponse:
        self.get_calls.append(path)
        return FakeHttpResponse(self.get_payload)


def test_api_client_post_returns_data_payload_and_trims_base_url(monkeypatch) -> None:
    created_clients: list[FakeHttpClient] = []

    def build_http_client(*, base_url: str) -> FakeHttpClient:
        client = FakeHttpClient(base_url=base_url)
        created_clients.append(client)
        return client

    monkeypatch.setattr(api_client_module.httpx, "Client", build_http_client)
    client = ApiClient("http://testserver/")

    result = client.post("/api/demo", {"name": "LinguaGacha"})

    assert created_clients[0].base_url == "http://testserver"
    assert created_clients[0].post_calls == [
        ("/api/demo", {"name": "LinguaGacha"}),
    ]
    assert result == {"accepted": True}


def test_api_client_get_returns_data_payload() -> None:
    client = ApiClient("http://testserver")
    fake_http_client = FakeHttpClient(base_url="http://testserver")
    client.http_client = fake_http_client

    result = client.get("/api/health")

    assert fake_http_client.get_calls == ["/api/health"]
    assert result == {"status": "ok"}


def test_api_client_uses_empty_dict_when_response_has_no_data() -> None:
    client = ApiClient("http://testserver")
    fake_http_client = FakeHttpClient(base_url="http://testserver")
    fake_http_client.post_payload = {"ok": True}
    fake_http_client.get_payload = {"ok": True}
    client.http_client = fake_http_client

    assert client.post("/api/demo", {}) == {}
    assert client.get("/api/demo") == {}
