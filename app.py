import ctypes
import logging
import os
import signal
import sys
import threading
import time
from types import TracebackType

from api.Application.CoreLifecycleAppService import CoreLifecycleAppService
from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from base.BasePath import BasePath
from base.LogManager import LogManager
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Migration.UserDataMigrationService import UserDataMigrationService

APP_VERSION_FILE_NAME: str = "version.txt"
CORE_INSTANCE_TOKEN_ENV_NAME: str = "LINGUAGACHA_CORE_INSTANCE_TOKEN"
PARENT_PID_ENV_NAME: str = "LINGUAGACHA_PARENT_PID"
SHUTDOWN_API_RESPONSE_DELAY_SECONDS: float = 0.05
PARENT_WATCH_INTERVAL_SECONDS: float = 1.0
WINDOWS_STILL_ACTIVE_EXIT_CODE: int = 259
WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION: int = 0x1000


def excepthook(
    exc_type: type[BaseException],
    exc_value: BaseException,
    exc_traceback: TracebackType | None,
) -> None:
    del exc_type
    del exc_traceback
    logger = LogManager.get()
    logger.fatal(Localizer.get().log_crash, exc_value)
    logger.shutdown()

    if not isinstance(exc_value, KeyboardInterrupt):
        print("")
        for i in range(3):
            print(Localizer.get().app_exit_countdown.format(SECONDS=3 - i))
            time.sleep(1)

    os.kill(os.getpid(), signal.SIGTERM)


def thread_excepthook(args: threading.ExceptHookArgs) -> None:
    """子线程未捕获异常处理。

    注意：hook 本身不得抛异常，避免递归/抑制后续 hook 调用。
    """

    try:
        thread_name = getattr(getattr(args, "thread", None), "name", "<unknown>")
        LogManager.get().fatal(
            f"Uncaught exception in thread: {thread_name}",
            getattr(args, "exc_value", None),
        )
    except Exception:
        # 兜底：异常处理路径中再抛异常只会让排障更困难。
        pass


def unraisable_hook(unraisable: sys.UnraisableHookArgs) -> None:
    """析构/GC 阶段不可引发异常处理。

    注意：不要持久化保存 unraisable.object / exc_value 等引用（可能导致对象复活/引用环）。
    """

    try:
        obj_repr = repr(getattr(unraisable, "object", None))
        err_msg = getattr(unraisable, "err_msg", "") or ""
        LogManager.get().fatal(
            f"Unraisable exception: {err_msg} object={obj_repr}",
            getattr(unraisable, "exc_value", None),
            level=logging.WARNING,
        )
    except Exception:
        # 兜底：异常处理路径中再抛异常只会让排障更困难。
        pass


def disable_windows_quick_edit_mode() -> None:
    """无头运行时仍复用旧终端保护，避免误选中文本卡住进程。"""
    if os.name == "nt":
        kernel32 = ctypes.windll.kernel32

        h_stdin = kernel32.GetStdHandle(-10)
        mode = ctypes.c_ulong()

        if kernel32.GetConsoleMode(h_stdin, ctypes.byref(mode)):
            mode.value &= ~0x0040
            kernel32.SetConsoleMode(h_stdin, mode)


def bootstrap_runtime() -> LogManager:
    """统一收敛无头 Core API 入口共享的启动阶段。"""
    app_root = BasePath.resolve_app_root()
    is_frozen = getattr(sys, "frozen", False)

    BasePath.initialize(app_root, is_frozen)

    sys.excepthook = excepthook
    sys.unraisablehook = unraisable_hook
    threading.excepthook = thread_excepthook

    disable_windows_quick_edit_mode()

    if app_root not in sys.path:
        sys.path.append(app_root)

    os.chdir(app_root)

    UserDataMigrationService.run_startup_migrations()

    config = Config().load()
    Localizer.set_app_language(config.app_language)
    logger = LogManager.get()

    version_path = os.path.join(BasePath.get_app_root(), APP_VERSION_FILE_NAME)
    with open(version_path, "r", encoding="utf-8-sig") as reader:
        version = reader.read().strip()

    Base.APP_VERSION = version
    logger.info(f"{Base.APP_NAME} v{version}")
    logger.print("")

    Engine.get().run()

    return logger


def cleanup_runtime(
    *,
    local_api_server_runtime: ServerBootstrap.ServerRuntime | None,
    logger: LogManager,
) -> None:
    """统一关闭服务、卸载工程并冲刷日志，避免不同退出口各写一份。"""
    runtime_shutdown = getattr(local_api_server_runtime, "shutdown", None)
    if callable(runtime_shutdown):
        runtime_shutdown()

    data_manager = DataManager.get()
    if data_manager.is_loaded():
        data_manager.unload_project()

    logger.shutdown()


