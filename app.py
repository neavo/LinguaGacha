import ctypes
import logging
import os
import signal
import sys
import threading
import time
from types import TracebackType

from PySide6.QtCore import QMessageLogContext
from PySide6.QtCore import Qt
from PySide6.QtCore import QtMsgType
from PySide6.QtCore import qInstallMessageHandler
from PySide6.QtGui import QFont
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication
from qfluentwidgets import Theme
from qfluentwidgets import setTheme
from rich.console import Console

from api.Application.AppContext import AppContext
from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Server.ServerBootstrap import ServerBootstrap
from base.Base import Base
from base.BasePath import BasePath
from base.CLIManager import CLIManager
from base.EventManager import EventManager
from base.LogManager import LogManager
from base.VersionManager import VersionManager
from frontend.AppFluentWindow import AppFluentWindow
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Migration.UserDataMigrationService import UserDataMigrationService

# QT 日志黑名单
QT_LOG_BLACKLIST: tuple[str, ...] = (
    "Error calling Python override of QDialog::eventFilter()",
    "QFont::setPointSize: Point size <= 0 (-1), must be greater than 0",
)
APP_VERSION_FILE_NAME: str = "version.txt"
APP_ICON_FILE_NAME: str = "icon.png"
PROXY_ENV_NAMES: tuple[str, ...] = ("http_proxy", "https_proxy")
QT_SCALE_FACTOR_ENV_NAME: str = "QT_SCALE_FACTOR"
QT_SCALE_FACTOR_MAP: dict[str, str] = {
    "50%": "0.50",
    "75%": "0.75",
    "150%": "1.50",
    "200%": "2.00",
}


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


def qt_message_handler(
    msg_type: QtMsgType,
    context: QMessageLogContext,
    msg: str,
) -> None:
    """Qt 日志处理器。

    用于屏蔽已知的无害噪音日志，避免污染控制台输出。
    """

    del msg_type, context

    if any(v in msg for v in QT_LOG_BLACKLIST):
        return

    print(msg)


def configure_proxy_environment(config: Config, logger: LogManager) -> None:
    """统一维护代理环境变量，避免启动流程里散落重复的赋值逻辑。"""
    if not config.proxy_enable or config.proxy_url == "":
        for proxy_env_name in PROXY_ENV_NAMES:
            os.environ.pop(proxy_env_name, None)
        return

    logger.info(Localizer.get().log_proxy)
    for proxy_env_name in PROXY_ENV_NAMES:
        os.environ[proxy_env_name] = config.proxy_url


def configure_qt_scale_factor(config: Config) -> None:
    """把缩放配置集中到一个映射表里，后续增减档位时更容易维护。"""
    scale_factor_value = QT_SCALE_FACTOR_MAP.get(config.scale_factor)
    if scale_factor_value is None:
        os.environ.pop(QT_SCALE_FACTOR_ENV_NAME, None)
        return

    os.environ[QT_SCALE_FACTOR_ENV_NAME] = scale_factor_value


