from typing import Callable

from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import CardWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

from widget.Separator import Separator

class GroupCard(CardWidget):

    def __init__(self, parent: QWidget, title: str, description: str, init: Callable = None, clicked: Callable = None) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        self.title_label = StrongBodyLabel(title, self)
        self.root.addWidget(self.title_label)

        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.root.addWidget(self.description_label)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加流式布局容器
        self.vbox_container = QWidget(self)
        self.vbox = QVBoxLayout(self.vbox_container)
        self.vbox.setSpacing(0)
        self.vbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.vbox_container)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda : clicked(self))

    # 添加控件
    def add_widget(self, widget) -> None:
        self.vbox.addWidget(widget)