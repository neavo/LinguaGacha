from pathlib import Path

import base.LogManager as log_manager_module
from pyfakefs.fake_filesystem import FakeFilesystem
from pytest import MonkeyPatch


def build_log_manager(
    monkeypatch: MonkeyPatch,
    log_dir: Path,
) -> log_manager_module.LogManager:
    """给每个测试单独造一套日志基础设施，避免单例和真实文件互相污染。"""
    monkeypatch.setattr(
        log_manager_module.BasePath,
        "get_log_dir",
        staticmethod(lambda: str(log_dir)),
    )
    return log_manager_module.LogManager()


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
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        manager.error("任务失败", RuntimeError("boom"), console=False)
        manager.shutdown()

        text = read_log_text(log_dir)
        assert "任务失败" in text
        assert "RuntimeError: boom" in text
    finally:
        manager.shutdown()


def test_console_log_publishes_log_event(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """console=True 旧语义现在表示进入日志窗口事件流。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        subscriber = manager.subscribe_events()
        manager.warning("窗口日志", file=False, console=True)

        event = subscriber.get_nowait()
        assert event.level == "warning"
        assert event.message == "窗口日志"
        assert event.sequence == 1
        assert event.id == "log-1"
    finally:
        manager.shutdown()


def test_console_false_does_not_publish_log_event(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """console=False 保留为只写文件，不进入日志窗口。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        subscriber = manager.subscribe_events()
        manager.info("只进文件", console=False)
        manager.shutdown()

        assert subscriber.empty() is True
        assert "只进文件" in read_log_text(log_dir)
    finally:
        manager.shutdown()


def test_fatal_writes_file_immediately_and_marks_event_fatal(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """fatal 应同步直写文件，并在日志窗口里标记 fatal。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        subscriber = manager.subscribe_events()
        manager.fatal("应用崩溃", RuntimeError("fatal"))

        text = read_log_text(log_dir)
        event = subscriber.get_nowait()
        assert "应用崩溃" in text
        assert "RuntimeError: fatal" in text
        assert event.level == "fatal"
        assert "RuntimeError: fatal" in event.message
    finally:
        manager.shutdown()


def test_shutdown_closes_file_handler_stream(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """shutdown 应主动释放文件句柄，别把资源回收留给垃圾回收阶段。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        manager.info("收尾日志", console=False)
        manager.shutdown()

        assert manager.file_handler.stream is None
    finally:
        manager.shutdown()


def test_subscribe_events_replays_ring_buffer(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """新订阅者应拿到当前进程内最近日志快照。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)

    try:
        manager.info("第一条", file=False)
        manager.error("第二条", file=False)

        subscriber = manager.subscribe_events()
        replayed_events = [subscriber.get_nowait(), subscriber.get_nowait()]

        assert [event.message for event in replayed_events] == ["第一条", "第二条"]
        assert [event.sequence for event in replayed_events] == [1, 2]
    finally:
        manager.shutdown()


def test_log_event_ring_buffer_keeps_recent_limit(
    fs: FakeFilesystem,
    monkeypatch: MonkeyPatch,
) -> None:
    """ring buffer 只保留最近固定数量日志，避免日志窗口长期占用内存。"""
    log_dir = create_log_dir(fs)
    manager = build_log_manager(monkeypatch, log_dir)
    manager.log_events = log_manager_module.deque(maxlen=2)

    try:
        manager.info("一", file=False)
        manager.info("二", file=False)
        manager.info("三", file=False)

        assert [event.message for event in manager.snapshot_events()] == ["二", "三"]
    finally:
        manager.shutdown()
