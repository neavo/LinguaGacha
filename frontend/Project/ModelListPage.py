from functools import partial

import anthropic
import openai
from google import genai
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PillPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard
from widget.LineEditMessageBox import LineEditMessageBox

class ModelListPage(MessageBoxBase, Base):

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 初始化
        self.id: int = id
        self.filter: str = ""
        self.models: list[str] = None

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroller = SingleDirectionScrollArea(self, orient = Qt.Orientation.Vertical)
        self.scroller.setWidgetResizable(True)
        self.scroller.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        self.viewLayout.addWidget(self.scroller)

        # 设置滚动控件
        self.vbox_parent = QWidget(self)
        self.vbox_parent.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.vbox_parent)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下
        self.scroller.setWidget(self.vbox_parent)

        # 添加控件
        self.add_widget(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 点击事件
    def clicked(self, widget: PillPushButton) -> None:
        config = Config().load()
        platform = config.get_platform(self.id)
        platform["model"] = widget.text().strip()
        config.set_platform(platform)
        config.save()

        # 关闭窗口
        self.close()

    # 过滤按钮点击事件
    def filter_button_clicked(self, widget: PushButton, window: FluentWindow) -> None:
        if self.filter != "":
            self.filter = ""
            self.filter_button.setText(Localizer.get().filter)

            # 更新子控件
            self.update_sub_widgets(self.flow_card)
        else:
            message_box = LineEditMessageBox(
                window,
                Localizer.get().platform_edit_page_model,
                message_box_close = self.filter_message_box_close
            )
            message_box.get_line_edit().setText(self.filter)
            message_box.exec()

    # 过滤输入框关闭事件
    def filter_message_box_close(self, widget: LineEditMessageBox, text: str) -> None:
        self.filter = text.strip()
        self.filter_button.setText(f"{Localizer.get().filter} - {self.filter}")

        # 更新子控件
        self.update_sub_widgets(self.flow_card)

    # 获取模型
    def get_models(self, api_url: str, api_key: str, api_format: Base.APIFormat) -> list[str]:
        result = []

        try:
            if api_format == Base.APIFormat.GOOGLE:
                client = genai.Client(
                    api_key = api_key,
                )
                return [model.name for model in client.models.list()]
            elif api_format == Base.APIFormat.ANTHROPIC:
                client = anthropic.Anthropic(
                    api_key = api_key,
                    base_url = api_url,
                )
                return [model.id for model in client.models.list()]
            else:
                client = openai.OpenAI(
                    base_url = api_url,
                    api_key = api_key,
                )
                return [model.id for model in client.models.list()]
        except Exception as e:
            self.debug(Localizer.get().model_list_page_fail, e)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().model_list_page_fail,
            })

        return result

    # 更新子控件
    def update_sub_widgets(self, widget: FlowCard) -> None:
        if self.models is None:
            platform: dict = Config().load().get_platform(self.id)
            self.models = self.get_models(
                platform.get("api_url"),
                platform.get("api_key")[0] if len(platform.get("api_key")) > 0 else "",
                platform.get("api_format"),
            )

        widget.take_all_widgets()
        for model in [v for v in self.models if self.filter.lower() in v.lower()]:
            pilled_button = PillPushButton(model)
            pilled_button.setFixedWidth(432)
            pilled_button.clicked.connect(partial(self.clicked, pilled_button))
            widget.add_widget(pilled_button)

    # 模型名称
    def add_widget(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        self.filter_button: PushButton = None

        def init(widget: FlowCard) -> None:
            self.filter_button = PushButton(Localizer.get().filter)
            self.filter_button.setIcon(FluentIcon.FILTER)
            self.filter_button.setContentsMargins(4, 0, 4, 0)
            self.filter_button.clicked.connect(lambda _: self.filter_button_clicked(self.filter_button, window))
            widget.add_widget_to_head(self.filter_button)

            # 更新子控件
            self.update_sub_widgets(widget)

        self.flow_card = FlowCard(
            parent = self,
            title = Localizer.get().model_list_page_title,
            description = Localizer.get().model_list_page_content,
            init = init,
        )
        parent.addWidget(self.flow_card)
