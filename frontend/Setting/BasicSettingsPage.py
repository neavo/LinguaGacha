from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentWindow

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.SpinCard import SpinCard

class BasicSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "token_threshold": 384,
            "max_workers": 0,
            "rpm_threshold": 0,
            "request_timeout": 120,
            "max_round": 16,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_max_workers(self.vbox, config, window)
        self.add_widget_rpm_threshold(self.vbox, config, window)
        self.add_widget_token_threshold(self.vbox, config, window)
        self.add_widget_request_timeout(self.vbox, config, window)
        self.add_widget_max_round(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1) # 确保控件顶端对齐

    # 每秒任务数阈值
    def add_widget_max_workers(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("max_workers"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["max_workers"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_max_workers_title,
                Localizer.get().basic_settings_page_max_workers_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 每分钟任务数阈值
    def add_widget_rpm_threshold(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("rpm_threshold"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["rpm_threshold"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_rpm_threshold_title,
                Localizer.get().basic_settings_page_rpm_threshold_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 翻译任务长度阈值
    def add_widget_token_threshold(self, parent: QLayout, config: dict, window: FluentWindow)-> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("token_threshold"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["token_threshold"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_token_threshold_title,
                Localizer.get().basic_settings_page_token_threshold_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 请求超时时间
    def add_widget_request_timeout(self, parent: QLayout, config: dict, window: FluentWindow)-> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("request_timeout"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["request_timeout"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_request_timeout_title,
                Localizer.get().basic_settings_page_request_timeout_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 翻译流程最大轮次
    def add_widget_max_round(self, parent: QLayout, config: dict, window: FluentWindow)-> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("max_round"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["max_round"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_max_round_title,
                Localizer.get().basic_settings_page_max_round_content,
                init = init,
                value_changed = value_changed,
            )
        )