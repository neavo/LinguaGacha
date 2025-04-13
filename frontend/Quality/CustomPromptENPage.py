import os
from functools import partial

from PyQt5.QtCore import QEvent
from PyQt5.QtCore import QPoint
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import CommandButton
from qfluentwidgets import PlainTextEdit

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from widget.CommandBarCard import CommandBarCard
from widget.EmptyCard import EmptyCard
from widget.SwitchButtonCard import SwitchButtonCard

class CustomPromptENPage(QWidget, Base):

    PRESET_PATH: str = "resource/custom_prompt/en"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "custom_prompt_en_enable": False,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 载入配置文件
        config = self.load_config()

        # 设置默认数据
        if config.get("custom_prompt_en_data") == None:
            config["custom_prompt_en_data"] = PromptBuilder(config).get_base(BaseLanguage.EN)
            self.save_config(config)

        # 设置主容器
        self.container = QVBoxLayout(self)
        self.container.setSpacing(8)
        self.container.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.container, config, window)
        self.add_widget_body(self.container, config, window)
        self.add_widget_footer(self.container, config, window)

    # 头部
    def add_widget_header(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def widget_init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("custom_prompt_en_enable"))

        def widget_callback(widget, checked: bool) -> None:
            config = self.load_config()
            config["custom_prompt_en_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().custom_prompt_en_page_head,
                Localizer.get().custom_prompt_en_page_head_desc,
                widget_init,
                widget_callback,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.prefix_body = EmptyCard("", PromptBuilder(config).get_prefix(BaseLanguage.EN))
        self.prefix_body.remove_title()
        parent.addWidget(self.prefix_body)

        self.main_text = PlainTextEdit(self)
        self.main_text.setPlainText(config.get("custom_prompt_en_data"))
        parent.addWidget(self.main_text)

        self.suffix_body = EmptyCard("", PromptBuilder(config).get_suffix(BaseLanguage.EN).replace("\n", " "))
        self.suffix_body.remove_title()
        parent.addWidget(self.suffix_body)

    # 底部
    def add_widget_footer(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.add_command_bar_action_preset(self.command_bar_card, config, window)

    # 保存
    def add_command_bar_action_save(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:
        def triggered() -> None:
            # 读取配置文件
            config = self.load_config()

            # 从表格更新数据
            config["custom_prompt_en_data"] = self.main_text.toPlainText().strip()

            # 保存配置文件
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            })

        parent.add_action(
            Action(FluentIcon.SAVE, Localizer.get().quality_save, parent, triggered = triggered),
        )

    # 预设
    def add_command_bar_action_preset(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        widget: CommandButton = None

        def load_preset() -> list[str]:
            filenames: list[str] = []

            try:
                for root, _, filenames in os.walk(f"{__class__.PRESET_PATH}"):
                    filenames = [v.lower().removesuffix(".txt") for v in filenames if v.lower().endswith(".txt")]
            except Exception:
                pass

            return filenames

        def reset() -> None:
            message_box = MessageBox(Localizer.get().alert, Localizer.get().quality_reset_alert, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            self.main_text.setPlainText("")
            config = self.load_config()
            config["custom_prompt_en_data"] = PromptBuilder(config).get_base(BaseLanguage.EN)
            config = self.save_config(config)
            self.main_text.setPlainText(config.get("custom_prompt_en_data"))

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_reset_toast,
            })

        def apply_preset(filename: str) -> None:
            path: str = f"{__class__.PRESET_PATH}/{filename}.txt"

            prompt: str = ""
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    prompt = reader.read().strip()
            except Exception:
                pass

            # 读取配置文件
            self.main_text.setPlainText("")
            config = self.load_config()
            config["custom_prompt_en_data"] = prompt
            config = self.save_config(config)
            self.main_text.setPlainText(config.get("custom_prompt_en_data"))

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            })

        def triggered() -> None:
            menu = RoundMenu("", widget)
            menu.addAction(
                Action(
                    FluentIcon.CLEAR_SELECTION,
                    Localizer.get().quality_reset,
                    triggered = reset,
                )
            )
            for v in load_preset():
                menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        v,
                        triggered = partial(apply_preset, v),
                    )
                )
            menu.exec(widget.mapToGlobal(QPoint(0, -menu.height())))

        widget = parent.add_action(Action(
            FluentIcon.EXPRESSIVE_INPUT_ENTRY,
            Localizer.get().quality_preset,
            parent = parent,
            triggered = triggered
        ))