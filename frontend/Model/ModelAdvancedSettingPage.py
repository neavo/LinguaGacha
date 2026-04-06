from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import Slider
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import SwitchButton

from api.Client.ModelApiClient import ModelApiClient
from base.Base import Base
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelPageSnapshot
from module.Localizer.Localizer import Localizer
from module.Utils.JSONTool import JSONTool
from widget.CustomTextEdit import CustomTextEdit
from widget.GroupCard import GroupCard
from widget.SettingCard import SettingCard


class ModelAdvancedSettingPage(Base, MessageBoxBase):
    TOP_P_DEFAULT: float = 0.95
    TEMPERATURE_DEFAULT: float = 0.95
    PRESENCE_PENALTY_DEFAULT: float = 0.00
    FREQUENCY_PENALTY_DEFAULT: float = 0.00

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
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.enableTransparentBackground()
        # scroll_area.setSmoothMode(SmoothMode.NO_SMOOTH)  # 禁用平滑滚动以提升性能
        self.viewLayout.addWidget(scroll_area)

        # 添加控件
        self.add_generation_slider_card(
            scroll_area_vbox,
            title=Localizer.get().model_advanced_setting_page_top_p_title,
            field_name="top_p",
            slider_max=100,
            default_value=self.TOP_P_DEFAULT,
        )
        self.add_generation_slider_card(
            scroll_area_vbox,
            title=Localizer.get().model_advanced_setting_page_temperature_title,
            field_name="temperature",
            slider_max=200,
            default_value=self.TEMPERATURE_DEFAULT,
        )
        self.add_generation_slider_card(
            scroll_area_vbox,
            title=Localizer.get().model_advanced_setting_page_presence_penalty_title,
            field_name="presence_penalty",
            slider_max=100,
            default_value=self.PRESENCE_PENALTY_DEFAULT,
        )
        self.add_generation_slider_card(
            scroll_area_vbox,
            title=Localizer.get().model_advanced_setting_page_frequency_penalty_title,
            field_name="frequency_penalty",
            slider_max=100,
            default_value=self.FREQUENCY_PENALTY_DEFAULT,
        )

        # 自定义网络配置
        self.add_widget_request_config(scroll_area_vbox)

        # 填充
        scroll_area_vbox.addStretch(1)

    def refresh_model_from_snapshot(self, snapshot: ModelPageSnapshot) -> None:
        """统一从最新快照回填当前模型，避免弹窗继续持有旧参数。"""

        self.model = next(
            (item for item in snapshot.models if item.id == self.model.id),
            self.model,
        )

    def update_model_fields(self, patch: dict[str, object]) -> None:
        """所有高级设置写入都通过同一 API 入口，保证状态源唯一。"""

        snapshot = self.model_api_client.update_model(self.model.id, patch)
        self.refresh_model_from_snapshot(snapshot)

    # 获取生成参数值
    def get_generation_value(self, key: str, default: float = 0.0) -> float:
        return float(getattr(self.model.generation, key, default))

    # 获取生成参数启用状态
    def get_generation_enable(self, key: str) -> bool:
        return bool(getattr(self.model.generation, f"{key}_custom_enable", False))

    # 滑动条释放事件
    def slider_released(
        self, slider: Slider, value_label: StrongBodyLabel, arg: str
    ) -> None:
        value = slider.value()
        value_label.setText(f"{(value / 100):.2f}")

        self.update_model_fields({"generation": {arg: value / 100}})

    # 开关状态变化事件
    def checked_changed(
        self,
        slider: Slider,
        value_label: StrongBodyLabel,
        checked: bool,
        field_name: str,
        default_value: float,
    ) -> None:
        slider.setVisible(checked)
        value_label.setVisible(checked)

        # 重置为默认值
        value_label.setText(f"{default_value:.2f}")
        slider.setValue(int(default_value * 100))

        self.update_model_fields(
            {
                "generation": {
                    field_name: default_value,
                    f"{field_name}_custom_enable": checked,
                }
            }
        )

    def add_generation_slider_card(
        self,
        parent: QLayout,
        *,
        title: str,
        field_name: str,
        slider_max: int,
        default_value: float,
    ) -> None:
        """统一构建生成参数卡片，避免四组滑条逻辑持续分叉。"""

        card = SettingCard(
            title=title,
            description=Localizer.get().model_advanced_setting_page_param_caution,
            parent=self,
        )
        slider = Slider(Qt.Orientation.Horizontal)
        slider.setFixedWidth(256)
        value_label = StrongBodyLabel("", card)
        value_label.setFixedWidth(48)
        value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        slider_container = QWidget(card)
        slider_layout = QHBoxLayout(slider_container)
        slider_layout.setContentsMargins(0, 0, 0, 0)
        slider_layout.setSpacing(8)
        slider_layout.addWidget(slider)
        slider_layout.addWidget(value_label)

        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")

        value = self.get_generation_value(field_name, default_value)
        slider.setRange(0, slider_max)
        slider.setValue(int(value * 100))
        value_label.setText(f"{value:.2f}")

        # 设置可见性
        is_enabled = self.get_generation_enable(field_name)
        slider.setVisible(is_enabled)
        value_label.setVisible(is_enabled)
        switch_button.setChecked(is_enabled)

        # 最后注册事件，避免在页面初始化的过程中重置设置数据
        switch_button.checkedChanged.connect(
            lambda checked: self.checked_changed(
                slider,
                value_label,
                checked,
                field_name,
                default_value,
            )
        )
        slider.sliderReleased.connect(
            lambda: self.slider_released(slider, value_label, field_name)
        )

        card.add_right_widget(slider_container)
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    def emit_json_format_error_toast(self) -> None:
        """统一提示 JSON 格式错误，避免 Headers 与 Body 分支各自拼事件。"""

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().model_advanced_setting_page_json_format_error,
            },
        )

    def validate_and_save_request_field(
        self,
        plain_text_edit: CustomTextEdit,
        field_name: str,
    ) -> bool:
        """校验并保存请求 JSON，保证 Headers/Body 走同一条规则。"""

        text = plain_text_edit.toPlainText().strip()
        if text == "":
            plain_text_edit.set_error(False)
            self.save_request_field(field_name, {})
            return True

        if not self.is_valid_request_json_text(text):
            plain_text_edit.set_error(True)
            return False

        parsed = JSONTool.loads(text)
        plain_text_edit.set_error(False)
        self.save_request_field(field_name, parsed)
        return True

    def is_valid_request_json_text(self, text: str) -> bool:
        """统一判断请求 JSON 是否为对象，避免不同交互路径各自实现一遍。"""

        try:
            parsed = JSONTool.loads(text)
        except Exception:
            return False

        return isinstance(parsed, dict)

    def handle_request_field_focus_out(self, plain_text_edit: CustomTextEdit) -> None:
        """失焦时只在内容非法时提示，避免输入过程中频繁打断。"""

        text = plain_text_edit.toPlainText().strip()
        if text == "":
            return

        if not self.is_valid_request_json_text(text):
            self.emit_json_format_error_toast()

    def add_request_json_group(
        self,
        parent: QLayout,
        *,
        title: str,
        description: str,
        placeholder: str,
        field_name: str,
        enabled_field_name: str,
    ) -> None:
        """统一构建请求配置分组，避免 Headers 与 Body 的结构再次分叉。"""

        request_config = self.model.request

        def switch_changed(checked: bool, plain_text_edit: CustomTextEdit) -> None:
            plain_text_edit.setReadOnly(not checked)
            self.update_model_fields(
                {
                    "request": {
                        enabled_field_name: checked,
                    }
                }
            )

        def init(widget: GroupCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            is_enabled = bool(getattr(request_config, enabled_field_name))
            switch_button.setChecked(is_enabled)
            widget.add_header_widget(switch_button)

            plain_text_edit = CustomTextEdit(self, monospace=True)
            plain_text_edit.setFixedHeight(192)
            request_field = getattr(request_config, field_name)
            if request_field:
                plain_text_edit.setPlainText(JSONTool.dumps(request_field, indent=4))
            plain_text_edit.setPlaceholderText(placeholder)
            plain_text_edit.setReadOnly(not is_enabled)
            plain_text_edit.textChanged.connect(
                lambda: self.validate_and_save_request_field(
                    plain_text_edit,
                    field_name,
                )
            )
            plain_text_edit.set_on_focus_out(
                lambda: self.handle_request_field_focus_out(plain_text_edit)
            )
            widget.add_widget(plain_text_edit)

            switch_button.checkedChanged.connect(
                lambda checked: switch_changed(checked, plain_text_edit)
            )

        parent.addWidget(
            GroupCard(
                parent=self,
                title=title,
                description=description,
                init=init,
            )
        )

    # 自定义请求配置
    def add_widget_request_config(self, parent: QLayout) -> None:
        self.add_request_json_group(
            parent,
            title=Localizer.get().model_advanced_setting_page_headers_title,
            description=Localizer.get().model_advanced_setting_page_headers_content,
            placeholder=Localizer.get().model_advanced_setting_page_headers_placeholder,
            field_name="extra_headers",
            enabled_field_name="extra_headers_custom_enable",
        )
        self.add_request_json_group(
            parent,
            title=Localizer.get().model_advanced_setting_page_body_title,
            description=Localizer.get().model_advanced_setting_page_body_content,
            placeholder=Localizer.get().model_advanced_setting_page_body_placeholder,
            field_name="extra_body",
            enabled_field_name="extra_body_custom_enable",
        )

    def save_request_field(
        self,
        field: str,
        value: dict[str, object],
    ) -> None:
        """保存请求配置字段"""
        self.update_model_fields({"request": {field: value}})
