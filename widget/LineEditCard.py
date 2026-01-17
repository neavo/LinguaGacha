from typing import Callable

from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import StrongBodyLabel

from widget.CustomLineEdit import CustomLineEdit

class LineEditCard(CardWidget):

    def __init__(self, title: str, description: str, init: Callable = None, text_changed: Callable = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.vbox_container = QWidget(self)
        self.vbox = QVBoxLayout(self.vbox_container)
        self.vbox.setSpacing(0)
        self.vbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.vbox_container)

        self.title_label = StrongBodyLabel(title, self)
        self.vbox.addWidget(self.title_label)

        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.vbox.addWidget(self.description_label)

        # 填充
        self.root.addStretch(1)

        # 添加控件
        self.line_edit = CustomLineEdit()
        self.line_edit.setFixedWidth(192)
        self.line_edit.setClearButtonEnabled(True)
        self.root.addWidget(self.line_edit)

        if callable(init):
            init(self)

        if callable(text_changed):
            self.line_edit.textChanged.connect(lambda text: text_changed(self, text))

    def get_line_edit(self) -> CustomLineEdit:
        return self.line_edit

    # 添加控件
    def add_widget(self, widget) -> None:
        self.root.addWidget(widget)

    # 添加间隔
    def add_spacing(self, spacing: int) -> None:
        self.root.addSpacing(spacing)