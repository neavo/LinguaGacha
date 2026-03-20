import logging
import os
import queue
import traceback
from logging.handlers import QueueHandler
from logging.handlers import QueueListener
from logging.handlers import TimedRotatingFileHandler
from typing import Self

from base.BasePath import BasePath
from rich.console import Console
from rich.logging import RichHandler


class LogTargetFilter(logging.Filter):
    """按目标和渲染方式分流日志，避免业务线程自己挑 handler。"""

    def __init__(
        self,
        *,
        emit_key: str,
        render_plain_console: bool | None = None,
    ) -> None:
        super().__init__()
        self.emit_key: str = emit_key
        self.render_plain_console: bool | None = render_plain_console

    def filter(self, record: logging.LogRecord) -> bool:
        """只让目标匹配的记录通过，保证文件/控制台职责单一。"""
        should_emit = bool(getattr(record, self.emit_key, False))
        if not should_emit:
            return False

        if self.render_plain_console is None:
            return True

        return bool(getattr(record, "render_plain_console", False)) == bool(
            self.render_plain_console
        )


class PlainConsoleHandler(logging.Handler):
    """保留原来 print 风格的裸控制台输出，避免空行也被 Rich 包装。"""

    def __init__(self, console: Console) -> None:
        super().__init__(level=logging.INFO)
        self.console: Console = console

    def emit(self, record: logging.LogRecord) -> None:
        """用 Rich Console 直接打印消息，保持 print 语义不变。"""
        try:
            message = self.format(record)
            self.console.print(message)
        except Exception:
            self.handleError(record)


class LogManager:
    """统一管理异步日志和崩溃兜底，避免工作线程被日志 I/O 拖慢。"""

    def __init__(self) -> None:
        super().__init__()

        # 控制台对象只保留一个，避免普通输出和兜底输出风格飘来飘去。
        self.console = Console()
        self.expert_mode: bool | None = None
        self.async_enabled: bool = False
        self.shutdown_complete: bool = False

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

        # 结构化控制台日志继续交给 RichHandler，方便平时看级别和时间。
        self.structured_console_handler = RichHandler(
            markup=True,
            show_path=False,
            rich_tracebacks=False,
            tracebacks_extra_lines=0,
            log_time_format="[%X]",
            omit_repeated_times=False,
        )
        self.structured_console_handler.setLevel(logging.INFO)
        self.structured_console_handler.addFilter(
            LogTargetFilter(
                emit_key="emit_console",
                render_plain_console=False,
            )
        )

        # print 专用控制台 handler 单独保留，避免把空行也打成带级别的日志。
        self.plain_console_handler = PlainConsoleHandler(self.console)
        self.plain_console_handler.setLevel(logging.INFO)
        self.plain_console_handler.setFormatter(logging.Formatter("%(message)s"))
        self.plain_console_handler.addFilter(
            LogTargetFilter(
                emit_key="emit_console",
                render_plain_console=True,
            )
        )

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
                self.structured_console_handler,
                self.plain_console_handler,
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
                console=True,
                render_plain_console=False,
            )

    @classmethod
    def get(cls) -> Self:
        """单例入口保持不变，避免仓库其他模块跟着改调用。"""
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    def is_expert_mode(self) -> bool:
        """专家模式只影响控制台细节，文件日志始终保留完整信息。"""
        if self.expert_mode is None:
            from module.Config import Config

            self.expert_mode = Config().load().expert_mode

        self.structured_console_handler.setLevel(
            logging.DEBUG if self.expert_mode else logging.INFO
        )
        return self.expert_mode

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
        self.log(logging.DEBUG, msg, e=e, file=file, console=console, sync=False)

    def info(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """信息日志默认异步化，维持现有调用口不变。"""
        self.log(logging.INFO, msg, e=e, file=file, console=console, sync=False)

    def warning(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """警告日志默认异步化，减少高并发下的 handler 锁竞争。"""
        self.log(logging.WARNING, msg, e=e, file=file, console=console, sync=False)

    def error(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        """错误日志默认异步化，平时场景优先保证业务线程吞吐。"""
        self.log(logging.ERROR, msg, e=e, file=file, console=console, sync=False)

    def fatal(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
        level: int = logging.ERROR,
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
            self.dispatch(
                level,
                console_message,
                file=False,
                console=True,
                render_plain_console=render_plain_console,
                sync=sync,
            )

    def build_messages(
        self,
        msg: str,
        e: Exception | BaseException | None,
    ) -> tuple[str, str]:
        """文件永远保留完整堆栈，控制台按专家模式裁剪细节。"""
        if e is None:
            return msg, msg

        message_with_error = f"{msg}\n{e}" if msg != "" else f"{e}"
        traceback_text = self.get_traceback(e)
        file_message = f"{message_with_error}\n{traceback_text}\n"

        if self.is_expert_mode():
            return file_message, file_message

        return file_message, message_with_error

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
        record = self.create_record(
            level,
            message,
            file=file,
            console=console,
            render_plain_console=render_plain_console,
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
        render_plain_console: bool = False,
    ) -> None:
        """日志系统自救时直接写 handler，避免依赖队列可用性。"""
        file_message, console_message = self.build_messages(msg, e)

        if file:
            self.handle_record(
                self.create_record(
                    level,
                    file_message,
                    file=True,
                    console=False,
                    render_plain_console=False,
                )
            )

        if console:
            self.handle_record(
                self.create_record(
                    level,
                    console_message,
                    file=False,
                    console=True,
                    render_plain_console=render_plain_console,
                )
            )

    def get_handlers(self) -> tuple[logging.Handler, ...]:
        """把 handler 列表收拢到一起，避免同步写和 flush 各自维护一份。"""
        return (
            self.file_handler,
            self.structured_console_handler,
            self.plain_console_handler,
        )

    def create_record(
        self,
        level: int,
        message: str,
        *,
        file: bool,
        console: bool,
        render_plain_console: bool,
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
                "emit_console": console,
                "render_plain_console": render_plain_console,
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
        self.async_enabled = False

    def flush_handlers(self) -> None:
        """集中 flush 便于退出阶段和兜底阶段复用同一套收尾动作。"""
        for handler in self.get_handlers():
            try:
                handler.flush()
            except Exception:
                # 退出阶段只尽量冲刷日志，不能因为 flush 再抛异常打断收尾。
                pass

    def get_traceback(self, e: Exception | BaseException) -> str:
        """统一保留完整堆栈文本，避免各处自行格式化异常。"""
        return f"{(''.join(traceback.format_exception(e))).strip()}"

    def get_trackback(self, e: Exception | BaseException) -> str:
        """兼容旧调用名，避免其他模块意外引用时断掉。"""
        return self.get_traceback(e)
