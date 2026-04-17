import ctypes
import logging
import os
import signal
import sys
import threading
import time
from types import TracebackType

from rich.console import Console

from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from base.BasePath import BasePath
from base.CLIManager import CLIManager
from base.LogManager import LogManager
from base.VersionManager import VersionManager
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Migration.UserDataMigrationService import UserDataMigrationService

APP_VERSION_FILE_NAME: str = "version.txt"
PROXY_ENV_NAMES: tuple[str, ...] = ("http_proxy", "https_proxy")


def start_local_api_server_if_needed(
    *,
    is_cli_mode: bool,
    server_bootstrap: type[ServerBootstrap],
) -> ServerBootstrap.ServerRuntime | None:
    """本地 Core 服务只属于 UI 边界，CLI 仍维持内部入口语义。"""

    if is_cli_mode:
        return None
    return server_bootstrap.start()


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


def configure_proxy_environment(config: Config, logger: LogManager) -> None:
    """统一维护代理环境变量，避免启动流程里散落重复的赋值逻辑。"""
    if not config.proxy_enable or config.proxy_url == "":
        for proxy_env_name in PROXY_ENV_NAMES:
            os.environ.pop(proxy_env_name, None)
        return

    logger.info(Localizer.get().log_proxy)
    for proxy_env_name in PROXY_ENV_NAMES:
        os.environ[proxy_env_name] = config.proxy_url


def disable_windows_quick_edit_mode() -> None:
    """无头运行时仍复用旧终端保护，避免误选中文本卡住进程。"""
    if os.name == "nt" and Console().color_system != "truecolor":
        kernel32 = ctypes.windll.kernel32

        h_stdin = kernel32.GetStdHandle(-10)
        mode = ctypes.c_ulong()

        if kernel32.GetConsoleMode(h_stdin, ctypes.byref(mode)):
            mode.value &= ~0x0040
            kernel32.SetConsoleMode(h_stdin, mode)


def bootstrap_runtime() -> LogManager:
    """统一收敛无头入口与 CLI 入口共享的启动阶段。"""
    app_dir = BasePath.resolve_app_dir()
    is_frozen = getattr(sys, "frozen", False)

    BasePath.initialize(app_dir, is_frozen)

    sys.excepthook = excepthook
    sys.unraisablehook = unraisable_hook
    threading.excepthook = thread_excepthook

    disable_windows_quick_edit_mode()

    if app_dir not in sys.path:
        sys.path.append(app_dir)

    os.chdir(app_dir)

    VersionManager.cleanup_update_temp_on_startup()
    UserDataMigrationService.run_startup_migrations()

    config = Config().load()
    Localizer.set_app_language(config.app_language)
    logger = LogManager.get()

    version_path = os.path.join(BasePath.get_app_dir(), APP_VERSION_FILE_NAME)
    with open(version_path, "r", encoding="utf-8-sig") as reader:
        version = reader.read().strip()

    logger.info(f"{Base.APP_NAME} {version}")
    if logger.is_expert_mode():
        logger.info(Localizer.get().log_expert_mode)
    logger.print("")

    configure_proxy_environment(config, logger)
    Engine.get().run()
    VersionManager.get().set_version(version)

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


def wait_for_headless_shutdown() -> None:
    """无头模式持续驻留，直到收到中断信号。"""
    stop_event = threading.Event()
    while not stop_event.wait(0.5):
        continue


def run_headless_mode(*, logger: LogManager) -> None:
    """无头模式负责本地 Core API 生命周期与统一清理。"""
    local_api_server_runtime = ServerBootstrap.start()
    try:
        wait_for_headless_shutdown()
    except KeyboardInterrupt:
        return
    finally:
        cleanup_runtime(
            local_api_server_runtime=local_api_server_runtime,
            logger=logger,
        )


def main() -> int:
    """统一无头入口与 CLI 入口的退出码收口。"""
    logger = bootstrap_runtime()
    cli_manager = CLIManager.get()
    is_cli_mode = cli_manager.run()

    if is_cli_mode:
        exit_code = cli_manager.get_exit_code()
        cleanup_runtime(local_api_server_runtime=None, logger=logger)
        if exit_code is None:
            return 0
        else:
            return exit_code
    else:
        run_headless_mode(logger=logger)
        return 0


if __name__ == "__main__":
    sys.exit(main())
