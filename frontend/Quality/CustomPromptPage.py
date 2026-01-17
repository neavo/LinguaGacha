import os
from functools import partial

from PyQt5.QtCore import QPoint
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CommandButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import RoundMenu

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from widget.CommandBarCard import CommandBarCard
from widget.CustomTextEdit import CustomTextEdit
from widget.EmptyCard import EmptyCard
from widget.SwitchButtonCard import SwitchButtonCard

class CustomPromptPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow, language: BaseLanguage.Enum) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        if language == BaseLanguage.Enum.ZH:
            self.language = language
            self.base_key = "custom_prompt_zh"
            self.preset_path = "resource/custom_prompt/zh"
        else:
            self.language = language
            self.base_key = "custom_prompt_en"
            self.preset_path = "resource/custom_prompt/en"

        # 载入并保存默认配置
        config = Config().load()
        if getattr(config, f"{self.base_key}_data", None) == None:
            setattr(config, f"{self.base_key}_data", PromptBuilder(config).get_base(language))
        config.save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_footer(self.root, config, window)

    # 头部
    def add_widget_header(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                getattr(config, f"{self.base_key}_enable"),
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            setattr(config, f"{self.base_key}_enable", widget.get_switch_button().isChecked())
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = getattr(Localizer.get(), f"{self.base_key}_page_head"),
                description = getattr(Localizer.get(), f"{self.base_key}_page_head_desc"),
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        self.prefix_body = EmptyCard("", PromptBuilder(config).get_prefix(self.language))
        self.prefix_body.remove_title()
        parent.addWidget(self.prefix_body)

        self.main_text = CustomTextEdit(self)
        self.main_text.setPlainText(getattr(config, f"{self.base_key}_data",))
        parent.addWidget(self.main_text)

        self.suffix_body = EmptyCard("", PromptBuilder(config).get_suffix(self.language).replace("\n", ""))
        self.suffix_body.remove_title()
        parent.addWidget(self.suffix_body)

    # 底部
    def add_widget_footer(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.add_command_bar_action_preset(self.command_bar_card, config, window)

    # 保存
    def add_command_bar_action_save(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        def triggered() -> None:
            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", self.main_text.toPlainText().strip())
            config.save()

            # 弹出提示
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            })

        parent.add_action(
            Action(FluentIcon.SAVE, Localizer.get().quality_save, parent, triggered = triggered),
        )

    # 预设
    def add_command_bar_action_preset(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        widget: CommandButton = None

        def load_preset() -> list[str]:
            filenames: list[str] = []

            try:
                for root, _, filenames in os.walk(f"{self.preset_path}"):
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

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", PromptBuilder(config).get_base(self.language))
            config.save()

            # 更新 UI
            self.main_text.setPlainText(
                getattr(config, f"{self.base_key}_data"),
            )

            # 弹出提示
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_reset_toast,
            })

        def apply_preset(filename: str) -> None:
            path: str = f"{self.preset_path}/{filename}.txt"

            prompt: str = ""
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    prompt = reader.read().strip()
            except Exception:
                pass

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", prompt)
            config.save()

            # 更新 UI
            self.main_text.setPlainText(
                getattr(config, f"{self.base_key}_data"),
            )

            # 弹出提示
            self.emit(Base.Event.TOAST, {
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