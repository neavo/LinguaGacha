from __future__ import annotations

from dataclasses import dataclass
import logging
import sys
import traceback
from typing import Self


@dataclass(frozen=True)
class LogTargets:
    """描述一次 Python 工具日志的输出意图，便于测试确认旧签名语义。"""

    file: bool
    console: bool
    window: bool


@dataclass(frozen=True)
class LogPayload:
    """Python 本地日志值对象；TS-only 运行态不再通过 HTTP 接收它。"""

    level: str
    message: str
    source: str
    targets: LogTargets
    error_message: str | None = None
    stack: str | None = None


class LogManager:
    """保留 Python 工具的日志调用口，输出权威不再跨进程桥接到 TS Gateway。"""

    def __init__(self) -> None:
        super().__init__()
        self.payloads: list[LogPayload] = []

    @classmethod
    def get(cls) -> Self:
        """单例入口保持不变，避免纯工具模块为了日志改动批量迁移。"""
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
        self.log(logging.INFO, msg, e=e, file=file, console=console)

    def debug(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.DEBUG, msg, e=e, file=file, console=console)

    def info(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.INFO, msg, e=e, file=file, console=console)

    def warning(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.WARNING, msg, e=e, file=file, console=console)

    def error(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.ERROR, msg, e=e, file=file, console=console)

    def fatal(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
        level: int = logging.CRITICAL,
    ) -> None:
        self.log(level, msg, e=e, file=file, console=console)

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
        """兼容旧签名；sync 和 render_plain_console 在本地工具日志中没有额外语义。"""
        del render_plain_console
        del sync
        if not file and not console:
            return

        payload = self.build_payload(level, msg, e, file=file, console=console)
        self.payloads.append(payload)
        if console:
            self.write_fallback_stderr(payload)

    def build_payload(
        self,
        level: int,
        msg: str,
        e: Exception | BaseException | None,
        *,
        file: bool,
        console: bool,
    ) -> LogPayload:
        """把旧日志参数归一成值对象，异常信息保留完整堆栈。"""
        error_message = None if e is None else str(e)
        stack = None if e is None else self.get_traceback(e)
        message = self.normalize_message(msg)
        if message == "" and error_message is not None:
            message = error_message
        return LogPayload(
            level=self.normalize_level(level),
            message=message,
            source="python-tool",
            targets=LogTargets(
                file=file,
                console=console,
                window=False,
            ),
            error_message=error_message,
            stack=stack,
        )

    def shutdown(self) -> None:
        """本地工具日志没有后台线程，保留方法只为测试和旧调用点幂等收尾。"""

    def write_fallback_stderr(self, payload: LogPayload) -> None:
        """stderr 是 Python 工具侧最小可见兜底，不再依赖 Electron Gateway。"""
        text = payload.message
        if payload.error_message is not None:
            text = f"{text}\n{payload.error_message}"
        if payload.stack is not None:
            text = f"{text}\n{payload.stack}"
        sys.stderr.write(f"[{payload.level.upper()}] [{payload.source}] {text}\n")
        sys.stderr.flush()

    def get_traceback(self, e: Exception | BaseException) -> str:
        """统一保留完整堆栈文本，避免各处自行格式化异常。"""
        return f"{(''.join(traceback.format_exception(e))).strip()}"

    def get_trackback(self, e: Exception | BaseException) -> str:
        """兼容旧调用名，避免其他模块意外引用时断掉。"""
        return self.get_traceback(e)

    @classmethod
    def normalize_level(cls, level: int) -> str:
        """把标准库 logging level 收窄到项目稳定级别集合。"""
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
        """统一换行，避免 Windows 日志在测试和 stderr 中出现双重换行差异。"""
        return str(message).replace("\r\n", "\n").replace("\r", "\n")
