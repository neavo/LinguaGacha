from queue import Empty
from queue import Queue
from typing import Protocol
from typing import Any

from base.Base import Base
from api.Bridge.PublicEventBridge import PublicEventBridge
from api.Contract.EventEnvelope import EventEnvelope


class EventBridgeProtocol(Protocol):
    """约束事件映射器最小能力，便于切换公开事件桥或 patch 事件桥。"""

    def map_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]: ...


class EventStreamService:
    """维护 SSE 订阅者，并负责把内部事件标准化后广播出去。"""

    KEEPALIVE_BYTES: bytes = b": keepalive\n\n"

    def __init__(self, event_bridge: EventBridgeProtocol | None = None) -> None:
        self.event_bridge = (
            event_bridge if event_bridge is not None else PublicEventBridge()
        )
        self.subscribers: list[Queue[EventEnvelope]] = []
        self.subscribed_events: tuple[Base.Event, ...] = Base.API_STREAM_SOURCE_EVENTS
        self.subscribe_internal_events()

    def subscribe_internal_events(self) -> None:
        """启动时统一接入允许出站的内部事件，避免 SSE 长连只是空壳。"""

        for event in self.subscribed_events:
            Base().subscribe(event, self.publish_internal_event)

    def dispose(self) -> None:
        """服务结束时主动退订，避免测试反复启动后留下悬空处理器。"""

        for event in self.subscribed_events:
            Base().unsubscribe(event, self.publish_internal_event)

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
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            handler.send_header("Access-Control-Allow-Headers", "Content-Type")
            handler.end_headers()

            while True:
                try:
                    envelope = subscriber.get(timeout=0.5)
                    handler.wfile.write(envelope.to_sse_payload())
                except Empty:
                    handler.wfile.write(self.KEEPALIVE_BYTES)
                handler.wfile.flush()
        except (
            BrokenPipeError,
            ConnectionResetError,
            ConnectionAbortedError,
        ):
            # 浏览器刷新、标签页关闭或 Windows 10053/10054 断连都属于预期收尾，
            # 这里直接吞掉，避免把正常的 SSE 断线放大成控制台 traceback。
            pass
        finally:
            self.remove_subscriber(subscriber)
