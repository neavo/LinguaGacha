import os
import sys

import rapidjson as json
from PyQt5.QtGui import QFont
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QApplication

from module.Platform.PlatformTester import PlatformTester
from module.Localizer.Localizer import Localizer
from module.Translator.Translator import Translator
from frontend.AppFluentWindow import AppFluentWindow

# 载入配置文件
def load_config() -> dict:
    config = {}

    if os.path.exists("resource/config.json"):
        with open("resource/config.json", "r", encoding = "utf-8-sig") as reader:
            config = json.load(reader)

    return config

if __name__ == "__main__":
    # 启用了高 DPI 缩放
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps)

    # 设置工作目录
    script_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    sys.path.append(script_dir)
    # print(f"[[green]INFO[/]] 当前工作目录为 {script_dir}")

    # 载入配置文件
    config = load_config()

    # 设置应用语言
    Localizer.set_app_language(config.get("app_language"))

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

    # 设置全局字体属性，解决狗牙问题
    font = QFont("Consolas")
    if config.get("font_hinting", True) == True:
        font.setHintingPreference(QFont.PreferFullHinting)
    else:
        font.setHintingPreference(QFont.PreferNoHinting)
    app.setFont(font)

    # 创建全局窗口对象
    with open("version.txt", "r", encoding = "utf-8-sig") as reader:
        version = reader.read().strip()
    app_fluent_window = AppFluentWindow(f"LinguaGacha {version}")

    # 创建翻译器
    translator = Translator()

    # 创建接口测试器
    platform_test = PlatformTester()

    # 显示全局窗口
    app_fluent_window.show()

    # 进入事件循环，等待用户操作
    sys.exit(app.exec_())