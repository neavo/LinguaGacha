import dataclasses
from typing import Any

import pytest

from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequesterStream import StreamConsumer
from module.Engine.TaskRequesterStream import StreamControl
from module.Engine.TaskRequesterStream import StreamSession
from module.Engine.TaskRequesterStream import safe_close_resource


@dataclasses.dataclass
class CloseRecorder:
    called: int = 0
    raise_on_close: bool = False

    def close(self) -> None:
        self.called += 1
        if self.raise_on_close:
            raise RuntimeError("close failed")


class HasNonCallableClose:
    close = 123


def test_stream_control_create_passes_through() -> None:
    control = StreamControl.create(stop_checker=None, deadline_monotonic=1.25)
    assert control.stop_checker is None
    assert control.deadline_monotonic == 1.25


def test_safe_close_resource_no_close_is_noop() -> None:
    safe_close_resource(object())


def test_safe_close_resource_non_callable_close_is_noop() -> None:
    safe_close_resource(HasNonCallableClose())


def test_safe_close_resource_calls_close() -> None:
    recorder = CloseRecorder()
    safe_close_resource(recorder)
    assert recorder.called == 1


def test_safe_close_resource_swallow_close_error() -> None:
    recorder = CloseRecorder(raise_on_close=True)
    safe_close_resource(recorder)
    assert recorder.called == 1


def test_consume_iterates_all_items_and_closes() -> None:
    close_recorder = CloseRecorder()
    seen: list[Any] = []
    session = StreamSession(iterator=["a", "b"], close=close_recorder.close)
    control = StreamControl.create(stop_checker=None, deadline_monotonic=None)

    StreamConsumer.consume(session, control, on_item=seen.append)

    assert seen == ["a", "b"]
    assert close_recorder.called == 1


def test_consume_stop_checker_cancels_and_closes_once() -> None:
    close_recorder = CloseRecorder()

    def stop_checker() -> bool:
        return True

    session = StreamSession(iterator=["never"], close=close_recorder.close)
    control = StreamControl.create(stop_checker=stop_checker, deadline_monotonic=None)

    with pytest.raises(RequestCancelledError, match="stop requested"):
        StreamConsumer.consume(session, control, on_item=lambda item: None)

    assert close_recorder.called == 1


def test_consume_hard_timeout_raises_and_closes_once(monkeypatch: Any) -> None:
    close_recorder = CloseRecorder()

    def stop_checker() -> bool:
        return False

    monkeypatch.setattr(
        "module.Engine.TaskRequesterStream.time.monotonic", lambda: 100.0
    )

    session = StreamSession(iterator=["never"], close=close_recorder.close)
    control = StreamControl.create(stop_checker=stop_checker, deadline_monotonic=99.0)

    with pytest.raises(RequestHardTimeoutError, match="deadline exceeded"):
        StreamConsumer.consume(session, control, on_item=lambda item: None)

    assert close_recorder.called == 1


def test_consume_close_error_is_swallowed_on_cancel() -> None:
    close_recorder = CloseRecorder(raise_on_close=True)

    def stop_checker() -> bool:
        return True

    session = StreamSession(iterator=["never"], close=close_recorder.close)
    control = StreamControl.create(stop_checker=stop_checker, deadline_monotonic=None)

    with pytest.raises(RequestCancelledError):
        StreamConsumer.consume(session, control, on_item=lambda item: None)

    assert close_recorder.called == 1
