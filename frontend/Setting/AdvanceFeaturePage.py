from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentWindow

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.SwitchButtonCard import SwitchButtonCard

class AdvanceFeaturePage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "auto_glossary_enable": False,
            "mtool_optimizer_enable": False,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_mtool(self.vbox, config, window)
        self.add_widget_auto_glossary(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # MTool 优化器
    def add_widget_mtool(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def widget_init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("mtool_optimizer_enable"))

        def widget_callback(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config["mtool_optimizer_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().advance_feature_page_mtool_optimizer_enable_title,
                Localizer.get().advance_feature_page_mtool_optimizer_enable_content,
                widget_init,
                widget_callback,
            )
        )

    # 自动补全术语表
    def add_widget_auto_glossary(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def widget_init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("auto_glossary_enable"))

        def widget_callback(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config["auto_glossary_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().advance_feature_page_auto_glossary_enable_title,
                Localizer.get().advance_feature_page_auto_glossary_enable_content,
                widget_init,
                widget_callback,
            )
        )