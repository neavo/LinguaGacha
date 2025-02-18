from functools import partial

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

import anthropic
import google.generativeai as genai
from openai import OpenAI
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PillPushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard

class ModelListPage(MessageBoxBase, Base):

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 初始化
        self.id = id

        # 载入配置文件
        config = self.load_config()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroller = SingleDirectionScrollArea(self, orient = Qt.Vertical)
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
        config = self.load_config()
        platform = self.get_platform_from_config(self.id, config)
        platform["model"] = widget.text().strip()
        self.update_platform_to_config(platform, config)
        self.save_config(config)

        # 关闭窗口
        self.close()

    # 获取平台配置
    def get_platform_from_config(self, id: int, config: dict) -> None:
        for item in config.get("platforms", []):
            if item.get("id", 0) == id:
                platform = item
                break

        return platform

    # 更新平台配置
    def update_platform_to_config(self, platform: dict, config: dict) -> None:
        for i, item in enumerate(config.get("platforms", [])):
            if item.get("id", 0) == platform.get("id", 0):
                config.get("platforms")[i] = platform
                break

    # 获取模型
    def get_models(self, api_url: str, api_key: str, api_format: str) -> list[str]:
        result = []

        try:
            if api_format == Base.APIFormat.GOOGLE:
                genai.configure(
                    api_key = api_key,
                    transport = "rest"
                )
                return [model.name for model in genai.list_models()]
            elif api_format == Base.APIFormat.ANTHROPIC:
                client = anthropic.Anthropic(
                    api_key = api_key,
                    base_url = api_url
                )
                return [model.id for model in client.models.list()]
            else:
                client = OpenAI(
                    base_url = api_url,
                    api_key = api_key,
                )
                result = [model.id for model in client.models.list()]
        except Exception as e:
            self.debug(Localizer.get().model_list_page_fail, e)
            self.emit(Base.Event.TOAST_SHOW, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().model_list_page_fail,
            })

        return result

    # 更新子控件
    def update_sub_widgets(self, widget: FlowCard) -> None:
        config = self.load_config()
        platform = self.get_platform_from_config(self.id, config)
        models = self.get_models(
            platform.get("api_url"),
            platform.get("api_key")[0],
            platform.get("api_format"),
        )

        widget.take_all_widgets()
        for model in models:
            pilled_button = PillPushButton(model)
            pilled_button.setFixedWidth(432)
            pilled_button.clicked.connect(partial(self.clicked, pilled_button))
            widget.add_widget(pilled_button)

    # 模型名称
    def add_widget(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.flow_card = FlowCard(
            Localizer.get().model_list_page_title,
            Localizer.get().model_list_page_content,
            init = lambda widget: self.update_sub_widgets(widget),
        )
        parent.addWidget(self.flow_card)
