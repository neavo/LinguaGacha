from queue import Empty
from typing import Any

from base.LogManager import LogEvent
from base.LogManager import LogManager
from api.Contract.EventEnvelope import build_sse_frame


class LogStreamService:
    """把 LogManager 的纯文本日志事件暴露为独立 SSE 流。"""

    KEEPALIVE_BYTES: bytes = b": keepalive\n\n"
    EVENT_TYPE: str = "log.appended"

    def __init__(
        self,
        log_manager_factory: Any = LogManager.get,
    ) -> None:
        self.log_manager_factory = log_manager_factory

    def stream_to_handler(self, handler: Any) -> None:
        """先回放最近日志，再持续推送新增日志。"""
        log_manager: LogManager = self.log_manager_factory()
        subscriber = log_manager.subscribe_events(replay=True)
        try:
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
            handler.send_header("Cache-Control", "no-cache")
            handler.send_header("Connection", "keep-alive")
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            handler.send_header("Access-Control-Allow-Headers", "Content-Type")
            handler.end_headers()

            while True:
                try:
                    event = subscriber.get(timeout=0.5)
                    handler.wfile.write(self.build_log_frame(event))
                except Empty:
                    handler.wfile.write(self.KEEPALIVE_BYTES)
                handler.wfile.flush()
        except (
            BrokenPipeError,
            ConnectionResetError,
            ConnectionAbortedError,
        ):
            # 日志窗口刷新或关闭属于正常断线，不应污染日志流本身。
            pass
        finally:
            log_manager.unsubscribe_events(subscriber)

    @classmethod
    def build_log_frame(cls, event: LogEvent) -> bytes:
        """统一日志 SSE 帧，事件名固定为 log.appended。"""
        return build_sse_frame(cls.EVENT_TYPE, event.to_dict())
