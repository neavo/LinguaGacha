import dataclasses
import time
from typing import Any
from typing import Callable
from typing import Protocol

from module.Engine.TaskRequesterErrors import RequestCancelledError
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError


@dataclasses.dataclass(frozen=True)
class StreamControl:
    stop_checker: Callable[[], bool] | None
    deadline_monotonic: float | None

    @staticmethod
    def create(
        *,
        stop_checker: Callable[[], bool] | None,
        deadline_monotonic: float | None,
    ) -> "StreamControl":
        return StreamControl(
            stop_checker=stop_checker,
            deadline_monotonic=deadline_monotonic,
        )


@dataclasses.dataclass(frozen=True)
class StreamSession:
    iterator: Any
    close: Callable[[], Any]
    finalize: Callable[[], Any] | None = None


class StreamStrategy(Protocol):
    """流式请求策略协议 - 定义不同 LLM API 的流式处理接口。"""

    def create_state(self) -> Any: ...

    def build_stream_session(
        self, client: Any, request_args: dict[str, Any]
    ) -> Any: ...

    def handle_item(self, state: Any, item: Any) -> None: ...

    def finalize(
        self, session: StreamSession, state: Any
    ) -> tuple[str, str, int, int]: ...


def safe_close_resource(resource: Any) -> None:
    """尽力关闭同步资源。

    同步请求器不会 await；若传入异步资源（aclose 返回 coroutine），关闭将不会生效。
    因此此处仅处理同步 close()，避免误导与潜在的未 await 告警。
    """

    close = getattr(resource, "close", None)
    if not callable(close):
        return

    try:
        close()
    except Exception:
        return


class StreamConsumer:
    @staticmethod
    def consume(
        session: StreamSession,
        control: StreamControl,
        *,
        on_item: Callable[[Any], None],
    ) -> None:
        """消费同步迭代器。

        注意：同步 stream 在拉取下一块 chunk 时通常是阻塞的，因此 stop/硬超时主要在
        chunk 边界检查；阻塞期间的强制打断依赖底层 SDK/httpx 超时。
        """

        closed = False

        def is_deadline_reached() -> bool:
            return (
                control.deadline_monotonic is not None
                and time.monotonic() >= control.deadline_monotonic
            )

        def close_once() -> None:
            nonlocal closed
            if closed:
                return
            closed = True
            try:
                session.close()
            except Exception:
                return

        try:
            iterator = iter(session.iterator)
            while True:
                # 同步流式无法在 next() 阻塞时被外部打断；
                # 这里的提前检查用于避免在“已请求 stop 的 chunk 边界”继续拉取下一块数据。
                if control.stop_checker is not None and control.stop_checker():
                    close_once()
                    raise RequestCancelledError("stop requested")
                if is_deadline_reached():
                    close_once()
                    raise RequestHardTimeoutError("deadline exceeded")

                try:
                    item = next(iterator)
                except StopIteration:
                    return

                on_item(item)
        finally:
            # 正常结束/异常结束都尝试关闭，避免残留连接。
            if not closed:
                close_once()
