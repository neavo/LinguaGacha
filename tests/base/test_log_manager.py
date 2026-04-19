from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from typing import cast

import base.LogManager as log_manager_module
import pytest
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


class FakeProgress:
    """进度条替身：只记录共享 Progress 的公开交互结果。"""

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.args = args
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        self.task_ids: list[int] = []
        self.operations: list[tuple[Any, ...]] = []

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def add_task(self, *args: object, total=None, completed=0) -> int:
        del args
        task_id = len(self.task_ids) + 1
        self.task_ids.append(task_id)
        self.operations.append(("add", task_id, total, completed))
        return task_id

    def update(self, task_id: int, **kwargs: int | None) -> None:
        self.operations.append(("update", task_id, kwargs))

    def stop_task(self, task_id: int) -> None:
        self.operations.append(("stop_task", task_id))

    def remove_task(self, task_id: int) -> None:
        self.task_ids = [value for value in self.task_ids if value != task_id]
        self.operations.append(("remove_task", task_id))


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


def build_progress_log_manager(
    monkeypatch: MonkeyPatch,
    log_dir: Path,
) -> log_manager_module.LogManager:
    """进度测试额外替换 Progress 实现，只保留共享会话行为。"""
    monkeypatch.setattr(log_manager_module, "Progress", FakeProgress)
    manager, _, _ = build_log_manager(monkeypatch, log_dir)
    return manager


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


def test_progress_returns_progress_session(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """公开 progress() 入口应该直接返回可用的进度会话对象。"""
    log_dir = create_log_dir(fs)
    manager, _, _ = build_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=True)
        assert isinstance(session, log_manager_module.LogManager.ProgressSession)
        assert session.transient is True
        assert session.manager is manager
    finally:
        manager.shutdown()


def test_progress_reuses_existing_console_progress(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """已有共享 Progress 存在时，新会话不应偷偷重建控制台区域。"""
    log_dir = create_log_dir(fs)
    manager = build_progress_log_manager(monkeypatch, log_dir)
    existing_progress = FakeProgress()
    manager.console_progress = cast(Any, existing_progress)

    try:
        with manager.progress(transient=False) as session:
            assert session is not None
            assert manager.console_progress is existing_progress
            assert existing_progress.started is False
    finally:
        manager.shutdown()


def test_progress_session_starts_and_stops_shared_progress(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """首个会话负责启动共享进度区，最后一个会话负责干净收尾。"""
    log_dir = create_log_dir(fs)
    manager = build_progress_log_manager(monkeypatch, log_dir)

    try:
        with manager.progress(transient=True) as session:
            task_id = session.new_task(total=3)
            session.update_task(task_id, advance=1)

            progress = manager.console_progress
            assert isinstance(progress, FakeProgress)
            assert progress.started is True
            assert progress.kwargs["console"] is manager.get_console()

        assert progress.stopped is True
        assert manager.console_progress is None
    finally:
        manager.shutdown()


def test_progress_session_new_task_raises_when_progress_not_started(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """未进入上下文前创建任务，应明确告诉调用方共享进度尚未启动。"""
    log_dir = create_log_dir(fs)
    manager = build_progress_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=False)
        with pytest.raises(RuntimeError, match="Progress is not started"):
            session.new_task(total=1)
    finally:
        manager.shutdown()


def test_progress_session_tolerates_manager_shutdown_during_active_session(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """关闭期间清空共享进度后，旧会话的 update/exit 也不该再抛异常。"""
    log_dir = create_log_dir(fs)
    manager = build_progress_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=False)
        session.__enter__()
        task_id = session.new_task(total=1)
        manager.shutdown()
        session.update_task(task_id, advance=1)
        session.__exit__(None, None, None)
        assert manager.console_progress is None
    finally:
        manager.shutdown()


def test_progress_session_keeps_shared_progress_for_following_session(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """前一个会话结束后，后续仍在使用的共享进度不应被误停掉。"""
    log_dir = create_log_dir(fs)
    manager = build_progress_log_manager(monkeypatch, log_dir)

    try:
        owner = manager.progress(transient=False)
        owner.__enter__()
        first_task_id = owner.new_task(total=2)
        second_task_id = owner.new_task(total=3)

        follower = manager.progress(transient=False)
        follower.__enter__()
        follower_task_id = follower.new_task(total=1)

        progress = manager.console_progress
        assert isinstance(progress, FakeProgress)

        owner.__exit__(None, None, None)

        assert manager.console_progress is progress
        assert progress.stopped is False
        assert ("stop_task", first_task_id) in progress.operations
        assert ("stop_task", second_task_id) in progress.operations
        assert ("stop_task", follower_task_id) not in progress.operations
        assert all(operation[0] != "remove_task" for operation in progress.operations)

        follower.__exit__(None, None, None)
        assert progress.stopped is True
    finally:
        manager.shutdown()
