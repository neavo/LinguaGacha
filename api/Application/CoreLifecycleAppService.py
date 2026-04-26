from collections.abc import Callable
from http.server import BaseHTTPRequestHandler


class CoreLifecycleAppService:
    """维护 Electron main 与 Core 之间的内部生命周期协作。"""

    SHUTDOWN_TOKEN_HEADER: str = "X-LinguaGacha-Core-Token"

    def __init__(
        self,
        *,
        instance_token: str,
        request_shutdown: Callable[[], None],
    ) -> None:
        self.instance_token = instance_token.strip()
        self.request_shutdown = request_shutdown

    def shutdown(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, bool]:
        del request
        received_token = handler.headers.get(self.SHUTDOWN_TOKEN_HEADER, "").strip()

        if self.instance_token == "" or received_token != self.instance_token:
            raise ValueError("Core 生命周期关闭令牌无效。")

        self.request_shutdown()
        return {"accepted": True}
