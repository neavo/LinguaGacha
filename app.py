import os
import sys
import json
import ctypes
import traceback

from rich.console import Console
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QIcon
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QApplication
from qfluentwidgets import Theme
from qfluentwidgets import setTheme

from base.BaseLanguage import BaseLanguage
from module.Platform.PlatformTester import PlatformTester
from module.Localizer.Localizer import Localizer
from base.LogManager import LogManager
from module.Translator.Translator import Translator
from module.ExpertConfig import ExpertConfig
from module.VersionManager import VersionManager
from frontend.AppFluentWindow import AppFluentWindow

# 捕获全局异常
def excepthook(exc_type, exc_value, exc_traceback) -> None:
    if issubclass(exc_type, KeyboardInterrupt):
        # 用户中断，不记录日志
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    # 使用LogHelper记录异常信息
    LogManager.error(f"{Localizer.get().log_crash}\n{"".join(traceback.format_exception(exc_type, exc_value, exc_traceback)).strip()}")

# 载入配置文件
def load_config() -> dict:
    config = {}

    if os.path.exists("resource/config.json"):
        with open("resource/config.json", "r", encoding = "utf-8-sig") as reader:
            config = json.load(reader)

    return config

if __name__ == "__main__":
    # 捕获全局异常
    sys.excepthook = excepthook

    # 当运行在 Windows 系统且没有运行在新终端时，禁用快速编辑模式
    if os.name == "nt" and Console().color_system != "truecolor":
        user32 = ctypes.windll.user32
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

    # 启用了高 DPI 缩放
    # 1. 全局缩放使能 (Enable High DPI Scaling)
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    # 2. 适配非整数倍缩放 (Adapt non-integer scaling)
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)

    # 设置工作目录
    script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    sys.path.append(script_dir)

    # 创建文件夹
    os.makedirs("./input", exist_ok=True)
    os.makedirs("./output", exist_ok=True)

    # 载入配置文件
    config = load_config()

    # 加载版本号
    with open("version.txt", "r", encoding="utf-8-sig") as reader:
        version = reader.read().strip()

    # 设置主题
    setTheme(Theme.DARK if config.get("theme", "light") == "dark" else Theme.LIGHT)

    # 设置应用语言
    Localizer.set_app_language(config.get("app_language", BaseLanguage.ZH))

    # 打印日志
    LogManager.info(f"LinguaGacha {version}")
    LogManager.debug(Localizer.get().log_debug_mode) if LogManager.is_debug() else None

    # 设置全局缩放比例
    if config.get("scale_factor", "") == "50%":
        os.environ["QT_SCALE_FACTOR"] = "0.50"
    elif config.get("scale_factor", "") == "75%":
        os.environ["QT_SCALE_FACTOR"] = "0.75"
    elif config.get("scale_factor", "") == "150%":
        os.environ["QT_SCALE_FACTOR"] = "1.50"
    elif config.get("scale_factor", "") == "200%":
        os.environ["QT_SCALE_FACTOR"] = "2.00"

    # 创建全局应用对象
    app = QApplication(sys.argv)

    # 设置应用图标
    app.setWindowIcon(QIcon("resource/icon_no_bg.png"))

    # 设置全局字体属性，解决狗牙问题
    font = QFont()
    font.setStyleStrategy(QFont.PreferAntialias)
    if config.get("font_hinting", True) == True:
        font.setHintingPreference(QFont.PreferFullHinting)
    else:
        font.setHintingPreference(QFont.PreferNoHinting)
    app.setFont(font)

    # 初始化实例
    ExpertConfig.get()

    # 创建翻译器
    translator = Translator()

    # 创建接口测试器
    platform_test = PlatformTester()

    # 创建应用更新其
    version_manager = VersionManager(version)

    # 创建全局窗口对象
    app_fluent_window = AppFluentWindow()
    app_fluent_window.show()

    # 进入事件循环，等待用户操作
    sys.exit(app.exec_())