if __name__ == "__main__":
    app_dir = BasePath.resolve_app_dir()
    is_frozen = getattr(sys, "frozen", False)

    # 启动早期先固定运行时路径单一来源，后续配置/日志/用户数据都依赖这里。
    BasePath.initialize(app_dir, is_frozen)

    # 捕获全局异常
    sys.excepthook = excepthook
    sys.unraisablehook = unraisable_hook
    threading.excepthook = thread_excepthook

    # 捕获 QT 日志
    qInstallMessageHandler(qt_message_handler)

    # 当运行在 Windows 系统且没有运行在新终端时，禁用快速编辑模式
    if os.name == "nt" and Console().color_system != "truecolor":
        kernel32 = ctypes.windll.kernel32

        # 获取控制台句柄
        hStdin = kernel32.GetStdHandle(-10)
        mode = ctypes.c_ulong()

        # 获取当前控制台模式
        if kernel32.GetConsoleMode(hStdin, ctypes.byref(mode)):
            # 清除启用快速编辑模式的标志 (0x0040)
            mode.value &= ~0x0040
            # 设置新的控制台模式
            kernel32.SetConsoleMode(hStdin, mode)

    # 适配非整数倍缩放
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    # 设置工作目录
    sys.path.append(app_dir)

    # 工作目录保持在 app_dir 以便访问资源文件（version.txt, resource/ 等）
    os.chdir(app_dir)

    # 启动早期先做更新残留清理，确保脚本异常中断后仍可自愈
    VersionManager.cleanup_update_temp_on_startup()

    # 启动期统一执行 userdata 迁移，避免各模块分散保留过渡逻辑。
    UserDataMigrationService.run_startup_migrations()

    # 载入并保存默认配置
    config = Config().load()

    # 加载版本号
    version_path = os.path.join(BasePath.get_app_dir(), APP_VERSION_FILE_NAME)
    with open(version_path, "r", encoding="utf-8-sig") as reader:
        version = reader.read().strip()

    # 设置主题
    setTheme(Theme.DARK if config.theme == Config.Theme.DARK else Theme.LIGHT)

    # 设置应用语言
    Localizer.set_app_language(config.app_language)
    logger = LogManager.get()

    # 打印日志
    logger.info(f"{Base.APP_NAME} {version}")
    if logger.is_expert_mode():
        logger.info(Localizer.get().log_expert_mode)
    logger.print("")

    # 网络代理
    configure_proxy_environment(config, logger)

    # 设置全局缩放比例
    configure_qt_scale_factor(config)

    # 创建全局应用对象
    app = QApplication(sys.argv)

    # 固定事件中心的 QObject 线程亲和性在主线程，避免后台线程首次触发导致回调跑偏。
    EventManager.get()

    icon_path = os.path.join(BasePath.get_resource_dir(), APP_ICON_FILE_NAME)
    app.setWindowIcon(QIcon(icon_path))

    # 设置全局字体属性，解决狗牙问题。
    # 注意：不要用 QFont() 覆盖系统字体尺寸，否则 pointSize() 可能是 -1 并触发 Qt 警告。
    font = QFont(app.font())
    font.setHintingPreference(QFont.HintingPreference.PreferNoHinting)
    app.setFont(font)

    # 启动任务引擎
    Engine.get().run()

    # 创建版本管理器
    VersionManager.get().set_version(version)

    cli_requested = CLIManager.get().build_parser().parse_args().cli
    local_api_server_runtime = start_local_api_server_if_needed(
        is_cli_mode=cli_requested,
        server_bootstrap=ServerBootstrap,
    )
    app_context: AppContext | None = None
    if local_api_server_runtime is not None:
        api_client = ApiClient(local_api_server_runtime.base_url)
        app_context = AppContext(
            project_api_client=ProjectApiClient(api_client),
            api_state_store=ApiStateStore(),
        )

    # 注册应用退出清理（确保数据库连接正确关闭，WAL 文件被清理）
    def cleanup_on_exit() -> None:
        runtime_shutdown = getattr(local_api_server_runtime, "shutdown", None)
        if callable(runtime_shutdown):
            runtime_shutdown()
        dm = DataManager.get()
        if dm.is_loaded():
            dm.unload_project()
        logger.shutdown()

    app.aboutToQuit.connect(cleanup_on_exit)

    # 处理启动参数
    is_cli_mode = CLIManager.get().run()
    if not is_cli_mode:
        app_fluent_window = AppFluentWindow(app_context)
        app_fluent_window.show()

    # 进入事件循环，等待用户操作；CLI 模式额外以 CLIManager 记录的退出码为准。
    app_exit_code = app.exec()
    cli_exit_code = CLIManager.get().get_exit_code()
    logger.shutdown()
    sys.exit(cli_exit_code if cli_exit_code is not None else app_exit_code)
