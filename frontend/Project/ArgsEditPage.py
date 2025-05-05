from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import FluentWindow
from qfluentwidgets import SwitchButton
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.SliderCard import SliderCard

class ArgsEditPage(MessageBoxBase, Base):

    TOP_P_DEFAULT: float = 0.95
    TEMPERATURE_DEFAULT: float = 0.95
    PRESENCE_PENALTY_DEFAULT: float = 0.00
    FREQUENCY_PENALTY_DEFAULT: float = 0.00

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取平台配置
        self.platform = config.get_platform(id)

        # 设置主布局
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient = Qt.Orientation.Vertical)
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

    # 滑动条释放事件
    def slider_released(self, widget: SliderCard, arg: str) -> None:
        value = widget.get_value()
        widget.set_text(f"{(value / 100):.2f}")

        # 更新配置文件
        config = Config().load()
        self.platform[arg] = value / 100
        config.set_platform(self.platform)
        config.save()

    # 开关状态变化事件
    def checked_changed(self, widget: SliderCard, checked: bool, arg: str) -> None:
        if checked == True:
            widget.set_visible(True)
        else:
            widget.set_visible(False)

        # 重置为默认值
        self.platform[arg] = getattr(__class__, f"{arg.upper()}_DEFAULT")
        widget.set_text(f"{getattr(__class__, f"{arg.upper()}_DEFAULT"):.2f}")
        widget.set_value(int(getattr(__class__, f"{arg.upper()}_DEFAULT") * 100))

        # 更新配置文件
        config = Config().load()
        self.platform[f"{arg}_custom_enable"] = checked
        config.set_platform(self.platform)
        config.save()

    # top_p
    def add_widget_top_p(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            widget.set_range(0, 100)
            widget.set_text(f"{self.platform.get("top_p"):.2f}")
            widget.set_value(int(self.platform.get("top_p") * 100))

            # 设置可见性
            widget.set_visible(self.platform.get("top_p_custom_enable") == True)
            switch_button.setChecked(self.platform.get("top_p_custom_enable") == True)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "top_p"))

        parent.addWidget(
            SliderCard(
                title = Localizer.get().args_edit_page_top_p_title,
                description = Localizer.get().args_edit_page_top_p_content,
                init = init,
                slider_released = lambda widget: self.slider_released(widget, "top_p"),
            )
        )

    # temperature
    def add_widget_temperature(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            widget.set_range(0, 200)
            widget.set_text(f"{self.platform.get("temperature"):.2f}")
            widget.set_value(int(self.platform.get("temperature") * 100))

            # 设置可见性
            widget.set_visible(self.platform.get("temperature_custom_enable") == True)
            switch_button.setChecked(self.platform.get("temperature_custom_enable") == True)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "temperature"))

        parent.addWidget(
            SliderCard(
                title = Localizer.get().args_edit_page_temperature_title,
                description = Localizer.get().args_edit_page_temperature_content,
                init = init,
                slider_released = lambda widget: self.slider_released(widget, "temperature"),
            )
        )

    # presence_penalty
    def add_widget_presence_penalty(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            widget.set_range(-200, 200)
            widget.set_text(f"{self.platform.get("presence_penalty"):.2f}")
            widget.set_value(int(self.platform.get("presence_penalty") * 100))

            # 设置可见性
            widget.set_visible(self.platform.get("presence_penalty_custom_enable") == True)
            switch_button.setChecked(self.platform.get("presence_penalty_custom_enable") == True)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "presence_penalty"))

        parent.addWidget(
            SliderCard(
                title = Localizer.get().args_edit_page_presence_penalty_title,
                description = Localizer.get().args_edit_page_presence_penalty_content,
                init = init,
                slider_released = lambda widget: self.slider_released(widget, "presence_penalty"),
            )
        )

    # frequency_penalty
    def add_widget_frequency_penalty(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SliderCard) -> None:
            switch_button = SwitchButton()
            switch_button.setOnText("")
            switch_button.setOffText("")
            widget.add_widget(switch_button)

            widget.set_range(-200, 200)
            widget.set_text(f"{self.platform.get("frequency_penalty"):.2f}")
            widget.set_value(int(self.platform.get("frequency_penalty") * 100))

            # 设置可见性
            widget.set_visible(self.platform.get("frequency_penalty_custom_enable") == True)
            switch_button.setChecked(self.platform.get("frequency_penalty_custom_enable") == True)

            # 最后注册事件，避免在页面初始化的过程中重置设置数据
            switch_button.checkedChanged.connect(lambda checked: self.checked_changed(widget, checked, "frequency_penalty"))

        parent.addWidget(
            SliderCard(
                title = Localizer.get().args_edit_page_frequency_penalty_title,
                description = Localizer.get().args_edit_page_frequency_penalty_content,
                init = init,
                slider_released = lambda widget: self.slider_released(widget, "frequency_penalty"),
            )
        )

    # 添加链接
    def add_widget_url(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
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
        parent.addWidget(hyper_link_label, alignment = Qt.AlignmentFlag.AlignHCenter)