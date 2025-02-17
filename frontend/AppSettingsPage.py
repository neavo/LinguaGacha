import os
import sys
import json
import subprocess

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QFileDialog

from qfluentwidgets import PushButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import SwitchButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.EmptyCard import EmptyCard
from widget.ComboBoxCard import ComboBoxCard
from widget.LineEditCard import LineEditCard
from widget.SwitchButtonCard import SwitchButtonCard

class AppSettingsPage(QWidget, Base):

    def __init__(self, text: str, window) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "proxy_url": "",
            "proxy_enable": False,
            "font_hinting": True,
            "scale_factor": "自动",
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.container = QVBoxLayout(self)
        self.container.setContentsMargins(0, 0, 0, 0)

        # 设置滚动容器
        self.scroller = SingleDirectionScrollArea(self, orient = Qt.Vertical)
        self.scroller.setWidgetResizable(True)
        self.scroller.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        self.container.addWidget(self.scroller)

        # 设置容器
        self.vbox_parent = QWidget(self)
        self.vbox_parent.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.vbox_parent)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下
        self.scroller.setWidget(self.vbox_parent)

        # 添加控件
        self.add_widget_proxy(self.vbox, config)
        self.add_widget_font_hinting(self.vbox, config)
        self.add_widget_debug_mode(self.vbox, config)
        self.add_widget_scale_factor(self.vbox, config)

        # 填充
        self.vbox.addStretch(1)

    # 网络代理地址
    def add_widget_proxy(self, parent, config) -> None:

        def checked_changed(swicth_button, checked: bool) -> None:
            swicth_button.setChecked(checked)

            config = self.load_config()
            config["proxy_enable"] = checked
            self.save_config(config)

        def init(widget) -> None:
            widget.set_text(config.get("proxy_url"))
            widget.set_fixed_width(256)
            widget.set_placeholder_text(Localizer.get().app_settings_page_proxy_url)

            swicth_button = SwitchButton()
            swicth_button.setOnText(Localizer.get().enable)
            swicth_button.setOffText(Localizer.get().disable)
            swicth_button.setChecked(config.get("proxy_enable", False))
            swicth_button.checkedChanged.connect(lambda checked: checked_changed(swicth_button, checked))
            widget.add_spacing(8)
            widget.add_widget(swicth_button)

        def text_changed(widget, text: str) -> None:
            config = self.load_config()
            config["proxy_url"] = text.strip()
            self.save_config(config)

        parent.addWidget(
            LineEditCard(
                Localizer.get().app_settings_page_proxy_url_title,
                Localizer.get().app_settings_page_proxy_url_content,
                init = init,
                text_changed = text_changed,
            )
        )

    # 应用字体优化
    def add_widget_font_hinting(self, parent, config) -> None:
        def init(widget) -> None:
            widget.set_checked(config.get("font_hinting"))

        def checked_changed(widget, checked: bool) -> None:
            config = self.load_config()
            config["font_hinting"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().app_settings_page_font_hinting_title,
                Localizer.get().app_settings_page_font_hinting_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 调整模式
    def add_widget_debug_mode(self, parent, config) -> None:
        def init(widget) -> None:
            widget.set_checked(os.path.isfile("./debug.txt"))

        def checked_changed(widget, checked: bool) -> None:
            if checked == True:
                open("./debug.txt", "w").close()
            else:
                os.remove("./debug.txt") if os.path.isfile("./debug.txt") else None

            # 重置调试模式检查状态
            self.reset_debug()

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().app_settings_page_debug_title,
                Localizer.get().app_settings_page_debug_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 全局缩放比例
    def add_widget_scale_factor(self, parent, config) -> None:
        def init(widget: ComboBoxCard) -> None:
            widget.set_current_index(max(0, widget.find_text(config.get("scale_factor"))))

        def current_changed(widget: ComboBoxCard) -> None:
            config = self.load_config()
            config["scale_factor"] = widget.get_current_text()
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().app_settings_page_scale_factor_title,
                Localizer.get().app_settings_page_scale_factor_content,
                ["自动", "50%", "75%", "150%", "200%"],
                init = init,
                current_changed = current_changed,
            )
        )