from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow

from base.Base import Base
from widget.ComboBoxCard import ComboBoxCard
from widget.PushButtonCard import PushButtonCard
from widget.SwitchButtonCard import SwitchButtonCard

class ProjectPage(QWidget, Base):

    LANGUAGE_MAP = {
        "中文" : Base.Language.ZH,
        "英文" : Base.Language.EN,
        "日文" : Base.Language.JA,
        "韩文" : Base.Language.KO,
        "俄文" : Base.Language.RU,
    }

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
            widget.set_current_text({v: k for k, v in ProjectPage.LANGUAGE_MAP.items()}.get(config.get("source_language"), ""))

        def current_text_changed(widget: ComboBoxCard, text: str) -> None:
            config = self.load_config()
            config["source_language"] = ProjectPage.LANGUAGE_MAP[text]
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                "原文语言",
                "设置当前翻译项目所使用的原始文本的语言",
                ("中文", "英文", "日文", "韩文", "俄文"),
                init = init,
                current_text_changed = current_text_changed,
            )
        )

    # 译文语言
    def add_widget_target_language(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def init(widget: ComboBoxCard) -> None:
            widget.set_current_text({v: k for k, v in ProjectPage.LANGUAGE_MAP.items()}.get(config.get("target_language"), ""))

        def current_text_changed(widget: ComboBoxCard, text: str) -> None:
            config = self.load_config()
            config["target_language"] = ProjectPage.LANGUAGE_MAP[text]
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                "译文语言",
                "设置当前翻译项目所期望的译文文本的语言",
                ("中文", "英文", "日文", "韩文", "俄文"),
                init = init,
                current_text_changed = current_text_changed,
            )
        )

    # 输入文件夹
    def add_widget_input_folder(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def widget_init(widget: PushButtonCard) -> None:
            widget.set_description(f"当前输入文件夹为 {config.get("input_folder")}")
            widget.set_text("选择文件夹")
            widget.set_icon(FluentIcon.FOLDER_ADD)

        def widget_callback(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, "选择文件夹", "")
            if path == None or path == "":
                return

            # 更新UI
            widget.set_description(f"当前输入文件夹为 {path.strip()}")

            # 更新并保存配置
            config = self.load_config()
            config["input_folder"] = path.strip()
            self.save_config(config)

        parent.addWidget(
            PushButtonCard(
                "输入文件夹",
                "",
                widget_init,
                widget_callback,
            )
        )

    # 输出文件夹
    def add_widget_output_folder(self, parent: QLayout, config: dict, windows: FluentWindow) -> None:
        def widget_init(widget: PushButtonCard) -> None:
            widget.set_description(f"当前输出文件夹为 {config.get("output_folder")}")
            widget.set_text("选择文件夹")
            widget.set_icon(FluentIcon.FOLDER_ADD)

        def widget_callback(widget: PushButtonCard) -> None:
            # 选择文件夹
            path = QFileDialog.getExistingDirectory(None, "选择文件夹", "")
            if path == None or path == "":
                return

            # 更新UI
            widget.set_description(f"当前输出文件夹为 {path.strip()}")

            # 更新并保存配置
            config = self.load_config()
            config["output_folder"] = path.strip()
            self.save_config(config)

        parent.addWidget(
            PushButtonCard(
                "输出文件夹（不能与输入文件夹相同）",
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
                "使用繁体输出中文",
                "启用此功能后，在译文语言设置为中文时，将使用繁体字形输出中文文本",
                init = init,
                checked_changed = checked_changed,
            )
        )