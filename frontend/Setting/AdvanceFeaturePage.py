from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentWindow
from qfluentwidgets import PillPushButton

from base.Base import Base
from widget.FlowCard import FlowCard
from widget.Separator import Separator
from widget.ComboBoxCard import ComboBoxCard
from widget.SwitchButtonCard import SwitchButtonCard

class AdvanceFeaturePage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "auto_glossary_enable": False,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_auto_glossary_enable(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 自动补全术语表
    def add_widget_auto_glossary_enable(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def widget_init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get("auto_glossary_enable"))

        def widget_callback(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config["auto_glossary_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                "自动补全术语表（不支持 SakuraLLM 模型）",
                (
                    "启用此功能后，在翻译的同时将对文本进行分析，尝试自动补全术语表中缺失的专有名词条目。"
                    + "\n" + "此功能设计目的仅为查漏补缺，并不能代替手动制作的术语表，只有在 **启用术语表功能** 时才生效。"
                    + "\n" + "实验性功能，可能导致负面效果，请自行判断是否需要启用，在 DeepSeek V3/R1 等强力模型上理论上会有较好的效果。"
                ),
                widget_init,
                widget_callback,
            )
        )