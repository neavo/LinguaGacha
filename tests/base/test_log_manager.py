from __future__ import annotations

import logging

from base.LogManager import LogBridgeClient
from base.LogManager import LogManager
from base.LogManager import LogPayload
from pytest import CaptureFixture


class FakeLogBridgeClient(LogBridgeClient):
    """测试用桥客户端只记录载荷，不触碰真实 HTTP 服务。"""

    def __init__(self, *, available: bool = True, fail: bool = False) -> None:
        super().__init__(base_url="http://127.0.0.1:1", token="token")
        self.available = available
        self.fail = fail
        self.payloads: list[LogPayload] = []

    def is_available(self) -> bool:
        return self.available

    def submit(self, payload: LogPayload, *, timeout: float = 0.5) -> None:
        del timeout
        if self.fail:
            raise RuntimeError("bridge failed")
        self.payloads.append(payload)


def test_info_log_flushes_to_ts_bridge_on_shutdown() -> None:
    """普通日志先缓存，再由 shutdown 确保提交给 TS 日志权威。"""
    client = FakeLogBridgeClient()
    manager = LogManager(client)

    manager.info("任务开始")
    manager.shutdown()

    assert [payload.message for payload in client.payloads] == ["任务开始"]
    assert client.payloads[0].level == "info"
    assert client.payloads[0].targets.file is True
    assert client.payloads[0].targets.console is True
    assert client.payloads[0].targets.window is True


def test_bridge_client_uses_public_api_path_and_core_token_header() -> None:
    """Python 日志桥只面向 TS Gateway 的公开 /api 日志提交接口。"""

    assert LogBridgeClient.APPEND_PATH == "/api/logs/append"
    assert LogBridgeClient.TOKEN_HEADER_NAME == "X-LinguaGacha-Core-Token"


def test_console_false_keeps_file_only_target_semantics() -> None:
    """旧 console=False 语义必须继续表示不进控制台与日志窗口。"""
    client = FakeLogBridgeClient()
    manager = LogManager(client)

    manager.warning("只写文件", console=False)
    manager.shutdown()

    assert client.payloads[0].targets.file is True
    assert client.payloads[0].targets.console is False
    assert client.payloads[0].targets.window is False


def test_exception_payload_preserves_error_message_and_stack() -> None:
    """异常日志仍在 Python 侧格式化堆栈，再作为结构化字段交给 TS。"""
    client = FakeLogBridgeClient()
    manager = LogManager(client)
    error = RuntimeError("boom")

    manager.error("任务失败", error)
    manager.shutdown()

    payload = client.payloads[0]
    assert payload.level == "error"
    assert payload.message == "任务失败"
    assert payload.error_message == "boom"
    assert payload.stack is not None
    assert "RuntimeError: boom" in payload.stack


def test_fatal_submits_synchronously() -> None:
    """fatal 不等后台线程，立即向 TS 日志桥提交。"""
    client = FakeLogBridgeClient()
    manager = LogManager(client)

    manager.fatal("应用崩溃")

    assert [payload.level for payload in client.payloads] == ["fatal"]
    assert [payload.message for payload in client.payloads] == ["应用崩溃"]


def test_bridge_unavailable_keeps_bounded_early_buffer() -> None:
    """TS 日志接口未就绪时先保留有限缓存，避免早期日志无限占内存。"""
    client = FakeLogBridgeClient(available=False)
    manager = LogManager(client)
    manager.pending_payloads = manager.pending_payloads.__class__(maxlen=2)

    manager.info("一")
    manager.info("二")
    manager.info("三")

    assert [payload.message for payload in manager.pending_payloads] == ["二", "三"]


def test_empty_log_flushes_to_ts_bridge() -> None:
    """旧版空分隔日志是有效日志，必须继续提交给 TS 日志权威。"""
    client = FakeLogBridgeClient()
    manager = LogManager(client)

    manager.print("")
    manager.info("接口测试开始")
    manager.shutdown()

    assert [payload.message for payload in client.payloads] == ["", "接口测试开始"]


def test_fatal_falls_back_to_stderr_when_bridge_fails(
    capsys: CaptureFixture[str],
) -> None:
    """崩溃路径桥接失败时仍要写 stderr 作为最小兜底。"""
    client = FakeLogBridgeClient(fail=True)
    manager = LogManager(client)

    manager.fatal("应用崩溃", RuntimeError("fatal"))

    captured = capsys.readouterr()
    assert "[FATAL] [python-core] 应用崩溃" in captured.err
    assert "RuntimeError: fatal" in captured.err


def test_empty_fallback_log_keeps_separator_on_stderr(
    capsys: CaptureFixture[str],
) -> None:
    """日志桥不可用时空分隔日志也要保留最小兜底输出。"""
    client = FakeLogBridgeClient(fail=True)
    manager = LogManager(client)
    payload = manager.build_payload(logging.INFO, "", None, file=True, console=True)

    manager.write_fallback_stderr(payload)

    captured = capsys.readouterr()
    assert captured.err == "[INFO] [python-core] \n"
