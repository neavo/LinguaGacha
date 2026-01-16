from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentWindow
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.SpinCard import SpinCard

class BasicSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient = Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_max_workers(scroll_area_vbox, config, window)
        self.add_widget_rpm_threshold(scroll_area_vbox, config, window)
        self.add_widget_input_token_threshold(scroll_area_vbox, config, window)
        self.add_widget_output_token_threshold(scroll_area_vbox, config, window)
        self.add_widget_request_timeout(scroll_area_vbox, config, window)
        self.add_widget_max_round(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 每秒任务数阈值
    def add_widget_max_workers(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.max_workers)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.max_workers = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_max_workers_title,
                description = Localizer.get().basic_settings_page_max_workers_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 每分钟任务数阈值
    def add_widget_rpm_threshold(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.rpm_threshold)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.rpm_threshold = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_rpm_threshold_title,
                description = Localizer.get().basic_settings_page_rpm_threshold_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 输入令牌长度阈值
    def add_widget_input_token_threshold(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.input_token_threshold)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.input_token_threshold = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_input_token_threshold_title,
                description = Localizer.get().basic_settings_page_input_token_threshold_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 输出令牌长度阈值
    def add_widget_output_token_threshold(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.output_token_threshold)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.output_token_threshold = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_output_token_threshold_title,
                description = Localizer.get().basic_settings_page_output_token_threshold_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 请求超时时间
    def add_widget_request_timeout(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.request_timeout)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.request_timeout = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_request_timeout_title,
                description = Localizer.get().basic_settings_page_request_timeout_content,
                init = init,
                value_changed = value_changed,
            )
        )

    # 翻译流程最大轮次
    def add_widget_max_round(self, parent: QLayout, config: Config, window: FluentWindow)-> None:

        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.max_round)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.max_round = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().basic_settings_page_max_round_title,
                description = Localizer.get().basic_settings_page_max_round_content,
                init = init,
                value_changed = value_changed,
            )
        )