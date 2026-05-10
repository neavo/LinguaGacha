from __future__ import annotations

import logging

from base.LogManager import LogManager
from pytest import CaptureFixture


def test_info_log_records_payload_and_writes_stderr(
    capsys: CaptureFixture[str],
) -> None:
    """普通日志保留本地 payload，并在 console=True 时写 stderr。"""
    manager = LogManager()

    manager.info("任务开始")

    captured = capsys.readouterr()
    assert [payload.message for payload in manager.payloads] == ["任务开始"]
    assert manager.payloads[0].level == "info"
    assert manager.payloads[0].targets.file is True
    assert manager.payloads[0].targets.console is True
    assert manager.payloads[0].targets.window is False
    assert "[INFO] [python-tool] 任务开始" in captured.err


def test_console_false_keeps_file_only_target_semantics(
    capsys: CaptureFixture[str],
) -> None:
    """旧 console=False 语义继续表示不进 stderr 输出。"""
    manager = LogManager()

    manager.warning("只写文件", console=False)

    captured = capsys.readouterr()
    assert manager.payloads[0].targets.file is True
    assert manager.payloads[0].targets.console is False
    assert manager.payloads[0].targets.window is False
    assert captured.err == ""


def test_exception_payload_preserves_error_message_and_stack() -> None:
    """异常日志仍在 Python 侧格式化堆栈，供本地工具排障。"""
    manager = LogManager()
    error = RuntimeError("boom")

    manager.error("任务失败", error, console=False)

    payload = manager.payloads[0]
    assert payload.level == "error"
    assert payload.message == "任务失败"
    assert payload.error_message == "boom"
    assert payload.stack is not None
    assert "RuntimeError: boom" in payload.stack


def test_fatal_uses_fatal_level(capsys: CaptureFixture[str]) -> None:
    """fatal 仍映射到稳定级别，避免旧调用点改签名。"""
    manager = LogManager()

    manager.fatal("应用崩溃")

    captured = capsys.readouterr()
    assert [payload.level for payload in manager.payloads] == ["fatal"]
    assert "[FATAL] [python-tool] 应用崩溃" in captured.err


def test_empty_log_keeps_separator_on_stderr(capsys: CaptureFixture[str]) -> None:
    """旧版空分隔日志仍保留最小可见输出。"""
    manager = LogManager()
    payload = manager.build_payload(logging.INFO, "", None, file=True, console=True)

    manager.write_fallback_stderr(payload)

    captured = capsys.readouterr()
    assert captured.err == "[INFO] [python-tool] \n"
