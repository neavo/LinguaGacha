import json
import threading

import httpx

from api.Bridge.EventTopic import EventTopic
from api.Client.ApiStateStore import ApiStateStore


class SseClient:
    """后台消费本地 SSE，并把事件合并进状态仓库。"""

    STREAM_PATH: str = "/api/events/stream"

    def __init__(self, base_url: str, api_state_store: ApiStateStore) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_state_store = api_state_store
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        """启动后台线程；重复调用时保持幂等。"""

        if self.thread is not None and self.thread.is_alive():
            return
        self.stop_event.clear()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        """停止后台 SSE 读取线程。"""

        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=1)
            self.thread = None

    def run(self) -> None:
        """持续读取事件流并合并进本地状态。"""

        try:
            with httpx.Client(base_url=self.base_url, timeout=None) as client:
                with client.stream("GET", self.STREAM_PATH) as response:
                    event_name = ""
                    data_lines: list[str] = []
                    for line in response.iter_lines():
                        if self.stop_event.is_set():
                            return
                        if line.startswith(":"):
                            continue
                        if line == "":
                            self.dispatch_event(event_name, data_lines)
                            event_name = ""
                            data_lines = []
                            continue
                        if line.startswith("event:"):
                            event_name = line.removeprefix("event:").strip()
                        elif line.startswith("data:"):
                            data_lines.append(line.removeprefix("data:").strip())
        except httpx.HTTPError:
            # 第一阶段保持静默失败；UI 仍可通过首屏快照工作，后续再补重连策略。
            return

    def dispatch_event(self, event_name: str, data_lines: list[str]) -> None:
        """把 SSE 事件解析为 JSON 并交给状态仓库。"""

        if event_name == "" or not data_lines:
            return
        payload_text = "\n".join(data_lines)
        payload = json.loads(payload_text)
        if isinstance(payload, dict):
            if event_name == EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value:
                self.api_state_store.mark_proofreading_snapshot_invalidated()
                return
            self.api_state_store.apply_event(event_name, payload)
