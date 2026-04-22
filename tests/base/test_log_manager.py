from __future__ import annotations

import logging
from pathlib import Path

import base.LogManager as log_manager_module
from pyfakefs.fake_filesystem import FakeFilesystem
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
    log_dir: Path,
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
        staticmethod(lambda: str(log_dir)),
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
    structured_handler = CapturingStructuredHandler.instances[0]
    plain_handler = CapturingPlainHandler.instances[0]
    return manager, structured_handler, plain_handler


def create_log_dir(fs: FakeFilesystem) -> Path:
    """日志测试统一走 pyfakefs，避免真实文件系统状态影响断言。"""
    log_dir = Path("C:/logs")
    fs.create_dir(str(log_dir))
    return log_dir


def read_log_text(log_dir: Path) -> str:
    """统一从虚拟日志文件读取文本，避免每个测试重复拼路径。"""
    return (log_dir / "app.log").read_text(encoding="utf-8")


def test_error_flushes_async_file_log(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """普通错误日志应先异步入队，并在 shutdown 时稳定落盘。"""
    log_dir = create_log_dir(fs)
    manager, _, _ = build_log_manager(monkeypatch, log_dir)

    try:
        manager.error("任务失败", RuntimeError("boom"), console=False)
        manager.shutdown()

        text = read_log_text(log_dir)
        assert "任务失败" in text
        assert "RuntimeError: boom" in text
    finally:
        manager.shutdown()


def test_error_routes_full_traceback_to_console_by_default(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """控制台默认也应保留完整异常堆栈，避免详细排障信息再被隐藏。"""
    log_dir = create_log_dir(fs)
    manager, structured_handler, _ = build_log_manager(monkeypatch, log_dir)

    try:
        manager.error("任务失败", RuntimeError("boom"), file=False, console=True)
        manager.shutdown()

        assert len(structured_handler.records) == 1
        console_message = structured_handler.records[0].getMessage()
        assert "任务失败" in console_message
        assert "RuntimeError: boom" in console_message
        assert console_message.endswith("RuntimeError: boom\n")
    finally:
        manager.shutdown()


def test_fatal_writes_file_immediately(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """fatal 应该同步直写，不能等监听线程慢慢刷盘。"""
    log_dir = create_log_dir(fs)
    manager, _, _ = build_log_manager(monkeypatch, log_dir)

    try:
        manager.fatal("应用崩溃", RuntimeError("fatal"), console=False)

        text = read_log_text(log_dir)
        assert "应用崩溃" in text
        assert "RuntimeError: fatal" in text
    finally:
        manager.shutdown()


def test_shutdown_closes_file_handler_stream(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """shutdown 应主动释放文件句柄，别把资源回收留给垃圾回收阶段。"""
    log_dir = create_log_dir(fs)
    manager, _, _ = build_log_manager(monkeypatch, log_dir)

    try:
        manager.info("收尾日志", console=False)
        manager.shutdown()

        assert manager.file_handler.stream is None
    finally:
        manager.shutdown()


def test_print_routes_to_plain_console_only(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """print 应该走裸控制台通道，别混进结构化控制台日志里。"""
    log_dir = create_log_dir(fs)
    manager, structured_handler, plain_handler = build_log_manager(
        monkeypatch,
        log_dir,
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


def test_rich_handler_uses_shared_console_and_print_rich_reuses_it(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """rich handler 和手动 rich 输出必须共用一个 Console，避免 live 进度分裂。"""
    log_dir = create_log_dir(fs)
    manager, structured_handler, _ = build_log_manager(monkeypatch, log_dir)

    try:
        assert structured_handler is manager.structured_console_handler
        assert (
            getattr(structured_handler, "console", manager.get_console())
            is manager.get_console()
        )

        messages: list[object] = []
        monkeypatch.setattr(
            manager.get_console(),
            "print",
            lambda renderable: messages.append(renderable),
        )

        manager.print_rich({"table": "demo"})

        assert messages == [{"table": "demo"}]
    finally:
        manager.shutdown()
