from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard
from widget.PushButtonCard import PushButtonCard
from widget.SwitchButtonCard import SwitchButtonCard

class ProjectPage(QWidget, Base):

    LANGUAGES = (
        Base.Language.ZH,
        Base.Language.EN,
        Base.Language.JA,
        Base.Language.KO,
        Base.Language.RU,
        Base.Language.DE,
        Base.Language.ID,
        Base.Language.VI,
    )

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "source_language": Base.Language.JA,
            "target_language": Base.Language.ZH,
            "input_folder": "./input",
            "output_folder": "./output",
            "traditional_chinese_enable": False,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_source_language(self.vbox, config, window)
        self.add_widget_target_language(self.vbox, config, window)
        self.add_widget_input_folder(self.vbox, config, window)
        self.add_widget_output_folder(self.vbox, config, window)
        self.add_widget_traditional_chinese(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 原文语言
    def add_widget_source_language(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def init(widget: ComboBoxCard) -> None:
            source_language = config.get("source_language")
            if source_language in ProjectPage.LANGUAGES:
                widget.set_current_index(ProjectPage.LANGUAGES.index(source_language))

        def current_changed(widget: ComboBoxCard) -> None:
            config = self.load_config()
            config["source_language"] = ProjectPage.LANGUAGES[widget.get_current_index()]
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().project_page_source_language_title,
                Localizer.get().project_page_source_language_content,
                Localizer.get().project_page_source_language_items.split(","),
                init = init,
                current_changed = current_changed,
            )
        )

    # 译文语言
    def add_widget_target_language(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:

        def init(widget: ComboBoxCard) -> None:
            source_language = config.get("target_language")
            if source_language in ProjectPage.LANGUAGES:
                widget.set_current_index(ProjectPage.LANGUAGES.index(source_language))

        def current_changed(widget: ComboBoxCard) -> None:
            config = self.load_config()
            config["target_language"] = ProjectPage.LANGUAGES[widget.get_current_index()]
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().project_page_target_language_title,
                Localizer.get().project_page_target_language_content,
                Localizer.get().project_page_target_language_items.split(","),
                init = init,
                current_changed = current_changed,
            )
        )

    # 输入文件夹
    def add_widget_input_folder(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def widget_init(widget: PushButtonCard) -> None:
            widget.set_description(f"{Localizer.get().project_page_input_folder_content} {config.get("input_folder")}")
            widget.set_text(Localizer.get().project_page_input_folder_btn)
            widget.set_icon(FluentIcon.FOLDER_ADD)

        def widget_callback(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().project_page_input_folder_btn, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.set_description(f"{Localizer.get().project_page_input_folder_content} {path.strip()}")

            # 更新并保存配置
            config = self.load_config()
            config["input_folder"] = path.strip()
            self.save_config(config)

        parent.addWidget(
            PushButtonCard(
                Localizer.get().project_page_input_folder_title,
                "",
                widget_init,
                widget_callback,
            )
        )

    # 输出文件夹
    def add_widget_output_folder(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def widget_init(widget: PushButtonCard) -> None:
            widget.set_description(f"{Localizer.get().project_page_output_folder_content} {config.get("output_folder")}")
            widget.set_text(Localizer.get().project_page_output_folder_btn)
            widget.set_icon(FluentIcon.FOLDER_ADD)

        def widget_callback(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, Localizer.get().project_page_output_folder_btn, "")
            if path == None or path == "":
                return

            # 更新UI
            widget.set_description(f"{Localizer.get().project_page_output_folder_content} {path.strip()}")

            # 更新并保存配置
            config = self.load_config()
            config["output_folder"] = path.strip()
            self.save_config(config)

        parent.addWidget(
            PushButtonCard(
                Localizer.get().project_page_output_folder_title,
                "",
                widget_init,
                widget_callback,
            )
        )

    # 输出文件夹
    def add_widget_traditional_chinese(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("traditional_chinese_enable"))

        def checked_changed(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config["traditional_chinese_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().project_page_traditional_chinese_title,
                Localizer.get().project_page_traditional_chinese_content,
                init = init,
                checked_changed = checked_changed,
            )
        )