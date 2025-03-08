import os
import sys
import traceback

import rapidjson as json
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QIcon
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QApplication
from qfluentwidgets import Theme
from qfluentwidgets import setTheme

from base.Base import Base
from module.Platform.PlatformTester import PlatformTester
from module.Localizer.Localizer import Localizer
from module.LogHelper import LogHelper
from module.AppUpdater import AppUpdater
from module.Translator.Translator import Translator
from frontend.AppFluentWindow import AppFluentWindow

# 捕获全局异常
def excepthook(exc_type, exc_value, exc_traceback) -> None:
    if issubclass(exc_type, KeyboardInterrupt):
        # 用户中断，不记录日志
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    # 使用LogHelper记录异常信息
    LogHelper.error(f"{Localizer.get().log_crash}\n{"".join(traceback.format_exception(exc_type, exc_value, exc_traceback)).strip()}")

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

    # 启用了高 DPI 缩放
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps)

    # 设置工作目录
    script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    sys.path.append(script_dir)

    # 创建文件夹
    os.makedirs("./input", exist_ok = True)
    os.makedirs("./output", exist_ok = True)

    # 载入配置文件
    config = load_config()

    # 加载版本号
    with open("version.txt", "r", encoding = "utf-8-sig") as reader:
        version = reader.read().strip()

    # 设置主题
    setTheme(Theme.DARK if config.get("theme", "light") == "dark" else Theme.LIGHT)

    # 设置应用语言
    Localizer.set_app_language(config.get("app_language", Base.Language.ZH))

    # 打印日志
    LogHelper.info(f"LinguaGacha {version}")
    LogHelper.debug(Localizer.get().log_debug_mode) if LogHelper.is_debug() else None

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
    font = QFont("Consolas")
    if config.get("font_hinting", True) == True:
        font.setHintingPreference(QFont.PreferFullHinting)
    else:
        font.setHintingPreference(QFont.PreferNoHinting)
    app.setFont(font)

    # 创建全局窗口对象
    app_fluent_window = AppFluentWindow(version)

    # 创建翻译器
    translator = Translator()

    # 创建应用更新其
    app_updater = AppUpdater()

    # 创建接口测试器
    platform_test = PlatformTester()

    # 显示全局窗口
    app_fluent_window.show()

    # 进入事件循环，等待用户操作
    sys.exit(app.exec_())