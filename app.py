import ctypes
import os
import signal
import sys
import time
from types import TracebackType

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import QApplication
from qfluentwidgets import Theme
from qfluentwidgets import setTheme
from rich.console import Console

from base.CLIManager import CLIManager
from base.LogManager import LogManager
from base.VersionManager import VersionManager
from frontend.AppFluentWindow import AppFluentWindow
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.SessionContext import SessionContext


def excepthook(
    exc_type: type[BaseException],
    exc_value: BaseException,
    exc_traceback: TracebackType,
) -> None:
    LogManager.get().error(Localizer.get().log_crash, exc_value)

    if not isinstance(exc_value, KeyboardInterrupt):
        print("")
        for i in range(3):
            print(Localizer.get().app_exit_countdown.format(SECONDS=3 - i))
            time.sleep(1)

    os.kill(os.getpid(), signal.SIGTERM)


if __name__ == "__main__":
    # 捕获全局异常
    sys.excepthook = lambda exc_type, exc_value, exc_traceback: excepthook(
        exc_type, exc_value, exc_traceback
    )

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

    # 1. 全局缩放使能 (Enable High DPI Scaling)
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_EnableHighDpiScaling, True)
    # 2. 适配非整数倍缩放 (Adapt non-integer scaling)
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    # 设置工作目录
    app_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    sys.path.append(app_dir)

    # 检测只读环境（AppImage, macOS .app bundle）
    is_appimage = os.environ.get("APPIMAGE") is not None
    is_macos_app = sys.platform == "darwin" and ".app/Contents/MacOS" in app_dir

    if is_appimage or is_macos_app:
        # 便携式环境使用用户主目录存储数据
        data_dir = os.path.join(os.path.expanduser("~"), "LinguaGacha")
    else:
        # Windows 和直接执行时使用应用目录
        data_dir = app_dir

    # 设置环境变量供其他模块使用
    os.environ["LINGUAGACHA_APP_DIR"] = app_dir
    os.environ["LINGUAGACHA_DATA_DIR"] = data_dir

    # 工作目录保持在 app_dir 以便访问资源文件（version.txt, resource/ 等）
    os.chdir(app_dir)

    # 创建文件夹
    os.makedirs(os.path.join(data_dir, "input"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "output"), exist_ok=True)

    # 载入并保存默认配置
    config = Config().load()

    # 加载版本号
    with open("version.txt", "r", encoding="utf-8-sig") as reader:
        version = reader.read().strip()

    # 设置主题
    setTheme(Theme.DARK if config.theme == Config.Theme.DARK else Theme.LIGHT)

    # 设置应用语言
    Localizer.set_app_language(config.app_language)

    # 打印日志
    LogManager.get().info(f"LinguaGacha {version}")
    LogManager.get().info(
        Localizer.get().log_expert_mode
    ) if LogManager.get().is_expert_mode() else None

    # 网络代理
    if not config.proxy_enable or config.proxy_url == "":
        os.environ.pop("http_proxy", None)
        os.environ.pop("https_proxy", None)
    else:
        LogManager.get().info(Localizer.get().log_proxy)
        os.environ["http_proxy"] = config.proxy_url
        os.environ["https_proxy"] = config.proxy_url

    # 设置全局缩放比例
    if config.scale_factor == "50%":
        os.environ["QT_SCALE_FACTOR"] = "0.50"
    elif config.scale_factor == "75%":
        os.environ["QT_SCALE_FACTOR"] = "0.75"
    elif config.scale_factor == "150%":
        os.environ["QT_SCALE_FACTOR"] = "1.50"
    elif config.scale_factor == "200%":
        os.environ["QT_SCALE_FACTOR"] = "2.00"
    else:
        os.environ.pop("QT_SCALE_FACTOR", None)

    # 创建全局应用对象
    app = QApplication(sys.argv)

    # 设置应用图标
    app.setWindowIcon(QIcon("resource/icon_no_bg.png"))

    # 设置全局字体属性，解决狗牙问题
    font = QFont()
    if config.font_hinting:
        font.setHintingPreference(QFont.HintingPreference.PreferFullHinting)
    else:
        font.setHintingPreference(QFont.HintingPreference.PreferNoHinting)
    app.setFont(font)

    # 启动任务引擎
    Engine.get().run()

    # 创建版本管理器
    VersionManager.get().set_version(version)

    # 注册应用退出清理（确保数据库连接正确关闭，WAL 文件被清理）
    def cleanup_on_exit() -> None:
        ctx = SessionContext.get()
        if ctx.is_loaded():
            ctx.unload()

    app.aboutToQuit.connect(cleanup_on_exit)

    # 处理启动参数
    if not CLIManager.get().run():
        app_fluent_window = AppFluentWindow()
        app_fluent_window.show()

    # 进入事件循环，等待用户操作
    sys.exit(app.exec())