def wait_for_headless_shutdown(
    shutdown_event: threading.Event | None = None,
) -> None:
    """无头模式持续驻留，直到收到中断信号。"""
    resolved_shutdown_event = (
        threading.Event() if shutdown_event is None else shutdown_event
    )
    while not resolved_shutdown_event.wait(0.5):
        continue


def request_shutdown_after_response(shutdown_event: threading.Event) -> None:
    """HTTP 响应先写回，再异步触发统一清理路径。"""

    shutdown_timer = threading.Timer(
        SHUTDOWN_API_RESPONSE_DELAY_SECONDS,
        shutdown_event.set,
    )
    shutdown_timer.daemon = True
    shutdown_timer.start()


def install_shutdown_signal_handlers(shutdown_event: threading.Event) -> None:
    """Electron 关闭或终端中断都汇入同一个 shutdown event。"""

    def handle_signal(signal_number: int, frame) -> None:
        del signal_number
        del frame
        shutdown_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)


def load_parent_pid() -> int | None:
    """读取 Electron main 传入的父进程 PID；缺失时跳过守护。"""

    raw_parent_pid = os.environ.get(PARENT_PID_ENV_NAME, "").strip()
    if raw_parent_pid == "":
        return None

    try:
        parent_pid = int(raw_parent_pid)
    except ValueError:
        return None

    if parent_pid <= 0:
        return None
    return parent_pid


def is_windows_process_alive(pid: int) -> bool:
    """Windows 下用进程句柄查询存活状态，避免向父进程发送信号。"""

    kernel32 = ctypes.windll.kernel32
    process_handle = kernel32.OpenProcess(
        WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION,
        False,
        pid,
    )
    if process_handle == 0:
        return False

    exit_code = ctypes.c_ulong()
    try:
        if not kernel32.GetExitCodeProcess(
            process_handle,
            ctypes.byref(exit_code),
        ):
            return False
        return exit_code.value == WINDOWS_STILL_ACTIVE_EXIT_CODE
    finally:
        kernel32.CloseHandle(process_handle)


def is_posix_process_alive(pid: int) -> bool:
    """POSIX 下 signal 0 只做存在性探测，不会终止目标进程。"""

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def is_parent_process_alive(pid: int) -> bool:
    """跨平台判断 Electron main 是否仍然存在。"""

    if os.name == "nt":
        return is_windows_process_alive(pid)
    return is_posix_process_alive(pid)


def start_parent_process_watchdog(
    *,
    shutdown_event: threading.Event,
    logger: LogManager,
) -> threading.Thread | None:
    """父进程消失时自动触发清理，避免 Core 成为孤儿进程。"""

    parent_pid = load_parent_pid()
    if parent_pid is None:
        return None

    def watch_parent_process() -> None:
        while not shutdown_event.wait(PARENT_WATCH_INTERVAL_SECONDS):
            if not is_parent_process_alive(parent_pid):
                logger.warning(
                    f"Parent process is gone, shutting down Core: {parent_pid}"
                )
                shutdown_event.set()
                return

    watchdog_thread = threading.Thread(
        target=watch_parent_process,
        daemon=True,
        name="CoreParentProcessWatchdog",
    )
    watchdog_thread.start()
    return watchdog_thread


def run_headless_mode(*, logger: LogManager) -> None:
    """无头模式负责本地 Core API 生命周期与统一清理。"""
    shutdown_event = threading.Event()
    install_shutdown_signal_handlers(shutdown_event)
    start_parent_process_watchdog(
        shutdown_event=shutdown_event,
        logger=logger,
    )
    core_lifecycle_app_service = CoreLifecycleAppService(
        instance_token=os.environ.get(CORE_INSTANCE_TOKEN_ENV_NAME, ""),
        request_shutdown=lambda: request_shutdown_after_response(shutdown_event),
    )
    local_api_server_runtime = ServerBootstrap.start(
        core_lifecycle_app_service=core_lifecycle_app_service,
    )
    try:
        wait_for_headless_shutdown(shutdown_event)
    except KeyboardInterrupt:
        shutdown_event.set()
    finally:
        cleanup_runtime(
            local_api_server_runtime=local_api_server_runtime,
            logger=logger,
        )


def main(argv: list[str] | None = None) -> int:
    """无头 Core API 的唯一公开入口。"""
    del argv

    logger = bootstrap_runtime()
    run_headless_mode(logger=logger)
    return 0


if __name__ == "__main__":
    sys.exit(main())
