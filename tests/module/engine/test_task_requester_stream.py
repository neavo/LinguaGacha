import dataclasses
import inspect
from typing import Any

import pytest

from module.Engine.TaskRequesterErrors import RequestCancelledError
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError
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


@dataclasses.dataclass
class ReenteringClose:
    called: int = 0
    reentered: bool = False

    def close(self) -> None:
        self.called += 1
        if self.reentered:
            return
        self.reentered = True

        # 从 session.close() 回溯到 StreamConsumer.consume 的 frame，拿到内部 close_once 再调用一次。
        # 这样可以覆盖 close_once 的“二次调用直接返回”分支。
        frame = inspect.currentframe()
        assert frame is not None
        close_once_frame = frame.f_back
        assert close_once_frame is not None
        consume_frame = close_once_frame.f_back
        assert consume_frame is not None
        close_once = consume_frame.f_locals.get("close_once")
        assert callable(close_once)
        close_once()


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


def test_consume_close_once_is_idempotent() -> None:
    close_recorder = ReenteringClose()
    session = StreamSession(iterator=[], close=close_recorder.close)
    control = StreamControl.create(stop_checker=None, deadline_monotonic=None)

    StreamConsumer.consume(session, control, on_item=lambda item: None)

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
