from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import FluentWindow
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.SliderCard import SliderCard

class ArgsEditPage(MessageBoxBase, Base):

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入配置文件
        config = self.load_config()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取平台配置
        self.get_platform_from_config(id, config)

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

        self.add_widget_top_p(self.vbox, config, window)
        self.add_widget_temperature(self.vbox, config, window)
        self.add_widget_presence_penalty(self.vbox, config, window)
        self.add_widget_frequency_penalty(self.vbox, config, window)
        self.add_widget_url(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 获取平台配置
    def get_platform_from_config(self, id: int, config: dict) -> None:
        for platform in config.get("platforms", []):
            if platform.get("id", 0) == id:
                self.platform = platform
                break

    # 更新平台配置
    def update_platform_to_config(self, platform: dict, config: dict) -> None:
        for i, item in enumerate(config.get("platforms", [])):
            if item.get("id", 0) == platform.get("id", 0):
                config.get("platforms")[i] = platform
                break

    # top_p
    def add_widget_top_p(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SliderCard) -> None:
            widget.set_range(0, 100)
            widget.set_text(f"{self.platform.get("top_p"):.2f}")
            widget.set_value(int(self.platform.get("top_p") * 100))

        def value_changed(widget: SliderCard, value: int) -> None:
            widget.set_text(f"{(value / 100):.2f}")

            config = self.load_config()
            self.platform["top_p"] = value / 100
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            SliderCard(
                Localizer.get().args_edit_page_top_p_title,
                Localizer.get().args_edit_page_top_p_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # temperature
    def add_widget_temperature(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SliderCard) -> None:
            widget.set_range(0, 200)
            widget.set_text(f"{self.platform.get("temperature"):.2f}")
            widget.set_value(int(self.platform.get("temperature") * 100))

        def value_changed(widget: SliderCard, value: int) -> None:
            widget.set_text(f"{(value / 100):.2f}")

            config = self.load_config()
            self.platform["temperature"] = value / 100
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            SliderCard(
                Localizer.get().args_edit_page_temperature_title,
                Localizer.get().args_edit_page_temperature_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # presence_penalty
    def add_widget_presence_penalty(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SliderCard) -> None:
            widget.set_range(-200, 200)
            widget.set_text(f"{self.platform.get("presence_penalty"):.2f}")
            widget.set_value(int(self.platform.get("presence_penalty") * 100))

        def value_changed(widget: SliderCard, value: int) -> None:
            widget.set_text(f"{(value / 100):.2f}")

            config = self.load_config()
            self.platform["presence_penalty"] = value / 100
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            SliderCard(
                Localizer.get().args_edit_page_presence_penalty_title,
                Localizer.get().args_edit_page_presence_penalty_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # frequency_penalty
    def add_widget_frequency_penalty(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SliderCard) -> None:
            widget.set_range(-200, 200)
            widget.set_text(f"{self.platform.get("frequency_penalty"):.2f}")
            widget.set_value(int(self.platform.get("frequency_penalty") * 100))

        def value_changed(widget: SliderCard, value: int) -> None:
            widget.set_text(f"{(value / 100):.2f}")

            config = self.load_config()
            self.platform["frequency_penalty"] = value / 100
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            SliderCard(
                Localizer.get().args_edit_page_frequency_penalty_title,
                Localizer.get().args_edit_page_frequency_penalty_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 添加链接
    def add_widget_url(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        if self.platform.get("api_format") == Base.APIFormat.GOOGLE:
            url = "https://ai.google.dev/api/generate-content"
        elif self.platform.get("api_format") == Base.APIFormat.ANTHROPIC:
            url = "https://docs.anthropic.com/en/api/getting-started"
        elif self.platform.get("api_format") == Base.APIFormat.SAKURALLM:
            url = "https://github.com/SakuraLLM/SakuraLLM#%E6%8E%A8%E7%90%86"
        else:
            url = "https://platform.openai.com/docs/api-reference/chat/create"

        hyper_link_label = HyperlinkLabel(QUrl(url), Localizer.get().args_edit_page_document_link)
        hyper_link_label.setUnderlineVisible(True)

        parent.addSpacing(16)
        parent.addWidget(hyper_link_label, alignment = Qt.AlignHCenter)