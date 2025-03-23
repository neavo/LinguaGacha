from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import TextBrowser
from qfluentwidgets import FluentWindow
from qfluentwidgets import PlainTextEdit

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from widget.CommandBarCard import CommandBarCard
from widget.EmptyCard import EmptyCard
from widget.SwitchButtonCard import SwitchButtonCard

class CustomPromptZHPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "custom_prompt_zh_enable": False,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 载入配置文件
        config = self.load_config()

        # 设置默认数据
        if config.get("custom_prompt_zh_data") == None:
            config["custom_prompt_zh_data"] = PromptBuilder(config).get_base(BaseLanguage.ZH)
            self.save_config(config)

        # 设置主容器
        self.container = QVBoxLayout(self)
        self.container.setSpacing(8)
        self.container.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.container, config, window)
        self.add_widget_body(self.container, config, window)
        self.add_widget_footer(self.container, config, window)

    # 页面每次展示时触发
    def showEvent(self, event: QEvent) -> None:
        super().showEvent(event)
        self.show_event_body(self, event) if callable(getattr(self, "show_event_body", None)) else None

    # 头部
    def add_widget_header(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def widget_init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("custom_prompt_zh_enable"))

        def widget_callback(widget, checked: bool) -> None:
            config = self.load_config()
            config["custom_prompt_zh_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().custom_prompt_zh_page_head,
                Localizer.get().custom_prompt_zh_page_head_desc,
                widget_init,
                widget_callback,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def update_widget(widget: PlainTextEdit) -> None:
            config = self.load_config()
            self.main_text.setPlainText(config.get("custom_prompt_zh_data"))

        self.prefix_body = EmptyCard("", PromptBuilder(config).get_prefix(BaseLanguage.ZH))
        self.prefix_body.remove_title()
        parent.addWidget(self.prefix_body)

        self.main_text = PlainTextEdit(self)
        self.show_event_body = lambda _, event: update_widget(self.main_text)
        parent.addWidget(self.main_text)

        self.suffix_body = EmptyCard("", PromptBuilder(config).get_suffix(BaseLanguage.ZH).replace("\n", ""))
        self.suffix_body.remove_title()
        parent.addWidget(self.suffix_body)

    # 底部
    def add_widget_footer(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.add_command_bar_action_01(self.command_bar_card, config, window)
        self.add_command_bar_action_02(self.command_bar_card, config, window)

    # 保存
    def add_command_bar_action_01(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:
        def triggered() -> None:
            # 读取配置文件
            config = self.load_config()

            # 从表格更新数据
            config["custom_prompt_zh_data"] = self.main_text.toPlainText().strip()

            # 保存配置文件
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().custom_prompt_zh_page_save_toast,
            })

        parent.add_action(
            Action(FluentIcon.SAVE, Localizer.get().custom_prompt_zh_page_save, parent, triggered = triggered),
        )

    # 重置
    def add_command_bar_action_02(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:
        def triggered() -> None:
            message_box = MessageBox(Localizer.get().alert, Localizer.get().custom_prompt_zh_page_reset_alert, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            # 清空控件
            self.main_text.setPlainText("")

            # 读取配置文件
            config = self.load_config()

            # 加载默认设置
            config["custom_prompt_zh_data"] = PromptBuilder(config).get_base(BaseLanguage.ZH)

            # 保存配置文件
            config = self.save_config(config)

            # 向控件更新数据
            self.main_text.setPlainText(config.get("custom_prompt_zh_data"))

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().custom_prompt_zh_page_reset_toast,
            })

        parent.add_action(
            Action(FluentIcon.DELETE, Localizer.get().custom_prompt_zh_page_reset, parent, triggered = triggered),
        )