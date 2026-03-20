from __future__ import annotations

import logging
from pathlib import Path

import base.LogManager as log_manager_module
from pytest import MonkeyPatch


class CapturingStructuredHandler(logging.Handler):
    """用内存收集结构化控制台日志，避免测试依赖真实终端。"""

    instances: list["CapturingStructuredHandler"] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        super().__init__(level=logging.INFO)
        self.records: list[logging.LogRecord] = []
        type(self).instances.append(self)

    def emit(self, record: logging.LogRecord) -> None:
        """记录收到的日志，方便断言路由是否正确。"""
        self.records.append(record)


class CapturingPlainHandler(logging.Handler):
    """用内存收集 print 通道日志，验证裸控制台输出没有串到 Rich 通道。"""

    instances: list["CapturingPlainHandler"] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        super().__init__(level=logging.INFO)
        self.records: list[logging.LogRecord] = []
        type(self).instances.append(self)

    def emit(self, record: logging.LogRecord) -> None:
        """记录收到的日志，方便断言 print 的路由结果。"""
        self.records.append(record)


def build_log_manager(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> tuple[
    log_manager_module.LogManager,
    CapturingStructuredHandler,
    CapturingPlainHandler,
]:
    """给每个测试单独造一套日志基础设施，避免单例和真实终端互相污染。"""
    CapturingStructuredHandler.instances = []
    CapturingPlainHandler.instances = []

    monkeypatch.setattr(
        log_manager_module.BasePath,
        "get_log_dir",
        staticmethod(lambda: str(tmp_path)),
    )
    monkeypatch.setattr(
        log_manager_module,
        "RichHandler",
        CapturingStructuredHandler,
    )
    monkeypatch.setattr(
        log_manager_module,
        "PlainConsoleHandler",
        CapturingPlainHandler,
    )

    manager = log_manager_module.LogManager()
    manager.expert_mode = False
    structured_handler = CapturingStructuredHandler.instances[0]
    plain_handler = CapturingPlainHandler.instances[0]
    return manager, structured_handler, plain_handler


def read_log_text(tmp_path: Path) -> str:
    """统一从临时日志文件读取文本，避免每个测试重复拼路径。"""
    return (tmp_path / "app.log").read_text(encoding="utf-8")


def test_error_flushes_async_file_log(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    """普通错误日志应先异步入队，并在 shutdown 时稳定落盘。"""
    manager, _, _ = build_log_manager(monkeypatch, tmp_path)

    try:
        manager.error("任务失败", RuntimeError("boom"), console=False)
        manager.shutdown()

        text = read_log_text(tmp_path)
        assert "任务失败" in text
        assert "RuntimeError: boom" in text
    finally:
        manager.shutdown()


def test_fatal_writes_file_immediately(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    """fatal 应该同步直写，不能等监听线程慢慢刷盘。"""
    manager, _, _ = build_log_manager(monkeypatch, tmp_path)

    try:
        manager.fatal("应用崩溃", RuntimeError("fatal"), console=False)

        text = read_log_text(tmp_path)
        assert "应用崩溃" in text
        assert "RuntimeError: fatal" in text
    finally:
        manager.shutdown()


def test_print_routes_to_plain_console_only(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    """print 应该走裸控制台通道，别混进结构化控制台日志里。"""
    manager, structured_handler, plain_handler = build_log_manager(
        monkeypatch,
        tmp_path,
    )

    try:
        manager.info("结构化日志", file=False, console=True)
        manager.print("普通输出", file=False, console=True)
        manager.shutdown()

        assert [record.getMessage() for record in structured_handler.records] == [
            "结构化日志"
        ]
        assert [record.getMessage() for record in plain_handler.records] == ["普通输出"]
    finally:
        manager.shutdown()
