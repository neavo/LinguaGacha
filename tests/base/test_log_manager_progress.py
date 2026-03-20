from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from typing import cast

import base.LogManager as log_manager_module
import pytest
from pyfakefs.fake_filesystem import FakeFilesystem
from rich.progress import TaskID


class CapturingStructuredHandler(logging.Handler):
    """用内存替身接管结构化控制台日志，避免测试依赖真实终端。"""

    instances: list["CapturingStructuredHandler"] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        super().__init__(level=logging.INFO)
        type(self).instances.append(self)

    def emit(self, record: logging.LogRecord) -> None:
        del record


class CapturingPlainHandler(logging.Handler):
    """用内存替身接管裸控制台日志，保证进度测试只关注共享 Progress 行为。"""

    instances: list["CapturingPlainHandler"] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        super().__init__(level=logging.INFO)
        type(self).instances.append(self)

    def emit(self, record: logging.LogRecord) -> None:
        del record


class FakeProgress:
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

    def update(self, task_id: int, **kwargs: int) -> None:
        self.operations.append(("update", task_id, kwargs))

    def stop_task(self, task_id: int) -> None:
        self.operations.append(("stop_task", task_id))

    def remove_task(self, task_id: int) -> None:
        self.task_ids = [value for value in self.task_ids if value != task_id]
        self.operations.append(("remove_task", task_id))


def build_log_manager(
    monkeypatch: pytest.MonkeyPatch,
    log_dir: Path,
) -> log_manager_module.LogManager:
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
    monkeypatch.setattr(log_manager_module, "Progress", FakeProgress)
    manager = log_manager_module.LogManager()
    manager.expert_mode = False
    return manager


def create_log_dir(fs: FakeFilesystem) -> Path:
    """进度相关日志测试统一走 pyfakefs，避免真实缓存和权限噪音。"""
    log_dir = Path("C:/logs")
    fs.create_dir(str(log_dir))
    return log_dir


def test_progress_reuses_existing_console_progress(
    fs: FakeFilesystem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=False)
        with pytest.raises(RuntimeError, match="Progress is not started"):
            session.new_task(total=1)
    finally:
        manager.shutdown()


def test_progress_session_update_is_noop_when_progress_not_started(
    fs: FakeFilesystem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=False)
        session.update_task(TaskID(1), advance=1)
    finally:
        manager.shutdown()


def test_progress_session_exit_is_noop_when_progress_is_none(
    fs: FakeFilesystem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        session = manager.progress(transient=False)
        session.__exit__(None, None, None)
        assert manager.console_progress is None
    finally:
        manager.shutdown()


def test_progress_session_keeps_shared_progress_for_following_session(
    fs: FakeFilesystem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

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
