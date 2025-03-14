from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import FlowLayout
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import CaptionLabel
from qfluentwidgets import SubtitleLabel
from qfluentwidgets import TransparentToolButton

from base.Base import Base
from module.Localizer.Localizer import Localizer

class ItemCard(CardWidget):

    def __init__(self, title: str, description: str, init = None, clicked = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setFixedSize(300, 150)
        self.setBorderRadius(4)
        self.vbox = QVBoxLayout(self)
        self.vbox.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 添加标题
        self.head_hbox_container = QWidget(self)
        self.head_hbox = QHBoxLayout(self.head_hbox_container)
        self.head_hbox.setSpacing(0)
        self.head_hbox.setContentsMargins(0, 0, 0, 0)
        self.vbox.addWidget(self.head_hbox_container)

        self.title_label = SubtitleLabel(title, self)
        self.head_hbox.addWidget(self.title_label)
        self.head_hbox.addStretch(1)
        self.title_button = TransparentToolButton(FluentIcon.MORE)
        self.head_hbox.addWidget(self.title_button)

        # 添加分割线
        line = QWidget(self)
        line.setFixedHeight(1)
        line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
        self.vbox.addSpacing(4)
        self.vbox.addWidget(line)
        self.vbox.addSpacing(4)

        # 添加描述
        self.description_label = CaptionLabel(description, self)
        self.description_label.setWordWrap(True)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.vbox.addWidget(self.description_label, 1)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda : clicked(self))
            self.title_button.clicked.connect(lambda : clicked(self))


class ToolBoxPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入配置文件
        config = self.load_config()

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加流式布局容器
        self.flow_container = QWidget(self)
        self.flow_layout = FlowLayout(self.flow_container, needAni = False)
        self.flow_layout.setSpacing(8)
        self.flow_layout.setContentsMargins(0, 0, 0, 0)
        self.vbox.addWidget(self.flow_container)

        # 添加控件
        self.add_re_translation(self.flow_layout, config, window)

    # 部分重翻
    def add_re_translation(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def clicked(widget: ItemCard) -> None:
            window.switchTo(window.re_translation_page)

        self.re_translation = ItemCard(
            title = Localizer.get().tool_box_page_re_translation,
            description = Localizer.get().tool_box_page_re_translation_desc,
            init = None,
            clicked = clicked,
        )
        parent.addWidget(self.re_translation)