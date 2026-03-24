from queue import Empty
from queue import Queue
from typing import Any

from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Contract.EventEnvelope import EventEnvelope


class EventStreamService:
    """维护 SSE 订阅者，并负责把内部事件标准化后广播出去。"""

    KEEPALIVE_BYTES: bytes = b": keepalive\n\n"

    def __init__(self, event_bridge: EventBridge | None = None) -> None:
        self.event_bridge = event_bridge if event_bridge is not None else EventBridge()
        self.subscribers: list[Queue[EventEnvelope]] = []

    def add_subscriber(self) -> Queue[EventEnvelope]:
        """为每条 SSE 连接分配独立队列，避免订阅者之间互相干扰。"""

        subscriber: Queue[EventEnvelope] = Queue()
        self.subscribers.append(subscriber)
        return subscriber

    def remove_subscriber(self, subscriber: Queue[EventEnvelope]) -> None:
        """连接断开时及时移除订阅者，避免队列泄漏。"""

        if subscriber in self.subscribers:
            self.subscribers.remove(subscriber)

    def publish_internal_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> None:
        """统一从内部事件桥接到外部标准事件。"""

        topic, payload = self.event_bridge.map_event(event, data)
        if topic is None:
            return

        envelope = EventEnvelope(topic=topic, data=payload)
        for subscriber in list(self.subscribers):
            subscriber.put(envelope)

    def stream_to_handler(self, handler: Any) -> None:
        """把订阅队列持续写入 HTTP 响应，形成 SSE 流。"""

        subscriber = self.add_subscriber()
        try:
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
            handler.send_header("Cache-Control", "no-cache")
            handler.send_header("Connection", "keep-alive")
            handler.end_headers()

            while True:
                try:
                    envelope = subscriber.get(timeout=0.5)
                    handler.wfile.write(envelope.to_sse_payload())
                except Empty:
                    handler.wfile.write(self.KEEPALIVE_BYTES)
                handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # 客户端主动断开是预期行为，无需额外记录噪音日志。
            pass
        finally:
            self.remove_subscriber(subscriber)
