from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import SwitchButton

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.SliderCard import SliderCard

class ModelRequestSettingPage(MessageBoxBase, Base):

    TOP_P_DEFAULT: float = 0.95
    TEMPERATURE_DEFAULT: float = 0.95
    PRESENCE_PENALTY_DEFAULT: float = 0.00
    FREQUENCY_PENALTY_DEFAULT: float = 0.00

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

        # 从 generation 中读取参数（兼容新数据结构）
        self.generation = self.model.get("generation", {})

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

        # 将滚动区域添加到父布局
        self.viewLayout.addWidget(scroll_area)

        # 添加控件
        self.add_widget_top_p(scroll_area_vbox, config, window)
        self.add_widget_temperature(scroll_area_vbox, config, window)
        self.add_widget_presence_penalty(scroll_area_vbox, config, window)
        self.add_widget_frequency_penalty(scroll_area_vbox, config, window)
        self.add_widget_url(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 获取生成参数值
    def get_generation_value(self, key: str, default: float = 0.0) -> float:
        return self.generation.get(key, default)

    # 获取生成参数启用状态
    def get_generation_enable(self, key: str) -> bool:
        return self.generation.get(f"{key}_custom_enable", False)

    # 滑动条释放事件
    def slider_released(self, widget: SliderCard, arg: str) -> None:
        value = widget.get_slider().value()
        widget.get_value_label().setText(f"{(value / 100):.2f}")

        # 更新配置文件
        config = Config().load()
        self.model = config.get_model(self.model_id)
        if "generation" not in self.model:
            self.model["generation"] = {}
        self.model["generation"][arg] = value / 100
        config.set_model(self.model)
        config.save()

    # 开关状态变化事件
    def checked_changed(self, widget: SliderCard, checked: bool, arg: str) -> None:
        if checked:
            widget.set_slider_visible(True)
        else:
            widget.set_slider_visible(False)

        # 重置为默认值
        default_value = getattr(__class__, f"{arg.upper()}_DEFAULT")
        widget.get_value_label().setText(f"{default_value:.2f}")
        widget.get_slider().setValue(int(default_value * 100))

        # 更新配置文件
        config = Config().load()
        self.model = config.get_model(self.model_id)
        if "generation" not in self.model:
            self.model["generation"] = {}
        self.model["generation"][arg] = default_value
        self.model["generation"][f"{arg}_custom_enable"] = checked
        config.set_model(self.model)
        config.save()

    # top_p
    def add_widget_top_p(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            value = self.get_generation_value("top_p", 0.95)
            widget.get_slider().setRange(0, 100)
            widget.get_slider().setValue(int(value * 100))
            widget.get_value_label().setText(f"{value:.2f}")

            # 设置可见性
            is_enabled = self.get_generation_enable("top_p")
            widget.set_slider_visible(is_enabled)
            switch_button.setChecked(is_enabled)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "top_p"))

        parent.addWidget(
            SliderCard(
                title=Localizer.get().model_request_setting_page_top_p_title,
                description=Localizer.get().model_request_setting_page_top_p_content,
                init=init,
                slider_released=lambda widget: self.slider_released(widget, "top_p"),
            )
        )

    # temperature
    def add_widget_temperature(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            value = self.get_generation_value("temperature", 0.95)
            widget.get_slider().setRange(0, 200)
            widget.get_slider().setValue(int(value * 100))
            widget.get_value_label().setText(f"{value:.2f}")

            # 设置可见性
            is_enabled = self.get_generation_enable("temperature")
            widget.set_slider_visible(is_enabled)
            switch_button.setChecked(is_enabled)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "temperature"))

        parent.addWidget(
            SliderCard(
                title=Localizer.get().model_request_setting_page_temperature_title,
                description=Localizer.get().model_request_setting_page_temperature_content,
                init=init,
                slider_released=lambda widget: self.slider_released(widget, "temperature"),
            )
        )

    # presence_penalty
    def add_widget_presence_penalty(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            value = self.get_generation_value("presence_penalty", 0.0)
            widget.get_slider().setRange(0, 100)
            widget.get_slider().setValue(int(value * 100))
            widget.get_value_label().setText(f"{value:.2f}")

            # 设置可见性
            is_enabled = self.get_generation_enable("presence_penalty")
            widget.set_slider_visible(is_enabled)
            switch_button.setChecked(is_enabled)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "presence_penalty"))

        parent.addWidget(
            SliderCard(
                title=Localizer.get().model_request_setting_page_presence_penalty_title,
                description=Localizer.get().model_request_setting_page_presence_penalty_content,
                init=init,
                slider_released=lambda widget: self.slider_released(widget, "presence_penalty"),
            )
        )

    # frequency_penalty
    def add_widget_frequency_penalty(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            value = self.get_generation_value("frequency_penalty", 0.0)
            widget.get_slider().setRange(0, 100)
            widget.get_slider().setValue(int(value * 100))
            widget.get_value_label().setText(f"{value:.2f}")

            # 设置可见性
            is_enabled = self.get_generation_enable("frequency_penalty")
            widget.set_slider_visible(is_enabled)
            switch_button.setChecked(is_enabled)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "frequency_penalty"))

        parent.addWidget(
            SliderCard(
                title=Localizer.get().model_request_setting_page_frequency_penalty_title,
                description=Localizer.get().model_request_setting_page_frequency_penalty_content,
                init=init,
                slider_released=lambda widget: self.slider_released(widget, "frequency_penalty"),
            )
        )

    # 添加链接
    def add_widget_url(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        api_format = self.model.get("api_format", "")
        if api_format == Base.APIFormat.GOOGLE:
            url = "https://ai.google.dev/gemini-api/docs/thinking"
        elif api_format == Base.APIFormat.ANTHROPIC:
            url = "https://docs.anthropic.com/en/api/getting-started"
        elif api_format == Base.APIFormat.SAKURALLM:
            url = "https://github.com/SakuraLLM/SakuraLLM#%E6%8E%A8%E7%90%86"
        else:
            url = "https://platform.openai.com/docs/api-reference/chat/create"

        hyper_link_label = HyperlinkLabel(QUrl(url), Localizer.get().model_request_setting_page_document_link)
        hyper_link_label.setUnderlineVisible(True)

        parent.addSpacing(16)
        parent.addWidget(hyper_link_label, alignment=Qt.AlignmentFlag.AlignHCenter)
