import os
import signal

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QWidget
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from qfluentwidgets import ComboBox
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import SwitchButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomLineEdit
from widget.SettingCard import SettingCard


class AppSettingsPage(Base, QWidget):
    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_expert_mode(scroll_area_vbox, config, window)
        self.add_widget_scale_factor(scroll_area_vbox, config, window)
        self.add_widget_proxy(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 专家模式
    def add_widget_expert_mode(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:

        def checked_changed(button: SwitchButton) -> None:
            config = Config().load()
            config.reset_expert_settings()
            config.expert_mode = button.isChecked()
            config.save()

            message_box = MessageBox(
                Localizer.get().warning, Localizer.get().app_settings_page_close, self
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        card = SettingCard(
            title=Localizer.get().app_settings_page_expert_title,
            description=Localizer.get().app_settings_page_expert_content,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(config.expert_mode)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # 全局缩放
    def add_widget_scale_factor(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:

        def current_changed(combo_box: ComboBox) -> None:
            config = Config().load()
            config.scale_factor = combo_box.text()
            config.save()

            message_box = MessageBox(
                Localizer.get().warning, Localizer.get().app_settings_page_close, self
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        card = SettingCard(
            title=Localizer.get().app_settings_page_scale_factor_title,
            description=Localizer.get().app_settings_page_scale_factor_content,
            parent=self,
        )
        combo_box = ComboBox(card)
        combo_box.addItems(
            (Localizer.get().auto, "50%", "75%", "150%", "200%")
        )
        combo_box.setCurrentIndex(max(0, combo_box.findText(config.scale_factor)))
        combo_box.currentIndexChanged.connect(
            lambda index: current_changed(combo_box)
        )
        card.add_right_widget(combo_box)
        parent.addWidget(card)

    # 网络代理
    def add_widget_proxy(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:

        def checked_changed(button: SwitchButton, checked: bool) -> None:
            config = Config().load()
            config.proxy_enable = checked
            config.save()

            message_box = MessageBox(
                Localizer.get().warning, Localizer.get().app_settings_page_close, self
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.hide()

            # 关闭应用
            if message_box.exec():
                os.kill(os.getpid(), signal.SIGTERM)

        def text_changed(line_edit: CustomLineEdit, text: str) -> None:
            config = Config().load()
            config.proxy_url = text.strip()
            config.save()

        card = SettingCard(
            title=Localizer.get().app_settings_page_proxy_url_title,
            description=Localizer.get().app_settings_page_proxy_url_content,
            parent=self,
        )
        line_edit = CustomLineEdit(card)
        line_edit.setText(config.proxy_url)
        line_edit.setFixedWidth(256)
        line_edit.setClearButtonEnabled(True)
        line_edit.setPlaceholderText(Localizer.get().app_settings_page_proxy_url)
        line_edit.textChanged.connect(lambda text: text_changed(line_edit, text))

        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(config.proxy_enable)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button, checked)
        )

        card.add_right_widget(line_edit)
        card.add_right_spacing(8)
        card.add_right_widget(switch_button)
        parent.addWidget(card)
