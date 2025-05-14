from typing import Callable

from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import CardWidget
from qfluentwidgets import PushButton
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

class PushButtonCard(CardWidget):

    def __init__(self, title: str, description: str, init: Callable = None, clicked: Callable = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))

        self.vbox.addWidget(self.title_label)
        self.vbox.addWidget(self.description_label)
        self.root.addLayout(self.vbox)

        # 填充
        self.root.addStretch(1)

        # 添加控件
        self.push_button = PushButton("", self)
        self.root.addWidget(self.push_button)

        if callable(init):
            init(self)

        if callable(clicked):
            self.push_button.clicked.connect(lambda _: clicked(self))

    def add_widget(self, widget) -> None:
        return self.root.addWidget(widget)

    def add_spacing(self, spacing: int) -> None:
        self.root.addSpacing(spacing)

    def add_stretch(self, stretch: int) -> None:
        self.root.addStretch(stretch)

    def get_title_label(self) -> StrongBodyLabel:
        return self.title_label

    def get_description_label(self) -> CaptionLabel:
        return self.description_label

    def get_push_button(self) -> PushButton:
        return self.push_button