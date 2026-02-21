import threading
import weakref
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from typing import Callable
from typing import Self

from PySide6.QtCore import QObject
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal

from base.LogManager import LogManager


class EventManager(QObject):
    """事件总线（EventManager）。

    职责：
    - 实现跨模块解耦的发布-订阅（pub/sub）机制。
    - 跨线程安全：所有回调统一在主线程（UI 线程）执行，后台线程可安全 emit。

    设计约束：
    - QObject 绑定方法自动弱引用：订阅者销毁后回调自动失效，无需手动 unsubscribe。
    - 高频事件合并投递（coalescing）：对 COALESCE_EVENT_VALUES 内的事件，仅保留最新 payload，
    在下一个 flush 时分发。此类事件必须是"可覆盖快照"语义（如进度、状态），而非增量触发。
    """

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
            "TRANSLATION_UPDATE",
            "PROGRESS_TOAST_UPDATE",
        }
    )

    # 自定义信号
    # 字典类型或者其他复杂对象应该使用 object 作为信号参数类型，这样可以传递任意 Python 对象，包括 dict
    # 注意：PySide6 在跨线程 queued emit 时，对自定义类型签名的封送/转换更容易出问题；
    # 这里统一使用 object 以确保事件总线在各平台/版本下稳定工作。
    signal: Signal = Signal(object, object)

    # 将高频事件合并到一次 UI flush 中，避免 UI 线程事件队列积压。
    flush_signal: Signal = Signal()

    def __init__(self) -> None:
        super().__init__()

        self.lock = threading.RLock()
        # 以 event 的字符串值作为唯一 key：避免 StrEnum/str 的 hash 语义差异导致查找失效。
        self.event_callbacks: dict[
            str,
            list[Callable[[Any, Any], None] | EventManager.WeakHandler],
        ] = {}
        self.owner_cleanup_connected: set[int] = set()

        # coalescing 只保留“最后一次的原始事件对象 + payload”，保证 handler 仍收到 StrEnum。
        self.pending_latest: dict[str, tuple[StrEnum, object]] = {}
        self.flush_scheduled: bool = False

        # PyQt 的 connect 支持指定 ConnectionType，但类型存根未覆盖该重载。
        queued_connection = Qt.ConnectionType.QueuedConnection
        self.signal.connect(self.process_event, queued_connection)  # type: ignore
        self.flush_signal.connect(self.flush_pending_events, queued_connection)  # type: ignore

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    # 处理事件
    def process_event(self, event: object, data: object) -> None:
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
                        continue
                    handlers.append(resolved)
                    cleaned.append(entry)
                    continue

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
                # 事件回调属于 UI 线程关键路径：不能让单个 handler 异常中断后续分发。
                handler_name = getattr(handler, "__qualname__", repr(handler))
                event_value = event_key
                data_type = type(data).__name__
                LogManager.get().error(
                    f"Event handler raised: event={event_value} handler={handler_name} data_type={data_type}",
                    e,
                )

    def get_event_value(self, event: object) -> str:
        value = getattr(event, "value", None)
        if isinstance(value, str) and value != "":
            return value
        return str(event)

    def should_coalesce(self, event: StrEnum) -> bool:
        return self.get_event_value(event) in self.COALESCE_EVENT_VALUES

    def flush_pending_events(self) -> None:
        with self.lock:
            pending = dict(self.pending_latest)
            self.pending_latest.clear()
            self.flush_scheduled = False

        if not pending:
            return

        for _event_key, pair in pending.items():
            event, data = pair
            self.process_event(event, data)

    # 触发事件
    def emit_event(self, event: StrEnum, data: object) -> None:
        event_key = self.get_event_value(event)
        if self.should_coalesce(event):
            with self.lock:
                self.pending_latest[event_key] = (event, data)
                if self.flush_scheduled:
                    return
                self.flush_scheduled = True

            self.flush_signal.emit()
            return

        self.signal.emit(event, data)

    # 订阅事件
    def subscribe(self, event: StrEnum, handler: Callable[[Any, Any], None]) -> None:
        if not callable(handler):
            return

        event_key = self.get_event_value(event)

        owner = getattr(handler, "__self__", None)
        func = getattr(handler, "__func__", None)

        if isinstance(owner, QObject) and callable(func):
            owner_id = id(owner)
            entry = EventManager.WeakHandler(
                owner_id=owner_id,
                func=func,
                ref=weakref.WeakMethod(handler),
            )

            need_connect_destroyed = False
            with self.lock:
                self.event_callbacks.setdefault(event_key, []).append(entry)
                if owner_id not in self.owner_cleanup_connected:
                    self.owner_cleanup_connected.add(owner_id)
                    need_connect_destroyed = True

            if need_connect_destroyed:
                owner.destroyed.connect(
                    lambda obj=None, owner_id=owner_id: (
                        self.cleanup_owner_subscriptions(owner_id)
                    )
                )
            return

        with self.lock:
            self.event_callbacks.setdefault(event_key, []).append(handler)

    def cleanup_owner_subscriptions(self, owner_id: int) -> None:
        with self.lock:
            self.owner_cleanup_connected.discard(owner_id)
            for event, handlers in list(self.event_callbacks.items()):
                cleaned: list[
                    Callable[[StrEnum, Any], None] | EventManager.WeakHandler
                ] = []

                for entry in handlers:
                    if isinstance(entry, EventManager.WeakHandler):
                        if entry.owner_id == owner_id:
                            continue
                    cleaned.append(entry)

                if cleaned:
                    self.event_callbacks[event] = cleaned
                else:
                    self.event_callbacks.pop(event, None)

    # 取消订阅事件
    def unsubscribe(self, event: StrEnum, handler: Callable[[Any, Any], None]) -> None:
        event_key = self.get_event_value(event)
        with self.lock:
            entries = self.event_callbacks.get(event_key)
            if not entries:
                return

            owner = getattr(handler, "__self__", None)
            func = getattr(handler, "__func__", None)
            if isinstance(owner, QObject) and callable(func):
                owner_id = id(owner)
                for idx, entry in enumerate(entries):
                    if not isinstance(entry, EventManager.WeakHandler):
                        continue
                    if entry.owner_id != owner_id:
                        continue
                    if entry.func != func:
                        continue
                    entries.pop(idx)
                    break
            else:
                for idx, entry in enumerate(entries):
                    if isinstance(entry, EventManager.WeakHandler):
                        continue
                    if entry != handler:
                        continue
                    entries.pop(idx)
                    break

            if not entries:
                self.event_callbacks.pop(event_key, None)
