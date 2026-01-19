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
from qfluentwidgets import RoundMenu

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.DataAccessLayer import DataAccessLayer
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from widget.CommandBarCard import CommandBarCard
from widget.CustomTextEdit import CustomTextEdit
from widget.EmptyCard import EmptyCard
from widget.SwitchButtonCard import SwitchButtonCard


class CustomPromptPage(QWidget, Base):
    def __init__(
        self, text: str, window: FluentWindow, language: BaseLanguage.Enum
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.language = language
        if language == BaseLanguage.Enum.ZH:
            self.preset_path = "resource/custom_prompt/zh"
        else:
            self.preset_path = "resource/custom_prompt/en"

        # 载入配置
        config = Config().load()

        # 初始化默认提示词（如果尚未设置）
        current_data = DataAccessLayer.get_custom_prompt_data(language)
        if not current_data:
            default_prompt = PromptBuilder(config).get_base(language)
            DataAccessLayer.set_custom_prompt_data(language, default_prompt)

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_footer(self.root, config, window)

        # 注册事件：工程加载后刷新数据（从 .lg 文件读取）
        self.subscribe(Base.Event.PROJECT_LOADED, self._on_project_loaded)

    # 工程加载后刷新数据
    def _on_project_loaded(self, event: Base.Event, data: dict) -> None:
        prompt_data = DataAccessLayer.get_custom_prompt_data(self.language)
        self.main_text.setPlainText(prompt_data)
        # 刷新开关状态
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(
                DataAccessLayer.get_custom_prompt_enable(self.language)
            )

    # 头部
    def add_widget_header(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        base_key = (
            "custom_prompt_zh"
            if self.language == BaseLanguage.Enum.ZH
            else "custom_prompt_en"
        )

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                DataAccessLayer.get_custom_prompt_enable(self.language),
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            DataAccessLayer.set_custom_prompt_enable(
                self.language, widget.get_switch_button().isChecked()
            )

        self.switch_card = SwitchButtonCard(
            title=getattr(Localizer.get(), f"{base_key}_page_head"),
            description=getattr(Localizer.get(), f"{base_key}_page_head_desc"),
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    # 主体
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.prefix_body = EmptyCard(
            "", PromptBuilder(config).get_prefix(self.language)
        )
        self.prefix_body.remove_title()
        parent.addWidget(self.prefix_body)

        self.main_text = CustomTextEdit(self)
        self.main_text.setPlainText(
            DataAccessLayer.get_custom_prompt_data(self.language)
        )
        parent.addWidget(self.main_text)

        self.suffix_body = EmptyCard(
            "", PromptBuilder(config).get_suffix(self.language).replace("\n", "")
        )
        self.suffix_body.remove_title()
        parent.addWidget(self.suffix_body)

    # 底部
    def add_widget_footer(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.add_command_bar_action_preset(self.command_bar_card, config, window)

    # 保存
    def add_command_bar_action_save(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            # 通过 DAL 保存（工程模式写入 .lg，否则写入 config.json）
            DataAccessLayer.set_custom_prompt_data(
                self.language, self.main_text.toPlainText().strip()
            )

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_save_toast,
                },
            )

        parent.add_action(
            Action(
                FluentIcon.SAVE,
                Localizer.get().quality_save,
                parent,
                triggered=triggered,
            ),
        )

    # 预设
    def add_command_bar_action_preset(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        widget: CommandButton = None

        def load_preset() -> list[str]:
            filenames: list[str] = []

            try:
                for root, _, filenames in os.walk(f"{self.preset_path}"):
                    filenames = [
                        v.lower().removesuffix(".txt")
                        for v in filenames
                        if v.lower().endswith(".txt")
                    ]
            except Exception:
                pass

            return filenames

        def reset() -> None:
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().quality_reset_alert, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            # 重置为默认提示词
            config = Config().load()
            default_prompt = PromptBuilder(config).get_base(self.language)
            DataAccessLayer.set_custom_prompt_data(self.language, default_prompt)

            # 更新 UI
            self.main_text.setPlainText(default_prompt)

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_reset_toast,
                },
            )

        def apply_preset(filename: str) -> None:
            path: str = f"{self.preset_path}/{filename}.txt"

            prompt: str = ""
            try:
                with open(path, "r", encoding="utf-8-sig") as reader:
                    prompt = reader.read().strip()
            except Exception:
                pass

            # 通过 DAL 保存
            DataAccessLayer.set_custom_prompt_data(self.language, prompt)

            # 更新 UI
            self.main_text.setPlainText(prompt)

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_import_toast,
                },
            )

        def triggered() -> None:
            menu = RoundMenu("", widget)
            menu.addAction(
                Action(
                    FluentIcon.CLEAR_SELECTION,
                    Localizer.get().quality_reset,
                    triggered=reset,
                )
            )
            for v in load_preset():
                menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        v,
                        triggered=partial(apply_preset, v),
                    )
                )
            menu.exec(widget.mapToGlobal(QPoint(0, -menu.height())))

        widget = parent.add_action(
            Action(
                FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                Localizer.get().quality_preset,
                parent=parent,
                triggered=triggered,
            )
        )
