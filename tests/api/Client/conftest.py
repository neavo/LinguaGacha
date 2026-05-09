from collections.abc import Callable
from collections.abc import Generator
from copy import deepcopy
from typing import Any

import pytest

from api.Server.ServerBootstrap import ServerBootstrap


type StartApiServerFactory = Callable[..., str]


class RecordingApiClient:
    """记录 HTTP 请求并返回预设响应，供薄客户端单元测试复用。"""

    def __init__(self) -> None:
        """初始化 RecordingApiClient 依赖和状态，保持对象写入口明确。"""

        self.post_requests: list[tuple[str, dict[str, object]]] = []
        self.get_requests: list[str] = []
        self.post_responses: dict[str, dict[str, object]] = {}
        self.get_responses: dict[str, dict[str, object]] = {}

    def queue_post_response(self, path: str, response: dict[str, object]) -> None:
        """压入 POST 响应，保持客户端测试按顺序消费。"""

        self.post_responses[path] = deepcopy(response)

    def queue_get_response(self, path: str, response: dict[str, object]) -> None:
        """压入 GET 响应，保持客户端测试按顺序消费。"""

        self.get_responses[path] = deepcopy(response)

    def post(self, path: str, body: dict[str, object]) -> dict[str, object]:
        """记录 POST 调用并返回排队响应，隔离真实网络。"""

        self.post_requests.append((path, deepcopy(body)))
        return deepcopy(self.post_responses.get(path, {}))

    def get(self, path: str) -> dict[str, object]:
        """按 key 读取测试头，模拟 HTTP header 访问。"""

        self.get_requests.append(path)
        return deepcopy(self.get_responses.get(path, {}))


@pytest.fixture
def start_api_server() -> Generator[StartApiServerFactory, None, None]:
    runtimes: list[Callable[[], None]] = []

    def factory(**services: Any) -> str:
        # 这里按后进先出关闭测试服务，避免后创建的资源泄漏到后续用例。
        base_url, shutdown = ServerBootstrap.start_for_test(**services)
        runtimes.append(shutdown)
        return base_url

    yield factory

    for shutdown in reversed(runtimes):
        shutdown()


@pytest.fixture
def recording_api_client() -> RecordingApiClient:
    return RecordingApiClient()
