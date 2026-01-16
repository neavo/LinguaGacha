import os
import webbrowser

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import PushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard
from widget.PushButtonCard import PushButtonCard
from widget.SpinCard import SpinCard
from widget.SwitchButtonCard import SwitchButtonCard

class BasicSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 根据应用语言构建语言列表
        if Localizer.get_app_language() == BaseLanguage.Enum.ZH:
            self.languages = [BaseLanguage.get_name_zh(v) for v in BaseLanguage.get_languages()]
        else:
            self.languages = [BaseLanguage.get_name_en(v) for v in BaseLanguage.get_languages()]

        # 设置容器
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
        self.add_widget_source_language(scroll_area_vbox, config, window)
        self.add_widget_target_language(scroll_area_vbox, config, window)
        self.add_widget_input_folder(scroll_area_vbox, config, window)
        self.add_widget_output_folder(scroll_area_vbox, config, window)
        self.add_widget_output_folder_open_on_finish(scroll_area_vbox, config, window)
        self.add_widget_traditional_chinese(scroll_area_vbox, config, window)
        self.add_widget_request_timeout(scroll_area_vbox, config, window)
        self.add_widget_max_round(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 原文语言
    def add_widget_source_language(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:
        def init(widget: ComboBoxCard) -> None:
            if config.source_language in BaseLanguage.get_languages():
                widget.get_combo_box().setCurrentIndex(
                    BaseLanguage.get_languages().index(config.source_language)
                )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()
            config.source_language = BaseLanguage.get_languages()[widget.get_combo_box().currentIndex()]
            config.save()

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().basic_settings_page_source_language_title,
                Localizer.get().basic_settings_page_source_language_content,
                items = self.languages,
                init = init,
                current_changed = current_changed,
            )
        )

    # 译文语言
    def add_widget_target_language(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:

        def init(widget: ComboBoxCard) -> None:
            if config.target_language in BaseLanguage.get_languages():
                widget.get_combo_box().setCurrentIndex(
                    BaseLanguage.get_languages().index(config.target_language)
                )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()
            config.target_language = BaseLanguage.get_languages()[widget.get_combo_box().currentIndex()]
            config.save()

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().basic_settings_page_target_language_title,
                Localizer.get().basic_settings_page_target_language_content,
                items = self.languages,
                init = init,
                current_changed = current_changed,
            )
        )

    # 输入文件夹
    def add_widget_input_folder(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:

        def open_btn_clicked(widget: PushButton) -> None:
            webbrowser.open(os.path.abspath(Config().load().input_folder))

        def init(widget: PushButtonCard) -> None:
            open_btn = PushButton(FluentIcon.FOLDER, Localizer.get().open, self)
            open_btn.clicked.connect(open_btn_clicked)
            widget.add_spacing(4)
            widget.add_widget(open_btn)

            widget.get_description_label().setText(f"{Localizer.get().basic_settings_page_input_folder_content} {config.input_folder}")
            widget.get_push_button().setText(Localizer.get().select)
            widget.get_push_button().setIcon(FluentIcon.ADD_TO)

        def clicked(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().select, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.get_description_label().setText(f"{Localizer.get().basic_settings_page_input_folder_content} {path.strip()}")

            # 更新并保存配置
            config = Config().load()
            config.input_folder = path.strip()
            config.save()

        parent.addWidget(
            PushButtonCard(
                title = Localizer.get().basic_settings_page_input_folder_title,
                description = "",
                init = init,
                clicked = clicked,
            )
        )

    # 输出文件夹
    def add_widget_output_folder(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:

        def open_btn_clicked(widget: PushButton) -> None:
            webbrowser.open(os.path.abspath(Config().load().output_folder))

        def init(widget: PushButtonCard) -> None:
            open_btn = PushButton(FluentIcon.FOLDER, Localizer.get().open, self)
            open_btn.clicked.connect(open_btn_clicked)
            widget.add_spacing(4)
            widget.add_widget(open_btn)

            widget.get_description_label().setText(f"{Localizer.get().basic_settings_page_output_folder_content} {config.output_folder}")
            widget.get_push_button().setText(Localizer.get().select)
            widget.get_push_button().setIcon(FluentIcon.ADD_TO)

        def clicked(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().select, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.get_description_label().setText(f"{Localizer.get().basic_settings_page_output_folder_content} {path.strip()}")

            # 更新并保存配置
            config = Config().load()
            config.output_folder = path.strip()
            config.save()

        parent.addWidget(
            PushButtonCard(
                title = Localizer.get().basic_settings_page_output_folder_title,
                description = "",
                init = init,
                clicked = clicked,
            )
        )

    # 任务完成后自动打开输出文件夹
    def add_widget_output_folder_open_on_finish(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                config.output_folder_open_on_finish
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            # 更新并保存配置
            config = Config().load()
            config.output_folder_open_on_finish = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().basic_settings_page_output_folder_open_on_finish_title,
                description = Localizer.get().basic_settings_page_output_folder_open_on_finish_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 繁体输出
    def add_widget_traditional_chinese(self, parent: QLayout, config: Config, windows: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                config.traditional_chinese_enable
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            # 更新并保存配置
            config = Config().load()
            config.traditional_chinese_enable = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().basic_settings_page_traditional_chinese_title,
                Localizer.get().basic_settings_page_traditional_chinese_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 请求超时时间
    def add_widget_request_timeout(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.request_timeout)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.request_timeout = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_request_timeout_title,
                description = Localizer.get().basic_settings_page_request_timeout_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 翻译流程最大轮次
    def add_widget_max_round(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.max_round)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.max_round = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_max_round_title,
                description = Localizer.get().basic_settings_page_max_round_content,
                init = init,
                value_changed = value_changed,
            )
        )