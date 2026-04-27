import threading
import time
import weakref
from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from typing import Callable
from typing import Self

from base.LogManager import LogManager


class EventManager:
    """纯 Python 事件总线。

    职责：
    - 负责跨模块发布订阅与线程安全分发。
    - 通过后台调度线程统一串行执行回调，避免事件处理彼此踩踏。
    - 对高频快照事件做最新值合并，避免过期进度挤爆队列。
    """

    @dataclass(frozen=True)
    class PendingEvent:
        event: StrEnum
        data: object

    @dataclass(frozen=True)
    class WeakHandler:
        owner_id: int
        func: Callable[..., Any]
        ref: weakref.WeakMethod

        def resolve(self) -> Callable[[Any, Any], None] | None:
            resolved = self.ref()
            if resolved is None:
                return None
            return resolved

    COALESCE_EVENT_VALUES: frozenset[str] = frozenset(
        {
            "TRANSLATION_PROGRESS",
            "ANALYSIS_PROGRESS",
        }
    )

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.dispatch_condition = threading.Condition(self.lock)
        self.event_callbacks: dict[
            str,
            list[Callable[[Any, Any], None] | EventManager.WeakHandler],
        ] = {}
        self.dispatch_queue: deque[EventManager.PendingEvent] = deque()
        self.pending_latest: dict[str, tuple[StrEnum, object]] = {}
        self.is_dispatching: bool = False
        self.stop_event = threading.Event()
        self.dispatcher_thread = threading.Thread(
            target=self.dispatch_loop,
            name="event-manager-dispatcher",
            daemon=True,
        )
        self.dispatcher_thread.start()

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    @classmethod
    def reset_for_test(cls) -> None:
        instance = getattr(cls, "__instance__", None)
        if instance is not None:
            instance.stop_dispatcher()
            delattr(cls, "__instance__")

    def stop_dispatcher(self) -> None:
        """测试重置与服务退出都走同一条停机路径，避免残留后台线程。"""
        with self.dispatch_condition:
            self.stop_event.set()
            self.dispatch_queue.clear()
            self.pending_latest.clear()
            self.dispatch_condition.notify_all()

        if self.dispatcher_thread.is_alive():
            self.dispatcher_thread.join(timeout=1.0)

    def dispatch_loop(self) -> None:
        """后台线程串行拉取待分发事件，保证回调执行顺序稳定。"""
        while True:
            pending_event: EventManager.PendingEvent | None = None
            with self.dispatch_condition:
                while pending_event is None:
                    if self.dispatch_queue:
                        pending_event = self.dispatch_queue.popleft()
                        self.is_dispatching = True
                    elif self.pending_latest:
                        event_key = next(iter(self.pending_latest))
                        event, data = self.pending_latest.pop(event_key)
                        pending_event = self.PendingEvent(event=event, data=data)
                        self.is_dispatching = True
                    elif self.stop_event.is_set():
                        self.dispatch_condition.notify_all()
                        return
                    else:
                        self.dispatch_condition.wait()

            self.process_event(pending_event.event, pending_event.data)

            with self.dispatch_condition:
                self.is_dispatching = False
                self.dispatch_condition.notify_all()

    def process_event(self, event: object, data: object) -> None:
        """执行单个事件的所有活跃处理器，并隔离单个处理器异常。"""
        event_key = self.get_event_value(event)
        with self.lock:
            entries = self.event_callbacks.get(event_key)
            if not entries:
                return

            handlers: list[Callable[[Any, Any], None]] = []
            cleaned: list[Callable[[Any, Any], None] | EventManager.WeakHandler] = []
            removed_dead = False

            for entry in entries:
                if isinstance(entry, EventManager.WeakHandler):
                    resolved = entry.resolve()
                    if resolved is None:
                        removed_dead = True
                    else:
                        handlers.append(resolved)
                        cleaned.append(entry)
                else:
                    handlers.append(entry)
                    cleaned.append(entry)

            if removed_dead:
                if cleaned:
                    self.event_callbacks[event_key] = cleaned
                else:
                    self.event_callbacks.pop(event_key, None)

        for handler in handlers:
            try:
                handler(event, data)
            except Exception as e:
                handler_name = getattr(handler, "__qualname__", repr(handler))
                data_type = type(data).__name__
                LogManager.get().error(
                    f"Event handler raised: event={event_key} handler={handler_name} data_type={data_type}",
                    e,
                )

    def get_event_value(self, event: object) -> str:
        value = getattr(event, "value", None)
        if isinstance(value, str) and value != "":
            return value
        return str(event)

    def should_coalesce(self, event: StrEnum, data: object) -> bool:
        event_key = self.get_event_value(event)
        if event_key in self.COALESCE_EVENT_VALUES:
            return True
        return False

    def merge_coalesced_event_data(self, previous_data: object, data: object) -> object:
        """进度事件按字段合并，避免请求数补丁覆盖完整快照。"""
        if not isinstance(previous_data, dict) or not isinstance(data, dict):
            return data

        return {
            **previous_data,
            **data,
        }

    def emit_event(self, event: StrEnum, data: object) -> None:
        """后台线程安全入队；高频快照只保留最后一帧。"""
        event_key = self.get_event_value(event)
        with self.dispatch_condition:
            if self.should_coalesce(event, data):
                previous_pending = self.pending_latest.get(event_key)
                if previous_pending is None:
                    self.pending_latest[event_key] = (event, data)
                else:
                    previous_event, previous_data = previous_pending
                    self.pending_latest[event_key] = (
                        previous_event,
                        self.merge_coalesced_event_data(previous_data, data),
                    )
            else:
                self.dispatch_queue.append(self.PendingEvent(event=event, data=data))

            self.dispatch_condition.notify()

    def subscribe(self, event: StrEnum, handler: Callable[[Any, Any], None]) -> None:
        if not callable(handler):
            return

        event_key = self.get_event_value(event)
        owner = getattr(handler, "__self__", None)
        func = getattr(handler, "__func__", None)

        if owner is not None and callable(func):
            try:
                weak_handler = EventManager.WeakHandler(
                    owner_id=id(owner),
                    func=func,
                    ref=weakref.WeakMethod(handler),
                )
            except TypeError:
                weak_handler = None

            if weak_handler is not None:
                with self.lock:
                    self.event_callbacks.setdefault(event_key, []).append(weak_handler)
                return

        with self.lock:
            self.event_callbacks.setdefault(event_key, []).append(handler)

    def unsubscribe(self, event: StrEnum, handler: Callable[[Any, Any], None]) -> None:
        event_key = self.get_event_value(event)
        with self.lock:
            entries = self.event_callbacks.get(event_key)
            if not entries:
                return

            owner = getattr(handler, "__self__", None)
            func = getattr(handler, "__func__", None)
            cleaned: list[Callable[[Any, Any], None] | EventManager.WeakHandler] = []

            for entry in entries:
                if isinstance(entry, EventManager.WeakHandler):
                    resolved = entry.resolve()
                    if resolved is None:
                        continue
                    if owner is not None and callable(func):
                        if entry.owner_id == id(owner) and entry.func == func:
                            continue
                    cleaned.append(entry)
                else:
                    if entry == handler:
                        continue
                    cleaned.append(entry)

            if cleaned:
                self.event_callbacks[event_key] = cleaned
            else:
                self.event_callbacks.pop(event_key, None)

    def wait_for_idle(self, timeout: float = 1.0) -> None:
        """测试辅助：等待队列与当前分发都清空，再继续断言最终结果。"""
        deadline = time.monotonic() + timeout
        with self.dispatch_condition:
            while self.dispatch_queue or self.pending_latest or self.is_dispatching:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("事件队列未在预期时间内清空")
                self.dispatch_condition.wait(timeout=min(remaining, 0.05))
