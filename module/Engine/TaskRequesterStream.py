import asyncio
import dataclasses
import inspect
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
    poll_interval_s: float
    cleanup_timeout_s: float

    @staticmethod
    def create(
        *,
        stop_checker: Callable[[], bool] | None,
        deadline_monotonic: float | None,
        poll_interval_s: float,
        cleanup_timeout_s: float | None = None,
    ) -> "StreamControl":
        poll_interval_s = poll_interval_s if poll_interval_s > 0 else 0.1

        if cleanup_timeout_s is None:
            # 清理阶段（取消/关闭）必须可退出，否则会导致翻译线程卡死。
            cleanup_timeout_s = max(0.2, min(2.0, poll_interval_s * 10))

        return StreamControl(
            stop_checker=stop_checker,
            deadline_monotonic=deadline_monotonic,
            poll_interval_s=poll_interval_s,
            cleanup_timeout_s=cleanup_timeout_s,
        )


@dataclasses.dataclass(frozen=True)
class StreamSession:
    iterator: Any
    close: Callable[[], Any]
    finalize: Callable[[], Any] | None = None


class StreamStrategy(Protocol):
    """流式请求策略协议 - 定义不同 LLM API 的流式处理接口。"""

    def create_state(self) -> Any:
        """创建策略特定的状态对象。"""
        ...

    def build_stream_session(
        self,
        client: Any,
        request_args: dict[str, Any],
    ) -> Any:
        """构建流式会话的异步上下文管理器，返回 AsyncContextManager[StreamSession]。"""
        ...

    def handle_item(self, state: Any, item: Any) -> None:
        """处理流式输出的单个 chunk。"""
        ...

    async def finalize(
        self,
        session: StreamSession,
        state: Any,
    ) -> tuple[str, str, int, int]:
        """流结束后提取最终结果：(think, result, input_tokens, output_tokens)。"""
        ...


def no_op_close() -> None:
    return None


async def maybe_await_value(result: Any) -> Any:
    if inspect.isawaitable(result):
        return await result
    return result


def safe_close_async_resource(resource: Any) -> Any:
    """尽力关闭异步流/生成器资源。"""

    close = getattr(resource, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            return asyncio.ensure_future(result)
        return None

    aclose = getattr(resource, "aclose", None)
    if callable(aclose):
        result = aclose()
        if inspect.isawaitable(result):
            return asyncio.ensure_future(result)
        return None

    return None


class StreamConsumer:
    @staticmethod
    async def consume(
        session: StreamSession,
        control: StreamControl,
        *,
        on_item: Callable[[Any], None],
    ) -> None:
        """消费异步迭代器，同时保持对 stop/hard-timeout 的快速响应。"""
        closed = False

        async def cancel_pending_anext_task(task: asyncio.Task | None) -> None:
            if task is None or task.done():
                return
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=control.cleanup_timeout_s)
            except asyncio.TimeoutError:
                return
            except asyncio.CancelledError:
                return
            except Exception:
                return

        def is_deadline_reached() -> bool:
            return (
                control.deadline_monotonic is not None
                and time.monotonic() >= control.deadline_monotonic
            )

        async def close_once() -> None:
            nonlocal closed
            if closed:
                return
            closed = True
            try:
                stop_result = session.close()
                if inspect.isawaitable(stop_result):
                    try:
                        await asyncio.wait_for(
                            stop_result,
                            timeout=control.cleanup_timeout_s,
                        )
                    except asyncio.TimeoutError:
                        return
            except Exception:
                return

        while True:
            # 在创建下一次 __anext__ 之前先检查，避免流式输出很密集时无法及时响应停止/超时。
            if control.stop_checker is not None and control.stop_checker():
                await close_once()
                raise RequestCancelledError("stop requested")
            if is_deadline_reached():
                await close_once()
                raise RequestHardTimeoutError("deadline exceeded")

            anext_task = asyncio.create_task(session.iterator.__anext__())
            try:
                while True:
                    done = (
                        await asyncio.wait(
                            {anext_task}, timeout=control.poll_interval_s
                        )
                    )[0]
                    if anext_task in done:
                        item = await anext_task
                        on_item(item)
                        break

                    if control.stop_checker is not None and control.stop_checker():
                        # 先取消 __anext__，避免 close 阻塞等待正在进行的拉取。
                        await cancel_pending_anext_task(anext_task)
                        await close_once()
                        raise RequestCancelledError("stop requested")

                    if is_deadline_reached():
                        # 先取消 __anext__，避免 close 阻塞等待正在进行的拉取。
                        await cancel_pending_anext_task(anext_task)
                        await close_once()
                        raise RequestHardTimeoutError("deadline exceeded")
            except StopAsyncIteration:
                return
            except (RequestCancelledError, RequestHardTimeoutError):
                await cancel_pending_anext_task(anext_task)
                raise
            except Exception:
                await cancel_pending_anext_task(anext_task)
                await close_once()
                raise
