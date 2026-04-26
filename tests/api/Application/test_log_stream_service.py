from queue import Empty
from queue import Queue

from api.Application.LogStreamService import LogStreamService
from base.LogManager import LogEvent


def build_log_event(sequence: int, message: str) -> LogEvent:
    return LogEvent(
        id=f"log-{sequence}",
        sequence=sequence,
        created_at="2026-04-26T00:00:00.000+00:00",
        level="info",
        message=message,
    )


class FakeLogManager:
    def __init__(self) -> None:
        self.subscriber: Queue[LogEvent] = Queue()
        self.unsubscribe_calls: list[Queue[LogEvent]] = []

    def subscribe_events(self, *, replay: bool = True) -> Queue[LogEvent]:
        assert replay is True
        self.subscriber.put(build_log_event(1, "历史日志"))
        return self.subscriber

    def unsubscribe_events(self, subscriber: Queue[LogEvent]) -> None:
        self.unsubscribe_calls.append(subscriber)


class FakeSseHandler:
    class FakeWFile:
        def __init__(self) -> None:
            self.payloads: list[bytes] = []

        def write(self, payload: bytes) -> None:
            self.payloads.append(payload)
            raise ConnectionAbortedError(10053, "connection aborted")

        def flush(self) -> None:
            return None

    def __init__(self) -> None:
        self.wfile = self.FakeWFile()
        self.headers: list[tuple[str, str]] = []
        self.status_code: int | None = None
        self.ended = False

    def send_response(self, status_code: int) -> None:
        self.status_code = status_code

    def send_header(self, key: str, value: str) -> None:
        self.headers.append((key, value))

    def end_headers(self) -> None:
        self.ended = True


class FakeEmptyLogManager(FakeLogManager):
    class EmptySubscriber:
        def get(self, timeout: float) -> object:
            del timeout
            raise Empty

    def subscribe_events(self, *, replay: bool = True) -> EmptySubscriber:
        del replay
        return self.EmptySubscriber()

    def unsubscribe_events(self, subscriber: object) -> None:
        self.unsubscribe_calls.append(subscriber)  # type: ignore[arg-type]


def test_build_log_frame_uses_log_appended_event() -> None:
    frame = LogStreamService.build_log_frame(build_log_event(1, "hello"))

    assert b"event: log.appended\n" in frame
    assert b'"message":"hello"' in frame


def test_stream_to_handler_replays_history_and_unsubscribes() -> None:
    log_manager = FakeLogManager()
    service = LogStreamService(log_manager_factory=lambda: log_manager)
    handler = FakeSseHandler()

    service.stream_to_handler(handler)

    assert handler.status_code == 200
    assert ("Content-Type", "text/event-stream; charset=utf-8") in handler.headers
    assert b"event: log.appended\n" in handler.wfile.payloads[0]
    assert log_manager.unsubscribe_calls == [log_manager.subscriber]


def test_stream_to_handler_writes_keepalive_for_empty_subscriber() -> None:
    log_manager = FakeEmptyLogManager()
    service = LogStreamService(log_manager_factory=lambda: log_manager)
    handler = FakeSseHandler()

    service.stream_to_handler(handler)

    assert handler.wfile.payloads == [LogStreamService.KEEPALIVE_BYTES]
    assert len(log_manager.unsubscribe_calls) == 1
