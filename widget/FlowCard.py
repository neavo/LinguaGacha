from typing import Callable

from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import CardWidget
from qfluentwidgets import FlowLayout
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

from widget.Separator import Separator

class FlowCard(CardWidget):

    def __init__(self, parent: QWidget, title: str, description: str, init: Callable = None, clicked: Callable = None) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 添加头部容器
        self.head_container = QWidget(self)
        self.head_hbox = QHBoxLayout(self.head_container)
        self.head_hbox.setSpacing(8)
        self.head_hbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.head_container)

        # 添加文本容器
        self.text_container = QWidget(self)
        self.text_vbox = QVBoxLayout(self.text_container)
        self.text_vbox.setSpacing(8)
        self.text_vbox.setContentsMargins(0, 0, 0, 0)
        self.head_hbox.addWidget(self.text_container)

        self.title_label = StrongBodyLabel(title, self)
        self.text_vbox.addWidget(self.title_label)

        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.text_vbox.addWidget(self.description_label)

        # 填充
        self.head_hbox.addStretch(1)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加流式布局容器
        self.flow_container = QWidget(self)
        self.flow_layout = FlowLayout(self.flow_container, needAni = False)
        self.flow_layout.setSpacing(8)
        self.flow_layout.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.flow_container)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda : clicked(self))

    def get_title_label(self) -> StrongBodyLabel:
        return self.title_label

    def get_description_label(self) -> CaptionLabel:
        return self.description_label

    # 添加控件
    def add_widget(self, widget: QWidget) -> None:
        self.flow_layout.addWidget(widget)

    # 添加控件到头部
    def add_widget_to_head(self, widget: QWidget) -> None:
        self.head_hbox.addWidget(widget)

    # 移除所有控件并且删除他们
    def take_all_widgets(self) -> None:
        self.flow_layout.takeAllWidgets()