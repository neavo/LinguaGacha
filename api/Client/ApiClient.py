from typing import Any

import httpx


class ApiClient:
    """统一维护本地 Core API 的 HTTP 调用入口。"""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.http_client = httpx.Client(base_url=self.base_url)

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """命令类接口统一走 POST，成功时只返回 data 负载。"""

        response = self.http_client.post(path, json=body)
        payload = response.json()
        return dict(payload.get("data", {}))

    def get(self, path: str) -> dict[str, Any]:
        """查询类接口统一走 GET，成功时只返回 data 负载。"""

        response = self.http_client.get(path)
        payload = response.json()
        return dict(payload.get("data", {}))
