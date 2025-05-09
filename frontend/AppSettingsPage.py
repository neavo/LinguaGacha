import os
import signal
import subprocess
import sys

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import SwitchButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard
from widget.LineEditCard import LineEditCard
from widget.SwitchButtonCard import SwitchButtonCard

class AppSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient = Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_expert_mode(scroll_area_vbox, config, window)
        self.add_widget_font_hinting(scroll_area_vbox, config, window)
        self.add_widget_scale_factor(scroll_area_vbox, config, window)
        self.add_widget_proxy(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 专家模式
    def add_widget_expert_mode(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                config.expert_mode
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            config.reset_expert_settings()
            config.expert_mode = widget.get_switch_button().isChecked()
            config.save()

            message_box = MessageBox(Localizer.get().warning, Localizer.get().app_settings_page_close, self)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().app_settings_page_expert_title,
                description = Localizer.get().app_settings_page_expert_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 字体优化
    def add_widget_font_hinting(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                config.font_hinting
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            config.font_hinting =  widget.get_switch_button().isChecked()
            config.save()

            message_box = MessageBox(Localizer.get().warning, Localizer.get().app_settings_page_close, self)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().app_settings_page_font_hinting_title,
                description = Localizer.get().app_settings_page_font_hinting_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 全局缩放
    def add_widget_scale_factor(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: ComboBoxCard) -> None:
            widget.get_combo_box().setCurrentIndex(
                max(0, widget.get_combo_box().findText(config.scale_factor))
            )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()
            config.scale_factor = widget.get_current_text()
            config.save()

            message_box = MessageBox(Localizer.get().warning, Localizer.get().app_settings_page_close, self)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        parent.addWidget(
            ComboBoxCard(
                title = Localizer.get().app_settings_page_scale_factor_title,
                description = Localizer.get().app_settings_page_scale_factor_content,
                items = (Localizer.get().auto, "50%", "75%", "150%", "200%"),
                init = init,
                current_changed = current_changed,
            )
        )

    # 网络代理
    def add_widget_proxy(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def checked_changed(swicth_button: SwitchButton, checked: bool) -> None:
            config = Config().load()
            config.proxy_enable = checked
            config.save()

            message_box = MessageBox(Localizer.get().warning, Localizer.get().app_settings_page_close, self)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        def init(widget: LineEditCard) -> None:
            widget.get_line_edit().setText(config.proxy_url)
            widget.get_line_edit().setFixedWidth(256)
            widget.get_line_edit().setPlaceholderText(Localizer.get().app_settings_page_proxy_url)

            swicth_button = SwitchButton()
            swicth_button.setOnText("")
            swicth_button.setOffText("")
            swicth_button.setChecked(config.proxy_enable)
            swicth_button.checkedChanged.connect(lambda checked: checked_changed(swicth_button, checked))
            widget.add_spacing(8)
            widget.add_widget(swicth_button)

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = Config().load()
            config.proxy_url = text.strip()
            config.save()

        parent.addWidget(
            LineEditCard(
                title = Localizer.get().app_settings_page_proxy_url_title,
                description = Localizer.get().app_settings_page_proxy_url_content,
                init = init,
                text_changed = text_changed,
            )
        )