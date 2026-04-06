from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import SpinBox

from api.Client.ModelApiClient import ModelApiClient
from base.Base import Base
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelPageSnapshot
from module.Localizer.Localizer import Localizer
from widget.SettingCard import SettingCard


class ModelTaskSettingPage(Base, MessageBoxBase):
    def __init__(
        self,
        model: ModelEntrySnapshot,
        model_api_client: ModelApiClient,
        window: FluentWindow,
    ) -> None:
        super().__init__(window)

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取模型配置
        self.model = model
        self.model_api_client = model_api_client

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
        self.add_widget_threshold(self.vbox)

        # 填充
        self.vbox.addStretch(1)

    def refresh_model_from_snapshot(self, snapshot: ModelPageSnapshot) -> None:
        """统一从最新快照回填当前模型，避免弹窗继续持有旧阈值。"""

        self.model = next(
            (item for item in snapshot.models if item.id == self.model.id),
            self.model,
        )

    def update_model_fields(self, patch: dict[str, object]) -> None:
        """所有阈值写入都通过同一 API 入口，保证页面没有第二写口。"""

        snapshot = self.model_api_client.update_model(self.model.id, patch)
        self.refresh_model_from_snapshot(snapshot)

    def add_threshold_setting_card(
        self,
        parent: QLayout,
        *,
        title: str,
        description: str,
        field_name: str,
        value: int,
    ) -> None:
        """统一构建阈值输入卡片，避免四组 SpinBox 写法分叉。"""

        def value_changed(spin_box: SpinBox) -> None:
            self.update_model_fields(
                {
                    "threshold": {
                        field_name: spin_box.value(),
                    }
                }
            )

        card = SettingCard(
            title=title,
            description=description,
            parent=self,
        )
        spin_box = SpinBox(card)
        spin_box.setRange(0, 9999999)
        spin_box.setValue(value)
        # 必须在 lambda 默认参数中绑定当前控件，避免循环内复用变量导致回调串写。
        spin_box.valueChanged.connect(
            lambda _value, target_spin_box=spin_box: value_changed(target_spin_box)
        )
        card.add_right_widget(spin_box)
        parent.addWidget(card)

    # 阈值设置
    def add_widget_threshold(self, parent: QLayout) -> None:
        threshold = self.model.threshold

        self.add_threshold_setting_card(
            parent,
            title=Localizer.get().model_basic_setting_page_input_token_title,
            description=Localizer.get().model_basic_setting_page_input_token_content,
            field_name="input_token_limit",
            value=threshold.input_token_limit,
        )

        self.add_threshold_setting_card(
            parent,
            title=Localizer.get().model_basic_setting_page_output_token_title,
            description=Localizer.get().model_basic_setting_page_output_token_content,
            field_name="output_token_limit",
            value=threshold.output_token_limit,
        )

        self.add_threshold_setting_card(
            parent,
            title=Localizer.get().model_basic_setting_page_concurrency_title,
            description=Localizer.get().model_basic_setting_page_concurrency_content,
            field_name="concurrency_limit",
            value=threshold.concurrency_limit,
        )

        self.add_threshold_setting_card(
            parent,
            title=Localizer.get().model_basic_setting_page_rpm_title,
            description=Localizer.get().model_basic_setting_page_rpm_content,
            field_name="rpm_limit",
            value=threshold.rpm_limit,
        )
