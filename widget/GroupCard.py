from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import CardWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

class GroupCard(CardWidget):

    def __init__(self, title: str, description: str, init = None) -> None:
        super().__init__(None)

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
        line = QWidget(self)
        line.setFixedHeight(1)
        line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
        self.root.addSpacing(4)
        self.root.addWidget(line)
        self.root.addSpacing(4)

        # 添加流式布局容器
        self.vbox_container = QWidget(self)
        self.vbox = QVBoxLayout(self.vbox_container)
        self.vbox.setSpacing(0)
        self.vbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.vbox_container)

        if callable(init):
            init(self)

    def set_title(self, title: str) -> None:
        self.title_label.setText(title)

    def set_description(self, description: str) -> None:
        self.description_label.setText(description)

    # 添加控件
    def addWidget(self, widget) -> None:
        self.vbox.addWidget(widget)

    # 添加分割线
    def addSeparator(self) -> None:
        line = QWidget(self)
        line.setFixedHeight(1)
        line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
        self.vbox.addSpacing(4)
        self.vbox.addWidget(line)
        self.vbox.addSpacing(4)