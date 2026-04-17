from queue import Empty

from base.Base import Base
from api.Application.EventStreamService import EventStreamService


def test_publish_event_creates_standardized_envelope() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"processed_line": 2, "total_line": 5},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "task.progress_changed"
    assert envelope.data["task_type"] == "translation"
    assert envelope.data["processed_line"] == 2


def test_publish_event_keeps_progress_patch_shape() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_internal_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"request_in_flight_count": 3},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "task.progress_changed"
    assert envelope.data == {
        "task_type": "translation",
        "request_in_flight_count": 3,
    }


class FakeSseHandler:
    """用最小 HTTP 处理器桩模拟客户端主动断开后的写入失败。"""

    class FakeWFile:
        def __init__(self) -> None:
            self.write_calls: int = 0

        def write(self, payload: bytes) -> None:
            del payload
            self.write_calls += 1
            raise ConnectionAbortedError(10053, "connection aborted")

        def flush(self) -> None:
            # 这里不做任何事，因为写入阶段已经模拟了连接中止。
            return None

    def __init__(self) -> None:
        self.wfile = self.FakeWFile()

    def send_response(self, status_code: int) -> None:
        del status_code

    def send_header(self, key: str, value: str) -> None:
        del key, value

    def end_headers(self) -> None:
        return None


class FakeEmptySubscriber:
    """用空队列桩把 SSE 循环推进到 keepalive 写入分支。"""

    def get(self, timeout: float) -> object:
        del timeout
        raise Empty


def test_stream_to_handler_swallow_connection_aborted_error() -> None:
    service = EventStreamService()
    subscriber = FakeEmptySubscriber()

    def fake_add_subscriber() -> FakeEmptySubscriber:
        service.subscribers.append(subscriber)  # 让 finally 能把订阅者移除干净。
        return subscriber

    service.add_subscriber = fake_add_subscriber  # type: ignore[method-assign]

    handler = FakeSseHandler()

    service.stream_to_handler(handler)

    assert handler.wfile.write_calls == 1
    assert service.subscribers == []
