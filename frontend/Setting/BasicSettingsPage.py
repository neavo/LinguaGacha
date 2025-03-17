from PyQt5.QtWidgets import QWidget, QVBoxLayout, QLayout
from qfluentwidgets import FluentWindow

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.SpinCard import SpinCard

class BasicSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置 (新增 token_pause_time 用于输入暂停时长，单位：秒)
        self.default = {
            "task_token_limit": 384,
            "token_pause_time": 10,   # 当达到token限制后暂停的秒数
            "batch_size": 0,
            "request_timeout": 120,
            "max_round": 16,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_batch_size(self.vbox, config, window)
        self.add_widget_task_token_limit(self.vbox, config, window)
        self.add_widget_token_pause_time(self.vbox, config, window)  # 新增控件：Token Pause Time
        self.add_widget_request_timeout(self.vbox, config, window)
        self.add_widget_max_round(self.vbox, config, window)

        # 填充：确保控件顶端对齐
        self.vbox.addStretch(1)

    # 并发任务数
    def add_widget_batch_size(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("batch_size"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["batch_size"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_batch_size_title,
                Localizer.get().basic_settings_page_batch_size_content,
                init=init,
                value_changed=value_changed,
            )
        )

    # 翻译任务长度阈值
    def add_widget_task_token_limit(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("task_token_limit"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["task_token_limit"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_task_token_limit_title,
                Localizer.get().basic_settings_page_task_token_limit_content,
                init=init,
                value_changed=value_changed,
            )
        )

    # 新增：输入暂停时长（秒）的控件
    def add_widget_token_pause_time(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.get("token_pause_time"))

        def value_changed(widget: SpinCard, value: int) -> None:
            config = self.load_config()
            config["token_pause_time"] = value
            self.save_config(config)

        parent.addWidget(
            SpinCard(
                Localizer.get().basic_settings_page_token_pause_time_title,   # 在 Localizer 中添加对应标题键
                Localizer.get().basic_settings_page_token_pause_time_content,  # 在 Localizer 中添加对应描述键
                init=init,
                value_changed=value_changed,
            )
        )

    # 请求超时时间
    def add_widget_request_timeout(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
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
                init=init,
                value_changed=value_changed,
            )
        )

    # 翻译流程最大轮次
    def add_widget_max_round(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
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
                init=init,
                value_changed=value_changed,
            )
        )
