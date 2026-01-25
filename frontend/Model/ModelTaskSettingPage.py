from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.SpinCard import SpinCard


class ModelTaskSettingPage(MessageBoxBase, Base):
    def __init__(self, model_id: str, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取模型配置
        self.model_id = model_id
        self.model = config.get_model(model_id)

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroll_area = SingleDirectionScrollArea(
            self, orient=Qt.Orientation.Vertical
        )
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.enableTransparentBackground()
        self.viewLayout.addWidget(self.scroll_area)

        # 设置滚动控件
        self.vbox_parent = QWidget(self)
        self.vbox_parent.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.vbox_parent)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24)
        self.scroll_area.setWidget(self.vbox_parent)

        # 阈值设置
        self.add_widget_threshold(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 阈值设置
    def add_widget_threshold(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        threshold = self.model.get("threshold", {})

        # 输入 Token 限制
        def init_input_token(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(threshold.get("input_token_limit", 512))

        def value_changed_input_token(widget: SpinCard) -> None:
            config = Config().load()
            if "threshold" not in self.model:
                self.model["threshold"] = {}
            self.model["threshold"]["input_token_limit"] = widget.get_spin_box().value()
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            SpinCard(
                title=Localizer.get().model_basic_setting_page_input_token_title,
                description=Localizer.get().model_basic_setting_page_input_token_content,
                init=init_input_token,
                value_changed=value_changed_input_token,
            )
        )

        # 输出 Token 限制
        def init_output_token(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(threshold.get("output_token_limit", 4096))

        def value_changed_output_token(widget: SpinCard) -> None:
            config = Config().load()
            if "threshold" not in self.model:
                self.model["threshold"] = {}
            self.model["threshold"]["output_token_limit"] = (
                widget.get_spin_box().value()
            )
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            SpinCard(
                title=Localizer.get().model_basic_setting_page_output_token_title,
                description=Localizer.get().model_basic_setting_page_output_token_content,
                init=init_output_token,
                value_changed=value_changed_output_token,
            )
        )

        # 并发数限制
        def init_concurrency(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(threshold.get("concurrency_limit", 0))

        def value_changed_concurrency(widget: SpinCard) -> None:
            config = Config().load()
            if "threshold" not in self.model:
                self.model["threshold"] = {}
            self.model["threshold"]["concurrency_limit"] = widget.get_spin_box().value()
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            SpinCard(
                title=Localizer.get().model_basic_setting_page_concurrency_title,
                description=Localizer.get().model_basic_setting_page_concurrency_content,
                init=init_concurrency,
                value_changed=value_changed_concurrency,
            )
        )

        # RPM 限制
        def init_rpm(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(threshold.get("rpm_limit", 0))

        def value_changed_rpm(widget: SpinCard) -> None:
            config = Config().load()
            if "threshold" not in self.model:
                self.model["threshold"] = {}
            self.model["threshold"]["rpm_limit"] = widget.get_spin_box().value()
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            SpinCard(
                title=Localizer.get().model_basic_setting_page_rpm_title,
                description=Localizer.get().model_basic_setting_page_rpm_content,
                init=init_rpm,
                value_changed=value_changed_rpm,
            )
        )
