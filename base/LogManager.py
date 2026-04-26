from __future__ import annotations

from collections import deque
from dataclasses import asdict
from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
import logging
import os
import queue
import sys
import traceback
from collections.abc import Sequence
from logging.handlers import QueueHandler
from logging.handlers import QueueListener
from logging.handlers import TimedRotatingFileHandler
from typing import Self

from base.BasePath import BasePath


@dataclass(frozen=True)
class LogEvent:
    """日志窗口的唯一跨层载荷，只携带纯文本诊断信息。"""

    id: str
    sequence: int
    created_at: str
    level: str
    message: str

    def to_dict(self) -> dict[str, object]:
        """SSE 层统一消费普通字典，避免暴露 dataclass 实例。"""
        return asdict(self)


class LogTargetFilter(logging.Filter):
    """按目标分流日志，避免业务线程自己挑 handler。"""

    def __init__(
        self,
        *,
        emit_key: str,
    ) -> None:
        super().__init__()
        self.emit_key: str = emit_key

    def filter(self, record: logging.LogRecord) -> bool:
        """只让目标匹配的记录通过，保证文件职责单一。"""
        return bool(getattr(record, self.emit_key, False))


class LogManager:
    """统一管理异步日志和崩溃兜底，避免工作线程被日志 I/O 拖慢。"""

    DEFAULT_RING_BUFFER_SIZE: int = 1000

    def __init__(self) -> None:
        super().__init__()
        self.async_enabled: bool = False
        self.shutdown_complete: bool = False
        self.next_event_sequence: int = 1
        self.log_events: deque[LogEvent] = deque(maxlen=self.DEFAULT_RING_BUFFER_SIZE)
        self.event_subscribers: list[queue.Queue[LogEvent]] = []

        log_path = BasePath.get_log_dir()
        os.makedirs(log_path, exist_ok=True)

        # 文件日志始终是最权威的排障来源，所以保留原来的轮转策略。
        self.file_handler = TimedRotatingFileHandler(
            f"{log_path}/app.log",
            when="midnight",
            interval=1,
            encoding="utf-8",
            backupCount=3,
        )
        self.file_handler.setLevel(logging.DEBUG)
        self.file_handler.setFormatter(
            logging.Formatter(
                "[%(asctime)s] [%(levelname)s] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        self.file_handler.addFilter(LogTargetFilter(emit_key="emit_file"))

        # 统一入口 logger 只负责把记录塞进队列，具体落地点交给监听线程。
        self.log_queue: queue.Queue[logging.LogRecord] = queue.Queue()
        self.queue_handler = QueueHandler(self.log_queue)
        self.app_logger = logging.getLogger(f"app_{id(self)}")
        self.app_logger.handlers.clear()
        self.app_logger.propagate = False
        self.app_logger.setLevel(logging.DEBUG)
        self.app_logger.addHandler(self.queue_handler)

        self.queue_listener: QueueListener | None = None
        try:
            self.queue_listener = QueueListener(
                self.log_queue,
                self.file_handler,
                respect_handler_level=True,
            )
            self.queue_listener.start()
            self.async_enabled = True
        except Exception as e:
            # 日志系统自己出问题时必须退回同步直写，不能把整个应用拖崩。
            self.async_enabled = False
            self.queue_listener = None
            self.dispatch_direct(
                logging.ERROR,
                "日志队列监听器启动失败，已降级为同步日志。",
                e=e,
                file=True,
                console=False,
            )

    @classmethod
    def get(cls) -> Self:
        """单例入口保持不变，避免仓库其他模块跟着改调用。"""
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def print(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """print 继续保留裸控制台输出语义，但实际写出改走日志线程。"""
        self.log(
            logging.INFO,
            msg,
            e=e,
            file=file,
            console=console,
            render_plain_console=True,
            sync=False,
        )

    def debug(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """调试日志默认异步化，尽量别阻塞后台任务线程。"""
        self.log(
            logging.DEBUG,
            msg,
            e=e,
            file=file,
            console=console,
            sync=False,
        )

    def info(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """信息日志默认异步化，维持现有调用口不变。"""
        self.log(
            logging.INFO,
            msg,
            e=e,
            file=file,
            console=console,
            sync=False,
        )

    def warning(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """警告日志默认异步化，减少高并发下的 handler 锁竞争。"""
        self.log(
            logging.WARNING,
            msg,
            e=e,
            file=file,
            console=console,
            sync=False,
        )

    def error(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """错误日志默认异步化，平时场景优先保证业务线程吞吐。"""
        self.log(
            logging.ERROR,
            msg,
            e=e,
            file=file,
            console=console,
            sync=False,
        )

    def fatal(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
        level: int = logging.CRITICAL,
    ) -> None:
        """崩溃兜底日志强制同步直写，避免进程退出前队列来不及刷盘。"""
        self.log(
            level,
            msg,
            e=e,
            file=file,
            console=console,
            sync=True,
        )

    def log(
        self,
        level: int,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
        render_plain_console: bool = False,
        sync: bool = False,
    ) -> None:
        """统一组装文件/控制台消息，避免不同方法重复拼异常文本。"""
        if not file and not console:
            return

        file_message, console_message = self.build_messages(msg, e)

        if file:
            self.dispatch(
                level,
                file_message,
                file=True,
                console=False,
                render_plain_console=False,
                sync=sync,
            )

        if console:
            self.publish_log_event(
                level,
                console_message,
            )

    def build_messages(
        self,
        msg: str,
        e: Exception | BaseException | None,
    ) -> tuple[str, str]:
        """文件与控制台默认都保留完整堆栈，避免排障信息再被隐藏。"""
        if e is None:
            return msg, msg

        message_with_error = f"{msg}\n{e}" if msg != "" else f"{e}"
        traceback_text = self.get_traceback(e)
        file_message = f"{message_with_error}\n{traceback_text}\n"
        return file_message, file_message

    def dispatch(
        self,
        level: int,
        message: str,
        *,
        file: bool,
        console: bool,
        render_plain_console: bool,
        sync: bool,
    ) -> None:
        """根据当前状态决定走异步队列还是同步直写。"""
        del console
        del render_plain_console
        record = self.create_record(
            level,
            message,
            file=file,
        )

        if sync or not self.async_enabled or self.shutdown_complete:
            self.handle_record(record)
            return

        self.app_logger.handle(record)

    def dispatch_direct(
        self,
        level: int,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """日志系统自救时直接写文件，并用 stderr 做极小兜底。"""
        file_message, console_message = self.build_messages(msg, e)

        if file:
            self.handle_record(
                self.create_record(
                    level,
                    file_message,
                    file=True,
                )
            )

        if console:
            sys.stderr.write(f"{console_message}\n")
            sys.stderr.flush()

    def get_handlers(self) -> tuple[logging.Handler, ...]:
        """把 handler 列表收拢到一起，避免同步写和 flush 各自维护一份。"""
        return (self.file_handler,)

    def create_record(
        self,
        level: int,
        message: str,
        *,
        file: bool,
    ) -> logging.LogRecord:
        """把目标信息塞进 LogRecord，方便监听线程无状态分流。"""
        return self.app_logger.makeRecord(
            self.app_logger.name,
            level,
            fn="",
            lno=0,
            msg=message,
            args=(),
            exc_info=None,
            extra={
                "emit_file": file,
            },
        )

    def handle_record(self, record: logging.LogRecord) -> None:
        """同步直写时也复用同一批 handler，保证格式和过滤规则一致。"""
        for handler in self.get_handlers():
            handler.handle(record)
            handler.flush()

    def shutdown(self) -> None:
        """正常退出时先停监听线程，再尽量刷干净尾部日志。"""
        if self.shutdown_complete:
            return

        self.shutdown_complete = True
        if self.queue_listener is not None:
            self.queue_listener.stop()
            self.queue_listener = None

        if self.queue_handler in self.app_logger.handlers:
            self.app_logger.removeHandler(self.queue_handler)

        self.flush_handlers()
        self.close_handlers()
        self.async_enabled = False

    def flush_handlers(self) -> None:
        """集中 flush 便于退出阶段和兜底阶段复用同一套收尾动作。"""
        for handler in self.get_handlers():
            try:
                handler.flush()
            except Exception:
                # 退出阶段只尽量冲刷日志，不能因为 flush 再抛异常打断收尾。
                pass

    def close_handlers(self) -> None:
        """退出时主动关闭 handler，避免文件句柄拖到 GC 才被动回收。"""
        handlers = (*self.get_handlers(), self.queue_handler)
        for handler in handlers:
            try:
                handler.close()
            except Exception:
                # 关闭阶段以尽力回收资源为主，单个 handler 失败不该阻断整体收尾。
                pass

    def get_traceback(self, e: Exception | BaseException) -> str:
        """统一保留完整堆栈文本，避免各处自行格式化异常。"""
        return f"{(''.join(traceback.format_exception(e))).strip()}"

    def get_trackback(self, e: Exception | BaseException) -> str:
        """兼容旧调用名，避免其他模块意外引用时断掉。"""
        return self.get_traceback(e)

    def subscribe_events(self, *, replay: bool = True) -> queue.Queue[LogEvent]:
        """给日志 SSE 分配独立队列，并按需回放最近日志。"""
        subscriber: queue.Queue[LogEvent] = queue.Queue()
        if replay:
            for event in self.snapshot_events():
                subscriber.put(event)
        self.event_subscribers.append(subscriber)
        return subscriber

    def unsubscribe_events(self, subscriber: queue.Queue[LogEvent]) -> None:
        """连接断开后移除订阅队列，避免日志窗口重复打开后泄漏。"""
        if subscriber in self.event_subscribers:
            self.event_subscribers.remove(subscriber)

    def snapshot_events(self) -> Sequence[LogEvent]:
        """返回不可变快照，避免调用方拿到内部 ring buffer 引用。"""
        return tuple(self.log_events)

    def publish_log_event(
        self,
        level: int,
        message: str,
    ) -> LogEvent:
        """生成纯文本日志事件，并广播给当前订阅者。"""
        sequence = self.next_event_sequence
        self.next_event_sequence += 1
        event = LogEvent(
            id=f"log-{sequence}",
            sequence=sequence,
            created_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            level=self.normalize_event_level(level),
            message=self.normalize_message(message),
        )
        self.log_events.append(event)
        for subscriber in list(self.event_subscribers):
            subscriber.put(event)
        return event

    @classmethod
    def normalize_event_level(cls, level: int) -> str:
        """把 logging 级别收敛成日志窗口第一版协议。"""
        if level >= logging.CRITICAL:
            return "fatal"
        if level >= logging.ERROR:
            return "error"
        if level >= logging.WARNING:
            return "warning"
        if level >= logging.INFO:
            return "info"
        return "debug"

    @classmethod
    def normalize_message(cls, message: str) -> str:
        """统一纯文本换行，避免日志窗口收到终端控制格式。"""
        return str(message).replace("\r\n", "\n").replace("\r", "\n")
