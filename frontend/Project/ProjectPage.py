import os
import webbrowser

from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import PushButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard
from widget.PushButtonCard import PushButtonCard
from widget.SwitchButtonCard import SwitchButtonCard

class ProjectPage(QWidget, Base):

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

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_source_language(self.vbox, config, window)
        self.add_widget_target_language(self.vbox, config, window)
        self.add_widget_input_folder(self.vbox, config, window)
        self.add_widget_output_folder(self.vbox, config, window)
        self.add_widget_output_folder_open_on_finish(self.vbox, config, window)
        self.add_widget_traditional_chinese(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

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
                Localizer.get().project_page_source_language_title,
                Localizer.get().project_page_source_language_content,
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
                Localizer.get().project_page_target_language_title,
                Localizer.get().project_page_target_language_content,
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

            widget.get_description_label().setText(f"{Localizer.get().project_page_input_folder_content} {config.input_folder}")
            widget.get_push_button().setText(Localizer.get().select)
            widget.get_push_button().setIcon(FluentIcon.ADD_TO)

        def clicked(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().select, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.get_description_label().setText(f"{Localizer.get().project_page_input_folder_content} {path.strip()}")

            # 更新并保存配置
            config = Config().load()
            config.input_folder = path.strip()
            config.save()

        parent.addWidget(
            PushButtonCard(
                title = Localizer.get().project_page_input_folder_title,
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

            widget.get_description_label().setText(f"{Localizer.get().project_page_output_folder_content} {config.output_folder}")
            widget.get_push_button().setText(Localizer.get().select)
            widget.get_push_button().setIcon(FluentIcon.ADD_TO)

        def clicked(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().select, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.get_description_label().setText(f"{Localizer.get().project_page_output_folder_content} {path.strip()}")

            # 更新并保存配置
            config = Config().load()
            config.output_folder = path.strip()
            config.save()

        parent.addWidget(
            PushButtonCard(
                title = Localizer.get().project_page_output_folder_title,
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
                title = Localizer.get().project_page_output_folder_open_on_finish_title,
                description = Localizer.get().project_page_output_folder_open_on_finish_content,
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
                Localizer.get().project_page_traditional_chinese_title,
                Localizer.get().project_page_traditional_chinese_content,
                init = init,
                checked_changed = checked_changed,
            )
        )