from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ApiResponse:
    """统一 API 响应形状，保证服务端输出契约稳定。"""

    ok: bool
    data: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """统一转换为 JSON 可序列化字典。"""

        payload: dict[str, Any] = {"ok": self.ok}
        if self.data is not None:
            payload["data"] = self.data
        if self.error is not None:
            payload["error"] = self.error
        return payload
