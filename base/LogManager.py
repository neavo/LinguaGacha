from __future__ import annotations

from collections import deque
from dataclasses import asdict
from dataclasses import dataclass
import json
import logging
import os
import queue
import sys
import threading
import time
import traceback
from typing import Self
from urllib import request


@dataclass(frozen=True)
class LogTargets:
    """Python 兼容层只表达目标意图，真正输出由 TS LogManager 决定。"""

    file: bool
    console: bool
    window: bool


@dataclass(frozen=True)
class LogPayload:
    """Python -> TS 的结构化日志载荷，跨进程只传值对象。"""

    level: str
    message: str
    source: str
    targets: LogTargets
    error_message: str | None = None
    stack: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        if self.error_message is None:
            payload.pop("error_message")
        if self.stack is None:
            payload.pop("stack")
        return payload


class LogBridgeClient:
    """向 TS Gateway 公开日志 API 提交日志，失败由 LogManager 负责缓存。"""

    BASE_URL_ENV_NAME: str = "LINGUAGACHA_LOG_API_BASE_URL"
    TOKEN_ENV_NAME: str = "LINGUAGACHA_LOG_API_TOKEN"
    TOKEN_HEADER_NAME: str = "X-LinguaGacha-Core-Token"
    APPEND_PATH: str = "/api/logs/append"
    DEFAULT_TIMEOUT_SECONDS: float = 0.5

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
    ) -> None:
        self.base_url: str = base_url or os.environ.get(self.BASE_URL_ENV_NAME, "")
        self.token: str = token or os.environ.get(self.TOKEN_ENV_NAME, "")

    def is_available(self) -> bool:
        return self.base_url != "" and self.token != ""

    def submit(
        self,
        payload: LogPayload,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        if not self.is_available():
            raise RuntimeError("TS 日志桥环境变量未配置。")

        body = json.dumps(payload.to_dict(), ensure_ascii=False).encode("utf-8")
        append_request = request.Request(
            f"{self.base_url}{self.APPEND_PATH}",
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                self.TOKEN_HEADER_NAME: self.token,
            },
            method="POST",
        )
        with request.urlopen(append_request, timeout=timeout) as response:
            if response.status >= 400:
                raise RuntimeError(f"TS 日志桥提交失败：{response.status}")


class LogManager:
    """Python 侧保留兼容调用口，日志权威迁移到 Electron main。"""

    DEFAULT_BUFFER_SIZE: int = 1000
    INITIAL_RETRY_DELAY_SECONDS: float = 0.2
    MAX_RETRY_DELAY_SECONDS: float = 5.0

    def __init__(self, bridge_client: LogBridgeClient | None = None) -> None:
        super().__init__()
        self.bridge_client: LogBridgeClient = bridge_client or LogBridgeClient()
        self.pending_payloads: deque[LogPayload] = deque(
            maxlen=self.DEFAULT_BUFFER_SIZE
        )
        self.flush_signal: queue.Queue[None] = queue.Queue()
        self.worker_lock: threading.Lock = threading.Lock()
        self.worker_thread: threading.Thread | None = None
        self.shutdown_requested: bool = False

    @classmethod
    def get(cls) -> Self:
        """单例入口保持不变，避免业务调用点批量迁移。"""
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
        self.log(logging.INFO, msg, e=e, file=file, console=console, sync=False)

    def debug(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.DEBUG, msg, e=e, file=file, console=console, sync=False)

    def info(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.INFO, msg, e=e, file=file, console=console, sync=False)

    def warning(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.WARNING, msg, e=e, file=file, console=console, sync=False)

    def error(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.log(logging.ERROR, msg, e=e, file=file, console=console, sync=False)

    def fatal(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
        level: int = logging.CRITICAL,
    ) -> None:
        self.log(level, msg, e=e, file=file, console=console, sync=True)

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
        """兼容旧签名；render_plain_console 已由 TS 控制台输出承接。"""
        del render_plain_console
        if not file and not console:
            return

        payload = self.build_payload(level, msg, e, file=file, console=console)
        if sync:
            self.submit_sync(payload)
            return

        self.enqueue_payload(payload)

    def build_payload(
        self,
        level: int,
        msg: str,
        e: Exception | BaseException | None,
        *,
        file: bool,
        console: bool,
    ) -> LogPayload:
        error_message = None if e is None else str(e)
        stack = None if e is None else self.get_traceback(e)
        message = self.normalize_message(msg)
        if message == "" and error_message is not None:
            message = error_message
        return LogPayload(
            level=self.normalize_level(level),
            message=message,
            source="python-core",
            targets=LogTargets(
                file=file,
                console=console,
                window=console,
            ),
            error_message=error_message,
            stack=stack,
        )

    def enqueue_payload(self, payload: LogPayload) -> None:
        self.pending_payloads.append(payload)
        if self.bridge_client.is_available():
            self.ensure_worker_started()
            self.flush_signal.put(None)

    def submit_sync(self, payload: LogPayload) -> None:
        try:
            self.bridge_client.submit(payload, timeout=1.0)
        except Exception:
            self.pending_payloads.append(payload)
            self.write_fallback_stderr(payload)

    def ensure_worker_started(self) -> None:
        with self.worker_lock:
            if self.worker_thread is not None and self.worker_thread.is_alive():
                return
            self.worker_thread = threading.Thread(
                target=self.flush_loop,
                name="linguagacha-log-bridge",
                daemon=True,
            )
            self.worker_thread.start()

    def flush_loop(self) -> None:
        retry_delay = self.INITIAL_RETRY_DELAY_SECONDS
        while not self.shutdown_requested:
            try:
                self.flush_signal.get(timeout=retry_delay)
            except queue.Empty:
                pass

            if not self.pending_payloads:
                retry_delay = self.INITIAL_RETRY_DELAY_SECONDS
                continue

            try:
                self.flush_pending_once()
                retry_delay = self.INITIAL_RETRY_DELAY_SECONDS
            except Exception:
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, self.MAX_RETRY_DELAY_SECONDS)

    def flush_pending_once(self) -> None:
        while self.pending_payloads:
            payload = self.pending_payloads[0]
            self.bridge_client.submit(payload)
            self.pending_payloads.popleft()

    def shutdown(self) -> None:
        self.shutdown_requested = True
        if self.bridge_client.is_available():
            try:
                self.flush_pending_once()
            except Exception:
                # 进程退出时日志桥失败只能降级 stderr，不能阻断主收尾链路。
                for payload in tuple(self.pending_payloads):
                    self.write_fallback_stderr(payload)
        if self.worker_thread is not None:
            self.flush_signal.put(None)
            self.worker_thread.join(timeout=1)

    def write_fallback_stderr(self, payload: LogPayload) -> None:
        text = payload.message
        if payload.error_message is not None:
            text = f"{text}\n{payload.error_message}"
        if payload.stack is not None:
            text = f"{text}\n{payload.stack}"
        sys.stderr.write(f"[{payload.level.upper()}] [python-core] {text}\n")
        sys.stderr.flush()

    def get_traceback(self, e: Exception | BaseException) -> str:
        """统一保留完整堆栈文本，避免各处自行格式化异常。"""
        return f"{(''.join(traceback.format_exception(e))).strip()}"

    def get_trackback(self, e: Exception | BaseException) -> str:
        """兼容旧调用名，避免其他模块意外引用时断掉。"""
        return self.get_traceback(e)

    @classmethod
    def normalize_level(cls, level: int) -> str:
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
        return str(message).replace("\r\n", "\n").replace("\r", "\n")
